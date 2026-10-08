// Laden der Modellkarten-Daten (ECMWF IFS, ICON-EU, ICON-D2), erzeugt von
// `scripts/ecmwf-ingest.py` bzw. `scripts/icon-ingest.py`.
//
// Alles same-origin unter `public/nwp/<modell>/`, kein Fremddienst, kein
// Open-Meteo-Budget. Die Wertebilder tragen den Lauf im PFAD und ändern sich
// nie mehr — der HTTP-Cache des Browsers ist damit die richtige Ablage, ein
// eigener IndexedDB-Cache brächte nichts dazu. Begrenzt werden muss nur der
// ARBEITSSPEICHER: ein dekodiertes Feld sind 1,8–2 MB Codes, ein Lauf über
// alle Größen wären Hunderte MB. Deshalb ein kleiner LRU über die Felder.

import { decodeCodes, decodeRgb3, decodeUv8, type GlobeField, type GlobeMeta, type GlobeModelId, type GlobeVarId } from '../config/globe'

const BASE = `${import.meta.env.BASE_URL}nwp/`

/** Höchstzahl dekodierter Felder im Speicher (~2 MB je Feld). */
const FIELD_LRU = 24

export async function loadGlobeMeta(model: GlobeModelId): Promise<GlobeMeta> {
  // `no-cache`: die Datei wechselt mit jedem Lauf unter derselben URL —
  // revalidieren, sonst zeigt der Browser bis zu zehn Minuten den alten Lauf
  // (GitHub Pages schickt max-age=600).
  const r = await fetch(`${BASE}${model}/meta.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as GlobeMeta
}

const metas = new Map<GlobeModelId, GlobeMeta>()
const fields = new Map<string, Promise<GlobeField>>()

/** Der Lader braucht `lo`/`step`/Raster aus der Meta — der Bereich setzt sie nach dem Laden. */
export function setGlobeMeta(meta: GlobeMeta): void {
  const old = metas.get(meta.model)
  if (old && old.runId !== meta.runId) {
    for (const k of [...fields.keys()]) if (k.startsWith(`${meta.model}/`)) fields.delete(k)
  }
  metas.set(meta.model, meta)
}

export function globeFieldUrl(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): string {
  return `${BASE}${model}/${runId}/${varId}/${String(step).padStart(3, '0')}.webp`
}

async function decodeImage(blob: Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  // Ohne Farbraumumrechnung und ohne Vormultiplikation — sonst sind die
  // Kanäle keine Codes mehr, sondern „ähnliche Farben".
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const { width: w, height: h } = bmp
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('kein 2D-Kontext')
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}

export function loadGlobeField(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): Promise<GlobeField> {
  const meta = metas.get(model)
  const vm = meta?.variables[varId]
  if (!meta || meta.runId !== runId || !vm) return Promise.reject(new Error(`kein Feld ${model}/${runId}/${varId}/${step}`))
  const key = `${model}/${runId}/${varId}/${step}`
  const hit = fields.get(key)
  if (hit) {
    // LRU: Zugriff ans Ende
    fields.delete(key)
    fields.set(key, hit)
    return hit
  }
  const p = (async () => {
    const r = await fetch(globeFieldUrl(model, runId, varId, step))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { data, w, h } = await decodeImage(await r.blob())
    if (w !== meta.grid.ni || h !== meta.grid.nj) throw new Error(`Raster ${w}×${h} statt ${meta.grid.ni}×${meta.grid.nj}`)
    if (vm.encoding === 'uv8') {
      return { grid: meta.grid, lo: vm.lo, step: vm.step, codes: new Uint16Array(0), uv: decodeUv8(data, w * h) }
    }
    if (vm.encoding === 'rgb3') {
      return { grid: meta.grid, lo: vm.lo, step: vm.step, codes: new Uint16Array(0), rgb: decodeRgb3(data, w * h) }
    }
    return { grid: meta.grid, lo: vm.lo, step: vm.step, codes: decodeCodes(data, w * h) }
  })()
  // Ein gescheiterter Abruf darf nicht für die Sitzung im Cache kleben
  p.catch(() => fields.get(key) === p && fields.delete(key))
  fields.set(key, p)
  while (fields.size > FIELD_LRU) fields.delete(fields.keys().next().value!)
  return p
}
