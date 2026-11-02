// Laden der Höhenstapel des 3D-Radars (worker/radar3d.ts schreibt sie nach
// R2): je Termin eine gzip-Datei, ~0,5 MB bei ruhiger Lage, entpackt
// Schichten × Zeilen × Spalten Byte (gemessen 27 MB). Deshalb bleiben die
// Dateien KOMPRIMIERT im Speicher und nur die zuletzt benutzten entpackt —
// eine Schleife über 3 h wären sonst knapp ein Gigabyte.

import { radarStamp } from '../config/radar'
import { r3dLevelRgba, type R3dIndex } from '../config/radar3d'

const base = () => import.meta.env.BASE_URL
const packed = new Map<number, Promise<ArrayBuffer>>()
const unpacked = new Map<number, Promise<Uint8Array>>()
/** entpackte Stapel im Speicher — der gezeigte und sein Nachbar beim Abspielen */
const UNPACKED_MAX = 3

let indexCache: { at: number; index: Promise<R3dIndex> } | null = null

export function loadR3dIndex(force = false): Promise<R3dIndex> {
  if (!force && indexCache && Date.now() - indexCache.at < 60_000) return indexCache.index
  const index = fetch(`${base()}radar/r3d/index.json`, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`3D-Index: HTTP ${r.status}`)
    return r.json() as Promise<R3dIndex>
  })
  indexCache = { at: Date.now(), index }
  index.catch(() => (indexCache = null))
  return index
}

function loadPacked(time: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  let p = packed.get(time)
  if (!p) {
    p = fetch(`${base()}radar/r3d/${radarStamp(time)}.bin`, { signal }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    packed.set(time, p)
    p.catch(() => packed.delete(time))
  }
  return p
}

/** Entpackter Stapel eines Termins */
export function loadR3dStack(time: number, signal?: AbortSignal): Promise<Uint8Array> {
  const hit = unpacked.get(time)
  if (hit) {
    unpacked.delete(time)
    unpacked.set(time, hit)
    return hit
  }
  const p = loadPacked(time, signal).then(async (buf) => {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  })
  unpacked.set(time, p)
  p.catch(() => unpacked.delete(time))
  while (unpacked.size > UNPACKED_MAX) unpacked.delete(unpacked.keys().next().value!)
  return p
}

/** Alte Termine verwerfen, die nicht mehr in der Schleife stehen */
export function pruneR3d(keep: number[]): void {
  const k = new Set(keep)
  for (const t of packed.keys()) if (!k.has(t)) packed.delete(t)
  for (const t of unpacked.keys()) if (!k.has(t)) unpacked.delete(t)
}

let canvas: HTMLCanvasElement | null = null

/** Eine Höhenschicht eines Termins als Bild (data-URL, wie die übrigen Radarbilder). */
export async function r3dLevelImage(time: number, level: number, signal?: AbortSignal): Promise<string> {
  const [index, stack] = await Promise.all([loadR3dIndex(), loadR3dStack(time, signal)])
  canvas ??= document.createElement('canvas')
  canvas.width = index.width
  canvas.height = index.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('kein Canvas')
  ctx.putImageData(new ImageData(r3dLevelRgba(stack, index, level), index.width, index.height), 0, 0)
  // synchron — bei mehreren parallel ladenden Bildern malt so keines auf
  // die Leinwand eines anderen (dieselbe Überlegung wie in api/dwdRadar.ts)
  return canvas.toDataURL('image/png')
}
