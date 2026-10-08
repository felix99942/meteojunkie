// Rechen-Worker der Modellkarten: dekodiert Felder und rechnet Kacheln
// (Farbfläche, Wolkenschichten, Isolinien) ABSEITS des Hauptthreads.
//
// Vorher lief das alles im Kachelprotokoll auf dem Hauptthread, gemessen
// (2026-10-08, IFS-Globus mit Isobaren, 10 Zeitschritte): ~220 ms Dekodieren
// (`getImageData`/`drawImage`/`decodeCodes`), ~100 ms Glätten, ~65 ms Kacheln
// — in Blöcken, in denen die Kugel stand. Hier läuft dieselbe Rechnung,
// mehrere Worker parallel (`globePool.ts`), zurück geht ein ImageBitmap als
// Transfer, also ohne Kopie.
//
// ZUSTANDSLOS bis auf Caches: jede Anfrage trägt URL, Raster und Kodierung
// selbst mit. Damit braucht der Worker keine Meta und kann nie mit einem
// veralteten Lauf rechnen — der Lauf steht in der URL, und die ist der
// Schlüssel.
//
// ABBRUCH: Aufträge laufen über eine eigene Schlange, je Auftrag ein
// Makrotask. Sonst käme eine `cancel`-Nachricht erst an die Reihe, wenn alle
// vorher eingetroffenen Kacheln schon gerechnet sind — beim schnellen
// Durchblättern genau der Rückstau, den der Abbruch verhindern soll.

import { decodeCodes, decodeRgb3, decodeUv8, getGlobeVariable, type GlobeField } from '../config/globe'
import { colorizeRgbTile, colorizeTile, GLOBE_TILE_SIZE } from './globeTiles'
import { CONTOUR_STYLES, contourTile, smoothField } from './globeContours'
import type { FieldSource, WorkerRequest, WorkerResponse } from './globePool'

/** Dekodierte Felder je Worker (~2 MB Codes, bei Isolinien +4 MB geglättet). */
const FIELD_LRU = 10
const fields = new Map<string, Promise<GlobeField>>()

function loadField(src: FieldSource): Promise<GlobeField> {
  const hit = fields.get(src.url)
  if (hit) {
    fields.delete(src.url)
    fields.set(src.url, hit)
    return hit
  }
  const p = (async () => {
    const r = await fetch(src.url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    // Ohne Farbraumumrechnung und ohne Vormultiplikation — sonst sind die
    // Kanäle keine Codes mehr, sondern „ähnliche Farben".
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const { width: w, height: h } = bmp
    const { ni, nj } = src.grid
    if (w !== ni || h !== nj) {
      bmp.close()
      throw new Error(`Raster ${w}×${h} statt ${ni}×${nj}`)
    }
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('kein 2D-Kontext')
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const data = ctx.getImageData(0, 0, w, h).data
    const base = { grid: src.grid, lo: src.lo, step: src.step }
    if (src.encoding === 'uv8') return { ...base, codes: new Uint16Array(0), uv: decodeUv8(data, w * h) }
    if (src.encoding === 'rgb3') return { ...base, codes: new Uint16Array(0), rgb: decodeRgb3(data, w * h) }
    return { ...base, codes: decodeCodes(data, w * h) }
  })()
  // Ein gescheiterter Abruf darf nicht im Cache kleben
  p.catch(() => fields.get(src.url) === p && fields.delete(src.url))
  fields.set(src.url, p)
  while (fields.size > FIELD_LRU) fields.delete(fields.keys().next().value!)
  return p
}

/** Linien plus Beschriftung; unter der Zahl wird die Linie AUSGESPART, wie in jeder gedruckten Wetterkarte. */
function drawContourTile(
  rgba: Uint8ClampedArray,
  labels: { x: number; y: number; text: string }[],
  style: (typeof CONTOUR_STYLES)[keyof typeof CONTOUR_STYLES],
): ImageBitmap {
  const size = GLOBE_TILE_SIZE
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0)
  ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const l of labels) {
    const w = ctx.measureText(l.text).width
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillRect(l.x - w / 2 - 3, l.y - 7, w + 6, 14)
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = 3
    ctx.strokeStyle = `rgba(${style.halo.join(',')},0.85)`
    ctx.strokeText(l.text, l.x, l.y)
    ctx.fillStyle = `rgb(${style.core.join(',')})`
    ctx.fillText(l.text, l.x, l.y)
  }
  return canvas.transferToImageBitmap()
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

const cancelled = new Set<number>()
const queue: Extract<WorkerRequest, { type: 'tile' | 'field' }>[] = []
let pumping = false

function schedule(): void {
  if (pumping || queue.length === 0) return
  pumping = true
  setTimeout(pump, 0)
}

async function pump(): Promise<void> {
  const job = queue.shift()
  try {
    if (job) await run(job)
  } finally {
    pumping = false
    schedule()
  }
}

async function run(job: Extract<WorkerRequest, { type: 'tile' | 'field' }>): Promise<void> {
  const { id } = job
  if (cancelled.delete(id)) return post({ id, aborted: true })
  try {
    if (job.type === 'field') {
      const f = await loadField(job.src)
      // Ohne `reply` nur vorwärmen (Vorladen): das Feld bleibt im Worker,
      // nichts wird kopiert
      if (!job.reply) return post({ id, ok: true })
      // KOPIEN übertragen — das Original bleibt hier im Cache für die Kacheln
      const out: GlobeField = { grid: f.grid, lo: f.lo, step: f.step, codes: f.codes.slice() }
      if (f.rgb) out.rgb = f.rgb.slice()
      if (f.uv) out.uv = f.uv.slice()
      const tr: Transferable[] = [out.codes.buffer]
      if (out.rgb) tr.push(out.rgb.buffer)
      if (out.uv) tr.push(out.uv.buffer)
      return post({ id, field: out }, tr)
    }
    const f = await loadField(job.src)
    if (cancelled.delete(id)) return post({ id, aborted: true })
    const { z, x, y } = job
    let bmp: ImageBitmap
    if (job.contour) {
      const smooth = smoothField(f, job.contour.smooth)
      if (cancelled.delete(id)) return post({ id, aborted: true })
      const style = CONTOUR_STYLES[job.contour.id]
      const { rgba, labels } = contourTile(f, smooth, job.contour.interval, style, z, x, y, GLOBE_TILE_SIZE)
      bmp = drawContourTile(rgba, labels, style)
    } else {
      const rgba = f.rgb ? colorizeRgbTile(f, z, x, y) : colorizeTile(f, getGlobeVariable(job.varId).scale, z, x, y)
      bmp = await createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, GLOBE_TILE_SIZE, GLOBE_TILE_SIZE))
    }
    post({ id, bitmap: bmp }, [bmp])
  } catch (e) {
    post({ id, error: e instanceof Error ? e.message : String(e) })
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.type === 'cancel') {
    // Steht der Auftrag noch in der Schlange, gleich herausnehmen
    const i = queue.findIndex((j) => j.id === msg.id)
    if (i >= 0) {
      queue.splice(i, 1)
      post({ id: msg.id, aborted: true })
    } else {
      cancelled.add(msg.id)
      // Kam die Abbestellung zu spät (Antwort schon unterwegs), bliebe die
      // Nummer sonst für immer stehen
      if (cancelled.size > 512) cancelled.clear()
    }
    return
  }
  queue.push(msg)
  schedule()
}
