// Registry des Ensemble-Modus (SPEC §9 Phase 3).
//
// ALLES HIER IST LIVE GEGEN DIE API GEPRÜFT (SPEC §6), nicht aus der Doku
// übernommen — Stand 2026-07-31, GEFS ergänzt 2026-08-17:
//   ecmwf_ifs025  → 51 Mitglieder (Kontrolllauf + member01…50), 15 Tage
//   ecmwf_aifs025 → 51 Mitglieder, 15 Tage (KI-Modell)
//   gfs_seamless  → 31 Mitglieder (Kontrolllauf + member01…30), Horizont live
//                   819 h ≈ 34 Tage; alle zehn Variablen unten vollständig
//   ecmwf_ifs04   → liefert nur noch EIN Mitglied, deshalb hier nicht geführt
// Die 9-km-Europa-Ensembles der Doku sind über die freie API unter keiner ID
// erreichbar (Professional/self-hosted).
//
// GEFS-Auflösung: `gfs_seamless` ist der Blend und dominiert die Einzeldomains —
// live geprüft ist es in den ersten 240 h Wert für Wert identisch mit `gfs025`
// (0,25°) und wechselt danach auf `gfs05` (0,5°). Deshalb genau EIN GEFS-Eintrag
// statt drei: `gfs025` endet bei 255 h, `gfs05` ist früh gröber.
//
// **Eine KI-Version des GFS gibt es nicht** (Stand 2026-08-17, live geprüft):
// `gfs_graphcast025` wird als ID zwar angenommen, liefert aber sowohl auf der
// Ensemble- als auch auf der Forecast-API durchgehend null — der klassische
// „HTTP 200 mit leeren Arrays"-Fall aus SPEC §6. `gencast025`, `graphcast025`,
// `gfs_aifs025` und `noaa_gefs_ai` sind gar keine gültigen IDs. Die einzige
// verfügbare KI-Ensemble-Alternative bleibt ECMWF AIFS.
//
// KOSTEN (SPEC §5): Die Ensemble-API liefert keine Kosten-Header und die Doku
// sagt zu Mitgliedern nichts Genaues. Wir rechnen konservativ mit „Mitglied =
// Variable" (~10 Variablen ≈ 1 Call), also ~5 Calls je Punktabruf. Punktweise
// ist das billig (0,05 % des Tagesbudgets); ein FELD wäre es nicht: das
// Österreich-Gitter mit 480 Punkten käme auf ~7.200 Calls = 72 % des
// Tagesbudgets — pro Feld. Deshalb ist der Ensemble-Modus punktbasiert und
// bekommt bewusst keine Kartenvariante.

import type { LatLon } from '../state/workbench'

export interface EnsembleModelInfo {
  id: string
  label: string
  /** Mitglieder inkl. Kontrolllauf (live gezählt). */
  members: number
  /** Horizont in Tagen (forecast_days-Maximum der Ensemble-API). */
  forecastDays: number
  /**
   * Horizont des deterministischen Hauptlaufs in Tagen — SEPARAT, weil die
   * normale Forecast-API bei 16 Tagen hart deckelt („Allowed range 0 to 16",
   * live geprüft). GEFS läuft im Ensemble weiter als sein Hauptlauf reichen
   * kann; mit `forecastDays` für beide Abrufe scheitert der Hauptlauf-Request
   * komplett. Kürzere Reihe ist richtig — das Panel lässt sie enden, statt zu
   * extrapolieren (SPEC §8).
   */
  deterministicDays: number
  updateIntervalHours: number
  resolutionKm: number
  /**
   * Modell-ID des zugehörigen DETERMINISTISCHEN Laufs (Hauptlauf) auf der
   * normalen Forecast-API. Das Ensemble liefert ihn nicht mit — seine
   * suffixlose Reihe ist der Kontrolllauf, nicht der Hauptlauf.
   */
  deterministicModel: string
  note: string
}

export const ENSEMBLE_MODELS: EnsembleModelInfo[] = [
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS ENS',
    members: 51,
    forecastDays: 15,
    deterministicDays: 15,
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'ecmwf_ifs025',
    note: 'Physikalisches ECMWF-Ensemble, 0,25°. Nativ 3-stündlich (ab +144 h 6-stündlich), von Open-Meteo auf 1 h interpoliert.',
  },
  {
    id: 'ecmwf_aifs025',
    label: 'ECMWF AIFS ENS (KI)',
    members: 51,
    forecastDays: 15,
    deterministicDays: 15,
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'ecmwf_aifs025_single',
    note: 'KI-Ensemble von ECMWF, 0,25°. Nativ 6-stündlich. Interessant als zweite Meinung zum IFS — nicht als Ersatz.',
  },
  {
    id: 'gfs_seamless',
    label: 'NOAA GEFS',
    members: 31,
    // Ensemble-API akzeptiert 35; der Blend endet live bei 819 h (~34 Tage).
    // Die volle Länge erreicht nur der 00-UTC-Lauf, die übrigen enden bei
    // ~384 h — das Panel lässt die Reihen dann enden (SPEC §8).
    forecastDays: 35,
    deterministicDays: 16, // Maximum der Forecast-API, siehe deterministicDays
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'gfs_seamless',
    note: 'NOAA GEFS, 31 Mitglieder. Seamless: bis +240 h 0,25°, danach 0,5° bis ~34 Tage. Deutlich weniger Mitglieder als ECMWF, dafür der einzige Weg über 15 Tage hinaus. Der deterministische Hauptlauf endet bei 16 Tagen (API-Grenze).',
  },
]

