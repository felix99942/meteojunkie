// Modell-Registry (SPEC §7). Die UI filtert Parameter-Dropdowns anhand dieser
// Metadaten und warnt, wenn Location/Domain außerhalb der Modellabdeckung liegt.
//
// Hinweis: resolutionKm / updateIntervalHours / coverage sind Näherungswerte
// aus der Open-Meteo-Doku (Stand Juli 2026) — bei Bedarf gegen
// https://open-meteo.com/en/docs abgleichen. resolutionKm = 0 bedeutet
// "variabel" (best_match / seamless).
//
// `forecastHours` dagegen ist LIVE GEMESSEN (2026-07-31, letzter nicht-null
// Zeitschritt je Modell, umgerechnet auf die Init-Zeit des Laufs). Zwei Werte
// waren deutlich zu klein und haben vorhandene Vorhersage abgeschnitten:
//   best_match    168 → 384 h (der Blend reicht so weit wie GFS)
//   ecmwf_ifs025  240 → 360 h (ECMWF liefert 15 Tage, nicht 10)
// Die übrigen Werte stimmten, sobald die Laufstunde berücksichtigt wird
// (siehe modelHorizonEnd).

import { latestRun } from './runs'
import { STEP_MS, TIME_RANGE } from './time'

export interface BBox {
  latMin: number
  lonMin: number
  latMax: number
  lonMax: number
}

export interface ModelInfo {
  id: string
  label: string
  provider: string
  resolutionKm: number
  updateIntervalHours: number
  forecastHours: number
  coverage: BBox | 'global'
  /** false für best_match / Seamless — die Single-Runs-BBox-API kann nur konkrete Domains. */
  supportsBoundingBox: boolean
  availableVariables: string[]
}

const BASE_VARS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
]

const CONVECTION_VARS = ['cape', 'shortwave_radiation']

