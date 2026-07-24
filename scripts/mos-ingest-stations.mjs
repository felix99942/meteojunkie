// Ingest des DACH-MOSMIX-Stationskatalogs (Vorhersage-Modus der Klimakarte).
//
// DWD veröffentlicht den MOSMIX-Stationskatalog als Fixed-Width-Textdatei. Wir
// filtern auf den DACH-Raum (Deutschland/Österreich/Schweiz + Grenzstationen)
// und legen eine statische Liste ab — analog zu den TAWES-Stammdaten. NUR fürs
// MOS/Vorhersage; die Klimadaten bleiben Österreich/TAWES.
//
//   node scripts/mos-ingest-stations.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CATALOG =
  'https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_stationskatalog.cfg?view=nasPublication&nn=16102'

// DACH-Bounding-Box (mit etwas Grenzpuffer).
const BBOX = { latMin: 45.5, latMax: 55.2, lonMin: 5.5, lonMax: 17.4 }

/**
 * DWD-Katalog-Koordinaten stehen als Grad+Dezimalminuten (DD.MM), NICHT als
 * Dezimalgrad: 48.15 = 48° 15′ = 48,25°. Umrechnen: Ganzteil = Grad, Nachkomma
 * als Minuten/60.
 */
function ddmmToDecimal(v) {
  const deg = Math.trunc(v)
  const min = Math.round((v - deg) * 100) // Nachkommastellen sind Bogenminuten
  return deg + min / 60
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mos')

async function main() {
  process.stdout.write(`Lade MOSMIX-Katalog …\n`)
  const res = await fetch(CATALOG)
  if (!res.ok) throw new Error(`Katalog HTTP ${res.status}`)
  // Datei ist latin-1 kodiert.
  const buf = new Uint8Array(await res.arrayBuffer())
  const text = new TextDecoder('latin1').decode(buf)
  const lines = text.split(/\r?\n/)

  const stations = []
  for (const ln of lines.slice(2)) {
    const id = ln.slice(0, 5).trim()
    if (!id || ln.startsWith('-')) continue
    // Name kann Leerzeichen enthalten; die letzten 3 Tokens sind LAT LON ELEV.
    const rest = ln.slice(11).trim()
    const toks = rest.split(/\s+/)
    if (toks.length < 4) continue
    const elev = Number(toks[toks.length - 1])
    const lonRaw = Number(toks[toks.length - 2])
    const latRaw = Number(toks[toks.length - 3])
    if (!Number.isFinite(latRaw) || !Number.isFinite(lonRaw)) continue
    const lat = ddmmToDecimal(latRaw)
    const lon = ddmmToDecimal(lonRaw)
    if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) continue
    const name = toks.slice(0, -3).join(' ')
    const icao = ln.slice(6, 10).trim()
    stations.push({ id, icao: icao || null, name, lat, lon, altitude: Number.isFinite(elev) ? elev : null })
  }

  if (stations.length < 500) throw new Error(`Unerwartet wenige Stationen (${stations.length}) — Abbruch`)
  process.stdout.write(`DACH-MOSMIX-Stationen: ${stations.length}\n`)

  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'stations.json'),
    JSON.stringify({ meta: { source: CATALOG, region: 'DACH', license: 'DWD/CDC, GeoNutzV' }, stations }, null, 0),
  )
  process.stdout.write(`Geschrieben: public/mos/stations.json\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
