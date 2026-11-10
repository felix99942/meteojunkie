// Schneevorhersage (Unterpunkt des Meteogramms, seit 2026-11-10, auf Wunsch):
// Neuschnee-SUMME ab jetzt an einem Ort, aus vier Hauptläufen und drei
// Ensembles. Rein, ohne DOM — der Rechenkern ist hier, die Darstellung in
// `components/SnowForecast.tsx`.
//
// Zwei Ansichten im selben Bereich:
//   * KOMBINIERT: alle Ensemble-Member in EINER Verteilung, jedes Ensemble mit
//     GLEICHEM Gewicht (nicht je Member — sonst bestimmte IFS mit 51 Membern
//     das Band fast allein), darüber die vier Hauptläufe als Linien.
//   * JE MODELL: jedes Ensemble mit seinem eigenen Band, Median und dem
//     zugehörigen Hauptlauf.
//
// Hauptläufe: AROME 1 km (GeoSphere, direkt vom Data Hub — Open-Meteo liefert
// `geosphere_arome_austria` seit dem Ende des 2,5-km-Datensatzes am 04.11.2026
// nur noch null, gemessen 2026-11-10), ICON-D2, ICON-EU und IFS 9 km
// (`ecmwf_ifs`, nicht der 0,25°-Lauf). Ensembles: ICON-D2-EPS (20 + Kontrolle,
// bis +48 h), ICON-EU-EPS (40, +120 h), IFS-ENS (50 + Kontrolle, 0,25°).
// AROME hat kein Ensemble auf diesem Weg.
//
// SCHNEE IN cm WIE OPEN-METEO: deren `snowfall` rechnet 1 mm Wasserwert = 0,7 cm.
// Die AROME-Werte (kg/m² = mm) werden genauso umgerechnet, sonst lägen sie
// allein wegen der Faustregel 40 % höher als die übrigen Linien.

import type { Series } from '../components/foehn'

export const SNOW_DAYS = 7
export const HOUR_MS = 3_600_000
/** cm Neuschnee je mm Wasserwert — die Umrechnung von Open-Meteo (`snowfall`). */
export const SNOW_CM_PER_MM = 0.7

export interface SnowMainRun {
  id: string
  label: string
  /** Woher: Open-Meteo-Modell-ID oder der GeoSphere Data Hub. */
  source: 'open-meteo' | 'geosphere'
  /** Abgefragte Tage (Open-Meteo `forecast_days`). */
  days: number
  color: string
}

export interface SnowEnsemble {
  id: string
  label: string
  members: number
  days: number
  /** Zugehöriger Hauptlauf (`SnowMainRun.id`). */
  main: string
  resolution: string
}

// Linienfarben bewusst NICHT aus dem Rosa/Lila der Bänder: die Hauptläufe
// müssen sich vom Band abheben
export const SNOW_MAIN_RUNS: SnowMainRun[] = [
  { id: 'arome', label: 'AROME 1 km', source: 'geosphere', days: 3, color: '#d9480f' },
  { id: 'icon_d2', label: 'ICON-D2', source: 'open-meteo', days: 3, color: '#1c7ed6' },
  { id: 'icon_eu', label: 'ICON-EU', source: 'open-meteo', days: 6, color: '#0ca678' },
  { id: 'ecmwf_ifs', label: 'IFS 9 km', source: 'open-meteo', days: SNOW_DAYS, color: '#f2b705' },
]

export const SNOW_ENSEMBLES: SnowEnsemble[] = [
  { id: 'icon_d2_eps', label: 'ICON-D2-EPS', members: 20, days: 3, main: 'icon_d2', resolution: '2,2 km' },
  { id: 'icon_eu', label: 'ICON-EU-EPS', members: 40, days: 6, main: 'icon_eu', resolution: '13 km' },
  { id: 'ecmwf_ifs025', label: 'IFS-ENS', members: 51, days: SNOW_DAYS, main: 'ecmwf_ifs', resolution: '0,25°' },
]

/** Rosa → Lila: 10–90 % hell, 25–75 % kräftig, Median dunkel. */
export const SNOW_BAND = { outer: '#f3a6d4', inner: '#b15fd6', median: '#5a1a8c' }

/** Stundenraster ab der laufenden Stunde (Summe dort = 0) über `SNOW_DAYS`. */
export function snowGrid(now: number, days = SNOW_DAYS): number[] {
  const start = Math.floor(now / HOUR_MS) * HOUR_MS
  return Array.from({ length: days * 24 + 1 }, (_, i) => start + i * HOUR_MS)
}

/**
 * Stundenwerte („Menge der vorangegangenen Stunde", Open-Meteo wie GeoSphere)
 * zur Summe AB DEM ERSTEN RASTERPUNKT: dort 0, danach aufaddiert. Lücken
 * mittendrin zählen 0; hinter dem letzten Wert endet die Reihe (null) — eine
 * waagrecht weiterlaufende Summe behauptete „kein Schnee mehr", wo keine
 * Vorhersage mehr existiert. Ohne einen einzigen Wert bleibt alles null.
 */
