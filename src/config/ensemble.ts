// Registry des Ensemble-Modus (SPEC §9 Phase 3). Bewusst NUR ECMWF: die
// Ensemble-API ist teuer genug, dass ein Modellvergleich über mehrere
// Ensembles das Budget nicht wert wäre (siehe Kostenhinweis unten).
//
// ALLES HIER IST LIVE GEGEN DIE API GEPRÜFT (SPEC §6), nicht aus der Doku
// übernommen — Stand 2026-07-31:
//   ecmwf_ifs025  → 51 Mitglieder (Kontrolllauf + member01…50), 15 Tage
//   ecmwf_aifs025 → 51 Mitglieder, 15 Tage (KI-Modell)
//   ecmwf_ifs04   → liefert nur noch EIN Mitglied, deshalb hier nicht geführt
// Die 9-km-Europa-Ensembles der Doku sind über die freie API unter keiner ID
// erreichbar (Professional/self-hosted).
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
  /** Horizont in Tagen (forecast_days-Maximum der API). */
  forecastDays: number
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
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'ecmwf_aifs025_single',
    note: 'KI-Ensemble von ECMWF, 0,25°. Nativ 6-stündlich. Interessant als zweite Meinung zum IFS — nicht als Ersatz.',
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
  { id: 'precipitation', label: 'Niederschlag (Summe)', unit: 'mm', kind: 'accum', zeroBased: true },
  { id: 'snowfall', label: 'Schneefall (Summe)', unit: 'cm', kind: 'accum', zeroBased: true },
  { id: 'wind_speed_10m', label: 'Wind 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'wind_gusts_10m', label: 'Böen 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'cloud_cover', label: 'Bewölkung', unit: '%', kind: 'instant', zeroBased: true },
  { id: 'pressure_msl', label: 'Luftdruck (MSL)', unit: 'hPa', kind: 'instant' },
  { id: 'cape', label: 'CAPE', unit: 'J/kg', kind: 'instant', zeroBased: true },
  { id: 'temperature_850hPa', label: 'Temperatur 850 hPa', unit: '°C', kind: 'instant' },
  { id: 'geopotential_height_500hPa', label: 'Geopotential 500 hPa', unit: 'gpm', kind: 'instant' },
]

export const DEFAULT_ENSEMBLE_VARIABLE = 'temperature_2m'

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
