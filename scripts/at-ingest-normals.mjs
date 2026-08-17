// Ingest der langjährigen Normale einer WMO-Klimaperiode (Österreich-Klimakarte).
//
// Aus dem Monatsdatensatz klima-v2-1m je Station und Parameter:
//   - monthly[1..12]: Mittel des jeweiligen Kalendermonats über die Periode
//   - annual: Mittel der Jahres-Werte (Jahres-Wert = annualAgg über die 12
//     Monate desselben Jahres) — so, wie die Karte den Jahreswert bildet, damit
//     Anomalien konsistent sind.
//   - seasonal[4]: dasselbe je meteorologischer Jahreszeit (DJF, MAM, JJA, SON;
//     Saison-Wert = annualAgg über die 3 Monate). MUSS eigens gerechnet werden:
//     bei Maximum-Parametern ist das Mittel der Saisonmaxima etwas anderes als
//     das Maximum der Monatsnormale. Der DEZEMBER zählt zum Winter des
//     FOLGEJAHRS — gleiche Konvention wie bei den Rekorden; deshalb beginnt der
//     Abruf einen Monat VOR der Periode.
//
// MINDESTDECKUNG (WMO-Regel „mind. 80 % der Jahre"): ein Normal entsteht nur aus
// >= MIN_YEARS der 30 Jahre, und ein Jahr zählt nur mit VOLLSTÄNDIGEN 12 Monaten.
// Ohne diese Regeln wäre ein „Jahresniederschlag" aus sieben Monaten systematisch
// zu klein und eine Station mit drei Messjahren stünde gleichberechtigt neben
// einer mit dreißig — beim Vergleich zweier Perioden wäre das eine Scheindifferenz.
//
// Ergebnis: public/at/normals-<periode>.json (eine Datei je Periode). Läuft
// manuell / in CI vor dem Build.
//
//   node scripts/at-ingest-normals.mjs            # 1991-2020 (Default)
//   node scripts/at-ingest-normals.mjs 1961-1990

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1m'
const META = `${BASE}/metadata`
const CHUNK = 80
const DELAY_MS = 400 // Pause zwischen Requests (Rate-Limit 5/s, 240/h)
/** Mindestzahl vollständiger Jahre für ein Normal (30-Jahre-Periode → 80 %). */
const MIN_YEARS = 24