export function sumFromStart(values: Series): Series {
  let last = -1
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i] != null) {
      last = i
      break
    }
  }
  if (last < 0) return values.map(() => null)
  let sum = 0
  return values.map((v, i) => {
    if (i === 0) return 0
    if (i > last) return null
    if (v != null && Number.isFinite(v)) sum += v
    return sum
  })
}

export interface BandStats {
  p10: Series
  p25: Series
  median: Series
  p75: Series
  p90: Series
  /** Je Zeitschritt: wie viele Ensembles beitragen. */
  groups: number[]
}

/**
 * Gewichtetes Quantil: Werte mit Gewichten, Stützstellen in der Mitte des
 * jeweiligen Gewichtsanteils (Hazen) und dazwischen linear — bei gleichen
 * Gewichten dasselbe wie das übliche Perzentil bis auf die Ränder.
 */
export function weightedQuantile(pairs: [value: number, weight: number][], p: number): number {
  if (pairs.length === 0) return Number.NaN
  const s = [...pairs].sort((a, b) => a[0] - b[0])
  const total = s.reduce((a, [, w]) => a + w, 0)
  let acc = 0
  const pos = s.map(([, w]) => {
    const mid = (acc + w / 2) / total
    acc += w
    return mid
  })
  if (p <= pos[0]) return s[0][0]
  if (p >= pos[pos.length - 1]) return s[s.length - 1][0]
  let k = 1
  while (pos[k] < p) k++
  const f = (p - pos[k - 1]) / (pos[k] - pos[k - 1])
  return s[k - 1][0] + f * (s[k][0] - s[k - 1][0])
}

/**
 * Verteilung über mehrere Ensembles: je Zeitschritt bekommt jedes Ensemble mit
 * Werten das Gewicht 1, aufgeteilt auf seine vorhandenen Member. Endet ein
 * Ensemble (ICON-D2-EPS nach 48 h), tragen ab dort nur noch die übrigen bei —
 * das Band springt an dieser Stelle; `groups` sagt, wo.
 */
export function pooledStats(ensembles: Series[][], nt: number): BandStats {
  const out: BandStats = {
    p10: new Array(nt).fill(null),
    p25: new Array(nt).fill(null),
    median: new Array(nt).fill(null),
    p75: new Array(nt).fill(null),
    p90: new Array(nt).fill(null),
    groups: new Array(nt).fill(0),
  }
  for (let t = 0; t < nt; t++) {
    const pairs: [number, number][] = []
    for (const members of ensembles) {
      const vals: number[] = []
      for (const m of members) {
        const v = m[t]
        if (v != null && Number.isFinite(v)) vals.push(v)
      }
      if (vals.length === 0) continue
      out.groups[t]++
      for (const v of vals) pairs.push([v, 1 / vals.length])
    }
    if (pairs.length === 0) continue
    out.p10[t] = weightedQuantile(pairs, 0.1)
    out.p25[t] = weightedQuantile(pairs, 0.25)
    out.median[t] = weightedQuantile(pairs, 0.5)
    out.p75[t] = weightedQuantile(pairs, 0.75)
    out.p90[t] = weightedQuantile(pairs, 0.9)
  }
  return out
}

/** Zeitpunkte, an denen sich die Zahl der beitragenden Ensembles ändert. */
export function groupChanges(gridMs: number[], groups: number[]): { t: number; from: number; to: number }[] {
  const out: { t: number; from: number; to: number }[] = []
  for (let i = 1; i < groups.length; i++) {
    if (groups[i] !== groups[i - 1] && groups[i] > 0 && groups[i - 1] > 0) {
      out.push({ t: gridMs[i], from: groups[i - 1], to: groups[i] })
    }
  }
  return out
}

/** Antwort des GeoSphere Data Hub (`timeseries/forecast/…`, GeoJSON). */
export interface GeoSphereTimeseries {
  reference_time?: string
  timestamps: string[]
  features: { properties: { parameters: Record<string, { unit?: string; data: (number | null)[] }> } }[]
}

/** AROME-Schneefall je Stunde (kg/m²) → Zeitstempel in ms und cm wie Open-Meteo. */
export function parseAromeSnow(body: GeoSphereTimeseries): { times: number[]; values: Series; run: number | null } {
  const data = body.features?.[0]?.properties?.parameters?.sf?.data ?? []
  return {
    times: (body.timestamps ?? []).map((s) => Date.parse(s)),
    values: data.map((v) => (v == null || !Number.isFinite(v) ? null : v * SNOW_CM_PER_MM)),
    run: body.reference_time ? Date.parse(body.reference_time) : null,
  }
}

/** Kurzfassung für die Leiste: Spanne der Hauptläufe und Median am Ende. */
export function lastValue(s: Series): { i: number; v: number } | null {
  for (let i = s.length - 1; i >= 0; i--) {
    const v = s[i]
    if (v != null) return { i, v }
  }
  return null
}
