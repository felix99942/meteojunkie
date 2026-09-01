// Ingest der HISTALP-Jahresreihen (Österreich-Klimakarte).
//
// WOZU: Der Abweichungsmodus im Zeitbezug „Klimaperiode" vergleicht zwei
// 30-Jahres-Perioden MITEINANDER — das ist eine TRENDaussage, und Trends sind
// genau das, was inhomogene Messreihen verfälschen. Die Stationsdaten
// (klima-v2) sind qualitätsgeprüft, aber NICHT homogenisiert: ein
// Standortwechsel vom Ortszentrum an den Flughafen erzeugt einen künstlichen
// Abkühlungssprung, den niemand herausrechnet. HISTALP ist genau dafür
// gemacht — homogenisierte, bruchbereinigte und lückenlos aufgefüllte
// Langzeitreihen des Alpenraums.
//
// Gemessen (2026-09-01, 25 Stationen mit vollem Normal in beiden Quellen):
// Erwärmung 1961–1990 → 1991–2020 im Median HISTALP +1,24 K, klima-v2 +1,13 K;
// je Station bis zu 0,59 K Unterschied (Rauris: +1,55 K ↔ +0,96 K, also knapp
// zwei Drittel des Signals). Die ABSOLUTwerte stimmen dagegen praktisch überein
// (Median-Differenz 0,003 K) — deshalb bleibt alles andere bei klima-v2 und
// NUR der Periodenvergleich wechselt die Quelle.
//
// GRENZEN, die die UI kennen muss: HISTALP liegt am Hub nur JÄHRLICH vor, mit
// genau ZWEI Größen (T01 Temperaturmittel, R01 Niederschlagssumme) und endet
// 2022. Damit deckt es vom Abweichungsmodus nur den Jahres-Ausschnitt und die
// Parameter tl_mittel/rr ab; alles andere bleibt bei klima-v2 (die UI sagt es).
//
// ZUORDNUNG über KOORDINATEN, nicht über Namen: HISTALP nutzt Synop-IDs und
// eigene Schreibweisen („Wien-Schwechat" ↔ „Schwechat Flughafen",
// „Eisenkappel" ↔ „Bad Eisenkappel"), Namensabgleich traf nur 54 von 85.
// Geografisch (≤ 3 km, ≤ 120 m Höhenunterschied) sind es 76.
//
// Die sechs `Region_AT_*`-Einträge sind KEINE Stationen, sondern HISTALPs
// regionale Mittelreihen (lat/lon = 0) — hier ausgefiltert.
//
//   node scripts/at-ingest-histalp.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/histalp-v1-1y'
/** HISTALP-Code → Registry-Code (src/config/atParameters.ts). */
const CODES = { T01: 'tl_mittel', R01: 'rr' }
/** Muss AT_NORMAL_PERIODS in src/config/atNormals.ts spiegeln. */
const PERIODS = [
  { id: '1991-2020', firstYear: 1991, lastYear: 2020 },
  { id: '1961-1990', firstYear: 1961, lastYear: 1990 },
]
/** WMO-Deckungsregel, dieselbe wie beim Normal-Ingest: ≥ 24 der 30 Jahre. */
const MIN_YEARS = 24
/** Zuordnungsschwellen Station ↔ Station. */
const MAX_KM = 3
const MAX_DH = 120

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')

