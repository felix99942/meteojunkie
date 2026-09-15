// Registry des Föhn-Bereichs (FoehnPanel, Rechenkern components/foehn.ts).
//
// Eine FÖHNACHSE ist ein Punktpaar quer über den Alpenhauptkamm, dessen
// Luftdruckdifferenz (MSL, Süd − Nord) die klassische Föhndiagnose ist, plus
// die Punkte, an denen die übrigen Kriterien abgelesen werden: ein Kammpunkt
// (Wind und Temperatur auf 700 hPa ≈ 3000 m, knapp über Kammhöhe) und je
// Richtung eine Talstation im LEE — bei Südföhn liegt das Lee nördlich des
// Kamms, bei Nordföhn südlich.
//
// Vorzeichen: ΔP = Süd − Nord. Positiv = Südföhn-Gradient, negativ = Nordföhn.
//
// NUR LOKALMODELLE (≤ 2,5 km): Föhn ist ein Phänomen der Täler und Pässe, ein
// 25-km-Global glättet genau das weg, worum es geht — die Druckdifferenz über
// den Kamm, den Durchbruch ins Tal. Der Preis ist der Horizont (1,5–5 Tage).
//
// LIVE GEPRÜFT (2026-09-14, alle sieben Achsenpunkte, SPEC §6):
//   Modell                      Auflösung  Horizont  700 hPa
//   meteoswiss_icon_ch1         1 km       33 h      nein (null)
//   meteofrance_arome_france    1,5 km     51 h      ja
//   meteoswiss_icon_ch2         2,1 km     120 h     nein (null)
//   icon_d2                     2,2 km     48 h      ja
//   geosphere_arome_austria     2,5 km     60 h      nein (null)
// `meteofrance_arome_france_hd` liefert KEIN pressure_msl (nur Bodengrößen) —
// deshalb nicht dabei. Lokal-Ensembles mit pressure_msl: ICON-CH2-EPS
// (21 Member, bis +120 h), ICON-D2-EPS (20, +48 h), ICON-CH1-EPS (11, +33 h).
// ΔP lässt sich JE MEMBER rechnen, weil Member n an beiden Punkten derselbe
// Lauf ist.
//
// SCHWELLEN SIND FAUSTREGELN, NICHT HIER GEMESSEN: ±4 hPa „Föhn in den Tälern
// wahrscheinlich", ±8 hPa „kräftiger Föhn" sind die gängigen Daumenwerte für
// Lugano–Zürich und Bozen–Innsbruck. Kammwind, Feuchte und θ-Differenz sind
// ebenso gesetzte Richtwerte. Eine Kalibrierung gegen gemessene Föhnstunden
// (GeoSphere 10-min Innsbruck: Richtung, Böen, Feuchte) steht aus — bis dahin
// sagt die UI „Faustregel".

import type { LatLon } from '../state/workbench'

export type FoehnDirection = 'south' | 'north'

export interface FoehnPoint extends LatLon {
  name: string
}

/** Windrichtungssektor in Grad (meteorologisch, Herkunft), `from` > `to` = über Nord. */
export interface Sector {
  from: number
  to: number
}

export interface FoehnAxis {
  id: string
  label: string
  /** Wo der Föhn der Achse ankommt — für die Auswahl. */
  region: string
  south: FoehnPoint
  north: FoehnPoint
  /** Kammpunkt: 700-hPa-Wind/Temperatur und Stauniederschlag. */
  crest: FoehnPoint
  /** Talstation im Lee bei SÜDföhn (nördlich des Kamms). */
  leeSouthFoehn: FoehnPoint
  /** Talstation im Lee bei NORDföhn (südlich des Kamms). */
  leeNorthFoehn: FoehnPoint
  /** |ΔP| in hPa, ab dem Föhn wahrscheinlich ist (Faustregel). */
  threshold: number
  /** |ΔP| in hPa für kräftigen Föhn (Faustregel). */
  strong: number
}

const BOZEN: FoehnPoint = { name: 'Bozen', lat: 46.498, lon: 11.354 }
const INNSBRUCK: FoehnPoint = { name: 'Innsbruck', lat: 47.26, lon: 11.39 }
const LUGANO: FoehnPoint = { name: 'Lugano', lat: 46.004, lon: 8.96 }

