// Lädt das Windvolumen der 3D-Partikel. Die Dateien liegen gzip-gepackt unter `.bin`,
// der Browser packt sie selbst aus (wie die 3D-Radarbilder).

import type { Wind3dField, Wind3dGrid } from '../config/wind3d'

const BASE = `${import.meta.env.BASE_URL}nwp/icon-d2-section/`
/** Felder im Speicher (je rund 1,8 MB) */
const FIELD_LRU = 6

export interface Wind3dMeta {
  runId: string
  run: string
  steps: number[]
  wind3d?: Wind3dGrid
}

async function gunzip(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

export async function loadWind3dMeta(): Promise<Wind3dMeta | null> {
  // no-cache: die Datei wechselt mit jedem Lauf unter derselben Adresse
  const r = await fetch(`${BASE}meta.json`, { cache: 'no-cache' }).catch(() => null)
  if (!r?.ok) return null
  return (r.json() as Promise<Wind3dMeta>).catch(() => null)
}

const heights = new Map<string, Promise<Int16Array>>()
const fields = new Map<string, Promise<Wind3dField>>()

function loadHeights(runId: string): Promise<Int16Array> {
  let p = heights.get(runId)
  if (!p) {
    p = gunzip(`${BASE}${runId}/wind3d/grid.bin`).then((b) => new Int16Array(b))
    p.catch(() => heights.delete(runId))
    heights.clear()
    heights.set(runId, p)
  }
  return p
}

export function loadWind3dField(meta: Wind3dMeta, grid: Wind3dGrid, step: number): Promise<Wind3dField> {
  const key = `${meta.runId}/${step}`
  let p = fields.get(key)
  if (p) {
    fields.delete(key)
  } else {
    p = Promise.all([
      gunzip(`${BASE}${meta.runId}/wind3d/${String(step).padStart(3, '0')}.bin`),
      loadHeights(meta.runId),
    ]).then(([wind, z]) => ({ grid, wind: new Int8Array(wind), heights: z }))
    p.catch(() => fields.delete(key))
  }
  fields.set(key, p)
  if (fields.size > FIELD_LRU) fields.delete(fields.keys().next().value as string)
  return p
}
