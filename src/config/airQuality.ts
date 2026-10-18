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
/**
 * Ein Tag Vorlauf, nur für die gleitenden Mittel: das 24-h-Mittel um 05 UTC
 * braucht die Stunden von gestern. Gezeigt wird ab heute 00 UTC. Kostet
 * nichts extra (6 statt 5 Tage bleiben weit unter der 14-Tage-Gewichtung).
 */
export const AIR_QUALITY_PAST_DAYS = 1

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

/**
 * WHO-Luftgüte-Richtwerte 2021 (WHO Global Air Quality Guidelines), die
 * KURZZEIT-Werte — die Jahresmittel lassen sich an einer Vier-Tage-Vorhersage
 * nicht ablesen. Bewusst NUR die WHO (auf Wunsch), keine EU-Grenzwerte.
 *
 * Jeder Wert gilt für ein MITTEL über `hours` Stunden, nicht für den
 * Stundenwert: verglichen wird deshalb das gleitende Mittel
 * (`rollingMean`), und die Beschriftung nennt den Zeitraum. Eine
 * 24-h-Schwelle gegen Stundenwerte zu legen, zeigte Überschreitungen, die
 * keine sind.
 */
export const WHO_GUIDELINES = {
  pm2_5: { value: 15, hours: 24 },
  pm10: { value: 45, hours: 24 },
  nitrogen_dioxide: { value: 25, hours: 24 },
  ozone: { value: 100, hours: 8 },
} as const

export const WHO_SOURCE_URL = 'https://www.who.int/publications/i/item/9789240034228'

/**
 * Nachlaufendes gleitendes Mittel über `window` Stunden (der Wert zur Stunde
 * i mittelt die Stunden i−window+1 … i). Eine Stunde bekommt nur dann einen
 * Wert, wenn mindestens drei Viertel des Fensters belegt sind — die übliche
 * Vollständigkeitsregel der Luftgüte-Auswertung; ein „Tagesmittel" aus drei
 * Stunden wäre keines.
 */
export function rollingMean(values: (number | null)[], window: number): (number | null)[] {
  const need = Math.ceil(window * 0.75)
  const out: (number | null)[] = []
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v != null) {
      sum += v
      count++
    }
    const drop = i - window >= 0 ? values[i - window] : null
    if (drop != null) {
      sum -= drop
      count--
    }
    out.push(i >= window - 1 && count >= need ? sum / count : null)
  }
  return out
}

/**
 * Konzentrationsgrenzen der EAQI-Stufen (µg/m³, Obergrenze je Stufe wie
 * `EAQI_BANDS`) für die Mittelwert-Kästen. GEMESSEN (2026-10-18, Wien, 96 h):
 * Open-Meteo rechnet die Teilindizes nach der NEUEN Einteilung der EEA — linear
 * zwischen diesen Grenzen nachgerechnet höchstens 0,5 Punkte Abweichung
 * (Rundung), mit der älteren Tabelle (NO₂ 40/90/120 …) bis 32. Bestätigt bis
 * in die Stufe „mäßig" (NO₂ bis 62, Ozon bis 76 µg/m³ gemessen), die oberen
 * Grenzen aus derselben Tabelle. Die Grenze zu „mäßig" ist dabei der
 * WHO-Richtwert: NO₂ 25 (24-h-Mittel), Ozon 100 (8-h-Mittel), PM2,5 15 und
 * PM10 45 (24-h-Mittel).
 */
export const CONC_BANDS: Record<'nitrogen_dioxide' | 'ozone' | 'pm2_5' | 'pm10', readonly number[]> = {
  nitrogen_dioxide: [10, 25, 60, 100, 150, Infinity],
  ozone: [60, 100, 120, 160, 180, Infinity],
  // Feinstaub ebenso gemessen (PM2,5 bis 39, PM10 bis 44 µg/m³ belegt); die
  // Grenze zu „mäßig" ist der WHO-Tagesrichtwert 15 bzw. 45
  pm2_5: [5, 15, 50, 90, 140, Infinity],
  pm10: [15, 45, 120, 195, 270, Infinity],
}

/** EAQI-Stufe einer Konzentration (auch eines Mittels — als Einordnung). */
export function concBand(variable: keyof typeof CONC_BANDS, value: number): EaqiBand {
  const tops = CONC_BANDS[variable]
  const i = tops.findIndex((t) => value <= t)
  return EAQI_BANDS[i < 0 ? EAQI_BANDS.length - 1 : i]
}

export type AmpelLevel = 'green' | 'yellow' | 'red'

/** EAQI-Stufe → Ampel: gut/ausreichend grün, mäßig gelb, ab schlecht rot. */
export function ampelOf(band: EaqiBand): AmpelLevel {
  const i = EAQI_BANDS.indexOf(band)
  return i <= 1 ? 'green' : i === 2 ? 'yellow' : 'red'
}

export interface AmpelDecision {
  level: AmpelLevel
  band: EaqiBand
  /** Woher die maßgebliche Stufe kommt. */
  source: 'model' | 'measured'
}

/**
 * Ampel zum aktuellen Index. Grundlage sind die Modell-Teilindizes der
 * laufenden Stunde (der Gesamtindex ist ihr Maximum). Liegt eine MESSUNG von
 * PM2,5 vor und fällt sie in eine ANDERE Stufe als das Modell-PM2,5, ersetzt
 * sie den Modell-Teilindex (auf Wunsch) — die Ampel folgt dann dem höchsten
 * aus gemessenem Feinstaub und den übrigen Modell-Teilindizes. Ohne Messung
 * oder bei gleicher Stufe bleibt es beim Modell.
 */
export function ampelDecision(
  modelParts: Partial<Record<(typeof EAQI_PARTS)[number]['key'], number | null>>,
  measuredPm25: number | null,
): AmpelDecision | null {
  const idx = (b: EaqiBand) => EAQI_BANDS.indexOf(b)
  let worst = -1
  for (const p of EAQI_PARTS) {
    const v = modelParts[p.key]
    if (v != null) worst = Math.max(worst, idx(eaqiBand(v)))
  }
  if (worst < 0) return null
  const modelBand = EAQI_BANDS[worst]
  const modelPm = modelParts.european_aqi_pm2_5
  if (measuredPm25 == null || modelPm == null) return { level: ampelOf(modelBand), band: modelBand, source: 'model' }
  const measuredBand = concBand('pm2_5', measuredPm25)
  if (idx(measuredBand) === idx(eaqiBand(modelPm))) return { level: ampelOf(modelBand), band: modelBand, source: 'model' }
  let others = -1
  for (const p of EAQI_PARTS) {
    if (p.key === 'european_aqi_pm2_5') continue
    const v = modelParts[p.key]
    if (v != null) others = Math.max(others, idx(eaqiBand(v)))
  }
  const band = EAQI_BANDS[Math.max(others, idx(measuredBand))]
  return { level: ampelOf(band), band, source: 'measured' }
}
