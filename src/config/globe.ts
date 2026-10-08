// Modellkarten: ECMWF IFS, DWD ICON-EU und ICON-D2 als Globus oder flache
// Karte (Europa, Alpen). Intern heißt der Bereich weiter „globe" — dort hat er
// angefangen, und das Datenformat ist dasselbe geblieben.
//
// Die Daten kommen NICHT von Open-Meteo — ein Gitter kostet dort ~Punktzahl
// Calls (global 1° = 65.000, Tagesbudget 10.000; ICON-D2 nativ ~900.000
// Punkte je Feld). Sie kommen direkt von ECMWF und vom DWD, geholt im Deploy
// (`scripts/ecmwf-ingest.py`, `scripts/icon-ingest.py`, gemeinsamer Kern
// `scripts/nwp_common.py`) und als Wertebilder same-origin ausgeliefert:
// verlustfreies WebP, je Pixel ein 16-Bit-Code in R (hoch) und G (tief),
// Wert = lo + (code − 1) · step, code 0 = kein Wert. Das Raster ist je Modell
// das native Gitter (`GlobeGrid`, aus dem GRIB übernommen); ECMWF ist global
// und tastet von Nord nach Süd, ICON regional und von Süd nach Nord.
//
// Hier liegen die Registry und die reinen Rechenkerne (Dekodieren, Abtasten,
// Kachelgeometrie, Laufalter) — getestet in `globe.test.ts`. Das Einfärben
// der Kacheln steht in `render/globeTiles.ts`, das Laden in `api/globeData.ts`.

import { bands, COLOR_SCALES, lerpRamp, TEMP_ANCHORS, type ColorScale } from './colorscales'

/**
 * `uv10` und `wavedir` sind keine wählbaren Größen, sondern die Datenquellen
 * der Partikel (Wind bzw. Wellenlauf, `encoding: 'uv8'`) — sie stehen deshalb
 * nicht in `GLOBE_VARIABLES`.
 */
export type GlobeVarId =
  | 't2m' | 't850' | 'msl' | 'precip' | 'wind10' | 'gust' | 'gh500' | 'tcc' | 'clouds' | 'uv10'
  | 'swh' | 'pp1d' | 'sst' | 'wavedir'

export interface GlobeVariable {
  id: GlobeVarId
  label: string
  /** Erklärung im Tooltip der Auswahl. */
  title: string
  scale: ColorScale
  /** Nachkommastellen der Werteanzeige am Zeiger. */
  decimals: number
  /** Jede wievielte Stufe der Legende beschriftet wird. */
  legendEvery: number
  /**
   * 'rgb3': drei Größen in einem Bild (Wolkenschichten), eigene Einfärbung
   * und Legende — `scale` gilt dann nicht.
   */
  kind?: 'rgb3'
}

/**
 * Temperatur GLOBAL: die Anker der Feld-Karte (`TEMP_ANCHORS`, −30 … 42 °C in
 * 8-K-Schritten) unverändert in der Mitte, nach unten um drei Anker bis −54
 * und nach oben um einen bis 50 °C verlängert. Mit der europäischen Skala
 * stand die ganze Antarktis und halb Sibirien im Winter in EINER Farbe
 * (unterste Stufe −30 °C, im Prototyp gesehen). Das kalte Ende wird HELLER —
 * Eis statt noch mehr Violett, und es bleibt vom −30-Violett unterscheidbar.
 */
const GLOBAL_TEMP_ANCHORS = ['#f1edf7', '#c9b6e0', '#9b77c3', ...TEMP_ANCHORS, '#4d0f33']
const GLOBAL_TEMP: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  // 14 Anker im 8-K-Abstand von −54 bis 50 → 53 Bänder à 2 K
  stops: bands(-54, 2, lerpRamp(GLOBAL_TEMP_ANCHORS, 53)),
}