export const MODELS: ModelInfo[] = [
  {
    id: 'best_match',
    label: 'Best Match',
    provider: 'Open-Meteo',
    resolutionKm: 0,
    updateIntervalHours: 1,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'icon_seamless',
    label: 'ICON Seamless',
    provider: 'DWD',
    resolutionKm: 0,
    updateIntervalHours: 3,
    forecastHours: 180,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'icon_d2',
    label: 'ICON-D2',
    provider: 'DWD',
    resolutionKm: 2.2,
    updateIntervalHours: 3,
    forecastHours: 48,
    coverage: { latMin: 43.18, lonMin: -3.94, latMax: 58.08, lonMax: 20.34 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'icon_eu',
    label: 'ICON-EU',
    provider: 'DWD',
    resolutionKm: 7,
    updateIntervalHours: 3,
    // 120 h live verifiziert (Juli 2026): Lauf 06 UTC lieferte Daten bis +126 h
    // ab Forecast-Start — nicht die ~78 h, die teils kursieren
    forecastHours: 120,
    coverage: { latMin: 29.5, lonMin: -23.5, latMax: 70.5, lonMax: 45.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'icon_global',
    label: 'ICON Global',
    provider: 'DWD',
    resolutionKm: 13,
    updateIntervalHours: 6,
    forecastHours: 180,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS 0.25°',
    provider: 'ECMWF',
    resolutionKm: 25,
    updateIntervalHours: 6,
    forecastHours: 360,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape'],
  },
  {
    id: 'gfs_seamless',
    label: 'GFS Seamless',
    provider: 'NOAA',
    resolutionKm: 0,
    updateIntervalHours: 6,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'gfs_global',
    label: 'GFS Global',
    provider: 'NOAA',
    resolutionKm: 25,
    updateIntervalHours: 6,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'meteofrance_arpege_europe',
    label: 'ARPEGE Europe',
    provider: 'Météo-France',
    resolutionKm: 11,
    updateIntervalHours: 6,
    forecastHours: 102,
    coverage: { latMin: 20.0, lonMin: -32.0, latMax: 72.0, lonMax: 42.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape'],
  },
  {
    id: 'meteofrance_arome_france',
    label: 'AROME France',
    provider: 'Météo-France',
    resolutionKm: 1.5,
    updateIntervalHours: 3,
    forecastHours: 51,
    coverage: { latMin: 37.5, lonMin: -12.0, latMax: 55.4, lonMax: 16.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape', 'shortwave_radiation'],
  },
  {
    // Live verifiziert (Juli 2026): Modell-ID, alle Basis+Konvektions-Variablen,
    // Horizont 60 h / Update alle 3 h laut Doku. Native Auflösung 2,5 km
    // (GeoSphere-Dataset nwp-v1-1h-2500m). Coverage = Alpenraum-Domain,
    // per Stichproben geprüft: München/Mailand/Prag/Zagreb ✓, Berlin ✗.
    id: 'geosphere_arome_austria',
    label: 'AROME Austria',
    provider: 'GeoSphere Austria',
    resolutionKm: 2.5,
    updateIntervalHours: 3,
    forecastHours: 60,
    coverage: { latMin: 43.0, lonMin: 5.5, latMax: 51.8, lonMax: 22.1 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'ukmo_global_deterministic_10km',
    label: 'UKMO Global 10 km',
    provider: 'UK Met Office',
    resolutionKm: 10,
    updateIntervalHours: 6,
    forecastHours: 168,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: BASE_VARS,
  },
  {
    id: 'ukmo_uk_deterministic_2km',
    label: 'UKMO UK 2 km',
    provider: 'UK Met Office',
    resolutionKm: 2,
    updateIntervalHours: 1,
    forecastHours: 54,
    coverage: { latMin: 44.9, lonMin: -13.9, latMax: 60.9, lonMax: 6.6 },
    supportsBoundingBox: true,
    availableVariables: BASE_VARS,
  },
]

const byId = new Map(MODELS.map((m) => [m.id, m]))

export function getModel(id: string): ModelInfo {
  const m = byId.get(id)
  if (!m) throw new Error(`Unbekanntes Modell: ${id}`)
  return m
}

export function isInCoverage(model: ModelInfo, lat: number, lon: number): boolean {
  if (model.coverage === 'global') return true
  const c = model.coverage
  return lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
}

/**
 * Ende des Modellhorizonts als Epoch-ms. `forecastHours` zählt ab der INIT-Zeit
 * des Laufs, nicht ab Mitternacht — deshalb wird der geschätzte Lauf
 * (config/runs.ts) als Bezugspunkt genommen.
 *
 * Das war vorher der Session-Start, was den Horizont systematisch um die
 * Laufstunde zu früh ansetzte: live gemessen liefert ICON Global aus dem
 * 12-UTC-Lauf Daten bis +193 h ab Mitternacht, die alte Rechnung schnitt bei
 * +180 h ab — 13 Stunden vorhandener Vorhersage wurden weggeworfen.
 * Jenseits des Horizonts wird nicht extrapoliert (Karte: Meldung,
 * Meteogramm: Serienende).
 */
export function modelHorizonEnd(model: ModelInfo, now: number = Date.now()): number {
  // Auf das Zeitraster deckeln: die API liefert höchstens forecast_days=16 ab
  // Rasterbeginn, egal wie weit das Modell rechnet. Ohne den Deckel läge der
  // Horizont von GFS/best_match rechnerisch HINTER dem letzten Zeitschritt —
  // die Schraffur im Scrubber verspräche dann Daten, die es nicht gibt.
  return Math.min(TIME_RANGE.end, latestRun(model, now).initTime + model.forecastHours * STEP_MS)
}

/** Liegt die Domain vollständig in der Modellabdeckung? (Teilweise außerhalb → Multi-Location-Request schlägt fehl.) */
export function isDomainInCoverage(model: ModelInfo, bbox: BBox): boolean {
  if (model.coverage === 'global') return true
  const c = model.coverage
  return (
    bbox.latMin >= c.latMin &&
    bbox.latMax <= c.latMax &&
    bbox.lonMin >= c.lonMin &&
    bbox.lonMax <= c.lonMax
  )
}
