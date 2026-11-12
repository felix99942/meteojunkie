// Größen des Bereichs TAWES: alle Messgrößen der 10-Minuten-Werte (`config/tawesStore.ts`), dazu
// ein paar daraus gerechnete (Taupunkt, gefühlte Temperatur, Änderungen über 3 und 24 h).
//
// Bewusst NICHT die Registry der Klimakarte (`atParameters.ts`): dort trägt jede Größe Normal,
// Abweichung, Monats- und Jahresaggregat — Begriffe, die es für „was misst das Netz jetzt"
// nicht gibt, und die meisten Größen hier (Druck, Bodentemperatur, Strahlung) haben dort
// keinen Gegenpart.
//
// ZEITFENSTER WÄHLBAR NUR BEIM NIEDERSCHLAG (auf Wunsch): 10 min bis 48 h, je Fenster eine
// eigene Farbskala an den DWD-Warnschwellen (`precipScale`). Alle übrigen Größen haben ihre
// natürliche Bedeutung: Messwert zum Termin, ein festes Fenster im Namen („Spitzenböe 24 h"),
// oder bei Höchst- und Tiefstwerten der synoptische Zeitraum (auf Wunsch): Maximum 06–18 UTC,
// Minimum 18–06 UTC (`synopticWindow`).

import { COLOR_SCALES, lerpRamp, precipScale, bands, type ColorScale } from './colorscales'
import type { TawesCode } from './tawesStore'

/** Wie aus den 10-Minuten-Werten der Kartenwert wird */
export type TawesAgg = 'last' | 'sum' | 'max' | 'min' | 'mean' | 'change'

/** Rohgröße oder eine daraus gerechnete */
export type TawesSource = TawesCode | 'dewpoint' | 'apparent'

export type TawesGroup =
  | 'Temperatur'
  | 'Feuchte'
  | 'Wind'
  | 'Luftdruck'
  | 'Niederschlag'
  | 'Sonne und Strahlung'
  | 'Schnee'
  | 'Boden'

export const TAWES_GROUPS: TawesGroup[] = [
  'Temperatur',
  'Feuchte',
  'Wind',
  'Luftdruck',
  'Niederschlag',
  'Sonne und Strahlung',
  'Schnee',
  'Boden',
]

/** Was eine Größe bei einem bestimmten Fenster zeigt */
export interface TawesDisplay {
  unit: string
  /** Rohwert × factor = Anzeigewert */
  factor: number
  decimals: number
  scale: ColorScale
}

export interface TawesParam {
  key: string
  label: string
  group: TawesGroup
  source: TawesSource
  agg: TawesAgg
  /** Fenster in 10-min-Schritten (bei `last` ungenutzt) */
  steps?: number
  /**
   * Fester synoptischer Zeitraum statt eines gleitenden Fensters: `day` = 06–18 UTC (Maximum),
   * `night` = 18–06 UTC (Minimum) — die Termine der SYNOP-Meldung. Über ein gleitendes 24-h-
   * Fenster läge das Minimum am Abend noch in der Nacht davor. Die Zeitleiste springt dafür auf
   * Tage bzw. Nächte um (`synopticPeriods`).
   */
  synoptic?: 'day' | 'night'
  /** Fenster wählbar (`PRECIP_WINDOWS`) — nur Niederschlag */
  windowed?: true
  display: TawesDisplay | ((steps: number) => TawesDisplay)
  /** Windfiedern möglich: Richtung aus dieser Größe */
  dir?: TawesCode
  /** Gültiger Bereich des ROHWERTS; außerhalb zählt er als fehlend */
  valid?: [number, number]
  /** `last`: so viele Schritte darf der letzte Wert hinter dem Netz liegen (Vorgabe 6 = 1 h) */
  maxAgeSteps?: number
  description: string
}

/** Wählbare Fenster beim Niederschlag, in 10-min-Schritten */
export const PRECIP_WINDOWS: { steps: number; label: string }[] = [
  { steps: 1, label: '10 min' },
  { steps: 6, label: '1 h' },
  { steps: 18, label: '3 h' },
  { steps: 72, label: '12 h' },
  { steps: 144, label: '24 h' },
  { steps: 288, label: '48 h' },
]
export const DEFAULT_PRECIP_STEPS = 6