/** 500-hPa-Geopotential: 480 … 600 gpdm in 4-gpdm-Bändern, kalt (Trog) → warm (Rücken). */
/**
 * Gesamtbewölkung in GRAUSTUFEN, wolkenlos HELL, bedeckt DUNKEL — dieselbe
 * Leserichtung wie im klassischen Meteogramm („SONNIG = HELL, BEDECKT =
 * DUNKEL"): die Fläche zeigt, wie der Himmel aussieht. Die vorherige Skala
 * (bedeckt weiß, wolkenlos durchsichtig) las sich umgekehrt. Das dunkle Ende
 * bleibt ÜBER der Kartenfarbe (#131418), sonst wäre „bedeckt" von „außerhalb
 * des Modellgebiets" nicht zu unterscheiden.
 */
const TCC_GREY: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(0, 10, lerpRamp(['#e4e5e7', '#2e3033'], 11)),
}

/**
 * MEER (nur ECMWF, Wellenmodell WAM). Über Land gibt es keinen Wert, dort
 * bleibt die Karte durchsichtig — Land und Meer trennen sich von selbst.
 * Wellenhöhe: ruhige See dunkelblau, ab ~2,5 m warm, Sturmsee magenta; die
 * Stufen sind unten fein (25 cm), weil dort entschieden wird, ob man baden
 * oder segeln kann.
 */
const WAVE_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12]
const WAVE_COLORS = lerpRamp(
  ['#123a6e', '#1f6fb0', '#2fa6c4', '#5cc8a8', '#b5df6a', '#f2d24b', '#f39a35', '#e0532a', '#b9265a', '#7c1a7a'],
  WAVE_STEPS.length,
)
const WAVE_HEIGHT: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: WAVE_STEPS.map((value, i) => ({ value, color: WAVE_COLORS[i] })),
}
/** Peak-Periode: kurze Windsee violett/blau, lange Dünung gelb/orange. */
const WAVE_PERIOD: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(0, 2, lerpRamp(['#2b1a4f', '#3c3f9a', '#2f7fb8', '#35b0a0', '#9fd36a', '#f2d24b', '#f08a3a'], 11)),
}
/** Wassertemperatur in 1-K-Bändern von −2 bis 32 °C. */
const SEA_TEMP: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(-2, 1, lerpRamp(['#3b2d7a', '#2f5fae', '#2d9cc0', '#3fbf9c', '#a6d65c', '#f2d24b', '#f39a35', '#e0532a', '#a8203f'], 35)),
}

const GH500: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(480, 4, lerpRamp(TEMP_ANCHORS, 31)),
}

