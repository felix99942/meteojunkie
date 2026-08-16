// Parameter-Registry der Österreich-Klimakarte (Schritt 3). Kuratierte Auswahl
// der klimatologisch wichtigen GeoSphere-Größen (klima-v2-1d) — deklarativ, damit
// Karte, Colorbar und Detailpanel konsistent bleiben (analog FieldSpec/variables.ts).
//
// Die GeoSphere-Codes stammen aus /metadata (siehe public/at/parameters.json);
// die Zuordnung zu Skala und Aggregat ist eine bewusste Design-Entscheidung.
// Farbskalen werden aus dem validierten Bestand (colorscales.ts) wiederverwendet;
// für Sonnenschein/Schneehöhe spiegeln zwei neue Rampen den vorhandenen Stil.

import { COLOR_SCALES, type ColorScale } from './colorscales'

/** Wie eine Reihe täglicher Werte auf EINEN Kartenwert reduziert wird. */
export type AggMode = 'mean' | 'sum' | 'max' | 'min' | 'last'

/**
 * Größenordnung des gezeigten Werts. Summenparameter wachsen mit dem Zeitbezug
 * um Größenordnungen (1 mm/Tag ↔ 1.000 mm/Jahr) — mit EINER festen Skala läge
 * in der Jahreskarte jede Station im obersten Band. Deshalb je Zeitbezug eine
 * eigene, wieder FESTE Skala (kein Auto-Scaling, SPEC §8).
 */
export type ValueSpan = 'day' | 'month' | 'year'

/** Anomalie als absolute Differenz (K, %-Punkte) oder als Prozent des Normals. */
export type AnomalyKind = 'delta' | 'percent'

export interface AtParameterSpec {
  /** GeoSphere-Parametercode im Tagesdatensatz (klima-v2-1d). */
  code: string
  /** Code im Monatsdatensatz (klima-v2-1m); fehlt → nur im Tag-Modus verfügbar. */
  monthlyCode?: string
  /**
   * Code im 10-Minuten-Datensatz (klima-v2-10min) für den LAUFENDEN Tag, den
   * klima-v2-1d noch nicht aggregiert hat. Fehlt → am aktuellen Tag kein Wert.
   */
  liveCode?: string
  /** Reduktion der 10-Minuten-Werte auf den Tageswert (meist = `agg`). */
  liveAgg?: AggMode
  /** Faktor auf den Live-Wert, wenn die 10-Minuten-Einheit abweicht (so: s → h). */
  liveFactor?: number
  label: string
  unit: string
  /**
   * Klartext für die UI: was die Größe misst und wie Tag/Monat/Jahr daraus
   * gebildet werden. Steht im Detailpanel und als Tooltip am Dropdown — die
   * Aggregatsfrage ("Monatsmittel oder Monatsmaximum?") entscheidet, wie ein
   * Rekord zu lesen ist.
   */
  description: string
  category: 'Temperatur' | 'Niederschlag' | 'Sonne' | 'Schnee' | 'Feuchte' | 'Wind'
  /** Reduktion täglicher Werte auf einen Wert (Tag/Monat-Aggregat der Rohreihe). */
  agg: AggMode
  /** Reduktion der 12 Monatswerte auf den Jahreswert. */
  annualAgg: AggMode
  /** Wie die Abweichung vom Normal ausgedrückt wird. */
  anomalyKind: AnomalyKind
  /** Einheit der Anomalie (z. B. 'K' oder '%'). */
  anomalyUnit: string
  scale: ColorScale
  /** Skala für Monatswerte, falls die Tagesskala nicht passt (Summenparameter). */
  monthScale?: ColorScale
  /** Skala für Jahreswerte (auch für Jahres-Normale einer Klimaperiode). */
  yearScale?: ColorScale
  /** Divergierende Skala für den Anomalie-Modus. */
  anomalyScale: ColorScale
}