export const windowLabel = (steps: number): string =>
  PRECIP_WINDOWS.find((w) => w.steps === steps)?.label ?? `${Math.round((steps / 6) * 10) / 10} h`

// --- Farbskalen -------------------------------------------------------------------------------

/**
 * Niederschlag je Fenster: dieselben 20 Farben, Rot (Index 14) auf „markant", Lila (16) auf
 * „Unwetter" der DWD-Warnkriterien des Zeitraums — Starkregen 1 h 15/25 mm, Dauerregen
 * 12 h 25/40, 24 h 30/50, 48 h 40/60 mm. Für 10 min gibt es kein Kriterium; dort liegen die
 * Stufen beim Sechstel der Stundenwerte (4 mm in 10 min ≈ 24 mm/h). 3 h nimmt die
 * Grundskala der Seite.
 */
const PRECIP_BY_STEPS: Record<number, ColorScale> = {
  1: precipScale([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20]),
  6: precipScale([0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 25, 30, 40, 60]),
  18: COLOR_SCALES.precipitation,
  72: precipScale([0.1, 0.2, 0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 13, 16, 20, 25, 30, 40, 50, 70, 100]),
  144: precipScale([0.1, 0.3, 0.5, 1, 2, 3, 4, 5, 7, 10, 13, 16, 20, 25, 30, 40, 50, 60, 80, 120]),
  288: precipScale([0.1, 0.3, 0.5, 1, 2, 3, 5, 7, 10, 13, 16, 20, 25, 30, 40, 50, 60, 75, 90, 150]),
}
export const precipScaleFor = (steps: number): ColorScale => PRECIP_BY_STEPS[steps] ?? COLOR_SCALES.precipitation

/** Rot = wärmer geworden, Blau = kälter (wie die Abweichungen der Klimakarte) */
const TEMP_CHANGE: ColorScale = {
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

/** Fallend magenta, steigend grün — dieselbe Lesart wie die Druckskala (Tief magenta, Hoch grün) */
const pressureChange = (s: number[]): ColorScale => ({
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: -s[3], color: '#c8236a' },
    { value: -s[2], color: '#e0508a' },
    { value: -s[1], color: '#f0a9c2' },
    { value: -s[0], color: '#5c5c58' },
    { value: s[0], color: '#8fc0a2' },
    { value: s[1], color: '#57b98a' },
    { value: s[2], color: '#2ba06a' },
    { value: s[3], color: '#0f7040' },
  ],
})
// Untere Kante jeder Klasse; unter −s[3] bleibt es beim dunkelsten Magenta (`clamp`)
const PRESSURE_TEND_3H = pressureChange([0.5, 1.5, 3, 5])
const PRESSURE_CHANGE_24H = pressureChange([1, 4, 8, 14])

/** Stationsdruck hängt fast nur an der Höhe: eine Rampe von den Gipfeln (dunkel) bis ins Tal */
const STATION_PRESSURE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(640, 20, lerpRamp(['#2b1d5c', '#3a52b0', '#2f9ac8', '#5fcf9f', '#c9dd58', '#f2b23c'], 21)),
}

const YELLOW = ['#3a3320', '#5a4a00', '#8a6f00', '#b38a00', '#d6a300', '#efc23a', '#f5d670', '#f8e59a']
const SUN_1H: ColorScale = { kind: 'stepped', belowMin: 'clamp', stops: [0, 5, 10, 20, 30, 40, 50, 60].map((value, i) => ({ value, color: YELLOW[i] })) }
const SUN_24H: ColorScale = { kind: 'stepped', belowMin: 'clamp', stops: [0, 1, 2, 4, 6, 8, 10, 12].map((value, i) => ({ value, color: YELLOW[i] })) }

