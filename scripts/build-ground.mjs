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
// EIN BILD, und das ist seit 2026-09-30 so — vorher waren es zwei.
//
//   `europe-ground.jpg`  UNTER den Wolken, IM Bild selbst (siehe
//     `render/cloudComposite.ts`). Ausschnitt ist genau `SATELLITE_AREA`,
//     also die Fläche, über die der Satellitenbereich seine Bilder anfordert:
//     Kachelfenster der Zoomstufe 6, x 27…40 und y 13…26 (die zweite Zahl
//     ist die ÄUSSERE Kante, nicht die letzte Kachel). Das ergibt lon
//     −28,125…45 und lat 31,95…72,40 — Island und das Nordkap eingeschlossen
//     — und ist in Mercator zufällig exakt QUADRATISCH (8.140 × 8.140 km).
//     Breite **2432 px = 3.347 m/px**, gemessen 551 KB.
//
// WARUM NUR NOCH EINES: das zweite (`dach-ground.jpg`, 1600 px über die
// frühere Detailfläche) gab es, weil das Komposit damals über einen kleinen
// Ausschnitt lief und dort viel schärfer war als das Europa-Bild — 4,3-fach
// hochskaliert verschwammen die Alpentäler zu einer Fläche. Seit die
// Satellitenbilder über GANZ EUROPA angefordert werden, liegt das Komposit
// bei ~3.400 m/px, also genau in der Auflösung dieses Bildes; ein schärferes
// hätte nichts mehr, woran es sich zeigen könnte. Die frühere Rolle als
// KARTENHINTERGRUND neben dem Satellitenbild ist ebenfalls weg — der Bereich
// zeigt ausserhalb der Satellitenfläche bewusst keinen Untergrund mehr.
//
// NICHT MEHR AN DAS RELIEF GEKOPPELT: der Ausschnitt war früher exakt das
// Fenster von `config/relief.ts`, damit beide Hintergründe austauschbar
// sind. Das Argument ist entfallen, seit dieses Bild kein Hintergrund mehr
// ist, sondern eine Zutat des Komposits — es folgt jetzt `SATELLITE_AREA`.
// Frühere Messreihe zum alten, engeren Fenster: 1280 px → 213 KB, 1536 →
// 296 KB, 2048 → 485 KB, 2560 → 747 KB.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi'
const LAYER = 'BlueMarble_NextGeneration'

// Kachelfenster der Zoomstufe 6 = `SATELLITE_AREA` (`ground.test.ts` hält
// die beiden gegeneinander). In Mercator exakt quadratisch.
const TILES = { zoom: 6, x0: 27, x1: 40, y0: 13, y1: 26 }

/** Nur noch ein Bild; `bounds` werden aus dem Kachelfenster gerechnet. */
const AREAS = [{ id: 'europe', tiles: TILES, width: 2432, out: 'europe-ground.jpg' }]

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
