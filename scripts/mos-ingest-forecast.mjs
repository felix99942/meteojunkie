// Ingest der MOSMIX-Vorhersage → kompakte, statische Pro-Parameter-JSONs
// (Vorhersage-Modus der Klimakarte). Läuft geplant (GitHub-Action-Cron) und legt
// die Ergebnisse unter public/mos/forecast/ ab — der Browser lädt sie same-origin
// wie jedes statische Asset (kein Live-Server, kein CORS-Problem).
//
// Quelle: DWD MOSMIX_L je Station (klein, unabhängig parsebar). Für den DACH-Raum
// (public/mos/stations.json). Zum lokalen Testen: MOS_LIMIT=25 begrenzt die Zahl.
//
//   node scripts/mos-ingest-forecast.mjs
//   MOS_LIMIT=25 node scripts/mos-ingest-forecast.mjs   # schneller Teillauf

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMosmixKml, unzipSingle } from './lib/mosmix.mjs'

const L_URL = (id) =>
  `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/${id}/kml/MOSMIX_L_LATEST_${id}.kmz`

const HOURLY_CAP = 72 // Stunden für die stündlichen Parameter (Zeitschieber)
// TX/TN = MOSMIX-eigene 12-h-Extreme (synoptisch), NICHT aus stündlichem TTT
// zusammengerechnet — der Punktforecast TTT unterschätzt den Tagesgang sonst um
// 1–2 °C (gerade bei Hitze). Siehe dailyExtremes().
const WANTED = new Set(['TTT', 'TX', 'TN', 'RR1c', 'SunD1', 'Neff', 'FF'])
const CONCURRENCY = 24

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mos')
const outDir = join(dir, 'forecast')

const K2C = (v) => (v == null ? null : Math.round((v - 273.15) * 10) / 10)
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

async function fetchStation(id) {
  try {
    const res = await fetch(L_URL(id))
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return parseMosmixKml(unzipSingle(buf), WANTED)
  } catch {
    return null
  }
}

/**
 * Synoptische Tagesextreme (Kelvin) je UTC-Kalendertag aus den MOSMIX-eigenen
 * 12-h-Elementen:
 *   TX @18:00Z = Höchstwert der letzten 12 h (06–18 UTC, Tagphase) → Tagesmaximum
 *   TN @06:00Z = Tiefstwert  der letzten 12 h (18–06 UTC, Nacht)   → Tagesminimum
 * Das ist das echte MOS-Tagesextrem. Der stündliche Punktforecast TTT glättet den
 * Tagesgang und liefert als Max/Min pro Tag systematisch 1–2 °C zu niedrige
 * Höchstwerte (bei Hitzewellen der sichtbare Fehler) — deshalb nur Fallback für
 * Tage/Stationen ohne TX/TN (z. B. der laufende Tag hat kein 06:00Z-TN mehr).
 */
function dailyExtremes(timeSteps, ttt, tx, tn) {
  const maxByDay = new Map()
  const minByDay = new Map()
  const tttByDay = new Map()
  for (let i = 0; i < timeSteps.length; i++) {
    const day = timeSteps[i].slice(0, 10)
    const hhmm = timeSteps[i].slice(11, 16)
    if (tx?.[i] != null && hhmm === '18:00') maxByDay.set(day, tx[i])
    if (tn?.[i] != null && hhmm === '06:00') minByDay.set(day, tn[i])
    const v = ttt?.[i]
    if (v != null) {
      if (!tttByDay.has(day)) tttByDay.set(day, [])
      tttByDay.get(day).push(v)
    }
  }
  const days = [...new Set([...maxByDay.keys(), ...minByDay.keys(), ...tttByDay.keys()])].sort()
  const max = days.map((d) => maxByDay.get(d) ?? (tttByDay.has(d) ? Math.max(...tttByDay.get(d)) : null))
  const min = days.map((d) => minByDay.get(d) ?? (tttByDay.has(d) ? Math.min(...tttByDay.get(d)) : null))
  return { days, max, min }
}

