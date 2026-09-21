// Erzeugt den NATÜRLICHEN UNTERGRUND der Bildkarten (Satellit): die Erde, wie
// sie aus dem All aussieht — wolkenfrei, echte Farben.
//
// Aufruf: `node scripts/build-ground.mjs [--width N] [--out pfad]`
//
// QUELLE ist **Blue Marble: Next Generation** der NASA über GIBS
// (Global Imagery Browse Services): ein wolkenfreies Monatskomposit aus
// MODIS-Daten, 500 m am Boden, nahtlos über die ganze Erde. Gemessen
// (2026-09-21): HTTP 200, `access-control-allow-origin: *`, kein Key, keine
// Zeitdimension — ein statisches Bild, das sich nie ändert.
//
// **WARUM NICHT DAS SCHÄRFERE LANDSAT-KOMPOSIT**: `Landsat_WELD_Corrected
// Reflectance_TrueColor_Global_Annual` hat 30 m und sieht in der Fläche
// besser aus, zeigt über unserem Ausschnitt aber genau die Fehler, für die
// diese Jahreskomposite bekannt sind — live geprüft: ein schwarzes Loch plus
// ein Wolkenfeld über Nordsee und Dänemark und sichtbare Szenenkanten quer
// über Deutschland. Als HINTERGRUND ist eine nahtlose, etwas weichere Fläche
// mehr wert als eine scharfe mit Löchern: sie soll einordnen, nicht
// abgelesen werden — dieselbe Überlegung wie beim Höhenrelief.
//
// **WARUM EIN BILD UND KEIN TILE-DIENST**: dieselbe Entscheidung wie überall
// (siehe `render/basemap.ts` und `build-relief.mjs`) — kein Key, kein fremdes
// Rate-Limit, und MapLibres `load`-Event hängt nicht an Requests, die uns
// nicht gehören. Der Untergrund ist statisch, also gehört er als Asset ins
// Repo.
//
// **WARUM DIE WMS-ANTWORT UNVERÄNDERT AUF DIE PLATTE GEHT**: der Dienst
// rendert in EPSG:3857, und MapLibres image-source spannt ein Bild LINEAR im
// Mercator-Raum auf — die Antwort IST also schon das Zielraster. Es wird
// nichts dekodiert und nichts neu kodiert (JPEG schreiben könnte dieses
// Projekt ohne Fremdpaket auch gar nicht, siehe `lib/png.mjs`).
//
// ZWEI BILDER, und sie haben verschiedene Aufgaben:
//
//   `europe-ground.jpg`  NEBEN dem Satellitenbild, als Kartenhintergrund.
//     Ausschnitt exakt das Fenster des Höhenreliefs (Kachelgrenzen der
//     Zoomstufe 6, x 29…40, y 14…26 — die zweite Zahl ist wie dort die
//     ÄUSSERE Kante, nicht die letzte Kachel), damit beide Hintergründe
//     deckungsgleich und austauschbar sind. Gemessen: 1280 px → 213 KB
//     (5381 m/px), 1536 → 296 KB, **2048 → 485 KB (3363 m/px ≈ 2,1 km/px am
//     Boden)**, 2560 → 747 KB. Gewählt sind 2048 — die Fläche ist
//     Hintergrund und grösstenteils verdeckt.
//
//   `dach-ground.jpg`    UNTER den Wolken, im Bild selbst (siehe
//     `render/cloudComposite.ts`). Hier zählt Schärfe: der Untergrund steht
//     neben gestochenen Wolkenkanten, und eine weiche Fläche daneben sieht
//     falsch aus. Ausschnitt ist die Detailfläche der HRFI-Kanäle
//     (`SATELLITE_DETAIL_AREA`), Breite **1600 px = 974 m/px** und 543 KB.
//     Gegenprobe am fertigen Komposit: mit dem Europa-Bild (4,3-fach
//     hochskaliert) verschwimmen die Alpentäler zu einer Fläche, mit 1600 px
//     stehen Grate und Schneefelder unter den Wolken; 2000 px (803 KB)
//     brachten im selben Ausschnitt nichts Sichtbares mehr.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi'
const LAYER = 'BlueMarble_NextGeneration'

