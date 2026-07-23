// Farbskalen für Kartenfelder (SPEC §8) — pro Parameter definiert, mit FESTEN
// Wertebereichen: kein Auto-Scaling, sonst sind Panels mit unterschiedlichen
// Modellen nicht mehr vergleichbar (der Zweck der Workbench).
//
// Bewusst DISKRET (gestuft) statt glatt interpoliert: klar abgegrenzte
// Farbbänder sind ablesbar — ein Wert lässt sich einer Stufe zuordnen. Eine
// glatt interpolierte Rampe verwischt gerade im mittleren Bereich zu „einer
// Farbe“ mit kaum unterscheidbaren Abstufungen (das war das Problem bei den
// Temperaturen). Vollbereichsgrößen (Temperatur/Taupunkt) bekommen deshalb
// eine mehrfarbige Rampe mit vielen Bändern statt eines einzigen Farbtons.
//
// belowMin steuert Werte unter stops[0].value:
//   'transparent' (Default bei kind:'stepped') — Basiskarte scheint durch,
//      für Größen mit „Null-Boden“ (Niederschlag/Schnee/Wind/Strahlung/Wolken:
//      „unter der Schwelle = nichts zu zeigen“).
//   'clamp' — unterste Bandfarbe, für Vollbereichsgrößen ohne Null-Boden
//      (Temperatur/Taupunkt/Druck/Feuchte).
// Windrichtung hat bewusst keine Skala — als Farbfeld ohne Vektoren sinnlos.

export interface ColorStop {
  value: number
  /** '#rrggbb' oder '#rrggbbaa' */
  color: string
}

export interface ColorScale {
  /** 'linear': zwischen Stops interpolieren; 'stepped': diskrete Bänder, keine Interpolation */
  kind: 'linear' | 'stepped'
  /** Verhalten unter stops[0].value. Default: 'stepped' → 'transparent'. */
  belowMin?: 'transparent' | 'clamp'
  stops: ColorStop[] // aufsteigend; stops[0].value = Skalenminimum
}

/** Gleichmäßige Bänder ab `start` mit Schrittweite `step`, eine Farbe je Band. */
function bands(start: number, step: number, colors: string[]): ColorStop[] {
  return colors.map((color, i) => ({ value: start + i * step, color }))
}

// Ankerfarben auf `count` Farben interpolieren (RGB) — so lassen sich viele
// feine Bänder aus wenigen Stützfarben erzeugen, ohne jede Stufe von Hand zu
// setzen. Anker sind '#rrggbb'.
function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0')
}
function lerpRamp(anchors: string[], count: number): string[] {
  const rgb = anchors.map(hexToRgb)
  const seg = anchors.length - 1
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : (i / (count - 1)) * seg
    const lo = Math.min(seg - 1, Math.floor(t))
    const f = t - lo
    const [ar, ag, ab] = rgb[lo]
    const [br, bg, bb] = rgb[lo + 1]
    return `#${toHex(ar + (br - ar) * f)}${toHex(ag + (bg - ag) * f)}${toHex(ab + (bb - ab) * f)}`
  })
}

