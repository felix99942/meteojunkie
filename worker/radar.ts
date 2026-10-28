// Eigene Radarbilder aus den 3D-Ableitungen des DWD (DMax = Säulenmaximum,
// VIL) — Begründung bei den Produkten in src/config/radar.ts. Läuft aus dem
// Cron des Workers alle 5 Minuten: holt die HDF5-Datei des Termins bei
// opendata.dwd.de (kein CORS, deshalb hier und nicht im Browser), rechnet sie
// auf ein Mercator-Bild in der Farbskala des Produkts und legt es mit einem
// Index in R2 ab. Gemessen 2026-10-28: ~5 Minuten Verzug beim DWD, DMax
// 1,9–2,3 MB, VII ~35 KB je Datei.
//
// **Speicher ist die Grenze, nicht die Rechenzeit.** Ein Worker darf 128 MB
// belegen; DMax sind 4800×4400 Werte à 2 Byte = 42 MB roh, und jsfive liefert
// sie als JS-Array mit 21 Mio. Einträgen (gemessen 167 MB Heap). Deshalb
// liefert jsfive hier nur die METADATEN und die Lage des komprimierten
// Blocks; entpackt wird als Strom (DecompressionStream) und dabei nur jeder
// `stride`-te Punkt behalten — 13 MB statt 167.

import * as hdf5 from 'jsfive'
import {
  OWN_RADAR,
  RADAR_IMAGE_WIDTH,
  ownRadarImageKey,
  radarStamp,
  type OwnRadarIndex,
  type OwnRadarSource,
} from '../src/config/radar'
import type { GeoBox } from '../src/config/wmsTime'
import { listKeys, type R2BucketLike } from './r2'

const DWD_RADAR = 'https://opendata.dwd.de/weather/radar/'
const STEP_MS = 5 * 60_000
/** Wie weit zurück fehlende Termine nachgeholt werden (der DWD hält ~2 Tage vor). */
const BACKFILL_MS = 3 * 3_600_000
/** Höchstens so viele Bilder je Produkt und Lauf — ein Bild ~0,5 s CPU. */
const MAX_PER_RUN = 6
/** So weit reicht der Index (die Schleife zeigt höchstens 3 h). */
const INDEX_MS = 6 * 3_600_000

export async function updateRadar(bucket: R2BucketLike, now = Date.now()): Promise<string> {
  const notes: string[] = []
  // Nacheinander, nicht parallel: zwei entpackte DMax-Felder gleichzeitig
  // kämen dem Speicherlimit nahe
  for (const src of OWN_RADAR) {
    try {
      notes.push(`${src.id}: ${await updateProduct(bucket, src, now)}`)
    } catch (err) {
      notes.push(`${src.id}: Fehler ${err}`)
    }
  }
  return `Radar: ${notes.join(' · ')}`
}

async function updateProduct(bucket: R2BucketLike, src: OwnRadarSource, now: number): Promise<string> {
  const prefix = `radar/${src.id}/`
  const have = new Map<number, string>()
  for (const key of await listKeys(bucket, prefix)) {
    const t = stampTime(key)
    if (t !== null) have.set(t, key)
  }
  const last = Math.floor(now / STEP_MS) * STEP_MS
  const wanted: number[] = []
  for (let t = last; t > now - BACKFILL_MS; t -= STEP_MS) if (!have.has(t)) wanted.push(t)

  let added = 0
  let geo: GeoBox | null = null
  for (const time of wanted.slice(0, MAX_PER_RUN * 3)) {
    if (added >= MAX_PER_RUN) break
    const res = await fetch(`${DWD_RADAR}${src.dir}/${src.prefix}${dwdStamp(time)}-hd5`)
    if (res.status === 404) continue // noch nicht da bzw. ausgefallen
    if (!res.ok) throw new Error(`DWD HTTP ${res.status}`)
    const field = await decodeOdim(await res.arrayBuffer(), src.stride)
    const img = renderMercator(field, src, RADAR_IMAGE_WIDTH)
    await bucket.put(ownRadarImageKey(src.id, time), await encodeIndexedPng(img), {
      httpMetadata: { contentType: 'image/png' },
    })
    have.set(time, ownRadarImageKey(src.id, time))
    geo = img.geo
    added++
  }
  if (added === 0) return 'nichts Neues'

  const index: OwnRadarIndex = {
    stepMs: STEP_MS,
    times: [...have.keys()].filter((t) => t > now - INDEX_MS).sort((a, b) => a - b),
    geo: geo!,
  }
  await bucket.put(`${prefix}index.json`, JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  })
  // Ältere Bilder als der Index räumen — sonst wüchse der Ordner, bis die
  // Lifecycle-Regel des Buckets greift, und jede Auflistung würde teurer
  const old = [...have.entries()].filter(([t]) => t <= now - INDEX_MS).map(([, k]) => k)
  if (old.length) await bucket.delete(old.slice(0, 1000))
  return `${added} neu, ${index.times.length} im Index`
}