// Divergierende Temperatur-Anomalie (K): blau (kalt) → neutral → rot (warm).
// ColorBrewer RdBu, barrierefrei. belowMin clamp (Extremkälte = dunkelblau).
const TEMP_ANOM_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: -12, color: '#2166ac' },
    { value: -8, color: '#4393c3' },
    { value: -5, color: '#92c5de' },
    { value: -2, color: '#d1e5f0' },
    { value: -0.5, color: '#dcdcdc' },
    { value: 0.5, color: '#fddbc7' },
    { value: 2, color: '#f4a582' },
    { value: 5, color: '#d6604d' },
    { value: 8, color: '#b2182b' },
    { value: 12, color: '#67001f' },
  ],
}

// Divergierende %-Anomalie (Niederschlag/Sonne): braun (trocken) → neutral →
// grün/teal (nass). ColorBrewer BrBG, um 100 % zentriert. belowMin clamp.
const PERCENT_ANOM_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: 20, color: '#8c510a' },
    { value: 40, color: '#bf812d' },
    { value: 60, color: '#dfc27d' },
    { value: 80, color: '#f6e8c3' },
    { value: 95, color: '#dcdcdc' },
    { value: 105, color: '#c7eae5' },
    { value: 130, color: '#80cdc1' },
    { value: 160, color: '#35978f' },
    { value: 200, color: '#01665e' },
  ],
}

// Sonnenscheindauer (h/Tag): sequenziell dunkel→hell-gelb, im Stil der
// Globalstrahlungsskala. Monoton heller = barrierefrei ablesbar.
const SUNSHINE_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: 0, color: '#3a3320' },
    { value: 2, color: '#5a4a00' },
    { value: 4, color: '#8a6f00' },
    { value: 6, color: '#b38a00' },
    { value: 8, color: '#d6a300' },
    { value: 10, color: '#efc23a' },
    { value: 12, color: '#f5d670' },
    { value: 14, color: '#f8e59a' },
  ],
}

// Schneehöhe (cm): sequenziell violett→weiß, Werte bis alpine Höhen. < 1 cm
// transparent (aper).
const SNOW_DEPTH_SCALE: ColorScale = {
  kind: 'stepped',
  stops: [
    { value: 1, color: '#3a2f7d' },
    { value: 5, color: '#4a3aa7' },
    { value: 10, color: '#6a5cd0' },
    { value: 20, color: '#9085e9' },
    { value: 40, color: '#a89ff0' },
    { value: 70, color: '#b7aef3' },
    { value: 120, color: '#cbc4f7' },
    { value: 200, color: '#e0dcfb' },
    { value: 300, color: '#f2f0fe' },
  ],
}

/** Dieselbe Rampe auf einen längeren Zeitbezug strecken (Summenparameter). */
function stretch(scale: ColorScale, factor: number): ColorScale {
  return { ...scale, stops: scale.stops.map((s) => ({ ...s, value: s.value * factor })) }
}

// Niederschlag: die Tagesskala (0,1–100 mm) wird für Monats-/Jahressummen um
// den Faktor „Tage im Zeitraum" gestreckt — gleiche Farben, gleiche Staffelung,
// nur andere Schwellen. Jahreswerte reichen in Österreich von ~450 mm
// (Seewinkel) bis > 2.500 mm (Nordstau).
const PRECIP_MONTH_SCALE = stretch(COLOR_SCALES.precipitation, 10)
const PRECIP_YEAR_SCALE = stretch(COLOR_SCALES.precipitation, 30)

// Sonnenschein: hier trägt das Strecken nicht (Jahressummen liegen alle zwischen
// ~1.300 und ~2.200 h, eine gestreckte Tagesskala hätte dort drei Bänder) —
// eigene Schwellen, gleiche Rampe.
const SUNSHINE_RAMP = ['#3a3320', '#5a4a00', '#8a6f00', '#b38a00', '#d6a300', '#efc23a', '#f5d670', '#f8e59a']
const sunshineScale = (values: number[]): ColorScale => ({
  kind: 'stepped',
  belowMin: 'clamp',
  stops: values.map((value, i) => ({ value, color: SUNSHINE_RAMP[i] })),
})
const SUNSHINE_MONTH_SCALE = sunshineScale([40, 70, 100, 130, 160, 190, 220, 250])
const SUNSHINE_YEAR_SCALE = sunshineScale([1200, 1350, 1500, 1650, 1800, 1900, 2000, 2100])

