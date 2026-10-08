// Isolinien der Modellkarten (Isobaren, 500-hPa-Geopotential) — je Kachel im
// Browser gerechnet, wie die Farbflächen (`globeTiles.ts`), und als eigene
// Rasterebene darüber gelegt. So lassen sie sich über JEDE Größe legen
// (Bodendruck über Niederschlag, 500 hPa über T850 — die klassischen
// synoptischen Kombinationen) und laufen auf der Kugel bis an die Pole.
//
// WARUM RASTER und nicht Vektorlinien (GeoJSON-Layer): die Beschriftung. Ein
// MapLibre-Symbol-Layer braucht eine Glyphs-Quelle, und die Basemap ist
// bewusst komplett lokal (siehe `render/basemap.ts`). In der Kachel zeichnet
// ein 2D-Canvas die Zahl selbst.
//
// DIE LINIE KOMMT AUS DEM ABSTAND ZUR ISOLINIE, nicht aus einem Vergleich
// benachbarter Pixel: d = |v − L| / |∇v| ist der Abstand des Pixels zur
// nächsten Linie in Pixeln (lineare Näherung), daraus folgen Deckkraft von
// Kern und Halo. Das ergibt gleich breite, kantengeglättete Linien
// unabhängig davon, wie steil das Feld ist — dieselbe Technik wie bei
// Isolinien im Shader.
//
// GEGLÄTTET wird vorher (`smoothField`, Kastenfilter je Modell): reduzierter
// Bodendruck ist über Gebirge auf einem 2-km-Gitter verrauscht — ICON-D2
// zeichnete sonst über den Alpen Kringel um jeden Gipfel, die keine Wetterlage
// sind, sondern die Reduktion auf Meereshöhe. Die Farbfläche bleibt ungeglättet.

import { gridX, gridY, tilePixelLat, tilePixelLon, type GlobeField } from '../config/globe'

const smoothCache = new WeakMap<GlobeField, Map<number, Float32Array>>()

/**
 * Feld als Fließkommawerte, über (2r+1)² Zellen gemittelt (Kastenfilter,
 * getrennt in x und y). Fehlende Werte zählen nicht mit; eine fehlende Zelle
 * bleibt fehlend. Global wird in der Länge über die Datumsgrenze gemittelt.
 */
export function smoothField(f: GlobeField, r: number): Float32Array {
  let byR = smoothCache.get(f)
  const hit = byR?.get(r)
  if (hit) return hit
  const { ni, nj, global } = f.grid
  const n = ni * nj
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = f.codes[i]
    raw[i] = c === 0 ? NaN : f.lo + (c - 1) * f.step
  }
  let out = raw
  if (r > 0) {
    const tmp = new Float32Array(n)
    // x-Richtung
    for (let j = 0; j < nj; j++) {
      const row = j * ni
      for (let i = 0; i < ni; i++) {
        let s = 0
        let k = 0
        for (let d = -r; d <= r; d++) {
          let ii = i + d
          if (ii < 0 || ii >= ni) {
            if (!global) continue
            ii = (ii + ni) % ni
          }
          const v = raw[row + ii]
          if (v === v) {
            s += v
            k++
          }
        }
        tmp[row + i] = raw[row + i] === raw[row + i] && k ? s / k : NaN
      }
    }
    // y-Richtung
    out = new Float32Array(n)
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        let s = 0
        let k = 0
        for (let d = -r; d <= r; d++) {
          const jj = j + d
          if (jj < 0 || jj >= nj) continue
          const v = tmp[jj * ni + i]
          if (v === v) {
            s += v
            k++
          }
        }
        out[j * ni + i] = tmp[j * ni + i] === tmp[j * ni + i] && k ? s / k : NaN
      }
    }
  }
  if (!byR) {
    byR = new Map()
    smoothCache.set(f, byR)
  }
  byR.set(r, out)
  return out
}

export interface ContourStyle {
  /** Linienfarbe (Kern) */
  core: [number, number, number]
  /** Halo zur Abgrenzung gegen den Untergrund */
  halo: [number, number, number]
}

/** Isobaren hell mit dunklem Halo, 500 hPa dunkel mit hellem — so bleiben beide gleichzeitig unterscheidbar und auf jeder Farbe lesbar. */
export const CONTOUR_STYLES: Record<'msl' | 'gh500', ContourStyle> = {
  msl: { core: [245, 246, 248], halo: [12, 13, 15] },
  gh500: { core: [14, 15, 17], halo: [235, 236, 238] },
}

export interface ContourLabel {
  x: number
  y: number
  text: string
}

/** Halbe Kernbreite und Halo-Reichweite in Pixeln. */
const CORE_HW = 0.75
const HALO_HW = 1.9
const HALO_ALPHA = 0.55
/** Beschriftung: Rand der Kachel, Mindestabstand, höchstens je Linie und Kachel. */
const LABEL_MARGIN = 18
const LABEL_GAP = 90
const LABELS_PER_LEVEL = 2
/** Pixelrand für Gradient und Durchschreitungsprüfung (≥ Halo-Reichweite · √2). */
const BORDER = 4

