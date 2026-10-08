// Kacheln für den Globus, im Browser aus dem geladenen Feld gerechnet.
//
// WARUM KACHELN und kein einzelnes Bild über die Erde (wie das Feld der
// Punktprognosen-Karte): MapLibre zieht im Globus nur KACHELquellen bis an die
// Pole (`extendToNorthPole` in `create_tile_mesh`, gesetzt für raster-Kacheln
// mit y = 0 bzw. am Südrand) — eine image-/canvas-Source endet an der
// Mercator-Grenze von 85,05°, und im Prototyp standen an beiden Polen schwarze
// Löcher. Der Streifen jenseits 85,05° zeigt dabei die Randzeile der Kachel
// gestreckt; die Werteanzeige am Zeiger liest dort trotzdem das echte Feld.
//
// Zweiter Gewinn: die Kachel wird je Zoomstufe NEU abgetastet, interpoliert
// wird also der WERT, nicht die Farbe. Ein hochgezogenes Farbbild zeigt beim
// Hineinzoomen 28-km-Treppen an jeder Bandgrenze (im Prototyp über den Alpen
// gesehen); so laufen die Bandgrenzen als glatte Isolinien durch.
//
// Die Kacheln kommen über ein EIGENES Protokoll (`globe://run/var/step/z/x/y`,
// registriert in `globeProtocol.ts` — getrennt, damit dieser Rechenkern ohne
// MapLibre testbar bleibt).

import { buildLut, LUT_SIZE } from './fieldImage'
import {
  gridX,
  gridY,
  tilePixelLat,
  tilePixelLon,
  type GlobeField,
  type GlobeModelId,
  type GlobeVarId,
} from '../config/globe'
import type { ColorScale } from '../config/colorscales'

export const GLOBE_TILE_SIZE = 256
export const GLOBE_PROTOCOL = 'globe'

/**
 * Feld → RGBA einer Kachel. Bilinear über die CODES (der Wert ist linear im
 * Code, die Umrechnung also erst nach der Interpolation nötig); global über
 * die Datumsgrenze gewickelt, regional außerhalb durchsichtig; ein fehlender
 * Nachbar macht das Pixel durchsichtig — dieselbe Regel wie `sampleField`,
 * hier nur auf ganze Zeilen/Spalten vorberechnet.
 */
export function colorizeTile(
  f: GlobeField,
  scale: ColorScale,
  z: number,
  x: number,
  y: number,
  size = GLOBE_TILE_SIZE,
): Uint8ClampedArray {
  const { ni, nj } = f.grid
  const lut = buildLut(scale)
  const sMin = scale.stops[0].value
  const sMax = scale.stops[scale.stops.length - 1].value
  const transparentBelow = scale.belowMin ? scale.belowMin === 'transparent' : scale.kind === 'stepped'
  const lutK = (LUT_SIZE - 1) / (sMax - sMin)

  // Spalten und Zeilen einmal je Kachel; −1 = außerhalb eines regionalen
  // Gitters (Pixel bleibt durchsichtig). `gridX`/`gridY` sind dieselben
  // Regeln wie in `sampleField` — die Werteanzeige liest genau das, was
  // gezeichnet wird.
  const ix0 = new Int32Array(size)
  const ix1 = new Int32Array(size)
  const fxs = new Float32Array(size)
  for (let px = 0; px < size; px++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, px, size))
    if (gx == null) {
      ix0[px] = -1
      continue
    }
    const i0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
    ix0[px] = i0
    ix1[px] = i0 + 1 === ni ? 0 : i0 + 1
    fxs[px] = gx - i0
  }
  const iy0s = new Int32Array(size)
  const fys = new Float32Array(size)
  for (let py = 0; py < size; py++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, py, size))
    if (gy == null) {
      iy0s[py] = -1
      continue
    }
    const j0 = Math.min(nj - 2, Math.floor(gy))
    iy0s[py] = j0
    fys[py] = gy - j0
  }

  const out = new Uint8ClampedArray(size * size * 4)
  const c = f.codes
  for (let py = 0; py < size; py++) {
    const iy0 = iy0s[py]
    if (iy0 < 0) continue
    const fy = fys[py]
    const r0 = iy0 * ni
    const r1 = r0 + ni
    let o = py * size * 4
    for (let px = 0; px < size; px++, o += 4) {
      if (ix0[px] < 0) continue
      const a = ix0[px]
      const b = ix1[px]
      const c00 = c[r0 + a]
      const c01 = c[r0 + b]
      const c10 = c[r1 + a]
      const c11 = c[r1 + b]
      if (c00 === 0 || c01 === 0 || c10 === 0 || c11 === 0) continue
      const fx = fxs[px]
      const code = (c00 * (1 - fx) + c01 * fx) * (1 - fy) + (c10 * (1 - fx) + c11 * fx) * fy
      const v = f.lo + (code - 1) * f.step
      if (transparentBelow && v < sMin) continue
      let li = Math.round((v - sMin) * lutK)
      if (li < 0) li = 0
      else if (li > LUT_SIZE - 1) li = LUT_SIZE - 1
      const l = li * 4
      out[o] = lut[l]
      out[o + 1] = lut[l + 1]
      out[o + 2] = lut[l + 2]
      out[o + 3] = lut[l + 3]
    }
  }
  return out
}

