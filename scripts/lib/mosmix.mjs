// MOSMIX-Parser (DWD Point-Forecast KML in KMZ). Backend-neutral: nutzbar aus
// einem GitHub-Action-Ingest ebenso wie aus einem Serverless-Worker.
//
// KMZ ist ein ZIP mit genau EINER KML-Datei. Node hat keinen ZIP-Reader, aber
// die einzelne Datei lässt sich über den lokalen ZIP-Header + zlib.inflateRaw
// entpacken (kein externes Paket nötig). Die KML ist maschinell erzeugt und
// regulär — die relevanten Felder werden gezielt extrahiert.

import { inflateRawSync } from 'node:zlib'

/** Erste Datei aus einem KMZ/ZIP-Buffer entpacken (Store oder Deflate). */
export function unzipSingle(buf) {
  // Lokaler Datei-Header: Signatur 'PK\x03\x04'
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Kein ZIP (KMZ) — Signatur fehlt')
  const method = buf.readUInt16LE(8)
  let compSize = buf.readUInt32LE(18)
  const nameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  const dataStart = 30 + nameLen + extraLen
  // Central-Directory-Start finden (Signatur 'PK\x01\x02'), begrenzt die Daten,
  // falls compSize im lokalen Header 0 ist (Data-Descriptor-Flag).
  if (!compSize) {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart)
    compSize = (cd < 0 ? buf.length : cd) - dataStart
  }
  const data = buf.subarray(dataStart, dataStart + compSize)
  const out = method === 0 ? data : inflateRawSync(data)
  return out.toString('utf-8')
}

/** Alle <dwd:TimeStep>-Werte (ISO-Zeitstempel) aus der KML. */
function parseTimeSteps(kml) {
  const block = kml.match(/<dwd:ForecastTimeSteps>([\s\S]*?)<\/dwd:ForecastTimeSteps>/)
  if (!block) return []
  return [...block[1].matchAll(/<dwd:TimeStep>([^<]+)<\/dwd:TimeStep>/g)].map((m) => m[1])
}

/** MOSMIX-Fehlkennung → null; sonst Zahl. */
function num(tok) {
  if (tok === '-' || tok === '---' || tok === '') return null
  const v = Number(tok)
  return Number.isFinite(v) ? v : null
}

/**
 * KML parsen. `wanted` = Menge der Element-Codes (z.B. new Set(['TTT','TX'])).
 * Rückgabe: { timeSteps:[iso…], stations: { id: { code: (number|null)[] } } }.
 */
export function parseMosmixKml(kml, wanted) {
  const timeSteps = parseTimeSteps(kml)
  const stations = {}
  // Placemarks isolieren
  for (const pm of kml.split('<kml:Placemark>').slice(1)) {
    const nameM = pm.match(/<kml:name>([^<]+)<\/kml:name>/)
    if (!nameM) continue
    const id = nameM[1].trim()
    const byCode = {}
    for (const fc of pm.matchAll(
      /<dwd:Forecast\s+dwd:elementName="([^"]+)"[^>]*>\s*<dwd:value>([\s\S]*?)<\/dwd:value>/g,
    )) {
      const code = fc[1]
      if (wanted && !wanted.has(code)) continue
      byCode[code] = fc[2].trim().split(/\s+/).map(num)
    }
    if (Object.keys(byCode).length) stations[id] = byCode
  }
  return { timeSteps, stations }
}
