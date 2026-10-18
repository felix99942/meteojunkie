// Luftqualität (Bereich „Luftqualität", `AirQualityPanel`) — Registry und
// reine Rechenkerne, getestet in `airQuality.test.ts`.
//
// Quelle ist die Air-Quality-API von Open-Meteo, die die Vorhersagen des
// Copernicus Atmosphere Monitoring Service (CAMS) ausliefert. Live geprüft
// (2026-10-18, Salzburg):
//   • CORS `*`, kein Key, derselbe `apiGet`-Pfad wie alle Punktabfragen —
//     EIN Abruf je Ort deckt alle Größen ab (11 Variablen ≈ 1 Call).
//   • Zwei Modelle: `cams_europe` (0,1°, ~10 km, bis rund +4 Tage ab 00 UTC
//     des heutigen Tags) und `cams_global` (0,4°, ~5 Tage). Die Vorgabe
//     `auto` mischt beide: bis zum Ende von CAMS Europa dessen Werte, danach
//     CAMS global — mit einem SPRUNG an der Naht (gemessen: Ozon nachts 41
//     gegen 5 µg/m³, das globale Gitter löst die nächtliche Ozonzehrung in der
//     Stadt nicht auf). Deshalb hier NUR `cams_europe`: lieber eine Achse,
//     die nach vier Tagen endet, als ein fünfter Tag, der aus einem anderen
//     Modell stammt und wie ein Wetterwechsel aussieht.
//   • Außerhalb Europas antwortet `cams_europe` mit „No data is available for
//     this location" (HTTP 400) — dort und NUR dort wird auf `cams_global`
//     ausgewichen, und die Seite sagt es.
//   • `forecast_days` über den Horizont hinaus liefert HTTP 200 mit `null` am
//     Ende (die bekannte Falle aus SPEC §6) — die Zeitachse endet deshalb am
//     letzten Wert (`dataEnd`), nicht am angefragten Zeitraum.
//   • `uv_index` gibt es nur in `cams_global` — deshalb hier nicht dabei.

export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'

/** Tage ab heute 00 UTC — etwas mehr als CAMS Europa trägt, der Rest ist null und wird abgeschnitten. */
export const AIR_QUALITY_FORECAST_DAYS = 5

export type AirDomain = 'cams_europe' | 'cams_global'

export const AIR_DOMAINS: Record<AirDomain, { label: string; resolution: string }> = {
  cams_europe: { label: 'CAMS Europa', resolution: '0,1° (~10 km)' },
  cams_global: { label: 'CAMS global', resolution: '0,4° (~45 km)' },
}

/**
 * Teilindizes des Europäischen Luftqualitätsindex — der Gesamtindex ist ihr
 * MAXIMUM, und welcher Schadstoff ihn setzt, ist die eigentliche Auskunft
 * („mäßig wegen Ozon" ist eine andere Lage als „mäßig wegen Feinstaub").
 */
export const EAQI_PARTS = [
  { key: 'european_aqi_pm2_5', label: 'Feinstaub PM2,5' },
  { key: 'european_aqi_pm10', label: 'Feinstaub PM10' },
  { key: 'european_aqi_nitrogen_dioxide', label: 'Stickstoffdioxid' },
  { key: 'european_aqi_ozone', label: 'Ozon' },
  { key: 'european_aqi_sulphur_dioxide', label: 'Schwefeldioxid' },
] as const

