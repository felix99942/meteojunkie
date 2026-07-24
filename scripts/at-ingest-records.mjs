// Ingest der Rekorde/Extreme aus dem Monatsdatensatz klima-v2-1m
// (Österreich-Klimakarte, Schritt 5b).
//
// Je Station und Parameter der höchste/niedrigste Monatswert mit Datum, plus
// österreichweite (nationale) Extreme. BEWUSSTE GRENZE: ab 1900 (die wenigen
// Reihen bis ins 18. Jh. — z.B. Wien ab 1767 — bleiben außen vor; das hält den
// Ingest überschaubar). Aus Monatswerten, keine Einzeltag-Rekorde.
//
//   node scripts/at-ingest-records.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1m'
const META = `${BASE}/metadata`
const START = '1900-01-01'
const END = '2026-07-01'
const CHUNK = 80
const DELAY_MS = 400

// Codes + ob negative Werte Fehlwerte sind (Niederschlag/Sonne).
const CODES = [
  { code: 'tl_mittel', nonNeg: false },
  { code: 'tlmax', nonNeg: false },
  { code: 'tlmin', nonNeg: false },
  { code: 'rr', nonNeg: true },
  { code: 'so_h', nonNeg: true },
]

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function url(codes, ids) {
  return `${BASE}?parameters=${codes}&start=${START}&end=${END}&station_ids=${ids.join(',')}&output_format=geojson`
}

async function fetchChunk(codes, ids) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const res = await fetch(url(codes, current))
    if (res.ok) return res.json()
    const body = await res.text()
    const bad = body.match(/station_ids:\s*'(\d+)'/)
    if (res.status === 403 && bad) {
      current = current.filter((id) => id !== Number(bad[1]))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(DELAY_MS * (attempt + 1) * 4)
      continue
    }
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  return { features: [], timestamps: [] }
}

async function main() {
  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  const nameById = new Map(stationsRaw.stations.map((s) => [s.id, s.name]))
  const metaRes = await fetch(META)
  if (!metaRes.ok) throw new Error(`Metadaten HTTP ${metaRes.status}`)
  const monthlyIds = new Set((await metaRes.json()).stations.map((s) => s.id))
  const ids = stationsRaw.stations.map((s) => s.id).filter((id) => monthlyIds.has(id))

  const codesStr = CODES.map((c) => c.code).join(',')
  const byStation = {}
  const national = {}

  for (let i = 0; i < ids.length; i += CHUNK) {
    const geo = await fetchChunk(codesStr, ids.slice(i, i + CHUNK))
    const months = (geo.timestamps ?? []).map((t) => t.slice(0, 7)) // YYYY-MM

    for (const f of geo.features ?? []) {
      const id = f.properties.station
      const per = {}
      for (const c of CODES) {
        const data = f.properties.parameters?.[c.code]?.data
        if (!data) continue
        let max = null
        let min = null
        for (let k = 0; k < data.length; k++) {
          const v = data[k]
          if (v == null || !Number.isFinite(v) || (c.nonNeg && v < 0)) continue
          if (!max || v > max.value) max = { value: v, date: months[k] }
          if (!min || v < min.value) min = { value: v, date: months[k] }
        }
        if (max && min) {
          per[c.code] = { max, min }
          // national fortschreiben
          const nat = (national[c.code] ??= { max: null, min: null })
          if (!nat.max || max.value > nat.max.value)
            nat.max = { ...max, station: id, name: nameById.get(id) ?? String(id) }
          if (!nat.min || min.value < nat.min.value)
            nat.min = { ...min, station: id, name: nameById.get(id) ?? String(id) }
        }
      }
      if (Object.keys(per).length) byStation[id] = per
    }
    process.stdout.write(`Chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)}: ${Object.keys(byStation).length} Stationen\n`)
    await sleep(DELAY_MS)
  }

  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'records.json'),
    JSON.stringify(
      { meta: { source: BASE, since: START, note: 'Monatsextreme, keine Einzeltag-Rekorde' }, byStation, national },
      null,
      0,
    ),
  )
  process.stdout.write(`Geschrieben: public/at/records.json (${Object.keys(byStation).length} Stationen)\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
