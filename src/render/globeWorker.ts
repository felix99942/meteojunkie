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
const FIELD_LRU = 16
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

/**
 * Beschriftung OHNE Canvas je Kachel. Gemessen (2026-11-02, IFS-Globus mit
 * Isobaren): das Zeichnen einer Linienkachel über ein OffscreenCanvas
 * (Pixel einsetzen, Zahlen, `transferToImageBitmap`) kostete immer wieder
 * ~90–100 ms, im Takt von ~100 ms — das beschleunigte Canvas im Worker wartet
 * auf den GPU-Prozess. Die Linien selbst kosten 3–7 ms. 34 Kacheln je
 * Zeitschritt dauerten so 2,6 s, und daran hing das Weiterblättern.
 * Ein wiederverwendetes Canvas änderte nichts (gemessen).
 *
 * Deshalb wie bei den Farbkacheln: die Pixel werden selbst geschrieben. Die
 * Ziffern samt Halo werden EINMAL je Worker und Linienart auf einem
 * CPU-Canvas (`willReadFrequently`) gerastert und als RGBA gemerkt, danach
 * nur noch kopiert. Ziffern sind gleich breit, Kerning entfällt.
 */
interface Glyph {
  w: number
  h: number
  /** Vorschub ohne Rand */
  adv: number
  data: Uint8ClampedArray
}
const GLYPH_PAD = 3
const GLYPH_H = 16
const GLYPH_CHARS = '0123456789-'
const glyphSets = new Map<string, Map<string, Glyph>>()

function glyphsFor(style: (typeof CONTOUR_STYLES)[keyof typeof CONTOUR_STYLES]): Map<string, Glyph> {
  const key = `${style.core}/${style.halo}`
  const hit = glyphSets.get(key)
  if (hit) return hit
  const ctx = new OffscreenCanvas(32, GLYPH_H).getContext('2d', { willReadFrequently: true })!
  const set = new Map<string, Glyph>()
  for (const ch of GLYPH_CHARS) {
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'
    const adv = ctx.measureText(ch).width
    const w = Math.ceil(adv) + 2 * GLYPH_PAD
    ctx.canvas.width = w // setzt den Zustand zurück — Schrift danach neu
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = `rgba(${style.halo.join(',')},0.85)`
    ctx.strokeText(ch, GLYPH_PAD, GLYPH_H / 2)
    ctx.fillStyle = `rgb(${style.core.join(',')})`
    ctx.fillText(ch, GLYPH_PAD, GLYPH_H / 2)
    set.set(ch, { w, h: GLYPH_H, adv, data: ctx.getImageData(0, 0, w, GLYPH_H).data })
  }
  glyphSets.set(key, set)
  return set
}

/** Linien plus Beschriftung; unter der Zahl wird die Linie AUSGESPART, wie in jeder gedruckten Wetterkarte. */
function drawContourTile(
  rgba: Uint8ClampedArray,
  labels: { x: number; y: number; text: string }[],
  style: (typeof CONTOUR_STYLES)[keyof typeof CONTOUR_STYLES],
): Promise<ImageBitmap> {
  const size = GLOBE_TILE_SIZE
  const glyphs = glyphsFor(style)
  for (const l of labels) {
    const chars = [...l.text].map((c) => glyphs.get(c)).filter((g): g is Glyph => g != null)
    const width = chars.reduce((s, g) => s + g.adv, 0)
    // Aussparung unter der Zahl
    const x0 = Math.max(0, Math.round(l.x - width / 2 - 3))
    const x1 = Math.min(size, Math.round(l.x + width / 2 + 3))
    const y0 = Math.max(0, Math.round(l.y - 7))
    const y1 = Math.min(size, Math.round(l.y + 7))
    for (let yy = y0; yy < y1; yy++) rgba.fill(0, 4 * (yy * size + x0), 4 * (yy * size + x1))
    // Ziffern darüber, „source-over" nicht vormultipliziert
    let pen = l.x - width / 2
    for (const g of chars) {
      const gx = Math.round(pen) - GLYPH_PAD
      const gy = Math.round(l.y - GLYPH_H / 2)
      for (let j = 0; j < g.h; j++) {
        const ty = gy + j
        if (ty < 0 || ty >= size) continue
        for (let i = 0; i < g.w; i++) {
          const tx = gx + i
          if (tx < 0 || tx >= size) continue
          const s = 4 * (j * g.w + i)
          const sa = g.data[s + 3] / 255
          if (sa === 0) continue
          const d = 4 * (ty * size + tx)
          const da = rgba[d + 3] / 255
          const oa = sa + da * (1 - sa)
          for (let k = 0; k < 3; k++) rgba[d + k] = (g.data[s + k] * sa + rgba[d + k] * da * (1 - sa)) / oa
          rgba[d + 3] = oa * 255
        }
      }
      pen += g.adv
    }
  }
  return createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, size, size))
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

/**
 * Nächster Auftrag: sichtbare Kacheln und Felder vor VORGELADENEN — ein
 * Vorladen darf das, was gerade gezeigt werden soll, nie aufhalten.
 */
function next(): (typeof queue)[number] | undefined {
  const i = queue.findIndex((j) => !(j.type === 'tile' && j.low))
  return queue.splice(i >= 0 ? i : 0, 1)[0]
}

async function pump(): Promise<void> {
  const job = next()
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
      bmp = await drawContourTile(rgba, labels, style)
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
