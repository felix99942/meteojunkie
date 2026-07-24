// Registry der MOS-Vorhersageparameter (Vorhersage-Modus der Klimakarte).
// Schlüssel = Dateiname unter public/mos/forecast/. Farbskalen aus dem
// validierten Bestand wiederverwendet; Sonnenschein (min/h) neu.

import { COLOR_SCALES, type ColorScale } from './colorscales'

export interface ForecastSpec {
  key: string
  label: string
  unit: string
  /** hourly → Zeitschieber; daily → Tageswahl (Tmin/Tmax). */
  kind: 'hourly' | 'daily'
  scale: ColorScale
}

// Sonnenscheindauer je Stunde (0–60 min): sequenziell dunkel→hellgelb.
const SUN_MIN_SCALE: ColorScale = {
  kind: 'stepped',
  stops: [
    { value: 1, color: '#5a4a00' },
    { value: 10, color: '#8a6f00' },
    { value: 20, color: '#b38a00' },
    { value: 30, color: '#d6a300' },
    { value: 40, color: '#efc23a' },
    { value: 50, color: '#f5d670' },
    { value: 60, color: '#f8e59a' },
  ],
}

export const FORECAST_PARAMS: ForecastSpec[] = [
  { key: 't2m', label: 'Temperatur 2 m', unit: '°C', kind: 'hourly', scale: COLOR_SCALES.temperature_2m },
  { key: 'tmax', label: 'Tagesmaximum', unit: '°C', kind: 'daily', scale: COLOR_SCALES.temperature_2m },
  { key: 'tmin', label: 'Tagesminimum', unit: '°C', kind: 'daily', scale: COLOR_SCALES.temperature_2m },
  { key: 'precip', label: 'Niederschlag (1 h)', unit: 'mm', kind: 'hourly', scale: COLOR_SCALES.precipitation },
  { key: 'sun', label: 'Sonnenschein (1 h)', unit: 'min', kind: 'hourly', scale: SUN_MIN_SCALE },
  { key: 'cloud', label: 'Bewölkung', unit: '%', kind: 'hourly', scale: COLOR_SCALES.cloud_cover },
  { key: 'wind', label: 'Wind', unit: 'km/h', kind: 'hourly', scale: COLOR_SCALES.wind_speed_10m },
]

export function getForecastSpec(key: string): ForecastSpec {
  const s = FORECAST_PARAMS.find((p) => p.key === key)
  if (!s) throw new Error(`Unbekannter Vorhersageparameter: ${key}`)
  return s
}