/** `202610281815` aus dem Dateinamen des DWD (`…_20261028_1815-hd5`). */
function dwdStamp(time: number): string {
  const s = radarStamp(time) // 20261028T1815Z
  return `${s.slice(0, 8)}_${s.slice(9, 13)}`
}

function stampTime(key: string): number | null {
  const m = /\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z\.png$/.exec(key)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}

// --- HDF5 (ODIM) ---------------------------------------------------------------

export interface OdimField {
  /** Ausgedünntes Gitter, Zeile 0 = Norden. */
  values: Uint16Array
  width: number
  height: number
  stride: number
  gain: number
  offset: number
  nodata: number
  undetect: number
  /** Gitterweite des ORIGINALS in m und die vier Ecken (Außenkanten). */
  xscale: number
  yscale: number
  corners: { UL: [number, number]; UR: [number, number]; LL: [number, number]; LR: [number, number] }
}

// Privates von jsfive, das hier gebraucht wird — mit Versionspin (package.json)
interface JsfiveDataObjects {
  dtype: unknown
  filter_pipeline: Map<string, unknown>[] | null
  _get_chunk_params(): void
  _chunk_address: number | bigint
  /** Blockform je Achse (der Getter; `_chunk_dims` ist nur der Rang + 1). */
  chunks: number[]
}

export async function decodeOdim(buf: ArrayBuffer, stride: number): Promise<OdimField> {
  const f = new hdf5.File(buf, 'radar.h5')
  const ds = f.get('dataset1/data1/data') as unknown as { shape: number[]; _dataobjects: JsfiveDataObjects }
  const attrs = (path: string) => (f.get(path) as unknown as { attrs: Record<string, number> }).attrs
  const what = attrs('dataset1/data1/what')
  const where = attrs('where')
  const [H, W] = ds.shape
  const o = ds._dataobjects
  if (o.dtype !== '<u2') throw new Error(`Datentyp ${String(o.dtype)} statt <u2`)
  const filters = (o.filter_pipeline ?? []).map((m) => Number(m.get('filter_id')))
  if (filters.some((id) => id !== 1)) throw new Error(`Filter ${filters.join(',')} — erwartet nur deflate (1)`)
  o._get_chunk_params()
  const chunks = readChunkBTree(buf, Number(o._chunk_address), ds.shape.length)
  const [ch, cw] = o.chunks

  const w = Math.ceil(W / stride)
  const h = Math.ceil(H / stride)
  const values = new Uint16Array(w * h)
  for (const c of chunks) {
    let stream = new Blob([new Uint8Array(buf, c.address, c.size)]).stream()
    if (filters.length) stream = stream.pipeThrough(new DecompressionStream('deflate'))
    const [r0, c0] = c.offsets
    // Element e im Block → Zeile r0 + e / cw, Spalte c0 + e % cw; laufend
    // mitgezählt statt geteilt, das ist die heiße Schleife (21 Mio. Werte)
    let row = r0
    let col = c0
    let lo = -1 // erstes Byte eines Werts, der über eine Stromgrenze fällt
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value as Uint8Array
      let i = 0
      if (lo >= 0) {
        take(lo | (part[0] << 8))
        lo = -1
        i = 1
      }
      for (; i + 1 < part.length; i += 2) take(part[i] | (part[i + 1] << 8))
      if (i < part.length) lo = part[i]
      if (row >= r0 + ch) break
    }
    function take(v: number) {
      if (row < H && col < W && row % stride === 0 && col % stride === 0) values[(row / stride) * w + col / stride] = v
      if (++col >= c0 + cw) {
        col = c0
        row++
      }
    }
  }
  const corner = (k: string): [number, number] => [where[`${k}_lon`], where[`${k}_lat`]]
  return {
    values, width: w, height: h, stride,
    gain: what.gain, offset: what.offset, nodata: what.nodata, undetect: what.undetect,
    xscale: where.xscale, yscale: where.yscale,
    corners: { UL: corner('UL'), UR: corner('UR'), LL: corner('LL'), LR: corner('LR') },
  }
}

/**
 * B-Baum v1 der Rohdaten-Blöcke (HDF5-Spezifikation, „Version 1 B-trees"):
 * `TREE`, Typ, Ebene, Einträge, zwei Geschwisteradressen, dann im Wechsel
 * Schlüssel (Größe, Filtermaske, rank+1 Offsets) und Kindadressen. Adressen
 * mit 8 Byte — so schreibt es jede gängige HDF5-Bibliothek, und das DWD-
 * Komposit ist genau ein Block.
 */
function readChunkBTree(buf: ArrayBuffer, address: number, rank: number) {
  const view = new DataView(buf)
  const out: { address: number; size: number; offsets: number[] }[] = []
  const visit = (addr: number) => {
    const sig = String.fromCharCode(...new Uint8Array(buf, addr, 4))
    if (sig !== 'TREE') throw new Error('kein B-Baum an der Blockadresse')
    const level = view.getUint8(addr + 5)
    const entries = view.getUint16(addr + 6, true)
    let p = addr + 8 + 16
    for (let e = 0; e < entries; e++) {
      const size = view.getUint32(p, true)
      const offsets: number[] = []
      for (let d = 0; d <= rank; d++) offsets.push(Number(view.getBigUint64(p + 8 + d * 8, true)))
      p += 8 + (rank + 1) * 8
      const child = Number(view.getBigUint64(p, true))
      p += 8
      if (level === 0) out.push({ address: child, size, offsets: offsets.slice(0, rank) })
      else visit(child)
    }
  }
  visit(address)
  return out
}