// Differenz zweier Klimaperioden (K): das Signal ist ~1 K und läge in der
// Wetter-Anomalieskala (±12 K) durchgehend im selben Band. Feinere Stufung,
// gleiche RdBu-Farben; neutral ist ±0,25 K.
const CLIMATE_DELTA_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: -2, color: '#2166ac' },
    { value: -1.5, color: '#4393c3' },
    { value: -1, color: '#74add1' },
    { value: -0.5, color: '#c6dbef' },
    { value: -0.25, color: '#dcdcdc' },
    { value: 0.25, color: '#fddbc7' },
    { value: 0.5, color: '#f4a582' },
    { value: 1, color: '#d6604d' },
    { value: 1.5, color: '#b2182b' },
    { value: 2, color: '#67001f' },
  ],
}

// Dasselbe für prozentuale Größen (Niederschlag/Sonne): zwischen zwei Perioden
// ändern sie sich um wenige Prozent, nicht um Faktoren.
const CLIMATE_PERCENT_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: 70, color: '#8c510a' },
    { value: 80, color: '#bf812d' },
    { value: 90, color: '#dfc27d' },
    { value: 95, color: '#f6e8c3' },
    { value: 98, color: '#dcdcdc' },
    { value: 102, color: '#c7eae5' },
    { value: 105, color: '#80cdc1' },
    { value: 110, color: '#35978f' },
    { value: 120, color: '#01665e' },
    { value: 130, color: '#003c30' },
  ],
}

export const AT_PARAMETERS: AtParameterSpec[] = [
  { code: 'tl_mittel', monthlyCode: 'tl_mittel', liveCode: 'tl', liveAgg: 'mean', label: 'Temperatur Mittel', unit: '°C', category: 'Temperatur', agg: 'mean', annualAgg: 'mean', anomalyKind: 'delta', anomalyUnit: 'K', scale: COLOR_SCALES.temperature_2m, anomalyScale: TEMP_ANOM_SCALE, description: 'Mittlere Lufttemperatur in 2 m Höhe. Tageswert aus Termin- und Extremwerten; Monat und Jahr sind Mittelwerte daraus.' },
  { code: 'tlmax', monthlyCode: 'tlmax', liveCode: 'tlmax', liveAgg: 'max', label: 'Temperatur Maximum', unit: '°C', category: 'Temperatur', agg: 'max', annualAgg: 'max', anomalyKind: 'delta', anomalyUnit: 'K', scale: COLOR_SCALES.temperature_2m, anomalyScale: TEMP_ANOM_SCALE, description: 'Höchste Lufttemperatur in 2 m Höhe. Monat und Jahr sind der HÖCHSTE Tageswert im Zeitraum — ein Rekord fällt deshalb auf einen konkreten Tag.' },
  { code: 'tlmin', monthlyCode: 'tlmin', liveCode: 'tlmin', liveAgg: 'min', label: 'Temperatur Minimum', unit: '°C', category: 'Temperatur', agg: 'min', annualAgg: 'min', anomalyKind: 'delta', anomalyUnit: 'K', scale: COLOR_SCALES.temperature_2m, anomalyScale: TEMP_ANOM_SCALE, description: 'Tiefste Lufttemperatur in 2 m Höhe. Monat und Jahr sind der TIEFSTE Tageswert im Zeitraum — ein Rekord fällt deshalb auf einen konkreten Tag.' },
  { code: 'rr', monthlyCode: 'rr', liveCode: 'rr', liveAgg: 'sum', label: 'Niederschlag Summe', unit: 'mm', category: 'Niederschlag', agg: 'sum', annualAgg: 'sum', anomalyKind: 'percent', anomalyUnit: '%', scale: COLOR_SCALES.precipitation, monthScale: PRECIP_MONTH_SCALE, yearScale: PRECIP_YEAR_SCALE, anomalyScale: PERCENT_ANOM_SCALE, description: 'Niederschlagshöhe als 24-Stunden-Summe (Termin 6 UTC). Monat und Jahr sind Summen — der Rekord ist ein nasser Monat, kein einzelner Tag.' },
  { code: 'so_h', monthlyCode: 'so_h', liveCode: 'so', liveAgg: 'sum', liveFactor: 1 / 3600, label: 'Sonnenschein', unit: 'h', category: 'Sonne', agg: 'sum', annualAgg: 'sum', anomalyKind: 'percent', anomalyUnit: '%', scale: SUNSHINE_SCALE, monthScale: SUNSHINE_MONTH_SCALE, yearScale: SUNSHINE_YEAR_SCALE, anomalyScale: PERCENT_ANOM_SCALE, description: 'Sonnenscheindauer in Stunden. Monat und Jahr sind Summen — der Rekord ist ein sonniger Monat, kein einzelner Tag.' },
  { code: 'rfb_mittel', monthlyCode: 'rf_mittel', liveCode: 'rf', liveAgg: 'mean', label: 'Rel. Feuchte', unit: '%', category: 'Feuchte', agg: 'mean', annualAgg: 'mean', anomalyKind: 'delta', anomalyUnit: '%-Pkt', scale: COLOR_SCALES.relative_humidity_2m, anomalyScale: TEMP_ANOM_SCALE, description: 'Mittlere relative Luftfeuchte. Im Tagesdatensatz aus dem Feuchtefühler (rfb_mittel), im Monatsdatensatz als rf_mittel geführt.' },
  { code: 'sh', liveCode: 'sh', liveAgg: 'last', label: 'Schneehöhe (nur Tag)', unit: 'cm', category: 'Schnee', agg: 'last', annualAgg: 'max', anomalyKind: 'delta', anomalyUnit: 'cm', scale: SNOW_DEPTH_SCALE, anomalyScale: TEMP_ANOM_SCALE, description: 'Gesamtschneehöhe zum Beobachtungstermin. Nur im Tag-Modus verfügbar — der Monatsdatensatz führt keine Schneehöhe, deshalb gibt es dafür weder Normale noch Rekorde.' },
]