const distKm = (a, b) => {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function get(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

async function main() {
  const klima = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8')).stations
  const meta = await get(`${BASE}/metadata`)
  const histStations = meta.stations.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0 && s.lon !== 0,
  )
  process.stdout.write(`HISTALP: ${histStations.length} Stationen (ohne Regionalreihen)\n`)

  // Beste Zuordnung je HISTALP-Station; bei Kollision auf dieselbe
  // Klimastation gewinnt die NÄHERE — „Laas" und „Koetschach-Mauthen-Kornat"
  // zeigen beide auf Kötschach-Mauthen, und zwei Reihen für einen Kartenpunkt
  // wären eine stille Überschreibung.
  const claimed = new Map() // klimaId → { histId, km, dh, histName }
  for (const h of histStations) {
    let best = null
    for (const k of klima) {
      const km = distKm(h, k)
      if (km > MAX_KM) continue
      const dh = Math.abs((k.altitude ?? 0) - (h.altitude ?? 0))
      if (dh > MAX_DH) continue
      if (!best || km < best.km) best = { klimaId: k.id, klimaName: k.name, km, dh }
    }
    if (!best) continue
    const prev = claimed.get(best.klimaId)
    if (!prev || best.km < prev.km) {
      claimed.set(best.klimaId, {
        histId: h.id,
        histName: h.name,
        klimaName: best.klimaName,
        km: Math.round(best.km * 100) / 100,
        dh: Math.round(best.dh),
      })
    }
  }
  process.stdout.write(`Zuordnung ≤ ${MAX_KM} km / ≤ ${MAX_DH} m: ${claimed.size} Stationen\n`)

  const histIds = [...claimed.values()].map((v) => v.histId)
  const first = Math.min(...PERIODS.map((p) => p.firstYear))
  const last = Math.max(...PERIODS.map((p) => p.lastYear))
  const geo = await get(
    `${BASE}?parameters=${Object.keys(CODES).join(',')}` +
      `&start=${first}-01-01&end=${last}-01-01&station_ids=${histIds.join(',')}&output_format=geojson`,
  )
  const years = (geo.timestamps ?? []).map((t) => Number(t.slice(0, 4)))
  const byHistId = new Map((geo.features ?? []).map((f) => [String(f.properties.station), f.properties.parameters]))

  const periods = {}
  for (const p of PERIODS) periods[p.id] = {}
  const sources = {}
  let filled = 0
  for (const [klimaId, info] of claimed) {
    const params = byHistId.get(String(info.histId))
    if (!params) continue
    let any = false
    for (const p of PERIODS) {
      const entry = {}
      for (const [histCode, code] of Object.entries(CODES)) {
        const data = params[histCode]?.data
        if (!data) continue
        const vals = []
        for (let i = 0; i < data.length; i++) {
          if (years[i] < p.firstYear || years[i] > p.lastYear) continue
          const v = data[i]
          if (v == null || !Number.isFinite(v)) continue
          vals.push(v)
        }
        // Lieber kein Normal als eines aus einer halben Periode — dieselbe
        // Regel wie bei den klima-v2-Normalen.
        if (vals.length < MIN_YEARS) continue
        entry[code] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      }
      if (Object.keys(entry).length) {
        periods[p.id][klimaId] = entry
        any = true
      }
    }
    if (any) {
      sources[klimaId] = info
      filled++
    }
  }

  await writeFile(
    join(dir, 'histalp-normals.json'),
    JSON.stringify({
      meta: {
        source: BASE,
        title: meta.title,
        note:
          'Homogenisierte HISTALP-Jahresreihen, gemittelt über die WMO-Normalperioden. ' +
          'Nur für den Periodenvergleich (Trend) gedacht — Absolutwerte, Rekorde und alle ' +
          'übrigen Größen kommen aus klima-v2.',
        minYears: MIN_YEARS,
        matching: { maxKm: MAX_KM, maxAltitudeDiff: MAX_DH },
        codes: CODES,
      },
      periods,
      sources,
    }),
  )
  for (const p of PERIODS) {
    const n = Object.keys(periods[p.id]).length
    const t = Object.values(periods[p.id]).filter((e) => e.tl_mittel != null).length
    const r = Object.values(periods[p.id]).filter((e) => e.rr != null).length
    process.stdout.write(`  ${p.id}: ${n} Stationen (Temperatur ${t}, Niederschlag ${r})\n`)
  }
  const both = Object.keys(periods[PERIODS[0].id]).filter((k) => periods[PERIODS[1].id][k]).length
  process.stdout.write(`Geschrieben: public/at/histalp-normals.json (${filled} Stationen, ${both} in BEIDEN Perioden)\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