/** Schneehöhe (cm), wie in der Klimakarte; aper bleibt durchsichtig */
const SNOW_DEPTH: ColorScale = {
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

/** Regendauer: Anteil des Fensters, als Blauleiter */
const BLUES = lerpRamp(['#d4ecfb', '#5ea9ea', '#1f53b4', '#1a2a6b'], 10)
const durationScale = (max: number): ColorScale => ({
  kind: 'stepped',
  stops: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1].map((f, i) => ({ value: Math.round(f * max * 100) / 100, color: BLUES[i] })),
})

// --- Größen -----------------------------------------------------------------------------------

const TEMP: TawesDisplay = { unit: '°C', factor: 1, decimals: 1, scale: COLOR_SCALES.temperature_2m }
const TEMP_C: TawesDisplay = { unit: 'K', factor: 1, decimals: 1, scale: TEMP_CHANGE }
const WIND: TawesDisplay = { unit: 'km/h', factor: 3.6, decimals: 0, scale: COLOR_SCALES.wind_speed_10m }
const GUST: TawesDisplay = { unit: 'km/h', factor: 3.6, decimals: 0, scale: COLOR_SCALES.wind_gusts_10m }
const RADIATION: TawesDisplay = { unit: 'W/m²', factor: 1, decimals: 0, scale: COLOR_SCALES.shortwave_radiation }
const TEMP_VALID: [number, number] = [-50, 50]