const byCode = new Map(AT_PARAMETERS.map((p) => [p.code, p]))

export function getAtParameter(code: string): AtParameterSpec {
  const p = byCode.get(code)
  if (!p) throw new Error(`Unbekannter AT-Parameter: ${code}`)
  return p
}

/**
 * Farbskala eines ABSOLUTWERTS im gewählten Zeitbezug. Summenparameter haben
 * eigene Monats-/Jahresskalen; alles andere behält seine eine feste Skala.
 */
export function scaleFor(spec: AtParameterSpec, span: ValueSpan): ColorScale {
  if (span === 'year') return spec.yearScale ?? spec.monthScale ?? spec.scale
  if (span === 'month') return spec.monthScale ?? spec.scale
  return spec.scale
}

/**
 * Farbskala einer ABWEICHUNG. `climate` = Differenz zweier 30-Jahres-Perioden:
 * dort geht es um ~1 K bzw. wenige Prozent, wofür die Wetter-Anomalieskala
 * (±12 K, 20–200 %) zu grob ist — dann die feine Klimaskala.
 */
export function anomalyScaleFor(spec: AtParameterSpec, climate: boolean): ColorScale {
  if (!climate) return spec.anomalyScale
  return spec.anomalyKind === 'percent' ? CLIMATE_PERCENT_SCALE : CLIMATE_DELTA_SCALE
}

/** Abweichung eines Werts vom Normal: delta = Wert−Normal, percent = 100·Wert/Normal. */
export function anomaly(value: number, normal: number, kind: AnomalyKind): number | null {
  if (kind === 'percent') return normal !== 0 ? (100 * value) / normal : null
  return value - normal
}

/** Reihe (mit möglichen null-Lücken) gemäß Aggregat auf einen Wert reduzieren. */
export function aggregate(values: (number | null)[], mode: AggMode): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return null
  switch (mode) {
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'sum':
      return nums.reduce((a, b) => a + b, 0)
    case 'max':
      return Math.max(...nums)
    case 'min':
      return Math.min(...nums)
    case 'last':
      return nums[nums.length - 1]
  }
}