type Rgb = readonly [number, number, number]

function ramp(dark: Rgb, bright: Rgb): Rgb[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = i / 7
    return [0, 1, 2].map((k) => Math.round(dark[k] + (bright[k] - dark[k]) * t)) as unknown as Rgb
  })
}

/**
 * Je Schicht EINE Farbe in acht Stufen, 1/8 … 8/8: dunkel und blass bis hell
 * und kräftig, immer im selben Farbton (hoch grün, mittel rot, tief blau).
 * Nur die Deckkraft zu staffeln reichte nicht — auf der dunklen Karte sahen
 * 3/8 und 6/8 fast gleich „rot" aus, die Stärke der Schicht war nicht zu lesen
 * (Rückmeldung). Achtel, weil so Bedeckung gemeldet und gelesen wird.
 */
export const CLOUD_LAYER_RAMPS: Record<'high' | 'mid' | 'low', Rgb[]> = {
  high: ramp([22, 70, 34], [150, 255, 160]),
  mid: ramp([92, 24, 24], [255, 150, 140]),
  low: ramp([24, 44, 104], [150, 185, 255]),
}

/** Deckkraft je Achtel: dünne Schichten lassen die darunter durchscheinen. */
export const CLOUD_OCTA_ALPHA = Array.from({ length: 8 }, (_, i) => 0.5 + (0.38 * i) / 7)

/** Bedeckung in % → Achtel (0…8), wie in der Synop-Meldung gerundet. */
export function toOcta(percent: number): number {
  return Math.max(0, Math.min(8, Math.round(percent / 12.5)))
}

/**
 * Wolkenschichten → RGBA einer Kachel: jede Schicht eine eigene,
 * halbtransparente Fläche in IHREM Farbton, Helligkeit und Deckkraft nach
 * Achteln (`CLOUD_LAYER_RAMPS`). Gestapelt wie von oben gesehen — tief unten,
 * hoch oben — und übereinander normal überblendet („source-over"). Eine
 * frühere Fassung mischte die Kanäle ADDITIV (hoch + mittel = gelb, alle drei
 * = weiß); das waren sieben Farben für drei Größen und ist auf Wunsch raus.
 *
 * BILINEAR je Schicht, Farbe STUFENLOS zwischen den Achtelstufen: mit dem
 * nächsten Gitterpunkt stand jede 2-km-Zelle als Klötzchen da (Rückmeldung
 * „Pixelung"). Der nächste Gitterpunkt war nur nötig, solange die Kanäle
 * additiv gemischt wurden — eine Zwischenfarbe hätte dort wie eine dritte
 * Schicht ausgesehen; bei getrennten Schichten ist Interpolation richtig.
 * Vorher leicht geglättet (`smoothRgb3`), sonst blieben Treppen im Gitter.
 * Unter 1/8 blendet eine Schicht WEICH aus (statt hart bei 0/8 abzubrechen),
 * Küsten und Grenzen bleiben sichtbar. Fehlt an einer Ecke der Wert (Rand des
 * ICON-D2-Gebiets), bleibt das Pixel leer — wie bei den Farbflächen.
 */
const rgbSmoothCache = new WeakMap<GlobeField, Float32Array>()

/**
 * Halbmesser der Glättung in Gitterzellen: ~4–5 km auf jeder Seite. Bilinear
 * allein ließ beim Hineinzoomen Treppen stehen — ICON springt von Zelle zu
 * Zelle oft von 0 auf 100 %, und eine Interpolation über EINE Zelle folgt
 * dann noch dem Gitter. ICON-D2 (0,02°) ±2 Zellen, ICON-EU (0,0625°) ±1.
 */
export function cloudSmoothRadius(dlon: number): number {
  return Math.max(1, Math.round(0.04 / dlon))
}

/**
 * Die drei Schichten als Fließkomma-Bedeckung, geglättet (zweimal
 * Kastenfilter ±r, getrennt in x und y = Dreiecksfilter); fehlend (255) zählt
 * nicht mit und bleibt fehlend. Einmal je Feld gerechnet.
 */
