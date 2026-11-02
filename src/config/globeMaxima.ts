// Rechenkern der Maxima-Beschriftung im Niederschlagsfeld (Modellkarten) —
// ohne MapLibre, damit testbar; die Zahlenebene steht in render/fieldMaxima.ts.

import { formatReadout, gridX, gridY, type GlobeField, type GlobeVarId } from './globe'

export interface FieldMax {
  value: number
  lat: number
  lon: number
}

/** Mehr Zellen je Block werden ausgedünnt (gröbste Sicht auf der Kugel). */
const MAX_CELLS = 40_000

/**
 * Höchster Gitterwert im Kasten [W, S, O, N] (Grad, O ≥ W, höchstens 360°
 * breit), oder null ohne Wert. Liegt keine Zellmitte im Kasten (stark
 * hineingezoomt), zählt die Zelle unter der Kastenmitte.
 */
export function maxInBox(f: GlobeField, w: number, s: number, e: number, n: number): FieldMax | null {
  const g = f.grid
  const ya = (s - g.lat0) / g.dlat
  const yb = (n - g.lat0) / g.dlat
  const j0 = Math.max(0, Math.ceil(Math.min(ya, yb)))
  const j1 = Math.min(g.nj - 1, Math.floor(Math.max(ya, yb)))
  const x0 = Math.ceil((w - g.lon0) / g.dlon)
  const x1 = Math.floor((e - g.lon0) / g.dlon)
  if (j1 < j0 || x1 < x0) {
    const cx = gridX(g, (w + e) / 2)
    const cy = gridY(g, (s + n) / 2)
    if (cx == null || cy == null) return null
    const i = Math.round(cy) * g.ni + Math.round(cx)
    const code = f.codes[i]
    return code ? toMax(f, i, code) : null
  }
  const cells = (j1 - j0 + 1) * (x1 - x0 + 1)
  const stride = Math.max(1, Math.ceil(Math.sqrt(cells / MAX_CELLS)))
  let best = 0
  let bestIdx = -1
  for (let j = j0; j <= j1; j += stride) {
    const row = j * g.ni
    for (let x = x0; x <= x1; x += stride) {
      let i = x
      if (g.global) i = ((x % g.ni) + g.ni) % g.ni
      else if (x < 0 || x >= g.ni) continue
      const code = f.codes[row + i]
      if (code > best) {
        best = code
        bestIdx = row + i
      }
    }
  }
  return bestIdx < 0 ? null : toMax(f, bestIdx, best)
}

function toMax(f: GlobeField, idx: number, code: number): FieldMax {
  const g = f.grid
  const j = Math.floor(idx / g.ni)
  const i = idx - j * g.ni
  const lon = g.lon0 + i * g.dlon
  return {
    value: f.lo + (code - 1) * f.step,
    lat: g.lat0 + j * g.dlat,
    lon: lon > 180 ? lon - 360 : lon,
  }
}

/**
 * Kandidaten (je Block sein Maximum, in Bildschirm-px) so ausdünnen, dass
 * keine zwei Zahlen näher als `minDist` beieinanderstehen — der HÖHERE Wert
 * gewinnt. Erst so bekommt eine große Regenfläche mehrere Zahlen: die frühere
 * Regel „nur über allen acht Nachbarblöcken" ließ in einer zum Kern
 * ansteigenden Fläche genau eine übrig. Werte unter `min` entfallen.
 */
export function spacedMaxima<T extends { value: number; x: number; y: number }>(items: T[], minDist: number, min: number): T[] {
  const out: T[] = []
  const d2 = minDist * minDist
  for (const c of items.filter((i) => i.value >= min).sort((a, b) => b.value - a.value)) {
    if (out.every((o) => (o.x - c.x) ** 2 + (o.y - c.y) ** 2 >= d2)) out.push(c)
  }
  return out
}

/** Zahl ohne Einheit: unter 10 mit `decimals` Nachkommastellen, darüber ganze. */
export function formatMax(v: number, decimals = 1): string {
  return formatReadout(v, v < 9.95 ? decimals : 0)
}

/**
 * Welche Größen Höchstwerte als Zahlen bekommen, ab welchem Wert, und ob der
 * Feldwert eine RATE ist, die mit dem Intervall zur MENGE wird (`precip`:
 * mm/h × 1/3/6 h — „1,5" soll 1,5 mm heißen, nicht 1,5 mm/h). Schwellen: die
 * unterste eingefärbte Stufe der jeweiligen Skala.
 */
export const MAXIMA_OPTIONS: Partial<Record<GlobeVarId, { min: number; perInterval: boolean; decimals: number }>> = {
  precip: { min: 0.1, perInterval: true, decimals: 1 },
  // in ganzen mm gespeichert — „9,0" täuschte eine Genauigkeit vor, die es nicht gibt
  precipsum: { min: 1, perInterval: false, decimals: 0 },
}