// Kachelfenster der Zoomstufe 6 — dieselben Zahlen wie in `config/relief.ts`.
const TILES = { zoom: 6, x0: 29, x1: 40, y0: 14, y1: 26 }

/**
 * Die beiden Bilder. `bounds` in Grad; beim Europa-Bild werden sie aus dem
 * Kachelfenster gerechnet, damit sie nicht gegen das Relief driften.
 */
const AREAS = [
  { id: 'europe', tiles: TILES, width: 2048, out: 'europe-ground.jpg' },
  {
    id: 'detail',
    // = SATELLITE_DETAIL_AREA in `config/satellite.ts`; `ground.test.ts`
    // hält die beiden gegeneinander.
    bounds: { lonMin: 4, lonMax: 18, latMin: 44, latMax: 56 },
    width: 1600,
    out: 'dach-ground.jpg',
  },
]

const args = process.argv.slice(2)
const argVal = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const ONLY = argVal('--only', '')

const xToLon = (x, n) => (x / n) * 360 - 180
const yToLat = (y, n) => {
  const t = Math.PI - (2 * Math.PI * y) / n
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)))
}
const lonToMerc = (lon) => (lon * 20037508.342789244) / 180
const latToMerc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137

async function build(area) {
  const n = 2 ** TILES.zoom
  const bounds = area.tiles
    ? {
        lonMin: xToLon(area.tiles.x0, n),
        lonMax: xToLon(area.tiles.x1, n),
        latMax: yToLat(area.tiles.y0, n),
        latMin: yToLat(area.tiles.y1, n),
      }
    : area.bounds
  const minx = lonToMerc(bounds.lonMin)
  const maxx = lonToMerc(bounds.lonMax)
  const miny = latToMerc(bounds.latMin)
  const maxy = latToMerc(bounds.latMax)
  const width = area.width
  const height = Math.round((width * (maxy - miny)) / (maxx - minx))

  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: LAYER,
    styles: '',
    format: 'image/jpeg',
    srs: 'EPSG:3857',
    bbox: `${Math.round(minx)},${Math.round(miny)},${Math.round(maxx)},${Math.round(maxy)}`,
    width: String(width),
    height: String(height),
  })
  console.log(`hole ${LAYER} für '${area.id}' ${width}×${height}`)
  const res = await fetch(`${WMS}?${q}`)
  if (!res.ok) throw new Error(`GIBS: HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  // Eine ServiceException kommt als XML mit HTTP 200 — dieselbe Falle wie bei
  // den übrigen WMS dieses Projekts (SPEC §6).
  if (!type.startsWith('image/')) {
    throw new Error(`GIBS antwortet mit ${type}: ${(await res.text()).slice(0, 300)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  // JPEG-Kennung, damit ein umbenannter Fehlertext nicht als Bild im Repo landet.
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Antwort ist kein JPEG')

  const out = join('src', 'mapdata', area.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)

  const midLat = (bounds.latMin + bounds.latMax) / 2
  const mPerPx = ((maxx - minx) / width) * Math.cos((midLat * Math.PI) / 180)
  console.log(`${out}: ${(buf.length / 1024).toFixed(0)} KB (${width}×${height})`)
  console.log(
    `  Ecken: lon ${bounds.lonMin.toFixed(4)}…${bounds.lonMax.toFixed(4)}  ` +
      `lat ${bounds.latMin.toFixed(4)}…${bounds.latMax.toFixed(4)}`,
  )
  console.log(
    `  ${((maxx - minx) / width).toFixed(0)} m/px in Mercator, ` +
      `${(mPerPx / 1000).toFixed(2)} km/px am Boden bei ${midLat.toFixed(0)}° N\n`,
  )
}

async function main() {
  const todo = ONLY ? AREAS.filter((a) => a.id === ONLY) : AREAS
  if (todo.length === 0) throw new Error(`--only ${ONLY}: kenne nur ${AREAS.map((a) => a.id).join(', ')}`)
  for (const area of todo) await build(area)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