export const TAWES_PARAMS: TawesParam[] = [
  // Temperatur
  { key: 'tl', label: 'Lufttemperatur 2 m', group: 'Temperatur', source: 'tl', agg: 'last', display: TEMP, valid: TEMP_VALID, description: 'Lufttemperatur in 2 m Höhe zum Termin (10-Minuten-Wert).' },
  { key: 'tlmax', label: 'Höchstwert 06–18 UTC', group: 'Temperatur', source: 'tlmax', agg: 'max', synoptic: 'day', display: TEMP, valid: TEMP_VALID, description: 'Höchste Lufttemperatur des synoptischen Tages 06–18 UTC, aus den 10-Minuten-Maxima. Läuft der Tag noch, ist es der Höchstwert bisher.' },
  { key: 'tlmin', label: 'Tiefstwert 18–06 UTC', group: 'Temperatur', source: 'tlmin', agg: 'min', synoptic: 'night', display: TEMP, valid: TEMP_VALID, description: 'Tiefste Lufttemperatur der synoptischen Nacht 18–06 UTC, aus den 10-Minuten-Minima. Läuft die Nacht noch, ist es der Tiefstwert bisher.' },
  { key: 'tl_d3', label: 'Änderung 3 h', group: 'Temperatur', source: 'tl', agg: 'change', steps: 18, display: TEMP_C, valid: TEMP_VALID, description: 'Temperatur zum Termin minus Temperatur drei Stunden davor. Zeigt Kaltfronten, Föhndurchbrüche und den Tagesgang.' },
  { key: 'tl_d24', label: 'Änderung 24 h', group: 'Temperatur', source: 'tl', agg: 'change', steps: 144, display: TEMP_C, valid: TEMP_VALID, description: 'Temperatur zum Termin minus Temperatur zur selben Uhrzeit am Vortag — der Tagesgang fällt dabei heraus, übrig bleibt der Luftmassenwechsel.' },
  { key: 'td', label: 'Taupunkt', group: 'Temperatur', source: 'dewpoint', agg: 'last', display: { unit: '°C', factor: 1, decimals: 1, scale: COLOR_SCALES.dew_point_2m }, description: 'Aus Lufttemperatur und relativer Feuchte gerechnet (Magnus-Formel). GeoSphere führt keinen eigenen Taupunkt.' },
  { key: 'gefuehlt', label: 'Gefühlte Temperatur', group: 'Temperatur', source: 'apparent', agg: 'last', display: TEMP, description: 'Aus Lufttemperatur, Feuchte und Wind nach der AU-BOM/Steadman-Formel — dieselbe wie in der Klimakarte und bei Open-Meteo.' },

  // Feuchte
  { key: 'rf', label: 'Relative Feuchte', group: 'Feuchte', source: 'rf', agg: 'last', display: { unit: '%', factor: 1, decimals: 0, scale: COLOR_SCALES.relative_humidity_2m }, valid: [0, 100], description: 'Relative Luftfeuchte in 2 m Höhe zum Termin.' },

  // Wind
  { key: 'ff', label: 'Wind (vektorielles Mittel)', group: 'Wind', source: 'ff', agg: 'last', display: WIND, dir: 'dd', valid: [0, 80], description: 'Mittlerer Wind der letzten 10 Minuten in 10 m Höhe, vektoriell gemittelt: bei drehendem Wind kleiner als das arithmetische Mittel. Das ist der übliche Kartenwert, mit Richtung als Windfiedern.' },
  { key: 'ffam', label: 'Wind (arithmetisches Mittel)', group: 'Wind', source: 'ffam', agg: 'last', display: WIND, valid: [0, 80], description: 'Mittel der Windgeschwindigkeit über 10 Minuten ohne Richtung. Liegt bei böigem, drehendem Wind deutlich über dem vektoriellen Mittel.' },
  { key: 'ffx', label: 'Spitzenböe 10 min', group: 'Wind', source: 'ffx', agg: 'last', display: GUST, dir: 'ddx', valid: [0, 100], description: 'Stärkste Böe der letzten 10 Minuten, mit der Richtung, aus der sie kam.' },
  { key: 'ffx1', label: 'Spitzenböe 1 h', group: 'Wind', source: 'ffx', agg: 'max', steps: 6, display: GUST, valid: [0, 100], description: 'Stärkste Böe der Stunde bis zum Termin.' },
  { key: 'ffx24', label: 'Spitzenböe 24 h', group: 'Wind', source: 'ffx', agg: 'max', steps: 144, display: GUST, valid: [0, 100], description: 'Stärkste Böe der 24 Stunden bis zum Termin.' },

  // Luftdruck
  { key: 'pred', label: 'Luftdruck auf Meeresniveau', group: 'Luftdruck', source: 'pred', agg: 'last', display: { unit: 'hPa', factor: 1, decimals: 1, scale: COLOR_SCALES.pressure_msl }, valid: [900, 1080], description: 'Auf Meeresniveau reduzierter Luftdruck. GeoSphere reduziert NUR die tiefer gelegenen Stationen auf Meeresniveau (gemessen 2026-11-12: rund 170); die Bergstationen führen unter demselben Namen einen auf eine Bezugshöhe reduzierten Wert um 830 bzw. 787 hPa. Diese fehlen hier, sonst stünden sie als tiefe Tiefs in der Karte.' },
  { key: 'p', label: 'Luftdruck an der Station', group: 'Luftdruck', source: 'p', agg: 'last', display: { unit: 'hPa', factor: 1, decimals: 1, scale: STATION_PRESSURE }, valid: [500, 1080], description: 'Gemessener Luftdruck in Stationshöhe. Hängt vor allem an der Höhe — für die Wetterlage taugt die Tendenz daneben.' },
  { key: 'p_d3', label: 'Drucktendenz 3 h', group: 'Luftdruck', source: 'p', agg: 'change', steps: 18, display: { unit: 'hPa', factor: 1, decimals: 1, scale: PRESSURE_TEND_3H }, valid: [500, 1080], description: 'Druckänderung der letzten drei Stunden aus dem Stationsdruck — die synoptische Tendenz. Gerechnet am Stationsdruck, weil der reduzierte nur ein Teil der Stationen führt; über drei Stunden ist der Unterschied zwischen beiden vernachlässigbar.' },
  { key: 'p_d24', label: 'Druckänderung 24 h', group: 'Luftdruck', source: 'p', agg: 'change', steps: 144, display: { unit: 'hPa', factor: 1, decimals: 1, scale: PRESSURE_CHANGE_24H }, valid: [500, 1080], description: 'Druckänderung seit derselben Uhrzeit am Vortag, aus dem Stationsdruck.' },

  // Niederschlag
  {
    key: 'rr',
    label: 'Niederschlag',
    group: 'Niederschlag',
    source: 'rr',
    agg: 'sum',
    windowed: true,
    display: (steps) => ({ unit: 'mm', factor: 1, decimals: 1, scale: precipScaleFor(steps) }),
    valid: [0, 100],
    description: 'Niederschlagssumme über das gewählte Fenster bis zum Termin. Fehlt mehr als ein Viertel der 10-Minuten-Werte, steht dort keine Zahl — eine Summe mit Lücke sähe trockener aus, als es war. Die Farben hängen am Fenster: Rot ab der DWD-Schwelle „markant", Lila ab „Unwetter".',
  },
  {
    key: 'rrm',
    label: 'Niederschlagsdauer',
    group: 'Niederschlag',
    source: 'rrm',
    agg: 'sum',
    windowed: true,
    display: (steps) =>
      steps <= 6
        ? { unit: 'min', factor: 1, decimals: 0, scale: durationScale(steps * 10) }
        : { unit: 'h', factor: 1 / 60, decimals: 1, scale: durationScale(steps / 6) },
    valid: [0, 10],
    description: 'Wie lange es im gewählten Fenster geregnet oder geschneit hat. Unterscheidet Dauerregen von einem kurzen Guss mit derselben Menge.',
  },

  // Sonne und Strahlung
  { key: 'so1', label: 'Sonnenschein 1 h', group: 'Sonne und Strahlung', source: 'so', agg: 'sum', steps: 6, display: { unit: 'min', factor: 1 / 60, decimals: 0, scale: SUN_1H }, valid: [0, 600], description: 'Sonnenscheindauer der Stunde bis zum Termin.' },
  { key: 'so24', label: 'Sonnenschein 24 h', group: 'Sonne und Strahlung', source: 'so', agg: 'sum', steps: 144, display: { unit: 'h', factor: 1 / 3600, decimals: 1, scale: SUN_24H }, valid: [0, 600], description: 'Sonnenscheindauer der 24 Stunden bis zum Termin.' },
  { key: 'cglo', label: 'Globalstrahlung', group: 'Sonne und Strahlung', source: 'cglo', agg: 'last', display: RADIATION, valid: [0, 1500], description: 'Mittlere Globalstrahlung der letzten 10 Minuten — direkte und diffuse Sonnenstrahlung auf eine waagrechte Fläche. Nachts null.' },
  { key: 'chim', label: 'Himmelsstrahlung', group: 'Sonne und Strahlung', source: 'chim', agg: 'last', display: RADIATION, valid: [0, 1000], description: 'Mittlere diffuse Himmelsstrahlung der letzten 10 Minuten. Nur wenige Stationen messen sie (2026-11-12: vier).' },

  // Schnee
  { key: 'sh', label: 'Schneehöhe', group: 'Schnee', source: 'sh', agg: 'last', display: { unit: 'cm', factor: 1, decimals: 0, scale: SNOW_DEPTH }, valid: [0, 1500], maxAgeSteps: 18, description: 'Gesamtschneehöhe aus der Schneepegelmessung. Negative Werte (Messrauschen) zählen als fehlend. Darf bis zu drei Stunden alt sein — die Pegel melden seltener.' },

  // Boden
  { key: 'ts', label: 'Lufttemperatur 5 cm', group: 'Boden', source: 'ts', agg: 'last', display: TEMP, valid: TEMP_VALID, description: 'Lufttemperatur 5 cm über dem Boden. In klaren Nächten deutlich unter der 2-m-Temperatur.' },
  { key: 'tsmin', label: 'Tiefstwert 5 cm 18–06 UTC (Bodenfrost)', group: 'Boden', source: 'tsmin', agg: 'min', synoptic: 'night', display: TEMP, valid: TEMP_VALID, description: 'Tiefste Temperatur 5 cm über dem Boden in der synoptischen Nacht 18–06 UTC. Unter 0 °C: Bodenfrost, auch wenn die 2-m-Temperatur positiv blieb.' },
  { key: 'tsmax', label: 'Höchstwert 5 cm 06–18 UTC', group: 'Boden', source: 'tsmax', agg: 'max', synoptic: 'day', display: TEMP, valid: TEMP_VALID, description: 'Höchste Temperatur 5 cm über dem Boden im synoptischen Tag 06–18 UTC.' },
  { key: 'tb10', label: 'Erdboden −10 cm', group: 'Boden', source: 'tb10', agg: 'last', display: TEMP, valid: [-30, 40], description: 'Erdbodentemperatur in 10 cm Tiefe. Nur ein Teil der Stationen misst sie.' },
  { key: 'tb20', label: 'Erdboden −20 cm', group: 'Boden', source: 'tb20', agg: 'last', display: TEMP, valid: [-30, 40], description: 'Erdbodentemperatur in 20 cm Tiefe.' },
  { key: 'tb50', label: 'Erdboden −50 cm', group: 'Boden', source: 'tb50', agg: 'last', display: TEMP, valid: [-30, 40], description: 'Erdbodentemperatur in 50 cm Tiefe — folgt der Luft nur mit Tagen Verzug.' },
]