/** Konzentrationen, die als Kurven gezeigt werden (alle µg/m³). */
export const AIR_CONCENTRATIONS = ['pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'dust'] as const

export const AIR_VARIABLES: readonly string[] = [
  'european_aqi',
  ...EAQI_PARTS.map((p) => p.key),
  ...AIR_CONCENTRATIONS,
]

/**
 * Stufen des Europäischen Luftqualitätsindex (EAQI der Europäischen
 * Umweltagentur), so wie Open-Meteo ihn ausgibt: 0–20 gut … über 100 extrem
 * schlecht. Farben nach der EEA-Skala. `upTo` ist die OBERGRENZE der Stufe
 * (einschließlich), die letzte Stufe ist offen.
 */
export const EAQI_BANDS = [
  { upTo: 20, label: 'gut', color: '#50f0e6' },
  { upTo: 40, label: 'ausreichend', color: '#50ccaa' },
  { upTo: 60, label: 'mäßig', color: '#f0e641' },
  { upTo: 80, label: 'schlecht', color: '#ff5050' },
  { upTo: 100, label: 'sehr schlecht', color: '#c0305a' },
  { upTo: Infinity, label: 'extrem schlecht', color: '#a33fb0' },
] as const

export type EaqiBand = (typeof EAQI_BANDS)[number]

export function eaqiBand(value: number): EaqiBand {
  return EAQI_BANDS.find((b) => value <= b.upTo) ?? EAQI_BANDS[EAQI_BANDS.length - 1]
}

export interface AirQualityData {
  domain: AirDomain
  /** Zeitstempel in Epoch-ms (UTC), stündlich. */
  times: number[]
  values: Record<string, (number | null)[]>
}

interface AirQualityBody {
  hourly?: Record<string, (number | null)[]> & { time?: number[] }
}

/** Antwort der API (mit `timeformat=unixtime`) in Reihen je Variable. */
export function parseAirQuality(body: AirQualityBody, domain: AirDomain): AirQualityData {
  const hourly = body.hourly ?? {}
  const times = ((hourly.time ?? []) as number[]).map((s) => s * 1000)
  const values: Record<string, (number | null)[]> = {}
  for (const v of AIR_VARIABLES) {
    const raw = hourly[v]
    values[v] = Array.isArray(raw) ? raw.map((x) => (typeof x === 'number' ? x : null)) : times.map(() => null)
  }
  return { domain, times, values }
}

/**
 * Letzter Zeitpunkt, zu dem IRGENDEINE Größe einen Wert hat — dort endet die
 * Zeitachse. Ohne Daten `null`.
 */
export function dataEnd(data: AirQualityData): number | null {
  for (let i = data.times.length - 1; i >= 0; i--) {
    if (AIR_VARIABLES.some((v) => data.values[v]?.[i] != null)) return data.times[i]
  }
  return null
}

/** Index der Stunde, in der `nowMs` liegt — oder null, wenn sie nicht im Raster steht. */
export function currentIndex(times: number[], nowMs: number): number | null {
  const hour = Math.floor(nowMs / 3_600_000) * 3_600_000
  const i = times.indexOf(hour)
  return i < 0 ? null : i
}

/**
 * Welcher Schadstoff den Gesamtindex zur Stunde `i` setzt — der Teilindex
 * mit dem höchsten Wert. `null`, wenn keiner einen Wert hat.
 */
export function dominantPollutant(data: AirQualityData, i: number): string | null {
  let best: { label: string; v: number } | null = null
  for (const p of EAQI_PARTS) {
    const v = data.values[p.key]?.[i]
    if (v != null && (best === null || v > best.v)) best = { label: p.label, v }
  }
  return best?.label ?? null
}

/**
 * Obergrenze der Indexachse: die nächste Stufengrenze ÜBER dem höchsten Wert
 * (mindestens 20). Bleibt der Index unter 40, reicht die Achse bis 40 und die
 * Kurve füllt die Zeile; reißt ein einziger Wert die 60, geht sie bis 80. So
 * bleibt die Achse eng, endet aber immer auf einer Grenze, gegen die man die
 * Kurve liest. Über 100 (offene Stufe) in 20er-Schritten weiter.
 */
export function eaqiAxisTop(values: (number | null)[]): number {
  let max = 0
  for (const v of values) if (v != null && v > max) max = v
  const step = 20
  return Math.max(step, Math.floor(max / step) * step + step)
}
