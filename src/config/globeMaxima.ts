// Rechenkern der Maxima-Beschriftung im Niederschlagsfeld (Modellkarten) —
// ohne MapLibre, damit testbar; die Zahlenebene steht in render/fieldMaxima.ts.

import { formatReadout, gridX, gridY, type GlobeField, type GlobeVarId } from './globe'

export interface FieldMax {
  value: number
  lat: number
  lon: number
  /** Zellindex im Gitter */
  idx: number
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
    idx,
  }
}

/** Von den acht Nachbarn einer Zelle mindestens so viele mit Farbe … */
const FILL_NEIGHBOURS = 5

/**
 * Steht die Zelle in einer FARBFLÄCHE? Sie selbst und mindestens
 * FILL_NEIGHBOURS ihrer acht Nachbarn liegen bei `fillMin` (Feldeinheit, die
 * unterste eingefärbte Stufe der Skala) oder darüber. Ein einzelner nasser
 * Gitterpunkt ist in der Karte nicht zu sehen — eine Zahl darauf stünde im
 * Leeren (gemeldet: bei geringen Mengen Zahlen ohne Farbfläche).
 */
export function inFilledArea(f: GlobeField, idx: number, fillMin: number): boolean {
  const g = f.grid
  const minCode = Math.ceil((fillMin - f.lo) / f.step - 1e-9) + 1
  if (f.codes[idx] < minCode) return false
  const j = Math.floor(idx / g.ni)
  const i = idx - j * g.ni
  let n = 0
  for (let dj = -1; dj <= 1; dj++) {
    const jj = j + dj
    if (jj < 0 || jj >= g.nj) continue
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue
      let ii = i + di
      if (ii < 0 || ii >= g.ni) {
        if (!g.global) continue
        ii = (ii + g.ni) % g.ni
      }
      if (f.codes[jj * g.ni + ii] >= minCode) n++
    }
  }
  return n >= FILL_NEIGHBOURS
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
 * Welche Größen Höchstwerte als Zahlen bekommen, ab welcher MENGE (`min`, mm),
 * ab welchem FELDwert die Skala einfärbt (`fillMin`, für `inFilledArea`), und
 * ob der Feldwert eine RATE ist, die mit dem Intervall zur Menge wird
 * (`precip`: mm/h × 1/3/6 h — „1,5" soll 1,5 mm heißen, nicht 1,5 mm/h).
 */
export const MAXIMA_OPTIONS: Partial<
  Record<GlobeVarId, { min: number; perInterval: boolean; decimals: number; fillMin: number }>
> = {
  // ab 0,5 mm (auf Wunsch — geringere Mengen sind als Zahl nur Rauschen);
  // eingefärbt ist die Rate ab 0,1 mm/h
  precip: { min: 0.5, perInterval: true, decimals: 1, fillMin: 0.1 },
  // in ganzen mm gespeichert — „9,0" täuschte eine Genauigkeit vor, die es
  // nicht gibt; eingefärbt ab 1 mm
  precipsum: { min: 0.5, perInterval: false, decimals: 0, fillMin: 1 },
}

/**
 * Rasterpunkte für WERTE im Farbfeld (Panel-Ansicht: Temperatur, Wind,
 * Relative Topografie …), im Kasten [W, S, O, N]. Das Raster hängt an
 * VIELFACHEN des Abstands in Grad, nicht am Bildschirm — beim Verschieben
 * bleiben die Zahlen an ihrem Ort, statt bei jeder Bewegung über die Karte
 * zu springen (dieselbe Überlegung wie bei der Label-Ausdünnung der
 * Klimakarte). `stepLon` in Grad; die Breite wird mit cos(`latRef`)
 * gestaucht, damit die Punkte in Mercator ungefähr quadratisch stehen.
 * `latRef` sollte gerundet übergeben werden, sonst wandert das Raster beim
 * Verschieben in der Breite doch.
 */
export function valueGrid(w: number, s: number, e: number, n: number, stepLon: number, latRef: number): { lat: number; lon: number }[] {
  if (!(stepLon > 0)) return []
  const stepLat = stepLon * Math.cos((latRef * Math.PI) / 180)
  const out: { lat: number; lon: number }[] = []
  // halbe Schrittweite versetzt: nicht genau auf Gradnetzlinien
  for (let lat = (Math.floor(s / stepLat) + 0.5) * stepLat; lat <= n; lat += stepLat) {
    if (lat < s) continue
    for (let lon = (Math.floor(w / stepLon) + 0.5) * stepLon; lon <= e; lon += stepLon) {
      if (lon >= w) out.push({ lat, lon })
    }
    if (out.length > 2000) break
  }
  return out
}
