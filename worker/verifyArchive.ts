// Verifikations-Archiv der eigenen Modelle (Varda, C-LAEF) — Begründung und
// Datenfluss in src/config/ownVerify.ts. Läuft stündlich im TAWES-Cron:
// übernimmt die Punktdateien, die die Ingests nach verify/points/<modell>/
// gelegt haben, in das Archiv je Station und löscht sie danach.
//
// Station für Station statt alles im Speicher: 290 Archive à bis zu 4
// Vorlaufzeiten × 2 Größen × 4.440 Stunden wären als JS-Arrays ~80 MB — zu
// nah an den 128 MB eines Workers. So liegt nur ein Archiv gleichzeitig offen,
// dazu die Punktdateien des Laufs (~0,2 MB je Lauf).
//
// R2: je Modell und Stunde mit neuen Läufen 290 Lese- und 290 Schreibvorgänge
// (C-LAEF kommt mit dem Deploy alle ~3 h, Varda alle 6 h) — ~5.000
// Schreibvorgänge am Tag, gut im Freikontingent.

import {
  ARCHIVE_DAYS,
  OWN_VERIFY_MODELS,
  POINTS_PREFIX,
  applyRun,
  archiveKey,
  emptyArchive,
  rebaseArchive,
  type PointRun,
  type StationArchive,
} from '../src/config/ownVerify'
import { listKeys, type R2BucketLike } from './r2'

const HOUR = 3_600_000
/** Höchstens so viele Läufe je Modell und Durchgang (nach einem Ausfall). */
const MAX_RUNS = 12
const CONCURRENCY = 12

async function readJson<T>(bucket: R2BucketLike, key: string): Promise<T | null> {
  const obj = await bucket.get(key)
  if (!obj || !('text' in obj)) return null
  try {
    return JSON.parse(await obj.text()) as T
  } catch {
    return null
  }
}

export async function updateVerifyArchive(bucket: R2BucketLike, now = Date.now()): Promise<string> {
  const notes: string[] = []
  for (const model of OWN_VERIFY_MODELS) {
    try {
      notes.push(`${model.id}: ${await updateModel(bucket, model.id, model.leads, now)}`)
    } catch (err) {
      notes.push(`${model.id}: Fehler ${err}`)
    }
  }
  return `Verifikationsarchiv: ${notes.join(' · ')}`
}

async function updateModel(bucket: R2BucketLike, model: string, leads: number[], now: number): Promise<string> {
  const keys = [...(await listKeys(bucket, `${POINTS_PREFIX}${model}/`))].filter((k) => k.endsWith('.json')).sort()
  if (keys.length === 0) return 'nichts Neues'
  const take = keys.slice(0, MAX_RUNS)
  const runs: PointRun[] = []
  for (const k of take) {
    const r = await readJson<PointRun>(bucket, k)
    if (r) runs.push(r)
  }
  runs.sort((a, b) => a.initMs - b.initMs)
  const startMs = Math.floor((now - ARCHIVE_DAYS * 86_400_000) / HOUR) * HOUR

  // Stationen über alle Läufe (normal überall dieselben 290)
  const stations = new Set<number>()
  for (const r of runs) for (const id of r.stations) stations.add(id)
  const ids = [...stations]
  let late = 0
  let written = 0

  const work = async (id: number) => {
    const old = await readJson<StationArchive>(bucket, archiveKey(model, id))
    let a = old ? rebaseArchive(old, startMs) : emptyArchive(startMs)
    let changed = false
    for (const r of runs) {
      const row = r.stations.indexOf(id)
      if (row < 0) continue
      // Station ganz außerhalb des Modellgebiets: nichts anlegen
      if (!old && !changed && r.t2m[row].every((v) => v == null)) continue
      if (applyRun(a, r, row, leads)) changed = true
      else late++
    }
    if (!changed && (!old || old.startMs === startMs)) return
    a = trimTail(a)
    await bucket.put(archiveKey(model, id), JSON.stringify(a), {
      httpMetadata: { contentType: 'application/json' },
    })
    written++
  }
  for (let i = 0; i < ids.length; i += CONCURRENCY) await Promise.all(ids.slice(i, i + CONCURRENCY).map(work))

  await bucket.delete(take)
  await bucket.put(
    `verify/${model}/index.json`,
    JSON.stringify({ updated: now, lastInit: runs.length ? runs[runs.length - 1].initMs : null, startMs, stations: written }),
    { httpMetadata: { contentType: 'application/json' } },
  )
  const lateNote = late ? `, ${late} zu spät gekommene Stationsläufe verworfen` : ''
  return `${runs.length} Läufe (${runs.map((r) => r.runId).join(', ')}) → ${written} Stationsarchive${lateNote}`
}

/** Hängende Nullen am Ende weglassen — die Datei wächst sonst nur um Lücken. */
function trimTail(a: StationArchive): StationArchive {
  for (const v of Object.values(a.leads))
    for (const arr of [v.t, v.p]) while (arr.length && arr[arr.length - 1] == null) arr.pop()
  return a
}
