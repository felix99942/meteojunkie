// 3D-Radar im Browser: Höhenschichten (CAPPI) und Querschnitt aus dem Stapel,
// den der Worker alle 5 Minuten rechnet (worker/radar3d.ts — Herkunft,
// Geometrie und Kodierung stehen dort). Hier nur die reinen Rechenkerne:
// welcher Bildpunkt zu einem Ort gehört, welche Farbe ein Wert bekommt und
// was ein senkrechter Schnitt entlang einer Linie zeigt.

import type { GeoBox } from './wmsTime'
import { MASK_COLOR, WN_LEGEND } from './radar'

/** `radar/r3d/index.json` — dieselbe Form, die der Worker schreibt */
export interface R3dIndex {
  stepMs: number
  times: number[]
  /** Anzahl Radare je Termin (gleiche Reihenfolge wie `times`) */
  stations: number[]
  geo: GeoBox
  width: number
  height: number
  /** Höhen über NN in m */
  levels: number[]
}

/** 0 = abgedeckt, kein Echo · 1…254 = (dBZ + 32) · 2 · 255 = nicht abgedeckt */
export const R3D_NODATA = 255
export const r3dDbz = (q: number) => q / 2 - 32

/** Vorgabe beim Öffnen: 3 km — über dem Großteil der Abschattung, unter der Schmelzschicht im Sommer */
export const R3D_DEFAULT_LEVEL_M = 3000

export function r3dLevelLabel(m: number): string {
  return `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Bildpunkt (Spalte, Zeile) eines Orts im Stapel, oder null ausserhalb. Zeile 0 = Norden. */
export function r3dPixel(index: Pick<R3dIndex, 'geo' | 'width' | 'height'>, lon: number, lat: number): { x: number; y: number } | null {
  const { geo, width, height } = index
  const x = Math.floor(((lon - geo.west) / (geo.east - geo.west)) * width)
  const y = Math.floor(((merc(geo.north) - merc(lat)) / (merc(geo.north) - merc(geo.south))) * height)
  return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null
}

type Rgba = [number, number, number, number]
const hex = (c: string, a = 255): Rgba => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), a]
const thresholds = WN_LEGEND.map((s) => Number(s.label.replace(',', '.')))
const colors = WN_LEGEND.map((s) => hex(s.color))
/** „keine Daten" wie das Komposit: dieselbe graue Maske mit halber Deckkraft */
const MASK: Rgba = hex(MASK_COLOR, 128)
const CLEAR: Rgba = [0, 0, 0, 0]

/**
 * Farbe je kodiertem Wert — DIESELBE Skala wie die Reflektivität (WN), damit
 * eine Höhenschicht und das Bodenbild nebeneinander lesbar sind und der
 * Wert am Zeiger über dieselbe Legende geht. Unter 7 dBZ durchsichtig.
 */
export const R3D_LUT: Rgba[] = Array.from({ length: 256 }, (_, q) => {
  if (q === R3D_NODATA) return MASK
  if (q === 0) return CLEAR
  const dbz = r3dDbz(q)
  let k = -1
  while (k + 1 < thresholds.length && dbz >= thresholds[k + 1]) k++
  return k < 0 ? CLEAR : colors[k]
})

/** Eine Höhenschicht → RGBA (für ein Canvas) */
export function r3dLevelRgba(stack: Uint8Array, index: Pick<R3dIndex, 'width' | 'height'>, level: number): Uint8ClampedArray<ArrayBuffer> {
  const n = index.width * index.height
  const out = new Uint8ClampedArray(n * 4)
  const base = level * n
  for (let p = 0; p < n; p++) {
    const c = R3D_LUT[stack[base + p]]
    const o = 4 * p
    out[o] = c[0]
    out[o + 1] = c[1]
    out[o + 2] = c[2]
    out[o + 3] = c[3]
  }
  return out
}

const R = 6371
const RAD = Math.PI / 180
export function distanceKm(a: [number, number], b: [number, number]): number {
  const [lo1, la1] = a
  const [lo2, la2] = b
  const h = Math.sin(((la2 - la1) * RAD) / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface R3dSection {
  /** Bodenentfernung der Spalten ab A in km */
  distKm: number[]
  /** je Spalte und Schicht der kodierte Wert, Spalte für Spalte (Länge = Spalten × Schichten) */
  values: Uint8Array
  levels: number[]
  lengthKm: number
}

/**
 * Senkrechter Schnitt von A nach B: alle `stepKm` eine Spalte, je Schicht
 * der Wert des nächstgelegenen Bildpunkts. Zwischen A und B LINEAR in Länge
 * und Breite — bei Schnittlängen bis ~1.000 km weicht das vom Großkreis um
 * wenige Kilometer ab, weit unter der Breite einer Gewitterzelle nicht.
 * Ausserhalb des Stapels: „nicht abgedeckt".
 */
export function r3dSection(stack: Uint8Array, index: R3dIndex, a: [number, number], b: [number, number], stepKm = 1): R3dSection {
  const lengthKm = distanceKm(a, b)
  const cols = Math.max(2, Math.round(lengthKm / stepKm) + 1)
  const nL = index.levels.length
  const n = index.width * index.height
  const values = new Uint8Array(cols * nL).fill(R3D_NODATA)
  const distKm: number[] = []
  for (let c = 0; c < cols; c++) {
    const f = c / (cols - 1)
    distKm.push(f * lengthKm)
    const px = r3dPixel(index, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    if (!px) continue
    const p = px.y * index.width + px.x
    for (let L = 0; L < nL; L++) values[c * nL + L] = stack[L * n + p]
  }
  return { distKm, values, levels: index.levels, lengthKm }
}

/** Höchster Wert je Spalte (für die Kennzeile des Schnitts) und Echotop ≥ `thrDbz` in m */
export function sectionStats(s: R3dSection, thrDbz = 18): { maxDbz: number | null; topM: number | null } {
  const nL = s.levels.length
  let max = -1
  let top: number | null = null
  for (let c = 0; c < s.distKm.length; c++)
    for (let L = 0; L < nL; L++) {
      const q = s.values[c * nL + L]
      if (q === R3D_NODATA || q === 0) continue
      if (q > max) max = q
      if (r3dDbz(q) >= thrDbz && (top == null || s.levels[L] > top)) top = s.levels[L]
    }
  return { maxDbz: max > 0 ? r3dDbz(max) : null, topM: top }
}