// Spiegel von AT_NORMAL_PERIODS in src/config/atNormals.ts — beide Listen müssen
// zusammenpassen, sonst lädt die App eine Datei, die es nicht gibt.
const PERIODS = {
  '1991-2020': [1991, 2020],
  '1961-1990': [1961, 1990],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildUrl(codes, ids, start, end) {
  return `${BASE}?parameters=${codes}&start=${start}&end=${end}&station_ids=${ids.join(',')}&output_format=geojson`
}

/**
 * Chunk holen und dabei einzelne ungültige/gesperrte Stations-IDs tolerieren:
 * Der Hub 403t den GESAMTEN Request wegen EINER unbekannten ID
 * ("Violation for station_ids: 'X'") — die parsen, entfernen, erneut versuchen.
 * 429/5xx → kurzer Backoff.
 */
async function fetchChunk(codes, ids, start, end) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const res = await fetch(buildUrl(codes, current, start, end))
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

/** Reihenfolge wie SEASONS in src/api/atValues.ts — der Client indiziert danach. */
const SEASONS = ['DJF', 'MAM', 'JJA', 'SON']

/**
 * Kalendermonat → Saison und deren Jahr. Dezember gehört zum Winter des
 * Folgejahrs (Konvention aus at-ingest-records.mjs und api/atRecords.ts).
 */
function seasonOf(month, year) {
  if (month === 12) return { season: 'DJF', year: year + 1 }
  if (month <= 2) return { season: 'DJF', year }
  if (month <= 5) return { season: 'MAM', year }
  if (month <= 8) return { season: 'JJA', year }
  return { season: 'SON', year }
}

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

/** ISO-Datum aus den Metadaten (kann null sein) auf YYYY-MM-DD kürzen. */
const isoDay = (v) => (typeof v === 'string' ? v.slice(0, 10) : null)

async function main() {
  const periodId = process.argv[2] ?? '1991-2020'
  const years = PERIODS[periodId]
  if (!years) {
    throw new Error(`Unbekannte Periode "${periodId}" — bekannt: ${Object.keys(PERIODS).join(', ')}`)
  }
  const [firstYear, lastYear] = years
  // Ein Monat Vorlauf: der Winter des ersten Periodenjahrs braucht den Dezember
  // davor. Für Monats-/Jahresnormale bleibt er wirkungslos (das Jahr firstYear-1
  // hat dann nur einen Monat und fällt aus der Vollständigkeitsregel).
  const START = `${firstYear - 1}-12-01`
  const END = `${lastYear}-12-01`
  const nYears = lastYear - firstYear + 1

  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  // Nur Stationen nutzen, die es im MONATSdatensatz gibt — sonst 403t der Request.
  const metaRes = await fetch(META)
  if (!metaRes.ok) throw new Error(`Monats-Metadaten HTTP ${metaRes.status}`)
  const monthlyMeta = new Map((await metaRes.json()).stations.map((s) => [s.id, s]))
  // Stationen, deren Betriebszeit die Periode gar nicht schneidet, können keine
  // 24 Jahre liefern — die spart man sich (bei 1961–1990 rund zwei Drittel).
  const ids = stationsRaw.stations
    .map((s) => s.id)
    .filter((id) => {
      const m = monthlyMeta.get(id)
      if (!m) return false
      const from = isoDay(m.valid_from)
      const to = isoDay(m.valid_to)
      if (from && from > `${lastYear}-12-31`) return false
      if (to && to < START) return false
      return true
    })
  process.stdout.write(
    `Periode ${periodId}: ${ids.length} von ${stationsRaw.stations.length} Stationen im Monatsdatensatz und im Zeitraum\n`,
  )

  const codes = PARAMS.map((p) => p.code).join(',')
  const normals = {}
  let withData = 0

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const geo = await fetchChunk(codes, chunk, START, END)
    const months = (geo.timestamps ?? []).map((t) => Number(t.slice(5, 7))) // 1..12
    const yearOf = (geo.timestamps ?? []).map((t) => Number(t.slice(0, 4)))

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
          const v = data[k]
          if (v == null || !Number.isFinite(v) || (p.nonNeg && v < 0)) continue
          byMonth[months[k] - 1].push(v)
          const y = yearOf[k]
          if (!byYear.has(y)) byYear.set(y, [])
          byYear.get(y).push(v)
        }
        // Saison-Werte je Vorkommen sammeln (Schlüssel „DJF:1995").
        const bySeason = new Map()
        for (let k = 0; k < data.length; k++) {
          const v = data[k]
          if (v == null || !Number.isFinite(v) || (p.nonNeg && v < 0)) continue
          const { season, year: sy } = seasonOf(months[k], yearOf[k])
          if (sy < firstYear || sy > lastYear) continue
          const key = `${season}:${sy}`
          if (!bySeason.has(key)) bySeason.set(key, [])
          bySeason.get(key).push(v)
        }

        // Monats-Normal nur bei ausreichender Deckung DIESES Kalendermonats.
        const monthly = byMonth.map((vals) => (vals.length >= MIN_YEARS ? round2(mean(vals)) : null))
        // Jahres-Normal: nur VOLLSTÄNDIGE Jahre (12 Monate), davon mind. MIN_YEARS.
        const annualVals = []
        for (const [, vals] of byYear) {
          if (vals.length < 12) continue
          const a = reduce(vals, p.annual)
          if (a != null) annualVals.push(a)
        }
        const complete = annualVals.length
        let annual = complete >= MIN_YEARS ? round2(mean(annualVals)) : null
        // Durchgehende Nullen sind bei Niederschlag/Sonne KEIN Messwert, sondern
        // eine Station, die den Parameter nicht führt und statt null 0 meldet
        // (z. B. Wien Hohe Warte Hannhütte, 27 Jahre "0 mm"). Solche Reihen als
        // fehlend behandeln — sonst steht eine 0 mm auf der Jahreskarte.
        // Saison-Normal: nur VOLLSTÄNDIGE Saisons (3 Monate), davon mind. MIN_YEARS.
        const seasonal = SEASONS.map((season) => {
          const vals = []
          for (let y = firstYear; y <= lastYear; y++) {
            const got = bySeason.get(`${season}:${y}`)
            if (!got || got.length < 3) continue
            const a = reduce(got, p.annual)
            if (a != null) vals.push(a)
          }
          if (vals.length < MIN_YEARS) return null
          const v = round2(mean(vals))
          return p.nonNeg && v === 0 ? null : v
        })

        if (p.nonNeg && annual === 0) annual = null
        if (p.nonNeg && monthly.every((m) => m == null || m === 0)) monthly.fill(null)
        if (monthly.some((m) => m != null) || annual != null || seasonal.some((v) => v != null)) {
          perCode[p.code] = { monthly, seasonal, annual, ny: complete }
          any = true
        }
      }
      if (any) {
        normals[id] = perCode
        withData++
      }
    }
    process.stdout.write(
      `Chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)}: ${withData} Stationen mit Normalen\n`,
    )
    await sleep(DELAY_MS)
  }

  const file = `normals-${periodId}.json`
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, file),
    JSON.stringify(
      {
        meta: {
          source: BASE,
          period: periodId,
          years: nYears,
          minYears: MIN_YEARS,
          rule:
            'Jahres-Normal nur aus vollständigen Jahren (12 Monate), Saison-Normal nur aus ' +
            'vollständigen Saisons (3 Monate, Dezember zählt zum Winter des Folgejahrs), ' +
            'Monats-Normal je Kalendermonat',
          license: 'CC BY 4.0',
        },
        normals,
      },
      null,
      0,
    ),
  )
  const annualRr = Object.values(normals).filter((n) => n.rr?.annual != null).length
  process.stdout.write(
    `Geschrieben: public/at/${file} (${withData} Stationen, davon ${annualRr} mit Jahresniederschlag)\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
