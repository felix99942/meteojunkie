// Farbskalen für Kartenfelder (SPEC §8) — pro Parameter definiert, mit FESTEN
// Wertebereichen: kein Auto-Scaling, sonst sind Panels mit unterschiedlichen
// Modellen nicht mehr vergleichbar (der Zweck der Workbench).
//
// Konventionen (dunkle Kartenfläche): sequenziell = eine Farbe, dunkel→hell
// (niedrige Werte treten zurück, hohe leuchten); divergierend = zwei Farben
// mit neutralem grauen Mittelpunkt. Werte unterhalb des ersten Stops einer
// gestuften Skala sind transparent (z.B. Niederschlag < 0,1 mm).
// Windrichtung hat bewusst keine Skala — als Farbfeld ohne Vektoren sinnlos.

export interface ColorStop {
  value: number
  /** '#rrggbb' oder '#rrggbbaa' */
  color: string
}

export interface ColorScale {
  /** 'linear': zwischen Stops interpolieren; 'stepped': Schwellenwerte, keine Interpolation */
  kind: 'linear' | 'stepped'
  stops: ColorStop[] // aufsteigend; stops[0].value = Skalenminimum
}

export const COLOR_SCALES: Record<string, ColorScale> = {
  // divergierend um 0 °C, neutraler Mittelpunkt
  temperature_2m: {
    kind: 'linear',
    stops: [
      { value: -30, color: '#a6cdf7' },
      { value: -20, color: '#5598e7' },
      { value: -10, color: '#1c5cab' },
      { value: 0, color: '#484844' },
      { value: 10, color: '#8f3a1c' },
      { value: 20, color: '#c14f1f' },
      { value: 30, color: '#ef7133' },
      { value: 40, color: '#ffab73' },
    ],
  },
  dew_point_2m: {
    kind: 'linear',
    stops: [
      { value: -30, color: '#a6cdf7' },
      { value: -20, color: '#5598e7' },
      { value: -10, color: '#1c5cab' },
      { value: 0, color: '#484844' },
      { value: 10, color: '#8f3a1c' },
      { value: 20, color: '#c14f1f' },
      { value: 30, color: '#ef7133' },
    ],
  },
  // sequenziell blau mit Schwellenwerten (mm/h); < 0,1 transparent
  precipitation: {
    kind: 'stepped',
    stops: [
      { value: 0.1, color: '#184f95' },
      { value: 0.5, color: '#1c5cab' },
      { value: 1, color: '#256abf' },
      { value: 2, color: '#3987e5' },
      { value: 5, color: '#5598e7' },
      { value: 10, color: '#86b6ef' },
      { value: 20, color: '#b7d3f6' },
      { value: 50, color: '#e8f1fd' },
    ],
  },
  snowfall: {
    kind: 'stepped',
    stops: [
      { value: 0.1, color: '#3a2f7d' },
      { value: 0.5, color: '#4a3aa7' },
      { value: 1, color: '#6a5cd0' },
      { value: 2, color: '#9085e9' },
      { value: 5, color: '#b7aef3' },
      { value: 10, color: '#e0dcfb' },
    ],
  },
  // sequenziell orange (km/h), Windstille transparent
  wind_speed_10m: {
    kind: 'linear',
    stops: [
      { value: 0, color: '#5e2b1200' },
      { value: 10, color: '#5e2b12' },
      { value: 30, color: '#93401a' },
      { value: 50, color: '#c14f1f' },
      { value: 70, color: '#e56a33' },
      { value: 90, color: '#ff9d66' },
      { value: 120, color: '#ffd0ae' },
    ],
  },
  wind_gusts_10m: {
    kind: 'linear',
    stops: [
      { value: 0, color: '#5e2b1200' },
      { value: 20, color: '#5e2b12' },
      { value: 50, color: '#93401a' },
      { value: 75, color: '#c14f1f' },
      { value: 100, color: '#e56a33' },
      { value: 125, color: '#ff9d66' },
      { value: 150, color: '#ffd0ae' },
    ],
  },
  // klarer Himmel transparent → Basiskarte sichtbar
  cloud_cover: {
    kind: 'linear',
    stops: [
      { value: 0, color: '#c8c8c800' },
      { value: 50, color: '#a0a09d80' },
      { value: 100, color: '#dcdcd9' },
    ],
  },
  relative_humidity_2m: {
    kind: 'linear',
    stops: [
      { value: 0, color: '#123f2e' },
      { value: 50, color: '#199e70' },
      { value: 100, color: '#7fe3bd' },
    ],
  },
  // divergierend um 1013 hPa: Tief magenta, Hoch grün
  pressure_msl: {
    kind: 'linear',
    stops: [
      { value: 960, color: '#ff8ab8' },
      { value: 990, color: '#d55181' },
      { value: 1013, color: '#484844' },
      { value: 1035, color: '#199e70' },
      { value: 1050, color: '#7fe3bd' },
    ],
  },
  cape: {
    kind: 'stepped',
    stops: [
      { value: 100, color: '#4a2136' },
      { value: 250, color: '#7d2c4e' },
      { value: 500, color: '#a03962' },
      { value: 1000, color: '#c2497a' },
      { value: 2000, color: '#e070a0' },
      { value: 3000, color: '#ffa9cf' },
    ],
  },
  shortwave_radiation: {
    kind: 'linear',
    stops: [
      { value: 0, color: '#6e550000' },
      { value: 200, color: '#6e5500' },
      { value: 500, color: '#a37b00' },
      { value: 800, color: '#c98500' },
      { value: 1000, color: '#ffce6b' },
    ],
  },
}

export function getColorScale(variableId: string): ColorScale | undefined {
  return COLOR_SCALES[variableId]
}