export const GLOBE_VARIABLES: GlobeVariable[] = [
  {
    id: 't2m',
    label: 'Temperatur 2 m',
    title: 'Lufttemperatur in 2 m Höhe (°C)',
    scale: GLOBAL_TEMP,
    decimals: 1,
    legendEvery: 5,
  },
  {
    id: 't850',
    label: 'Temperatur 850 hPa',
    title:
      'Temperatur auf 850 hPa (~1500 m) — die Luftmasse ohne die bodennahe Grenzschicht. Über Hochland (Tibet, Anden, Antarktis) liegt die Fläche UNTER dem Gelände und ist vom Modell extrapoliert.',
    scale: GLOBAL_TEMP,
    decimals: 1,
    legendEvery: 5,
  },
  {
    id: 'gh500',
    label: 'Geopotential 500 hPa',
    title: 'Höhe der 500-hPa-Fläche in geopotentiellen Dekametern — Tröge (niedrig) und Rücken (hoch) der Höhenströmung',
    scale: GH500,
    decimals: 1,
    legendEvery: 5,
  },
  {
    id: 'msl',
    label: 'Luftdruck (MSL)',
    title: 'Auf Meereshöhe reduzierter Luftdruck (hPa)',
    scale: COLOR_SCALES.pressure_msl,
    decimals: 1,
    legendEvery: 1,
  },
  {
    id: 'precip',
    label: 'Niederschlag',
    title:
      'Mittlere Niederschlagsrate im Intervall seit dem vorigen Zeitschritt (mm/h) — bis +144 h über 3 Stunden, danach über 6 Stunden. Bei +0 h gibt es kein Intervall.',
    scale: COLOR_SCALES.precipitation,
    decimals: 1,
    legendEvery: 3,
  },
  {
    id: 'wind10',
    label: 'Wind 10 m',
    title: 'Mittlere Windgeschwindigkeit in 10 m Höhe zum Termin (km/h)',
    scale: COLOR_SCALES.wind_speed_10m,
    decimals: 0,
    legendEvery: 1,
  },
  {
    id: 'gust',
    label: 'Böen 10 m',
    title: 'Höchste Böe in 10 m seit dem vorigen Zeitschritt (km/h) — bis +144 h über 3 Stunden, danach über 6 Stunden',
    scale: COLOR_SCALES.wind_gusts_10m,
    decimals: 0,
    legendEvery: 1,
  },
  {
    id: 'tcc',
    label: 'Bewölkung gesamt',
    title: 'Gesamtbedeckung (%) — hell = wolkenlos, dunkel = bedeckt',
    scale: TCC_GREY,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'clouds',
    label: 'Wolkenschichten (nur ICON)',
    title:
      'Bedeckung je Höhe in Achteln als drei halbtransparente Flächen: hoch = grün, mittel = rot, tief = blau — je mehr Achtel, desto heller und kräftiger. Übereinander gestapelt wie von oben gesehen (tief unten, hoch oben). ECMWF Open Data führt keine Schichten.',
    scale: TCC_GREY,
    decimals: 0,
    legendEvery: 1,
    kind: 'rgb3',
  },
  {
    id: 'swh',
    label: 'Wellenhöhe (nur IFS)',
    title:
      'Signifikante Wellenhöhe (m) aus dem ECMWF-Wellenmodell — das Mittel des höchsten Drittels der Wellen, Windsee und Dünung zusammen. Einzelne Wellen werden bis etwa doppelt so hoch.',
    scale: WAVE_HEIGHT,
    decimals: 1,
    legendEvery: 2,
  },
  {
    id: 'pp1d',
    label: 'Wellenperiode (nur IFS)',
    title:
      'Peak-Periode (s): Abstand der energiereichsten Wellen. Unter ~8 s kurze, steile Windsee, über ~12 s lange Dünung aus fernen Sturmgebieten.',
    scale: WAVE_PERIOD,
    decimals: 1,
    legendEvery: 1,
  },
  {
    id: 'sst',
    label: 'Wassertemperatur (nur IFS)',
    title:
      'Temperatur der Meeresoberfläche (°C) — die Hauttemperatur des Modells über dem Meer, also die oberste Schicht, nicht die Temperatur in Badetiefe. Über Meereis kein Wert.',
    scale: SEA_TEMP,
    decimals: 1,
    legendEvery: 4,
  },
]

/** Größen, über denen die Partikel den WELLENLAUF statt des Winds zeigen. */
export const WAVE_VARIABLES: ReadonlySet<GlobeVarId> = new Set(['swh', 'pp1d'])

export const DEFAULT_GLOBE_VARIABLE: GlobeVarId = 't2m'

// --- Modelle und Ansichten -------------------------------------------------

export type GlobeModelId = 'ecmwf-ifs' | 'icon-eu' | 'icon-d2'

