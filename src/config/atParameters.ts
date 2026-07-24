// Parameter-Registry der Österreich-Klimakarte (Schritt 3). Kuratierte Auswahl
// der klimatologisch wichtigen GeoSphere-Größen (klima-v2-1d) — deklarativ, damit
// Karte, Colorbar und Detailpanel konsistent bleiben (analog FieldSpec/variables.ts).
//
// Die GeoSphere-Codes stammen aus /metadata (siehe public/at/parameters.json);
// die Zuordnung zu Skala und Aggregat ist eine bewusste Design-Entscheidung.
// Farbskalen werden aus dem validierten Bestand (colorscales.ts) wiederverwendet;
// für Sonnenschein/Schneehöhe spiegeln zwei neue Rampen den vorhandenen Stil.

import { COLOR_SCALES, type ColorScale } from './colorscales'

/** Wie eine Reihe täglicher Werte auf EINEN Kartenwert reduziert wird. */
export type AggMode = 'mean' | 'sum' | 'max' | 'min' | 'last'

export interface AtParameterSpec {
  /** GeoSphere-Parametercode (klima-v2-1d). */
  code: string
  label: string
  unit: string
  category: 'Temperatur' | 'Niederschlag' | 'Sonne' | 'Schnee' | 'Feuchte' | 'Wind'
  /** Reduktion über einen Zeitraum (bei Einzeltag irrelevant). */
  agg: AggMode
  scale: ColorScale
}

// Sonnenscheindauer (h/Tag): sequenziell dunkel→hell-gelb, im Stil der
// Globalstrahlungsskala. Monoton heller = barrierefrei ablesbar.
const SUNSHINE_SCALE: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: [
    { value: 0, color: '#3a3320' },
    { value: 2, color: '#5a4a00' },
    { value: 4, color: '#8a6f00' },
    { value: 6, color: '#b38a00' },
    { value: 8, color: '#d6a300' },
    { value: 10, color: '#efc23a' },
    { value: 12, color: '#f5d670' },
    { value: 14, color: '#f8e59a' },
  ],
}

// Schneehöhe (cm): sequenziell violett→weiß, Werte bis alpine Höhen. < 1 cm
// transparent (aper).
const SNOW_DEPTH_SCALE: ColorScale = {
  kind: 'stepped',
  stops: [
    { value: 1, color: '#3a2f7d' },
    { value: 5, color: '#4a3aa7' },
    { value: 10, color: '#6a5cd0' },
    { value: 20, color: '#9085e9' },
    { value: 40, color: '#a89ff0' },
    { value: 70, color: '#b7aef3' },
    { value: 120, color: '#cbc4f7' },
    { value: 200, color: '#e0dcfb' },
    { value: 300, color: '#f2f0fe' },
  ],
}

export const AT_PARAMETERS: AtParameterSpec[] = [
  { code: 'tl_mittel', label: 'Temperatur Mittel', unit: '°C', category: 'Temperatur', agg: 'mean', scale: COLOR_SCALES.temperature_2m },
  { code: 'tlmax', label: 'Temperatur Maximum', unit: '°C', category: 'Temperatur', agg: 'max', scale: COLOR_SCALES.temperature_2m },
  { code: 'tlmin', label: 'Temperatur Minimum', unit: '°C', category: 'Temperatur', agg: 'min', scale: COLOR_SCALES.temperature_2m },
  { code: 'rr', label: 'Niederschlag Summe', unit: 'mm', category: 'Niederschlag', agg: 'sum', scale: COLOR_SCALES.precipitation },
  { code: 'so_h', label: 'Sonnenschein', unit: 'h', category: 'Sonne', agg: 'sum', scale: SUNSHINE_SCALE },
  { code: 'sh', label: 'Schneehöhe', unit: 'cm', category: 'Schnee', agg: 'last', scale: SNOW_DEPTH_SCALE },
  { code: 'rfb_mittel', label: 'Rel. Feuchte', unit: '%', category: 'Feuchte', agg: 'mean', scale: COLOR_SCALES.relative_humidity_2m },
]

const byCode = new Map(AT_PARAMETERS.map((p) => [p.code, p]))

export function getAtParameter(code: string): AtParameterSpec {
  const p = byCode.get(code)
  if (!p) throw new Error(`Unbekannter AT-Parameter: ${code}`)
  return p
}

/** Reihe (mit möglichen null-Lücken) gemäß Aggregat auf einen Wert reduzieren. */
export function aggregate(values: (number | null)[], mode: AggMode): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return null
  switch (mode) {
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'sum':
      return nums.reduce((a, b) => a + b, 0)
    case 'max':
      return Math.max(...nums)
    case 'min':
      return Math.min(...nums)
    case 'last':
      return nums[nums.length - 1]
  }
}