async function main() {
  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  let ids = stationsRaw.stations.map((s) => s.id)
  const limit = Number(process.env.MOS_LIMIT || 0)
  if (limit > 0) ids = ids.slice(0, limit)
  process.stdout.write(`MOSMIX-Ingest für ${ids.length} Stationen …\n`)

  let canonicalSteps = null
  let run = null
  // Ergebnis-Container je Parameter: stationId → Werte
  const t2m = {}
  const precip = {}
  const sun = {}
  const cloud = {}
  const wind = {}
  const tmax = {}
  const tmin = {}
  let dayLabels = null
  let ok = 0

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((id) => fetchStation(id).then((r) => [id, r])))
    for (const [id, parsed] of results) {
      if (!parsed || !parsed.stations[id]) continue
      const st = parsed.stations[id]
      if (!canonicalSteps) {
        canonicalSteps = parsed.timeSteps
        run = parsed.timeSteps[0]
      }
      const steps = parsed.timeSteps
      // stündliche Parameter an das kanonische Raster ausrichten (per Index; alle
      // MOSMIX_L desselben Laufs teilen dasselbe Raster) und auf HOURLY_CAP kürzen
      const cut = (arr, f = (x) => x) => (arr ? arr.slice(0, HOURLY_CAP).map(f) : null)
      if (st.TTT) t2m[id] = cut(st.TTT, K2C)
      if (st.RR1c) precip[id] = cut(st.RR1c, r1)
      if (st.SunD1) sun[id] = cut(st.SunD1, (v) => (v == null ? null : Math.round(v / 60))) // s → min
      if (st.Neff) cloud[id] = cut(st.Neff, (v) => (v == null ? null : Math.round(v)))
      if (st.FF) wind[id] = cut(st.FF, (v) => (v == null ? null : Math.round(v * 3.6))) // m/s → km/h
      const ext = dailyExtremes(steps, st.TTT, st.TX, st.TN)
      if (!dayLabels) dayLabels = ext.days
      // Werte an das kanonische Tagesraster ausrichten (Station könnte einzelne
      // Tage anders belegen) statt auf Indexgleichheit zu vertrauen.
      const maxByDay = new Map(ext.days.map((d, j) => [d, ext.max[j]]))
      const minByDay = new Map(ext.days.map((d, j) => [d, ext.min[j]]))
      tmax[id] = dayLabels.map((d) => K2C(maxByDay.get(d) ?? null))
      tmin[id] = dayLabels.map((d) => K2C(minByDay.get(d) ?? null))
      ok++
    }
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length} (${ok} mit Daten)\n`)
  }

  if (!canonicalSteps) throw new Error('Keine MOSMIX-Daten erhalten')
  const hourlySteps = canonicalSteps.slice(0, HOURLY_CAP)

  await mkdir(outDir, { recursive: true })
  const write = (name, obj) => writeFile(join(outDir, `${name}.json`), JSON.stringify(obj))

  const meta = { run, generated: canonicalSteps[0], source: 'DWD MOSMIX_L', license: 'DWD/CDC, GeoNutzV' }
  await Promise.all([
    write('t2m', { meta, param: 'T2m', unit: '°C', kind: 'hourly', timeSteps: hourlySteps, byStation: t2m }),
    write('precip', { meta, param: 'Niederschlag', unit: 'mm', kind: 'hourly', timeSteps: hourlySteps, byStation: precip }),
    write('sun', { meta, param: 'Sonnenschein', unit: 'min', kind: 'hourly', timeSteps: hourlySteps, byStation: sun }),
    write('cloud', { meta, param: 'Bewölkung', unit: '%', kind: 'hourly', timeSteps: hourlySteps, byStation: cloud }),
    write('wind', { meta, param: 'Wind', unit: 'km/h', kind: 'hourly', timeSteps: hourlySteps, byStation: wind }),
    write('tmax', { meta, param: 'Tagesmaximum', unit: '°C', kind: 'daily', days: dayLabels, byStation: tmax }),
    write('tmin', { meta, param: 'Tagesminimum', unit: '°C', kind: 'daily', days: dayLabels, byStation: tmin }),
  ])
  process.stdout.write(`Geschrieben: public/mos/forecast/*.json (${ok} Stationen, Lauf ${run})\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