export interface GlobeModel {
  id: GlobeModelId
  label: string
  resolution: string
  /** Wer die Daten liefert — steht in der Quellenzeile (Lizenzbedingung). */
  provider: 'ECMWF' | 'DWD'
  /**
   * Ab diesem Alter des Laufs warnt die Leiste. Normalalter = Takt +
   * Bereitstellung + Abstand des Deploy-Crons (3 h), gemessen 2026-10-05:
   * IFS 12 + 7,5 + 3 ≈ 22,5 h · ICON-EU 6 + 3,7 + 3 ≈ 13 h · ICON-D2
   * 3 + 1,3 + 3 ≈ 7,5 h. Darüber ist mindestens ein Lauf ausgefallen.
   */
  staleHours: number
  /**
   * Höchste Zoomstufe, auf der Kacheln NEU abgetastet werden — darüber nur
   * gestreckt. Grob dort, wo ein Kachelpixel die Gitterweite unterschreitet:
   * 25 km → 6, 7 km → 7, 2,2 km → 8.
   */
  maxzoom: number
  title: string
}

export const GLOBE_MODELS: GlobeModel[] = [
  {
    id: 'ecmwf-ifs',
    label: 'ECMWF IFS',
    resolution: '25 km',
    provider: 'ECMWF',
    staleHours: 30,
    maxzoom: 6,
    title: 'ECMWF IFS 0,25° — weltweit, bis +15 Tage (Läufe 00/12 UTC)',
  },
  {
    id: 'icon-eu',
    label: 'ICON-EU',
    resolution: '7 km',
    provider: 'DWD',
    staleHours: 15,
    maxzoom: 7,
    title: 'DWD ICON-EU 0,0625° — Europa, bis +120 h (Läufe 00/06/12/18 UTC)',
  },
  {
    id: 'icon-d2',
    label: 'ICON-D2',
    resolution: '2,2 km',
    provider: 'DWD',
    staleHours: 9,
    maxzoom: 8,
    title: 'DWD ICON-D2 0,02° — Deutschland, Alpen, Österreich, bis +48 h (Läufe alle 3 h)',
  },
]

export const DEFAULT_GLOBE_MODEL: GlobeModelId = 'ecmwf-ifs'

export function getGlobeModel(id: string): GlobeModel {
  return GLOBE_MODELS.find((m) => m.id === id) ?? GLOBE_MODELS[0]
}

// --- Isolinien ---------------------------------------------------------------

export type ContourId = 'msl' | 'gh500'

export interface ContourDef {
  id: ContourId
  label: string
  title: string
  /** Linienabstand in der Einheit der Größe (auf der ganzen Kugel verdoppelt). */
  interval: number
  /**
   * Glättung vor dem Linienzeichnen in Gitterzellen (Kastenfilter ±r), je
   * Modell. Reduzierter BODENDRUCK ist über Gebirge verrauscht, und das umso
   * mehr, je feiner das Gitter: ICON-D2 zog mit ±4 Zellen (~18 km)
   * geschlossene 1025er-Kringel um jedes Alpental, mit ±8 noch große Schleifen
   * (beides im Browser gesehen); ±12 sind ~50 km — die Skala, auf der eine
   * Isobare eine Wetterlage beschreibt. Das 500-hPa-Feld ist von sich aus
   * glatt; ±1 nimmt beim IFS nur winzige Inseln, die bilinear als kantige
   * Kästchen erschienen. Die Farbfläche bleibt in jedem Fall ungeglättet.
   */
  smooth: Record<GlobeModelId, number>
}

/**
 * Abstände nach der Praxis der Wetterdienste: Isobaren alle 5 hPa (DWD-
 * Bodenanalyse), 500 hPa alle 4 gpdm.
 */
export const CONTOURS: ContourDef[] = [
  {
    id: 'msl',
    label: 'Isobaren',
    title: 'Bodendruck (MSL) alle 5 hPa, beschriftet — geglättet, damit Gebirgsrauschen keine Kringel zieht',
    interval: 5,
    smooth: { 'ecmwf-ifs': 1, 'icon-eu': 3, 'icon-d2': 12 },
  },
  {
    id: 'gh500',
    label: '500 hPa',
    title: 'Geopotential 500 hPa alle 4 gpdm, beschriftet',
    interval: 4,
    smooth: { 'ecmwf-ifs': 1, 'icon-eu': 1, 'icon-d2': 3 },
  },
]

