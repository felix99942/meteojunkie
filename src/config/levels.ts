// Drucklevel für Vertikalprofile / Skew-T (SPEC §13, Phase 3). Open-Meteo
// liefert Größen pro Drucklevel als eigene Hourly-Variablen, z.B.
// `temperature_850hPa`, `relative_humidity_850hPa`, `wind_speed_850hPa`,
// `wind_direction_850hPa`, `geopotential_height_850hPa`.
//
// WICHTIG: Level- und Modellverfügbarkeit ist noch NICHT live verifiziert
// (Tages-API-Limit war beim Anlegen erschöpft). Die Liste ist ein Arbeitsstand
// aus der Open-Meteo-Doku und laut SPEC §6 live nachzuprüfen, sobald das Limit
// resettet — Modelle antworten teils mit HTTP 200 und leeren Arrays.

/** Drucklevel in hPa, absteigend (Boden → Höhe) — Reihenfolge = Plotreihenfolge. */
export const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30,
] as const

export type PressureLevel = (typeof PRESSURE_LEVELS)[number]

/** Drucklevel-Größen, die ein Skew-T braucht. */
export const PROFILE_VARIABLES = [
  'temperature',
  'relative_humidity',
  'wind_speed',
  'wind_direction',
  'geopotential_height',
] as const

export type ProfileVariable = (typeof PROFILE_VARIABLES)[number]

/** Open-Meteo-Variablenname für Größe × Level, z.B. temperature_850hPa. */
export function levelVar(variable: ProfileVariable, level: number): string {
  return `${variable}_${level}hPa`
}

// Modelle mit Drucklevel-Daten. Arbeitsstand (live zu verifizieren): die
// globalen/EU-Modelle liefern Drucklevel; hochauflösende Lokalmodelle (AROME,
// ICON-D2) teils nur wenige oder keine — daher konservativ. best_match/seamless
// mischen und liefern Drucklevel.
const PRESSURE_LEVEL_MODELS = new Set<string>([
  'best_match',
  'icon_seamless',
  'icon_global',
  'icon_eu',
  'gfs_seamless',
  'gfs_global',
  'ecmwf_ifs025',
])

export function supportsPressureLevels(modelId: string): boolean {
  return PRESSURE_LEVEL_MODELS.has(modelId)
}