// --- Bild ----------------------------------------------------------------------

export interface IndexedImage {
  width: number
  height: number
  /** Je Pixel ein Palettenindex; 0 = durchsichtig, 1 = „keine Daten". */
  pixels: Uint8Array
  /** RGBA je Palettenindex. */
  palette: [number, number, number, number][]
  geo: GeoBox
}

const A = 6378137
const B = 6356752.3142451802
const E = Math.sqrt(1 - (B * B) / (A * A))
const LAT_TS = (60 * Math.PI) / 180
const LON_0 = (10 * Math.PI) / 180
const tsf = (phi: number) =>
  Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2)
const MTS = Math.cos(LAT_TS) / Math.sqrt(1 - E * E * Math.sin(LAT_TS) ** 2)
const TTS = tsf(LAT_TS)

/**
 * Polarstereografisch wie im `projdef` der Dateien (+lat_ts=60 +lon_0=10,
 * WGS84) — OHNE x_0/y_0: die Lage im Gitter kommt aus der Ecke UL, deren
 * Außenkante bei den gemessenen Dateien genau auf (0, 0) des Gitters liegt.
 */
export function stereo(lonDeg: number, latDeg: number): [number, number] {
  const lon = (lonDeg * Math.PI) / 180
  const r = (A * MTS * tsf((latDeg * Math.PI) / 180)) / TTS
  return [r * Math.sin(lon - LON_0), -r * Math.cos(lon - LON_0)]
}

const parseLabel = (s: string) => Number(s.replace(',', '.'))
const hex = (c: string): [number, number, number, number] => [
  parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255,
]

/** Gitter → Mercator-Bild in der Farbskala des Produkts (nächster Nachbar). */
export function renderMercator(field: OdimField, src: OwnRadarSource, width: number): IndexedImage {
  const c = field.corners
  const geo: GeoBox = {
    west: Math.min(c.UL[0], c.LL[0]),
    east: Math.max(c.UR[0], c.LR[0]),
    south: Math.min(c.LL[1], c.LR[1]),
    north: Math.max(c.UL[1], c.UR[1]),
  }
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const m0 = merc(geo.south)
  const m1 = merc(geo.north)
  const height = Math.round((width * (m1 - m0)) / (((geo.east - geo.west) * Math.PI) / 180))
  const [ox, oy] = stereo(c.UL[0], c.UL[1])
  const cell = field.xscale * field.stride
  const cellY = field.yscale * field.stride
  const thresholds = src.legend.map((s) => parseLabel(s.label))
  const palette: [number, number, number, number][] = [[0, 0, 0, 0], [125, 125, 125, 128], ...src.legend.map((s) => hex(s.color))]
  // Rohwert → Palettenindex einmal je möglichem Wert (65.536), nicht je Pixel
  const lut = new Uint8Array(65536)
  for (let v = 0; v < 65536; v++) {
    if (v === field.nodata) lut[v] = 1
    else if (v === field.undetect) lut[v] = 0
    else {
      const x = v * field.gain + field.offset
      let k = -1
      while (k + 1 < thresholds.length && x >= thresholds[k + 1]) k++
      lut[v] = k < 0 ? 0 : k + 2
    }
  }
  const pixels = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) {
    const lat = (Math.atan(Math.sinh(m1 - ((j + 0.5) / height) * (m1 - m0))) * 180) / Math.PI
    for (let i = 0; i < width; i++) {
      const lon = geo.west + ((i + 0.5) / width) * (geo.east - geo.west)
      const [x, y] = stereo(lon, lat)
      const gx = Math.floor((x - ox) / cell)
      const gy = Math.floor((oy - y) / cellY)
      if (gx < 0 || gy < 0 || gx >= field.width || gy >= field.height) continue
      pixels[j * width + i] = lut[field.values[gy * field.width + gx]]
    }
  }
  return { width, height, pixels, palette, geo }
}

// --- PNG (indiziert) -----------------------------------------------------------

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(bytes: Uint8Array): number {
  let c = -1
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * Indiziertes PNG (Farbtyp 3) mit tRNS für die Deckkraft: 1 Byte je Pixel
 * statt 4 — die Skala hat höchstens 19 Farben.
 */
export async function encodeIndexedPng(img: IndexedImage): Promise<Uint8Array> {
  const { width, height, pixels, palette } = img
  const raw = new Uint8Array((width + 1) * height)
  for (let j = 0; j < height; j++) raw.set(pixels.subarray(j * width, (j + 1) * width), j * (width + 1) + 1)
  const deflated = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  )
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, 3, 0, 0, 0], 8)
  const plte = new Uint8Array(palette.flatMap(([r, g, b]) => [r, g, b]))
  const trns = new Uint8Array(palette.map(([, , , a]) => a))
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', deflated), chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
