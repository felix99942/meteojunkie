// Minimaler PNG-Leser/-Schreiber mit Bordmitteln (zlib ist in Node eingebaut).
//
// BEWUSST KEIN FREMDPAKET — dieselbe Entscheidung wie beim KMZ-Parser des
// MOSMIX-Ingests (scripts/lib/mosmix.mjs): gebraucht wird genau ein
// PNG-Unterfall, und ein Ingest-Skript soll keine Abhängigkeit in die
// Projektwurzel ziehen, die im Browser-Bundle ohnehin nichts verloren hat.
//
// Gelesen wird deshalb NUR, was die Terrarium-Kacheln liefern (live geprüft
// 2026-09-20: 8 Bit, Farbtyp 2 = RGB, nicht interlaced), geschrieben NUR, was
// das Relief braucht (8 Bit, Farbtyp 3 = Palette). Alles andere wirft — ein
// stillschweigend falsch gelesenes Bild wäre schlimmer als ein Abbruch.

import { deflateSync, inflateSync } from 'node:zlib'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// CRC32 nach PNG-Spezifikation (Tabelle einmalig).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Paeth-Prädiktor (PNG-Filter 4). */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * PNG → { width, height, rgb } mit rgb als Uint8Array (3 Bytes je Pixel).
 * Akzeptiert ausschliesslich 8-Bit-RGB ohne Interlacing.
 */
export function decodeRgbPng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('kein PNG')
  let width = 0
  let height = 0
  const idat = []
  let pos = 8
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      const color = data[9]
      const interlace = data[12]
      if (depth !== 8 || color !== 2 || interlace !== 0) {
        throw new Error(`PNG-Variante nicht unterstuetzt (depth=${depth} color=${color} interlace=${interlace})`)
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 3
  const stride = width * bpp
  const out = new Uint8Array(width * height * bpp)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const o = y * stride
    const prev = o - stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = y > 0 && x >= bpp ? out[prev + x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) v += paeth(a, b, c)
      else if (filter !== 0) throw new Error(`unbekannter PNG-Filter ${filter}`)
      out[o + x] = v & 0xff
    }
  }
  return { width, height, rgb: out }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/**
 * Indiziertes PNG schreiben. `index` ist ein Byte je Pixel, `palette` eine
 * Liste `[r, g, b, a]`; ein a < 255 erzeugt einen tRNS-Chunk.
 *
 * Filter 0 (None) für jede Zeile: das Bild besteht aus wenigen grossen
 * Flächen gleicher Farbe, die deflate ohnehin gut packt — ein Prädiktor
 * brächte hier nichts und machte den Schreiber komplizierter.
 */
export function encodeIndexedPng(width, height, index, palette) {
  if (palette.length > 256) throw new Error('Palette zu gross')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // Bittiefe
  ihdr[9] = 3 // Farbtyp: Palette
  const plte = Buffer.alloc(palette.length * 3)
  palette.forEach((c, i) => {
    plte[i * 3] = c[0]
    plte[i * 3 + 1] = c[1]
    plte[i * 3 + 2] = c[2]
  })
  const alphas = palette.map((c) => (c[3] == null ? 255 : c[3]))
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    Buffer.from(index.buffer, index.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1)
  }
  const chunks = [SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)]
  if (alphas.some((a) => a < 255)) chunks.push(chunk('tRNS', Buffer.from(alphas)))
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}