export type GlobeViewId = 'globe' | 'europe' | 'alps'

export interface GlobeView {
  id: GlobeViewId
  label: string
  projection: 'globe' | 'mercator'
  /** [[W, S], [O, N]] für die flachen Ansichten */
  bounds?: [[number, number], [number, number]]
}

export const GLOBE_VIEWS: GlobeView[] = [
  { id: 'globe', label: 'Globus', projection: 'globe' },
  // Europa: das ICON-EU-Gebiet ohne Nordafrika und Ural-Rand — die synoptische Übersicht
  { id: 'europe', label: 'Europa', projection: 'mercator', bounds: [[-25, 34], [42, 71]] },
  // Alpen: der Raum, in dem ICON-D2 seine 2,2 km ausspielt
  { id: 'alps', label: 'Alpen', projection: 'mercator', bounds: [[4.5, 44.3], [17.8, 49.8]] },
]

export function getGlobeVariable(id: string): GlobeVariable {
  return GLOBE_VARIABLES.find((v) => v.id === id) ?? GLOBE_VARIABLES[0]
}

// --- meta.json -------------------------------------------------------------

export interface GlobeGrid {
  ni: number
  nj: number
  lon0: number
  lat0: number
  dlon: number
  /** negativ: Zeile 0 ist der Nordrand (ECMWF), positiv: der Südrand (ICON) */
  dlat: number
  /**
   * Schließt sich die Länge (Spalte ni−1 grenzt an Spalte 0)? Nur dann wird
   * über die Datumsgrenze gewickelt; ein regionales Gitter endet an seinem
   * Rand, außerhalb gibt es keinen Wert.
   */
  global: boolean
}

export interface GlobeVarMeta {
  lo: number
  step: number
  unit: string
  /** Vorhandene Schritte in Stunden ab Init (Niederschlag und Böe ohne +0). */
  steps: number[]
  /**
   * Nur Niederschlag und Böe: Länge des Intervalls VOR dem Termin, für das
   * der Wert gilt (h), parallel zu `steps`. Aus dem GRIB übernommen, nicht
   * angenommen — gemessen wechselt es: der Niederschlag gilt bis zum vorigen
   * Schritt (1, 3 oder 6 h), die Böe bei ICON IMMER der letzten Stunde, bei
   * IFS bis +90 h der letzten Stunde, dann 3 bzw. 6 h.
   */
  intervals?: number[]
  /**
   * 'rgb3' = Wolkenschichten, drei Kanäle in % statt eines Codes;
   * 'uv8' = Windkomponenten, R = u, G = v, je (code − 128) · 0,5 m/s, 0 = kein Wert
   */
  encoding?: 'rgb3' | 'uv8'
}

/** Intervall (h) des Werts zum Schritt, oder undefined für Termingrößen. */
export function intervalHours(vm: GlobeVarMeta | undefined, step: number): number | undefined {
  if (!vm?.intervals) return undefined
  const i = vm.steps.indexOf(step)
  return i < 0 ? undefined : vm.intervals[i]
}

export interface GlobeMeta {
  model: GlobeModelId
  runId: string
  /** Init-Zeit, ISO UTC */
  run: string
  generated: string
  grid: GlobeGrid
  variables: Partial<Record<GlobeVarId, GlobeVarMeta>>
}

/** Ein dekodiertes Feld: Codes statt Werte (halber Speicher, 2 MB je Feld). */
export interface GlobeField {
  grid: GlobeGrid
  lo: number
  step: number
  codes: Uint16Array
  /** Nur Wolkenschichten: je Zelle [mittel, hoch, tief] in %, 255 = kein Wert. */
  rgb?: Uint8Array
  /** Nur Windkomponenten: je Zelle [u, v] als Code, (code − 128) · 0,5 m/s, 0 = kein Wert. */
  uv?: Uint8Array
}