export const DEFAULT_TAWES_PARAM = 'tl'

export const getTawesParam = (key: string): TawesParam => TAWES_PARAMS.find((p) => p.key === key) ?? TAWES_PARAMS[0]

export const displayOf = (p: TawesParam, steps: number): TawesDisplay =>
  typeof p.display === 'function' ? p.display(steps) : p.display

/** Rohgrößen, die eine Größe zum Rechnen braucht */
export function codesFor(p: TawesParam, withDir = false): TawesCode[] {
  const base: TawesCode[] = p.source === 'dewpoint' ? ['tl', 'rf'] : p.source === 'apparent' ? ['tl', 'rf', 'ff'] : [p.source]
  return withDir && p.dir ? [...base, p.dir] : base
}

/** Fenster der Größe in 10-min-Schritten (wählbar beim Niederschlag) */
export const stepsFor = (p: TawesParam, precipSteps: number): number => (p.windowed ? precipSteps : (p.steps ?? 1))

/** Beschriftung in der Karte: „Niederschlag 24 h", „Spitzenböe 1 h" */
export const tawesTitle = (p: TawesParam, precipSteps: number): string =>
  p.windowed ? `${p.label} ${windowLabel(precipSteps)}` : p.label

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export interface SynopticWindow {
  /** Beginn (ausschließlich) und Ende (einschließlich) des Zeitraums, ms */
  startMs: number
  endMs: number
  /** Zeitraum läuft beim Termin noch */
  running: boolean
}