export function smoothRgb3(f: GlobeField): Float32Array {
  const hit = rgbSmoothCache.get(f)
  if (hit) return hit
  const rgb = f.rgb!
  const { ni, nj, global } = f.grid
  const r = cloudSmoothRadius(f.grid.dlon)
  const n = ni * nj
  let cur: Float32Array = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const c = 3 * i
    if (rgb[c] === 255) cur[c] = cur[c + 1] = cur[c + 2] = NaN
    else {
      cur[c] = rgb[c]
      cur[c + 1] = rgb[c + 1]
      cur[c + 2] = rgb[c + 2]
    }
  }
  // Ein Durchgang = Kastenfilter in x, dann in y. ZWEI Durchgänge ergeben
  // einen Dreiecksfilter: ein einzelner Kasten ließ beim Hineinzoomen
  // Kästchen in den Flächen stehen (im Browser gesehen).
  const pass = (src: Float32Array, dx: number, dy: number): Float32Array => {
    const dst = new Float32Array(n * 3)
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const c = 3 * (j * ni + i)
        if (src[c] !== src[c]) {
          dst[c] = dst[c + 1] = dst[c + 2] = NaN
          continue
        }
        let s0 = 0
        let s1 = 0
        let s2 = 0
        let k = 0
        for (let d = -r; d <= r; d++) {
          let ii = i + d * dx
          const jj = j + d * dy
          if (jj < 0 || jj >= nj) continue
          if (ii < 0 || ii >= ni) {
            if (!global) continue
            ii = (ii + ni) % ni
          }
          const q = 3 * (jj * ni + ii)
          if (src[q] !== src[q]) continue
          s0 += src[q]
          s1 += src[q + 1]
          s2 += src[q + 2]
          k++
        }
        dst[c] = s0 / k
        dst[c + 1] = s1 / k
        dst[c + 2] = s2 / k
      }
    }
    return dst
  }
  for (let p = 0; p < 2; p++) cur = pass(pass(cur, 1, 0), 0, 1)
  rgbSmoothCache.set(f, cur)
  return cur
}

export function colorizeRgbTile(f: GlobeField, z: number, x: number, y: number, size = GLOBE_TILE_SIZE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  if (!f.rgb) return out
  const rgb = smoothRgb3(f)
  const { ni, nj } = f.grid
  const ix0 = new Int32Array(size)
  const ix1 = new Int32Array(size)
  const fxs = new Float32Array(size)
  for (let px = 0; px < size; px++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, px, size))
    if (gx == null) {
      ix0[px] = -1
      continue
    }
    const i0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
    ix0[px] = i0
    ix1[px] = i0 + 1 === ni ? 0 : i0 + 1
    fxs[px] = gx - i0
  }
  // Reihenfolge des Übermalens: tief → mittel → hoch; Kanal im Bild: R mittel, G hoch, B tief
  const order: { ch: number; ramp: Rgb[] }[] = [
    { ch: 2, ramp: CLOUD_LAYER_RAMPS.low },
    { ch: 0, ramp: CLOUD_LAYER_RAMPS.mid },
    { ch: 1, ramp: CLOUD_LAYER_RAMPS.high },
  ]
  for (let py = 0; py < size; py++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, py, size))
    if (gy == null) continue
    const j0 = Math.min(nj - 2, Math.floor(gy))
    const fy = gy - j0
    const r0 = j0 * ni
    const r1 = r0 + ni
    let o = py * size * 4
    for (let px = 0; px < size; px++, o += 4) {
      if (ix0[px] < 0) continue
      const a00 = 3 * (r0 + ix0[px])
      const a01 = 3 * (r0 + ix1[px])
      const a10 = 3 * (r1 + ix0[px])
      const a11 = 3 * (r1 + ix1[px])
      // NaN = kein Wert (gilt für alle drei Kanäle gemeinsam)
      const m = rgb[a00] + rgb[a01] + rgb[a10] + rgb[a11]
      if (m !== m) continue
      const fx = fxs[px]
      const w00 = (1 - fx) * (1 - fy)
      const w01 = fx * (1 - fy)
      const w10 = (1 - fx) * fy
      const w11 = fx * fy
      // vormultipliziert übermalen
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const { ch, ramp } of order) {
        const cover = rgb[a00 + ch] * w00 + rgb[a01 + ch] * w01 + rgb[a10 + ch] * w10 + rgb[a11 + ch] * w11
        const oct = cover / 12.5
        // weich ausblenden: 0 bei 0,3/8, voll ab 0,9/8
        const fade = Math.min(1, Math.max(0, (oct - 0.3) / 0.6))
        if (fade === 0) continue
        const t = Math.min(7, Math.max(0, oct - 1))
        const k = Math.min(6, Math.floor(t))
        const u = t - k
        const c0 = ramp[k]
        const c1 = ramp[k + 1]
        const al = (CLOUD_OCTA_ALPHA[k] + (CLOUD_OCTA_ALPHA[k + 1] - CLOUD_OCTA_ALPHA[k]) * u) * fade
        r = (c0[0] + (c1[0] - c0[0]) * u) * al + r * (1 - al)
        g = (c0[1] + (c1[1] - c0[1]) * u) * al + g * (1 - al)
        b = (c0[2] + (c1[2] - c0[2]) * u) * al + b * (1 - al)
        a = al + a * (1 - al)
      }
      if (a === 0) continue
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = a * 255
    }
  }
  return out
}

export function globeTileUrl(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): string {
  return `${GLOBE_PROTOCOL}://${model}/${runId}/${varId}/${step}/{z}/{x}/{y}`
}
