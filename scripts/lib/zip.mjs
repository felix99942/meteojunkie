// ZIP-Archive mit mehreren Einträgen lesen — mit Bordmitteln (zlib), ohne
// Fremdpaket, wie `png.mjs` und der KMZ-Leser in `mosmix.mjs`.
//
// Gelesen wird über das ZENTRALVERZEICHNIS am Dateiende, nicht über die
// lokalen Header: die DWD-Archive des Climate Data Center tragen bis zu 40
// Einträge (Messwerte plus Metadaten), und bei gesetztem Bit 3 stehen die
// Größen nur im Zentralverzeichnis, im lokalen Header als 0. Kann nur
// „stored" (0) und „deflate" (8); alles andere wirft, statt still falsch zu
// lesen. ZIP64 wird nicht unterstützt (die Archive sind wenige MB).

import { inflateRawSync } from 'node:zlib'

/**
 * Einträge eines ZIP-Puffers, deren Name `want` erfüllt → Map Name → Inhalt.
 * @param {Buffer} buf
 * @param {(name: string) => boolean} [want]
 * @returns {Map<string, Buffer>}
 */
export function unzipEntries(buf, want = () => true) {
  // End of central directory: Signatur 0x06054b50, höchstens 64 KB Kommentar
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP — Zentralverzeichnis fehlt')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: kaputter Verzeichniseintrag')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`ZIP: lokaler Header von ${name} fehlt`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + csize)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
    else throw new Error(`ZIP: Kompression ${method} bei ${name} nicht unterstützt`)
  }
  return out
}