export const DEFAULT_ENSEMBLE_MODEL = ENSEMBLE_MODELS[0].id

export function getEnsembleModel(id: string): EnsembleModelInfo {
  return ENSEMBLE_MODELS.find((m) => m.id === id) ?? ENSEMBLE_MODELS[0]
}

export interface EnsembleVariableInfo {
  id: string
  label: string
  unit: string
  /**
   * `accum` = Größe, die über die Vorhersagezeit aufsummiert dargestellt wird
   * (Niederschlag/Schneefall). Stundenwerte als Spaghetti sind hier unlesbar;
   * die Summenkurve ist die Größe, um die es geht.
   */
  kind: 'instant' | 'accum'
  /** y-Achse bei 0 verankern. */
  zeroBased?: boolean
}

// Eigene Variablenliste statt HOURLY_VARIABLES: das Ensemble liefert andere
// Größen (u.a. Höhenwetter), und die deterministischen Registries sollen davon
// unberührt bleiben. Alle Einträge live geprüft.
export const ENSEMBLE_VARIABLES: EnsembleVariableInfo[] = [
  { id: 'temperature_2m', label: 'Temperatur 2 m', unit: '°C', kind: 'instant' },
  // Label ohne „(Summe)": die Darstellung ist umschaltbar (Summe ↔ 6 h)
  { id: 'precipitation', label: 'Niederschlag', unit: 'mm', kind: 'accum', zeroBased: true },
  { id: 'snowfall', label: 'Schneefall', unit: 'cm', kind: 'accum', zeroBased: true },
  { id: 'wind_speed_10m', label: 'Wind 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'wind_gusts_10m', label: 'Böen 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'cloud_cover', label: 'Bewölkung', unit: '%', kind: 'instant', zeroBased: true },
  { id: 'pressure_msl', label: 'Luftdruck (MSL)', unit: 'hPa', kind: 'instant' },
  { id: 'cape', label: 'CAPE', unit: 'J/kg', kind: 'instant', zeroBased: true },
  { id: 'temperature_850hPa', label: 'Temperatur 850 hPa', unit: '°C', kind: 'instant' },
  { id: 'geopotential_height_500hPa', label: 'Geopotential 500 hPa', unit: 'gpm', kind: 'instant' },
]

export const DEFAULT_ENSEMBLE_VARIABLE = 'temperature_2m'

/**
 * Darstellung von Summengrößen im Ensemble. `sum` = kumuliert ab Rasterbeginn,
 * `6h` = 6-Stunden-Mengen je Mitglied (Wetterzentrale-Manier) — die zeigt, WANN
 * der Niederschlag fällt, was die Summenkurve nicht hergibt.
 */
export type EnsembleAccumView = 'sum' | '6h'

/** Intervalllänge der 6-h-Ansicht in Stunden. */
export const ENSEMBLE_BUCKET_HOURS = 6

export interface EnsembleVariableOption {
  /** Zusammengesetzter Wert `id` bzw. `id:view` — nur fürs <select>. */
  value: string
  label: string
  variable: string
  view: EnsembleAccumView
}

/** Wert eines Dropdown-Eintrags zerlegen; ohne Ansichtsteil gilt 'sum'. */
export function parseEnsembleVariableValue(value: string): {
  variable: string
  view: EnsembleAccumView
} {
  const [variable, view] = value.split(':')
  return { variable, view: view === '6h' ? '6h' : 'sum' }
}

/**
 * Dropdown-Einträge des Ensembles. Summengrößen stehen zweimal drin — als
 * kumulierte Summe und als 6-h-Mengen je Mitglied. Die Ansicht ist Teil der
 * Auswahl, nicht ein separater Umschalter daneben.
 */
export function ensembleVariableOptions(): EnsembleVariableOption[] {
  const out: EnsembleVariableOption[] = []
  for (const v of ENSEMBLE_VARIABLES) {
    if (v.kind !== 'accum') {
      out.push({ value: v.id, label: `${v.label} (${v.unit})`, variable: v.id, view: 'sum' })
      continue
    }
    out.push({
      value: `${v.id}:sum`,
      label: `${v.label} Summe (${v.unit})`,
      variable: v.id,
      view: 'sum',
    })
    out.push({
      value: `${v.id}:6h`,
      label: `${v.label} ${ENSEMBLE_BUCKET_HOURS} h (${v.unit}/${ENSEMBLE_BUCKET_HOURS} h)`,
      variable: v.id,
      view: '6h',
    })
  }
  return out
}

export function getEnsembleVariable(id: string): EnsembleVariableInfo {
  return ENSEMBLE_VARIABLES.find((v) => v.id === id) ?? ENSEMBLE_VARIABLES[0]
}

/** Kuratierte Punkte für die Schnellwahl — Landeshauptstädte plus Sonnblick. */
export const ENSEMBLE_QUICK_POINTS: LatLon[] = [
  { lat: 48.21, lon: 16.37, label: 'Wien' },
  { lat: 47.07, lon: 15.44, label: 'Graz' },
  { lat: 48.31, lon: 14.29, label: 'Linz' },
  { lat: 47.8, lon: 13.04, label: 'Salzburg' },
  { lat: 47.27, lon: 11.39, label: 'Innsbruck' },
  { lat: 46.62, lon: 14.31, label: 'Klagenfurt' },
  { lat: 47.5, lon: 9.75, label: 'Bregenz' },
  { lat: 47.05, lon: 12.96, label: 'Sonnblick' },
]