export const FOEHN_AXES: FoehnAxis[] = [
  {
    id: 'tirol',
    label: 'Bozen – Innsbruck',
    region: 'Wipptal / Inntal',
    south: BOZEN,
    north: INNSBRUCK,
    crest: { name: 'Brenner', lat: 47.004, lon: 11.506 },
    // Innsbruck ist selbst die klassische Südföhn-Station am Ausgang des
    // Wipptals; bei Nordföhn liegt Bozen im Lee.
    leeSouthFoehn: INNSBRUCK,
    leeNorthFoehn: BOZEN,
    threshold: 4,
    strong: 8,
  },
  {
    id: 'schweiz',
    label: 'Lugano – Zürich',
    region: 'Reusstal / Zentralschweiz',
    south: LUGANO,
    north: { name: 'Zürich-Kloten', lat: 47.458, lon: 8.548 },
    crest: { name: 'Gotthard', lat: 46.56, lon: 8.56 },
    // Kloten liegt im Mittelland und ist KEINE Föhnstation — das Lee der
    // Achse ist Altdorf im Reusstal, die klassische Schweizer Föhnstation.
    leeSouthFoehn: { name: 'Altdorf', lat: 46.88, lon: 8.64 },
    leeNorthFoehn: LUGANO,
    threshold: 4,
    strong: 8,
  },
]

export const DEFAULT_FOEHN_AXIS = FOEHN_AXES[0].id

export function getFoehnAxis(id: string): FoehnAxis {
  return FOEHN_AXES.find((a) => a.id === id) ?? FOEHN_AXES[0]
}

/**
 * Wählbare Lokalmodelle, fein → grob. Die Reihenfolge ist auch die
 * Farbzuordnung (Farbe folgt dem Modell, nicht der Auswahl).
 */
export const FOEHN_MODELS = [
  'meteoswiss_icon_ch1',
  'meteofrance_arome_france',
  'meteoswiss_icon_ch2',
  'icon_d2',
  'geosphere_arome_austria',
] as const

/** Live geprüft: liefern `temperature_700hPa`/`wind_*_700hPa` an allen Achsenpunkten. */
export const FOEHN_UPPER_AIR_MODELS: ReadonlySet<string> = new Set([
  'meteofrance_arome_france',
  'icon_d2',
])

export const DEFAULT_OVERLAY_MODELS: string[] = [...FOEHN_MODELS]

/**
 * Modell für Kriterien, Kamm und Lee. ICON-D2: eines der zwei Lokalmodelle
 * mit 700-hPa-Größen, und seine Domain deckt beide Achsen ab.
 */
export const DEFAULT_DETAIL_MODEL = 'icon_d2'

export interface FoehnEnsemble {
  id: string
  label: string
  /** Member inkl. Kontrolllauf (live gezählt). */
  members: number
  /** forecast_days für den Abruf — reicht ab heute 00 UTC über den Horizont. */
  forecastDays: number
  /** Deterministisches Gegenstück — dessen Horizont gilt als Horizont des Ensembles. */
  deterministicModel: string
}

export const FOEHN_ENSEMBLES: FoehnEnsemble[] = [
  {
    id: 'meteoswiss_icon_ch2_ensemble',
    label: 'ICON-CH2-EPS',
    members: 21,
    forecastDays: 6,
    deterministicModel: 'meteoswiss_icon_ch2',
  },
  { id: 'icon_d2_eps', label: 'ICON-D2-EPS', members: 20, forecastDays: 3, deterministicModel: 'icon_d2' },
  {
    id: 'meteoswiss_icon_ch1_ensemble',
    label: 'ICON-CH1-EPS',
    members: 11,
    forecastDays: 3,
    deterministicModel: 'meteoswiss_icon_ch1',
  },
]

export function getFoehnEnsemble(id: string): FoehnEnsemble {
  return FOEHN_ENSEMBLES.find((e) => e.id === id) ?? FOEHN_ENSEMBLES[0]
}

/**
 * Richtwerte der Kriterien neben der Druckdifferenz (Faustregeln, s. o.).
 *
 * - Kammwind: die Anströmung auf Kammhöhe muss QUER über den Kamm aus der
 *   Föhnrichtung kommen und kräftig genug sein, damit Luft übergreift.
 * - Feuchte im Lee: Föhnluft ist abgesunken und trocken.
 * - θ-Differenz Tal − 700 hPa: ist die Föhnluft bis zum Talboden
 *   durchgebrochen, ist die Schicht dazwischen durchmischt und θ nahezu
 *   gleich; liegt noch ein Kaltluftsee im Tal, ist θ unten mehrere K
 *   niedriger. Allein nicht eindeutig (sommerliche Durchmischung am Nachmittag
 *   sieht ähnlich aus) — deshalb nur eines von vier Kriterien.
 */
export const FOEHN_LIMITS = {
  crestMinSpeedKmh: 30,
  leeMaxRh: 50,
  minThetaDiff: -3,
}

export const CREST_SECTORS: Record<FoehnDirection, Sector> = {
  // SO bis WSW — bei Südföhn kommt die Kammanströmung meist aus S bis SW.
  south: { from: 135, to: 247.5 },
  // WNW über N bis NO.
  north: { from: 292.5, to: 45 },
}

export const DIRECTION_LABEL: Record<FoehnDirection, string> = {
  south: 'Südföhn',
  north: 'Nordföhn',
}
