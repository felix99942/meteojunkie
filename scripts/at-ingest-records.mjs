// Ingest der Rekorde aus dem Monatsdatensatz klima-v2-1m
// (Österreich-Klimakarte, Schritt 5b, erweitert).
//
// Je Station und Parameter drei Rekord-Ebenen:
//   abs — absoluter Stationsrekord (höchster/niedrigster Monatswert überhaupt)
//   mon — Monatsrekorde je Kalendermonat (z.B. wärmster Juli, kältester Jänner)
//   sea — Saisonrekorde je Jahreszeit (DJF/MAM/JJA/SON; Winter = Dez+Jän+Feb)
// plus österreichweite absolute Rekorde (national).
//
// Ausgabe: EINE kleine Datei je Station unter public/at/records/<id>.json
// (nur die angeklickte Station wird im Browser geladen) + _national.json.
// Aus Monatswerten, ab 1900. Keine echten Einzeltag-Rekorde.
//
//   node scripts/at-ingest-records.mjs

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1m'
const META = `${BASE}/metadata`
const START = '1900-01-01'
const END = '2026-07-01'
const CHUNK = 80
const DELAY_MS = 400

// code + Saison-/Fehlwert-Semantik: seasonAgg = wie 3 Monate zu einem
// Saisonwert werden, nonNeg = negative Werte sind Fehlwerte.
const CODES = [
  { code: 'tl_mittel', seasonAgg: 'mean', nonNeg: false },
  { code: 'tlmax', seasonAgg: 'max', nonNeg: false },
  { code: 'tlmin', seasonAgg: 'min', nonNeg: false },
  { code: 'rr', seasonAgg: 'sum', nonNeg: true },
  { code: 'so_h', seasonAgg: 'sum', nonNeg: true },
]

// Monat (1..12) → Saison + Saison-Jahr-Versatz (Dez zählt zum Winter des Folgejahrs).
const SEASON = {
  12: ['DJF', 1], 1: ['DJF', 0], 2: ['DJF', 0],
  3: ['MAM', 0], 4: ['MAM', 0], 5: ['MAM', 0],
  6: ['JJA', 0], 7: ['JJA', 0], 8: ['JJA', 0],
  9: ['SON', 0], 10: ['SON', 0], 11: ['SON', 0],
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')
const outDir = join(dir, 'records')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const reduce = (vals, mode) => {
  if (!vals.length) return null
  if (mode === 'sum') return vals.reduce((a, b) => a + b, 0)
  if (mode === 'max') return Math.max(...vals)
  if (mode === 'min') return Math.min(...vals)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
const r2 = (v) => Math.round(v * 100) / 100

function urlFor(codes, ids) {
  return `${BASE}?parameters=${codes}&start=${START}&end=${END}&station_ids=${ids.join(',')}&output_format=geojson`
}

async function fetchChunk(codes, ids) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const res = await fetch(urlFor(codes, current))
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

/** Extrem aktualisieren: {v, ...tag} bei max bzw. min. */
function bump(rec, value, tag) {
  if (!rec.max || value > rec.max.v) rec.max = { v: r2(value), ...tag }
  if (!rec.min || value < rec.min.v) rec.min = { v: r2(value), ...tag }
}

async function main() {
  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  const nameById = new Map(stationsRaw.stations.map((s) => [s.id, s.name]))
  const metaRes = await fetch(META)
  if (!metaRes.ok) throw new Error(`Metadaten HTTP ${metaRes.status}`)
  const monthlyIds = new Set((await metaRes.json()).stations.map((s) => s.id))
  const ids = stationsRaw.stations.map((s) => s.id).filter((id) => monthlyIds.has(id))

  const codesStr = CODES.map((c) => c.code).join(',')
  const national = {}
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  let written = 0

  for (let i = 0; i < ids.length; i += CHUNK) {
    const geo = await fetchChunk(codesStr, ids.slice(i, i + CHUNK))
    const ts = geo.timestamps ?? []
    const yr = ts.map((t) => Number(t.slice(0, 4)))
    const mo = ts.map((t) => Number(t.slice(5, 7)))

    for (const f of geo.features ?? []) {
      const id = f.properties.station
      const perCode = {}
      for (const c of CODES) {
        const data = f.properties.parameters?.[c.code]?.data
        if (!data) continue
        const abs = { max: null, min: null }
        const mon = Array.from({ length: 12 }, () => ({ max: null, min: null }))
        const seasonBuckets = new Map() // "SEASON|year" → [values]

        for (let k = 0; k < data.length; k++) {
          const v = data[k]
          if (v == null || !Number.isFinite(v) || (c.nonNeg && v < 0)) continue
          const m = mo[k]
          const y = yr[k]
          bump(abs, v, { d: ts[k].slice(0, 7) })
          bump(mon[m - 1], v, { y })
          const [season, off] = SEASON[m]
          const skey = `${season}|${y + off}`
          if (!seasonBuckets.has(skey)) seasonBuckets.set(skey, [])
          seasonBuckets.get(skey).push(v)
        }

        // Saisonwerte je Jahr aggregieren (nur vollständige Saisons mit 3 Monaten)
        const sea = { DJF: { max: null, min: null }, MAM: { max: null, min: null }, JJA: { max: null, min: null }, SON: { max: null, min: null } }
        for (const [skey, vals] of seasonBuckets) {
          if (vals.length !== 3) continue
          const [season, y] = skey.split('|')
          bump(sea[season], reduce(vals, c.seasonAgg), { y: Number(y) })
        }

        if (abs.max && abs.min) {
          perCode[c.code] = { abs, mon, sea }
          const nat = (national[c.code] ??= { max: null, min: null })
          if (!nat.max || abs.max.v > nat.max.v) nat.max = { ...abs.max, s: id, n: nameById.get(id) ?? String(id) }
          if (!nat.min || abs.min.v < nat.min.v) nat.min = { ...abs.min, s: id, n: nameById.get(id) ?? String(id) }
        }
      }
      if (Object.keys(perCode).length) {
        await writeFile(join(outDir, `${id}.json`), JSON.stringify(perCode))
        written++
      }
    }
    process.stdout.write(`Chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)}: ${written} Stationsdateien\n`)
    await sleep(DELAY_MS)
  }

  await writeFile(
    join(outDir, '_national.json'),
    JSON.stringify({ meta: { source: BASE, since: START, note: 'Monatsextreme, keine Einzeltag-Rekorde' }, national }),
  )
  process.stdout.write(`Geschrieben: public/at/records/*.json (${written} Stationen) + _national.json\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
