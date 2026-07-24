// Ingest der langjährigen Normale 1991–2020 (Österreich-Klimakarte, Schritt 5).
//
// Aus dem Monatsdatensatz klima-v2-1m je Station und Parameter:
//   - monthly[1..12]: Mittel des jeweiligen Kalendermonats über 1991–2020
//   - annual: Mittel der 30 Jahres-Werte (Jahres-Wert = annualAgg über die 12
//     Monate desselben Jahres) — so, wie die Karte den Jahreswert bildet, damit
//     Anomalien konsistent sind.
// Ergebnis: public/at/normals.json. Läuft manuell / in CI vor dem Build.
//
//   node scripts/at-ingest-normals.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1m'
const META = `${BASE}/metadata`
const START = '1991-01-01'
const END = '2020-12-01'
const CHUNK = 80
const DELAY_MS = 400 // Pause zwischen Requests (Rate-Limit 5/s, 240/h)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildUrl(codes, ids) {
  return `${BASE}?parameters=${codes}&start=${START}&end=${END}&station_ids=${ids.join(',')}&output_format=geojson`
}

/**
 * Chunk holen und dabei einzelne ungültige/gesperrte Stations-IDs tolerieren:
 * Der Hub 403t den GESAMTEN Request wegen EINER unbekannten ID
 * ("Violation for station_ids: 'X'") — die parsen, entfernen, erneut versuchen.
 * 429/5xx → kurzer Backoff.
 */
async function fetchChunk(codes, ids) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const res = await fetch(buildUrl(codes, current))
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

// Monatscodes + Jahres-Aggregat (Spiegel der Registry in config/atParameters.ts).
const PARAMS = [
  { code: 'tl_mittel', annual: 'mean', nonNeg: false },
  { code: 'tlmax', annual: 'max', nonNeg: false },
  { code: 'tlmin', annual: 'min', nonNeg: false },
  { code: 'rr', annual: 'sum', nonNeg: true },
  { code: 'so_h', annual: 'sum', nonNeg: true },
  { code: 'rf_mittel', annual: 'mean', nonNeg: false },
]

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100)

function reduce(vals, mode) {
  if (!vals.length) return null
  switch (mode) {
    case 'sum': return vals.reduce((a, b) => a + b, 0)
    case 'max': return Math.max(...vals)
    case 'min': return Math.min(...vals)
    default: return mean(vals)
  }
}

async function main() {
  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  // Nur Stationen nutzen, die es im MONATSdatensatz gibt — sonst 403t der Request.
  const metaRes = await fetch(META)
  if (!metaRes.ok) throw new Error(`Monats-Metadaten HTTP ${metaRes.status}`)
  const monthlyIds = new Set((await metaRes.json()).stations.map((s) => s.id))
  const ids = stationsRaw.stations.map((s) => s.id).filter((id) => monthlyIds.has(id))
  process.stdout.write(`Stationen im Monatsdatensatz: ${ids.length} von ${stationsRaw.stations.length}\n`)

  const codes = PARAMS.map((p) => p.code).join(',')
  const normals = {}
  let withData = 0

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const geo = await fetchChunk(codes, chunk)
    const months = (geo.timestamps ?? []).map((t) => Number(t.slice(5, 7))) // 1..12
    const years = (geo.timestamps ?? []).map((t) => Number(t.slice(0, 4)))

    for (const f of geo.features ?? []) {
      const id = f.properties.station
      const perCode = {}
      let any = false
      for (const p of PARAMS) {
        const data = f.properties.parameters?.[p.code]?.data
        if (!data) continue
        // gültige Werte je Kalendermonat und je Jahr sammeln
        const byMonth = Array.from({ length: 12 }, () => [])
        const byYear = new Map()
        for (let k = 0; k < data.length; k++) {
          let v = data[k]
          if (v == null || !Number.isFinite(v) || (p.nonNeg && v < 0)) continue
          byMonth[months[k] - 1].push(v)
          const y = years[k]
          if (!byYear.has(y)) byYear.set(y, [])
          byYear.get(y).push(v)
        }
        const monthly = byMonth.map((vals) => round2(mean(vals)))
        // Jahres-Normal: pro Jahr annualAgg, dann Mittel über die Jahre
        const annualVals = []
        for (const [, vals] of byYear) {
          const a = reduce(vals, p.annual)
          if (a != null) annualVals.push(a)
        }
        const annual = round2(mean(annualVals))
        if (monthly.some((m) => m != null) || annual != null) {
          perCode[p.code] = { monthly, annual }
          any = true
        }
      }
      if (any) {
        normals[id] = perCode
        withData++
      }
    }
    process.stdout.write(`Chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)}: ${withData} Stationen mit Normalen\n`)
    await sleep(DELAY_MS)
  }

  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'normals.json'),
    JSON.stringify(
      { meta: { source: BASE, period: '1991-2020', license: 'CC BY 4.0' }, normals },
      null,
      0,
    ),
  )
  process.stdout.write(`Geschrieben: public/at/normals.json (${withData} Stationen)\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
