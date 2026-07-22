// Stündliche Open-Meteo-Variablen, die in Phase 1 (Meteogramm) angeboten werden.
// Druckflächen-Variablen für Vertikalprofile kommen in Phase 3 dazu.

export interface VariableInfo {
  id: string
  label: string
  unit: string
  /** true → y-Achse beginnt bei 0 (Niederschlag, Wind, Strahlung, …) */
  nonNegative: boolean
}

export const HOURLY_VARIABLES: VariableInfo[] = [
  { id: 'temperature_2m', label: 'Temperatur 2 m', unit: '°C', nonNegative: false },
  { id: 'dew_point_2m', label: 'Taupunkt 2 m', unit: '°C', nonNegative: false },
  { id: 'relative_humidity_2m', label: 'Rel. Feuchte 2 m', unit: '%', nonNegative: true },
  { id: 'precipitation', label: 'Niederschlag', unit: 'mm', nonNegative: true },
  { id: 'snowfall', label: 'Schneefall', unit: 'cm', nonNegative: true },
  { id: 'cloud_cover', label: 'Bewölkung', unit: '%', nonNegative: true },
  { id: 'pressure_msl', label: 'Luftdruck (MSL)', unit: 'hPa', nonNegative: false },
  { id: 'wind_speed_10m', label: 'Wind 10 m', unit: 'km/h', nonNegative: true },
  { id: 'wind_gusts_10m', label: 'Böen 10 m', unit: 'km/h', nonNegative: true },
  { id: 'wind_direction_10m', label: 'Windrichtung 10 m', unit: '°', nonNegative: true },
  { id: 'cape', label: 'CAPE', unit: 'J/kg', nonNegative: true },
  { id: 'shortwave_radiation', label: 'Globalstrahlung', unit: 'W/m²', nonNegative: true },
]

const byId = new Map(HOURLY_VARIABLES.map((v) => [v.id, v]))

export function getVariable(id: string): VariableInfo {
  const v = byId.get(id)
  if (!v) throw new Error(`Unbekannte Variable: ${id}`)
  return v
}