/**
 * Isolinien einer Kachel: RGBA plus Beschriftungsstellen. `interval` ist der
 * Linienabstand in der Einheit der Größe; auf der ganzen Kugel (z ≤ 2) wird er
 * verdoppelt, sonst laufen Tiefs zu einem Linienknäuel zusammen.
 *
 * DIE LINIENWERTE LIEGEN UM EINE HALBE SPEICHERSTUFE VERSETZT (`shift`). Die
 * Werte sind gestuft gespeichert (0,5 hPa, 0,1 gpdm); wo vier benachbarte
 * Zellen GENAU auf einem Linienwert lagen (1020,0 hPa ist ein häufiger
 * Code), entstand eine Fläche ohne Gefälle — dort ist der Abstand zur Linie
 * nicht bestimmbar, und gezeichnet wurde ihr UMRISS: Doppellinien und
 * Treppenkästen (im Browser gesehen, ICON-EU-Isobaren, IFS-500 hPa). Um
 * `step / 2` verschoben fällt keine Linie mehr auf einen Code; der Fehler ist
 * eine Viertel-hPa und damit unsichtbar. Beschriftet wird der runde Wert.
 */
export function contourTile(
  f: GlobeField,
  smooth: Float32Array,
  interval: number,
  style: ContourStyle,
  z: number,
  x: number,
  y: number,
  size = 256,
): { rgba: Uint8ClampedArray; labels: ContourLabel[] } {
  const step = interval * (z <= 2 ? 2 : 1)
  const shift = f.step / 2
  const { ni, nj } = f.grid
  // Werte an den Pixelmitten, mit BORDER Pixeln Rand: einer für den
  // Gradienten, bis zu BORDER für die Prüfung, ob die Linie wirklich
  // durchschritten wird (siehe unten)
  const W = size + 2 * BORDER
  const cols = new Float64Array(W)
  const colOk = new Uint8Array(W)
  for (let k = 0; k < W; k++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, k - BORDER, size))
    if (gx != null) {
      cols[k] = gx
      colOk[k] = 1
    }
  }
  const V = new Float32Array(W * W).fill(NaN)
  for (let rr = 0; rr < W; rr++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, rr - BORDER, size))
    if (gy == null) continue
    const j0 = Math.min(nj - 2, Math.floor(gy))
    const fy = gy - j0
    const r0 = j0 * ni
    const r1 = r0 + ni
    for (let k = 0; k < W; k++) {
      if (!colOk[k]) continue
      const gx = cols[k]
      const i0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
      const i1 = i0 + 1 === ni ? 0 : i0 + 1
      const fx = gx - i0
      V[rr * W + k] =
        (smooth[r0 + i0] * (1 - fx) + smooth[r0 + i1] * fx) * (1 - fy) +
        (smooth[r1 + i0] * (1 - fx) + smooth[r1 + i1] * fx) * fy
    }
  }

  const rgba = new Uint8ClampedArray(size * size * 4)
  const dist = new Float32Array(size * size).fill(Infinity)
  const level = new Float32Array(size * size)
  const [cr, cg, cb] = style.core
  const [hr, hg, hb] = style.halo
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const c = (py + BORDER) * W + px + BORDER
      const v = V[c]
      const l = V[c - 1]
      const r = V[c + 1]
      const u = V[c - W]
      const d = V[c + W]
      if (v !== v || l !== l || r !== r || u !== u || d !== d) continue
      const g = Math.hypot((r - l) / 2, (d - u) / 2)
      if (g < 1e-9) continue
      const L = Math.round((v - shift) / step) * step
      const e = v - shift - L
      const dpx = Math.abs(e) / g
      if (dpx > HALO_HW + 0.5) continue
      // Wird der Linienwert in Reichweite WIRKLICH durchschritten? Die
      // Abstandsschätzung extrapoliert linear und zeichnete sonst dort einen
      // blassen Geisterstrich, wo das Feld nur an den Wert HERANREICHT —
      // am Rand einer Fläche knapp unter dem Linienwert (im Test gesehen).
      let crossed = false
      for (let k = 1; k <= BORDER && !crossed; k++) {
        for (const n of [V[c - k], V[c + k], V[c - k * W], V[c + k * W]]) {
          if (n === n && (n - shift - L) * e <= 0) {
            crossed = true
            break
          }
        }
      }
      if (!crossed) continue
      const core = Math.min(1, Math.max(0, CORE_HW + 0.5 - dpx))
      const halo = Math.min(1, Math.max(0, HALO_HW + 0.5 - dpx)) * HALO_ALPHA
      const a = core + (1 - core) * halo
      const o = 4 * (py * size + px)
      // Kern über Halo, Farbe nach Deckungsanteil gemischt
      const wCore = a > 0 ? core / a : 0
      rgba[o] = cr * wCore + hr * (1 - wCore)
      rgba[o + 1] = cg * wCore + hg * (1 - wCore)
      rgba[o + 2] = cb * wCore + hb * (1 - wCore)
      rgba[o + 3] = a * 255
      dist[py * size + px] = dpx
      level[py * size + px] = L
    }
  }

  // Beschriftung: Stellen GENAU auf der Linie, mit Abstand zum Kachelrand
  // (sonst schneidet die Nachbarkachel die Zahl ab) und zueinander
  const labels: ContourLabel[] = []
  const perLevel = new Map<number, number>()
  // Lückenlos abgesucht: die Linie ist gut einen Pixel breit, ein grobes
  // Raster verfehlte genau senkrechte oder waagrechte Linien ganz (im Test)
  for (let py = LABEL_MARGIN; py < size - LABEL_MARGIN; py++) {
    for (let px = LABEL_MARGIN + 6; px < size - LABEL_MARGIN - 6; px++) {
      const i = py * size + px
      if (dist[i] > 0.35) continue
      const L = level[i]
      if ((perLevel.get(L) ?? 0) >= LABELS_PER_LEVEL) continue
      if (labels.some((q) => Math.hypot(q.x - px, q.y - py) < LABEL_GAP)) continue
      labels.push({ x: px, y: py, text: String(Math.round(L)) })
      perLevel.set(L, (perLevel.get(L) ?? 0) + 1)
    }
  }
  return { rgba, labels }
}
