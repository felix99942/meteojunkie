// Gemessene Luftgüte in Österreich — reine Rechenkerne (getestet in
// `airMeasured.test.ts`); der Abruf steht in `api/airMeasured.ts`.
//
// Quelle ist der Download-Dienst der Europäischen Umweltagentur (EEA), Daten
// „Up To Date" (E2a): die stündlich gemeldeten, noch NICHT geprüften
// Messwerte der österreichischen Messnetze. Live geprüft (2026-10-18):
//   • CORS `*` samt Preflight, kein Key. `POST /ParquetFile` schneidet den
//     Zeitraum SERVERSEITIG zu und liefert ein ZIP mit EINER Parquet-Datei —
//     ganz Österreich, vier Stoffe, ein Tag ≈ 140 KB in ~3 s.
//   • Aktualität: die neueste gültige Stunde ist rund 2–3 h alt.
//   • Messpunkte: NO₂ 139, O₃ 100, PM10 108, PM2,5 75 — alle mit Lage in
//     `public/air/at-stations.json` (scripts/air-ingest-stations.mjs).
//   • ZEITSTEMPEL SIND ÖSTERREICHISCHE ORTSZEIT MIT SOMMERZEIT, ohne Angabe
//     der Zone — und die Metadaten behaupten „UTC+01". Gemessen gegen die
//     Halbstundenwerte des Landes Oberösterreich (Linz Stadtpark, NO₂, mit
//     ausdrücklichem Offset +02:00): mit UTC+2 stimmen alle 20 Stunden exakt
//     (Abweichung 0,0 µg/m³), mit UTC+1 2,4 und mit UTC 3,3 µg/m³ im Mittel.
//     Umgerechnet wird deshalb über die Zeitzone Europe/Vienna, nicht über
//     einen festen Versatz. OFFEN: nach der Umstellung auf Winterzeit
//     (25.10.2026) noch einmal gegenprüfen.
//   • `Start` ist der Beginn des Stundenmittels. Gezeichnet wird der Wert am
//     ENDE der Stunde (Start + 1 h), wie Stundenmittel üblich benannt werden.

export const EEA_DOWNLOAD_URL = 'https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile'
export const AT_STATIONS_URL = 'air/at-stations.json'

/** EEA-Schadstoffcodes ↔ Open-Meteo-Variablen. */
export const MEASURED_POLLUTANTS = [
  { code: 8, variable: 'nitrogen_dioxide' },
  { code: 7, variable: 'ozone' },
  { code: 5, variable: 'pm10' },
  { code: 6001, variable: 'pm2_5' },
] as const

export const pollutantUri = (code: number) => `http://dd.eionet.europa.eu/vocabulary/aq/pollutant/${code}`

/** Messstellen weiter weg zählen nicht — dann wäre es ein anderer Ort, kein Modellfehler. */
export const MEASURED_MAX_KM = 15

export interface AirStation {
  id: string
  /** EEA-Schadstoffcode des Messpunkts. */
  p: number
  name: string
  lat: number
  lon: number
  alt: number
  /** background | traffic | industrial */
  type: string
  /** urban | suburban | rural … */
  area: string
}

export interface MeasuredRow {
  /** Messpunkt-Kennung („AT/SPO.04.S184.63303.8.1"). */
  sp: string
  /** Ende des Stundenmittels in Epoch-ms UTC. */
  t: number
  v: number
}

const viennaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Vienna',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Versatz der Wiener Ortszeit gegen UTC zum Zeitpunkt `utcMs` (ms, Sommer +2 h). */
export function viennaOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(viennaParts.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return wall - utcMs
}

/**
 * Wiener Ortszeit → UTC. `wallMs` trägt die Wandzeit in den UTC-Feldern (so
 * liefert der Parquet-Leser einen zonenlosen Zeitstempel). In der doppelten
 * Stunde der Rückstellung gewinnt die erste (Sommerzeit) — eine Stunde im
 * Jahr, die dafür nicht zählt.
 */
export function viennaWallToUtc(wallMs: number): number {
  let utc = wallMs - viennaOffsetMs(wallMs - 3_600_000)
  const off = viennaOffsetMs(utc)
  utc = wallMs - off
  return utc
}

/** Großkreisabstand in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export interface MeasuredSeries {
  station: AirStation
  km: number
  /** Ende des Stundenmittels (ms UTC) → Wert. */
  values: Map<number, number>
}

/**
 * Messreihe eines Stoffs für den Ort: die nächste HINTERGRUNDstation im
 * Umkreis von `MEASURED_MAX_KM`, sonst die nächste Station gleich welchen
 * Typs. Hintergrund zuerst, weil das Modell mit ~10 km Gitterweite die
 * Hintergrundbelastung rechnet — eine Verkehrsstation an der Straße misst
 * NO₂ systematisch höher, und der Unterschied wäre kein Modellfehler. Der Typ
 * steht dann in der Beschriftung. Hat eine Station mehrere Messpunkte für den
 * Stoff (zwei Feinstaubgeräte), gewinnt der mit den meisten Werten.
 */
export function measuredFor(
  code: number,
  lat: number,
  lon: number,
  stations: AirStation[],
  rows: MeasuredRow[],
): MeasuredSeries | null {
  const bySp = new Map<string, Map<number, number>>()
  for (const r of rows) {
    let m = bySp.get(r.sp)
    if (!m) bySp.set(r.sp, (m = new Map()))
    m.set(r.t, r.v)
  }
  const cands = stations
    .filter((s) => s.p === code && (bySp.get(s.id)?.size ?? 0) > 0)
    .map((s) => ({ s, km: distanceKm(lat, lon, s.lat, s.lon) }))
    .filter((c) => c.km <= MEASURED_MAX_KM)
  if (!cands.length) return null
  const bg = cands.filter((c) => c.s.type === 'background')
  const pool = bg.length ? bg : cands
  pool.sort((a, b) => a.km - b.km || (bySp.get(b.s.id)!.size - bySp.get(a.s.id)!.size))
  // Gleicher Standort, mehrere Geräte: der Messpunkt mit den meisten Werten
  const nearest = pool[0]
  const same = pool.filter((c) => c.s.lat === nearest.s.lat && c.s.lon === nearest.s.lon)
  same.sort((a, b) => bySp.get(b.s.id)!.size - bySp.get(a.s.id)!.size)
  const pick = same[0]
  return { station: pick.s, km: pick.km, values: bySp.get(pick.s.id)! }
}

/** Klartext des Stationstyps für die Beschriftung. */
export function stationKind(s: AirStation): string {
  const type = s.type === 'traffic' ? 'verkehrsnah' : s.type === 'industrial' ? 'Industrie' : 'Hintergrund'
  const area = s.area.startsWith('rural') ? 'ländlich' : s.area === 'suburban' ? 'Stadtrand' : s.area === 'urban' ? 'städtisch' : ''
  return area ? `${type}, ${area}` : type
}