/** RGBA-Pixel eines Windbilds → je Zelle [u, v] als 8-Bit-Code (R = u, G = v). */
export function decodeUv8(rgba: ArrayLike<number>, count: number): Uint8Array {
  const out = new Uint8Array(count * 2)
  for (let i = 0; i < count; i++) {
    out[2 * i] = rgba[4 * i]
    out[2 * i + 1] = rgba[4 * i + 1]
  }
  return out
}

/**
 * Wind (u nach Osten, v nach Norden, m/s) an (lat, lon), bilinear, oder null
 * außerhalb des Gitters bzw. sobald ein Nachbar keinen Wert hat — dieselbe
 * Regel wie `sampleField`.
 */
export function sampleWind(f: GlobeField, lat: number, lon: number): [number, number] | null {
  const uv = f.uv
  if (!uv) return null
  const { ni, nj } = f.grid
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return null
  const ix0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
  const ix1 = ix0 + 1 === ni ? 0 : ix0 + 1
  const iy0 = Math.min(nj - 2, Math.floor(gy))
  const fx = gx - ix0
  const fy = gy - iy0
  const i00 = 2 * (iy0 * ni + ix0)
  const i01 = 2 * (iy0 * ni + ix1)
  const i10 = 2 * ((iy0 + 1) * ni + ix0)
  const i11 = 2 * ((iy0 + 1) * ni + ix1)
  if (uv[i00] === 0 || uv[i01] === 0 || uv[i10] === 0 || uv[i11] === 0) return null
  const w00 = (1 - fx) * (1 - fy)
  const w01 = fx * (1 - fy)
  const w10 = (1 - fx) * fy
  const w11 = fx * fy
  const u = uv[i00] * w00 + uv[i01] * w01 + uv[i10] * w10 + uv[i11] * w11
  const v = uv[i00 + 1] * w00 + uv[i01 + 1] * w01 + uv[i10 + 1] * w10 + uv[i11 + 1] * w11
  return [(u - 128) * 0.5, (v - 128) * 0.5]
}

/** RGBA-Pixel eines Schichtenbilds → je Zelle drei Bedeckungen (R mittel, G hoch, B tief). */
export function decodeRgb3(rgba: ArrayLike<number>, count: number): Uint8Array {
  const out = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    out[3 * i] = rgba[4 * i]
    out[3 * i + 1] = rgba[4 * i + 1]
    out[3 * i + 2] = rgba[4 * i + 2]
  }
  return out
}

/** Wolkenschichten am Punkt (nächster Gitterpunkt — die Werte sind 5-%-Stufen), oder null. */
export function sampleRgb3(f: GlobeField, lat: number, lon: number): { high: number; mid: number; low: number } | null {
  if (!f.rgb) return null
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return null
  const i = Math.round(gy) * f.grid.ni + (Math.round(gx) % f.grid.ni)
  const mid = f.rgb[3 * i]
  if (mid === 255) return null
  return { mid, high: f.rgb[3 * i + 1], low: f.rgb[3 * i + 2] }
}

/** RGBA-Pixel eines Wertebilds → 16-Bit-Codes (R hoch, G tief). */
export function decodeCodes(rgba: ArrayLike<number>, count: number): Uint16Array {
  const out = new Uint16Array(count)
  for (let i = 0; i < count; i++) out[i] = (rgba[4 * i] << 8) | rgba[4 * i + 1]
  return out
}

/**
 * Gitterspalte (in Zellen, gebrochen) zur Länge, oder null außerhalb eines
 * regionalen Gitters. Global wird über die Datumsgrenze gewickelt (Spalte
 * ni−1 grenzt an Spalte 0 — 179,75° O an 180° W). Länge und Breite sind
 * getrennt, weil die Kacheln Zeilen und Spalten je einmal vorberechnen.
 */