/**
 * Synoptischer Zeitraum zum Termin `atMs`: der laufende, wenn der Termin darin liegt, sonst
 * der zuletzt abgeschlossene — um 21 UTC zeigt der Höchstwert also den Tag 06–18 UTC, um
 * 10 UTC der Tiefstwert die vergangene Nacht. Ein 10-Minuten-Wert gilt für die zehn Minuten
 * BIS zu seinem Zeitstempel, deshalb gehört der Wert um 06:00 noch zur Nacht.
 */
export function synopticWindow(atMs: number, kind: 'day' | 'night'): SynopticWindow {
  const endHour = kind === 'day' ? 18 : 6
  const d = new Date(atMs)
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), endHour)
  if (end < atMs) end += DAY_MS
  const start = end - 12 * HOUR_MS
  if (atMs > start) return { startMs: start, endMs: end, running: atMs < end }
  return { startMs: start - DAY_MS, endMs: end - DAY_MS, running: false }
}

/**
 * Die Zeiträume für die Zeitleiste im Tagesmodus, ältester zuerst: der zum Stand des Netzes
 * (`newestMs`, ggf. noch laufend) und davor so viele ganze, wie der Speicher ab `firstMs`
 * trägt — höchstens `max`.
 */
export function synopticPeriods(newestMs: number, firstMs: number, kind: 'day' | 'night', max = 5): SynopticWindow[] {
  const w0 = synopticWindow(newestMs, kind)
  const out: SynopticWindow[] = [w0]
  for (let i = 1; out.length < max; i++) {
    const startMs = w0.startMs - i * DAY_MS
    if (startMs < firstMs) break
    out.unshift({ startMs, endMs: w0.endMs - i * DAY_MS, running: false })
  }
  return out
}