/** Aufsteigende Schwellenliste [from … to] mit fester Schrittweite (inklusive). */
function seq(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

// Mehrfarbige Temperatur-Stützfarben (kalt → warm) in 8-°C-Abständen von -30
// bis 42: Violett → Blau → Cyan → Grün → Gelb → Orange → Rot → Magenta.
// lerpRamp verdichtet sie auf 2-°C-Bänder — maximiert die Unterscheidbarkeit
// benachbarter Stufen (anders als eine einfarbige Orange-Rampe).
const TEMP_ANCHORS = [
  '#6a3d9a', // -30
  '#5a5fd0', // -22
  '#3288e0', // -14
  '#37b7dc', // -6
  '#5fcf9f', //  2
  '#8ed45a', // 10
  '#f0d848', // 18
  '#f28a30', // 26
  '#d93b2b', // 34
  '#8f1f5e', // 42
]

// Niederschlags-Stützfarben, hell → dunkel: fahles Blau → Blau → Indigo →
// Violett → Magenta → Rot (Extremwerte). lerpRamp verteilt sie auf die
// gestaffelten Schwellen (dicht bei leichtem Regen, grob bei Starkregen).
const PRECIP_ANCHORS = [
  '#cfe3f7',
  '#8fbdec',
  '#4a93e8',
  '#256abf',
  '#1c5cab',
  '#3f3f9e',
  '#6a3d9a',
  '#9c3990',
  '#c23a6a',
  '#d63a2b',
]

// Niederschlagsschwellen (mm/h): 0.1/0.2/0.5, dann 1er bis 10, 5er bis 50,
// 10er bis 100 — so bildet die Legende die Modellauflösung ab.
const PRECIP_STEPS = [0.1, 0.2, 0.5, ...seq(1, 10, 1), ...seq(15, 50, 5), ...seq(60, 100, 10)]
const PRECIP_COLORS = lerpRamp(PRECIP_ANCHORS, PRECIP_STEPS.length)

// Grün → Gelb → Orange → Rot → Magenta (kein Blau — grenzt Wind optisch von
// der Temperatur ab, die im Kalten violett/blau beginnt).
const WIND_RAMP = ['#2f9e6a', '#5cc36a', '#8ed45a', '#c2dd52', '#f0d848', '#f6b23c', '#f28a30', '#e9612a', '#d93b2b', '#bd2947', '#8f1f5e']

export const COLOR_SCALES: Record<string, ColorScale> = {
  temperature_2m: {
    kind: 'stepped',
    belowMin: 'clamp',
    stops: bands(-30, 2, lerpRamp(TEMP_ANCHORS, 37)), // -30 … 42 °C, 2-°C-Bänder
  },
  dew_point_2m: {
    kind: 'stepped',
    belowMin: 'clamp',
    stops: bands(-30, 2, lerpRamp(TEMP_ANCHORS.slice(0, 8), 29)), // -30 … 26 °C, 2-°C-Bänder
  },
  // sequenziell blau→rot, gestaffelte Schwellen (mm/h); < 0,1 transparent
  precipitation: {
    kind: 'stepped',
    stops: PRECIP_STEPS.map((value, i) => ({ value, color: PRECIP_COLORS[i] })),
  },
  snowfall: {
    kind: 'stepped',
    stops: [
      { value: 0.1, color: '#3a2f7d' },
      { value: 0.3, color: '#43389a' },
      { value: 0.5, color: '#4a3aa7' },
      { value: 1, color: '#6a5cd0' },
      { value: 2, color: '#9085e9' },
      { value: 3, color: '#a89ff0' },
      { value: 5, color: '#b7aef3' },
      { value: 7, color: '#cbc4f7' },
      { value: 10, color: '#e0dcfb' },
    ],
  },
  // sequenziell grün→magenta (km/h), Windstille (< 1) transparent
  wind_speed_10m: {
    kind: 'stepped',
    stops: [
      { value: 1, color: WIND_RAMP[0] },
      { value: 5, color: WIND_RAMP[1] },
      { value: 10, color: WIND_RAMP[2] },
      { value: 15, color: WIND_RAMP[3] },
      { value: 20, color: WIND_RAMP[4] },
      { value: 30, color: WIND_RAMP[5] },
      { value: 40, color: WIND_RAMP[6] },
      { value: 50, color: WIND_RAMP[7] },
      { value: 65, color: WIND_RAMP[8] },
      { value: 80, color: WIND_RAMP[9] },
      { value: 100, color: WIND_RAMP[10] },
    ],
  },
  wind_gusts_10m: {
    kind: 'stepped',
    stops: [
      { value: 2, color: WIND_RAMP[0] },
      { value: 10, color: WIND_RAMP[1] },
      { value: 20, color: WIND_RAMP[2] },
      { value: 30, color: WIND_RAMP[3] },
      { value: 40, color: WIND_RAMP[4] },
      { value: 55, color: WIND_RAMP[5] },
      { value: 70, color: WIND_RAMP[6] },
      { value: 90, color: WIND_RAMP[7] },
      { value: 110, color: WIND_RAMP[8] },
      { value: 130, color: WIND_RAMP[9] },
      { value: 150, color: WIND_RAMP[10] },
    ],
  },
  // klarer Himmel (< 10 %) transparent → Basiskarte sichtbar; dünne Wolken
  // halbtransparent, dichte deckend
  cloud_cover: {
    kind: 'stepped',
    stops: [
      { value: 10, color: '#6f727866' },
      { value: 20, color: '#7f828899' },
      { value: 30, color: '#8f9298b3' },
      { value: 40, color: '#a0a3a9cc' },
      { value: 50, color: '#b0b3b9' },
      { value: 60, color: '#c0c3c8' },
      { value: 70, color: '#cfd2d6' },
      { value: 80, color: '#dee0e4' },
      { value: 90, color: '#eceef1' },
      { value: 100, color: '#f6f7f9' },
    ],
  },
  relative_humidity_2m: {
    kind: 'stepped',
    belowMin: 'clamp',
    stops: bands(0, 10, [
      '#123f2e',
      '#155a41',
      '#177754',
      '#199e70',
      '#3bb488',
      '#5cc39c',
      '#7fd3b0',
      '#a2e0c6',
      '#c2ebd9',
      '#dcf4ea',
      '#eefbf6',
    ]), // 0 … 100 %
  },
  // divergierend um 1013 hPa: Tief magenta, Hoch grün, neutraler Mittelpunkt
  pressure_msl: {
    kind: 'stepped',
    belowMin: 'clamp',
    stops: [
      { value: 960, color: '#c8236a' },
      { value: 975, color: '#e0508a' },
      { value: 990, color: '#f080a8' },
      { value: 1000, color: '#f0a9c2' },
      { value: 1008, color: '#b89aa2' },
      { value: 1013, color: '#5c5c58' },
      { value: 1018, color: '#8fc0a2' },
      { value: 1024, color: '#57b98a' },
      { value: 1030, color: '#2ba06a' },
      { value: 1038, color: '#188a52' },
      { value: 1046, color: '#0f7040' },
    ],
  },
  cape: {
    kind: 'stepped',
    stops: [
      { value: 100, color: '#4a2136' },
      { value: 250, color: '#7d2c4e' },
      { value: 500, color: '#a03962' },
      { value: 750, color: '#b64270' },
      { value: 1000, color: '#c2497a' },
      { value: 1500, color: '#d65e90' },
      { value: 2000, color: '#e070a0' },
      { value: 2500, color: '#f08cba' },
      { value: 3000, color: '#ffa9cf' },
    ],
  },
  shortwave_radiation: {
    kind: 'stepped',
    stops: [
      { value: 50, color: '#5a4a00' },
      { value: 150, color: '#8a6f00' },
      { value: 250, color: '#b38a00' },
      { value: 400, color: '#d6a300' },
      { value: 550, color: '#efc23a' },
      { value: 700, color: '#f5d670' },
      { value: 850, color: '#f8e59a' },
      { value: 1000, color: '#fbf1c8' },
    ],
  },
}

export function getColorScale(variableId: string): ColorScale | undefined {
  return COLOR_SCALES[variableId]
}