export function gridX(g: GlobeGrid, lon: number): number | null {
  let gx = (lon - g.lon0) / g.dlon
  if (g.global) return ((gx % g.ni) + g.ni) % g.ni
  // regional: Länge auf den Bereich des Gitters falten (−180…180 gegen 0…360)
  if (gx < 0) gx += 360 / g.dlon
  if (gx > g.ni - 1) gx -= 360 / g.dlon
  return gx < 0 || gx > g.ni - 1 ? null : gx
}

/** Gitterzeile zur Breite; global an den Polen geklemmt, regional null außerhalb. */
export function gridY(g: GlobeGrid, lat: number): number | null {
  const gy = (lat - g.lat0) / g.dlat
  if (g.global) return Math.min(g.nj - 1, Math.max(0, gy))
  return gy < 0 || gy > g.nj - 1 ? null : gy
}

/**
 * Bilinearer Wert an (lat, lon). NaN außerhalb eines regionalen Gitters und
 * sobald einer der vier Nachbarn keinen Wert hat: ein halber Mittelwert wäre
 * eine erfundene Zahl.
 */
export function sampleField(f: GlobeField, lat: number, lon: number): number {
  const { ni, nj } = f.grid
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return NaN
  const ix0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
  const ix1 = ix0 + 1 === ni ? 0 : ix0 + 1
  const iy0 = Math.min(nj - 2, Math.floor(gy))
  const fx = gx - ix0
  const fy = gy - iy0
  const c = f.codes
  const r0 = iy0 * ni
  const r1 = r0 + ni
  const c00 = c[r0 + ix0]
  const c01 = c[r0 + ix1]
  const c10 = c[r1 + ix0]
  const c11 = c[r1 + ix1]
  if (c00 === 0 || c01 === 0 || c10 === 0 || c11 === 0) return NaN
  const code = (c00 * (1 - fx) + c01 * fx) * (1 - fy) + (c10 * (1 - fx) + c11 * fx) * fy
  return f.lo + (code - 1) * f.step
}

// --- Kachelgeometrie (Web-Mercator, XYZ) -----------------------------------

/** Länge der Pixelmitte `px` in Kachel x der Stufe z. */
export function tilePixelLon(z: number, x: number, px: number, size: number): number {
  return ((x * size + px + 0.5) / (size * 2 ** z)) * 360 - 180
}

/** Breite der Pixelmitte `py` in Kachel y der Stufe z (inverse Mercator). */
export function tilePixelLat(z: number, y: number, py: number, size: number): number {
  const m = Math.PI * (1 - (2 * (y * size + py + 0.5)) / (size * 2 ** z))
  return (Math.atan(Math.sinh(m)) * 180) / Math.PI
}

// --- Zeit und Laufalter ----------------------------------------------------

const HOUR = 3_600_000

export function runMs(meta: GlobeMeta): number {
  return Date.parse(meta.run)
}

export function validMs(meta: GlobeMeta, step: number): number {
  return runMs(meta) + step * HOUR
}

/** Index des Schritts, dessen Gültigkeitszeit `targetMs` am nächsten liegt. */
export function nearestStepIndex(steps: number[], run: number, targetMs: number): number {
  let best = 0
  let bestD = Infinity
  steps.forEach((s, i) => {
    const d = Math.abs(run + s * HOUR - targetMs)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

export type GlobeFreshness = 'ok' | 'old' | 'spent'

/**
 * 'spent' schlägt 'old': liegt der letzte Termin in der Vergangenheit, ist es
 * keine Vorhersage mehr. Die Schwelle hängt am Modell (`staleHours`) — die
 * 12 h der MOS-Vorhersage wären bei IFS ein Dauerfehlalarm, bei ICON-D2 zu spät.
 */
export function globeFreshness(run: number, lastValid: number, now: number, staleHours: number): GlobeFreshness {
  if (Number.isFinite(lastValid) && lastValid < now) return 'spent'
  if (Number.isFinite(run) && now - run > staleHours * HOUR) return 'old'
  return 'ok'
}
