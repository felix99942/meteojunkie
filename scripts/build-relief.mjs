// Erzeugt das QUALITATIVE Höhenrelief für die Ortswahl-Karte (Soundings):
// Atlas-Manier — abgestufte Höhenschichten, KEINE ablesbaren Werte.
//
// Aufruf: `node scripts/build-relief.mjs [--zoom N] [--out pfad]`
//
// WARUM EIN BILD UND KEIN TILE-DIENST: dieselbe Entscheidung wie überall
// sonst auf dieser Seite (siehe render/basemap.ts) — kein API-Key, kein
// fremdes Rate-Limit, und MapLibres `load`-Event hängt nicht an Requests, die
// uns nicht gehören. Das Relief ist ausserdem statisch: einmal erzeugt, gilt
// es für immer, also gehört es als Asset ins Repo und nicht in eine
// Laufzeitabfrage.
//
// QUELLE sind die offenen Terrain-Kacheln von AWS Open Data (Mapzen/Tilezen
// „terrarium"), zusammengesetzt aus SRTM, GMTED2010, ETOPO1 u. a. — frei
// nutzbar, Nachweis steht in der Attribution des Bereichs. Kodierung:
// h = R·256 + G + B/256 − 32768 (Meter).
//
// WARUM DIE KACHELN DIREKT PASSEN: sie liegen in Web-Mercator (XYZ), und
// MapLibres image-source spannt ein Bild LINEAR im Mercator-Raum auf. Das
// zusammengesetzte Kachelfeld ist damit schon das Zielraster — es braucht
// keine Umprojektion wie in render/fieldImage.ts, wo ein lat/lon-Gitter
// vorverzerrt werden muss. Die Bildecken sind exakt die Kachelgrenzen.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeRgbPng, encodeIndexedPng } from './lib/png.mjs'

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const TILE_PX = 256

/**
 * Landflächen als Polygone — 1:50m, also DIESELBE Stufe wie die
 * Küstenlinie, die `build-basemap.mjs` für die Karte holt. Das ist der
 * Grund für 50m und nicht 10m: die Maskenkante liegt damit exakt unter der
 * gezeichneten Küstenlinie, statt ein paar Pixel daneben.
 */
const LAND_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson'

// Ausschnitt = die 'europe'-Domain aus build-basemap.mjs. Auf ganze Kacheln
// aufgerundet, die Bildecken liegen deshalb etwas weiter aussen.
const AREA = { lonMin: -12, lonMax: 40, latMin: 35, latMax: 70 }

/**
 * Höhenschichten wie im Atlas: Tiefland grün, Mittelgebirge oliv/khaki,
 * Hochgebirge braun bis hell. Die Reihenfolge der Schwellen ist die
 * Paletten-Reihenfolge (Index 0 = Meer).
 *
 * GEDÄMPFT fürs dunkle Theme, und das ist eine Bedingung, keine Marotte:
 * über dem Relief liegen die Grenzlinien (#b4b9c2) und die Stadtlabels, und
 * die müssen lesbar bleiben. Selbst die hellste Stufe bleibt deshalb klar
 * unter der Helligkeit dieser Linien.
 *
 * MEER ist fast die Hintergrundfarbe der Karte (#131418), nur eine Spur
 * blaustichig — es trägt keine Information, Bathymetrie lenkt hier nur ab.
 * WAS als Meer gilt, entscheidet aber NICHT die Höhe allein, sondern
 * zusätzlich die Landmaske — siehe `rasterizeLand`.
 */
const STEPS = [
  { upTo: 0, color: [16, 21, 27], label: 'Meer' },
  { upTo: 200, color: [30, 42, 36], label: '0–200 m' },
  { upTo: 500, color: [42, 51, 39], label: '200–500 m' },
  { upTo: 1000, color: [59, 60, 44], label: '500–1000 m' },
  { upTo: 1500, color: [77, 68, 48], label: '1000–1500 m' },
  { upTo: 2000, color: [93, 74, 52], label: '1500–2000 m' },
  { upTo: 2500, color: [109, 85, 64], label: '2000–2500 m' },
  { upTo: 3000, color: [125, 101, 82], label: '2500–3000 m' },
  { upTo: Infinity, color: [145, 128, 112], label: 'über 3000 m' },
]

const lonToX = (lon, n) => ((lon + 180) / 360) * n
const latToY = (lat, n) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
}
const xToLon = (x, n) => (x / n) * 360 - 180
const yToLat = (y, n) => {
  const t = Math.PI * (1 - (2 * y) / n)
  return (180 / Math.PI) * Math.atan(Math.sinh(t))
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ZOOM = Number(arg('--zoom', '6'))
const OUT = arg('--out', 'src/mapdata/europe-relief.png')
// Kachel-Zwischenlager: ein erneuter Lauf mit anderer Palette soll nicht
// wieder ein paar hundert Kacheln von einem fremden Dienst holen.
const CACHE = arg('--cache', join(process.env.TMPDIR || '/tmp', 'terrarium-cache'))

async function fetchTile(z, x, y) {
  const file = join(CACHE, `${z}-${x}-${y}.png`)
  if (existsSync(file)) return readFileSync(file)
  const res = await fetch(TILE_URL(z, x, y))
  if (!res.ok) throw new Error(`Kachel ${z}/${x}/${y}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, buf)
  return buf
}

/** Kacheln nebenläufig holen, aber gedrosselt — fremder Dienst. */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

/**
 * Landmaske ins Zielraster brennen (Scanline-Füllung, Even-Odd-Regel).
 *
 * WARUM ES SIE BRAUCHT: Terrarium liefert die tatsächliche Geländehöhe, und
 * die ist in den Niederlanden grossflächig NEGATIV (bis −7 m), an der
 * deutschen Marschküste ebenso. Nach reiner Höhenschwelle wurden diese
 * Gebiete als Meer eingefärbt — die Karte sah aus, als stünde das halbe
 * Land unter Wasser. Eine tiefere Schwelle behebt das nicht, sie verschiebt
 * es nur: Wattenmeer und Bodden liegen ebenfalls knapp unter null und wären
 * dann Land.
 *
 * Die Maske hebt deshalb nur AN und löscht nie: Land unter dem Meeresspiegel
 * wird zur untersten Landstufe, aber ein Punkt ausserhalb der Polygone bleibt
 * nach seiner HÖHE klassifiziert — sonst verlöre man kleine Inseln, die in
 * 1:50m fehlen.
 *
 * Even-Odd über alle Ringe EINES Polygons zusammen: damit sparen sich
 * Löcher (Binnengewässer in einer Landmasse) von selbst aus.
 */
function rasterizeLand(geojson, width, height, toPx) {
  const mask = new Uint8Array(width * height)
  const xs = []
  for (const f of geojson.features) {
    if (!f.geometry) continue
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
      : []
    for (const rings of polys) {
      // Kanten des GANZEN Polygons (äusserer Ring + Löcher) in Pixelraum
      const edges = []
      let yMin = Infinity
      let yMax = -Infinity
      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = toPx(ring[i][0], ring[i][1])
          const b = toPx(ring[i + 1][0], ring[i + 1][1])
          if (a.y === b.y) continue // waagrechte Kanten tragen nichts bei
          edges.push(a.y < b.y ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y } : { x0: b.x, y0: b.y, x1: a.x, y1: a.y })
          yMin = Math.min(yMin, a.y, b.y)
          yMax = Math.max(yMax, a.y, b.y)
        }
      }
      if (!edges.length) continue
      const yStart = Math.max(0, Math.floor(yMin))
      const yEnd = Math.min(height - 1, Math.ceil(yMax))
      for (let y = yStart; y <= yEnd; y++) {
        const yc = y + 0.5
        xs.length = 0
        for (const e of edges) {
          if (yc < e.y0 || yc >= e.y1) continue
          xs.push(e.x0 + ((yc - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0))
        }
        if (xs.length < 2) continue
        xs.sort((a, b) => a - b)
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const from = Math.max(0, Math.ceil(xs[k] - 0.5))
          const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5))
          for (let x = from; x <= to; x++) mask[y * width + x] = 1
        }
      }
    }
  }
  return mask
}

async function main() {
  const n = 2 ** ZOOM
  const x0 = Math.floor(lonToX(AREA.lonMin, n))
  const x1 = Math.ceil(lonToX(AREA.lonMax, n))
  const y0 = Math.floor(latToY(AREA.latMax, n))
  const y1 = Math.ceil(latToY(AREA.latMin, n))
  const cols = x1 - x0
  const rows = y1 - y0
  const width = cols * TILE_PX
  const height = rows * TILE_PX

  const jobs = []
  for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) jobs.push({ tx, ty })
  console.log(`Zoom ${ZOOM}: ${cols}×${rows} = ${jobs.length} Kacheln → ${width}×${height} px`)

  process.stdout.write('  Landmaske … ')
  const landRes = await fetch(LAND_URL)
  if (!landRes.ok) throw new Error(`Landpolygone: HTTP ${landRes.status}`)
  const land = rasterizeLand(await landRes.json(), width, height, (lon, lat) => ({
    x: (lonToX(lon, n) - x0) * TILE_PX,
    y: (latToY(lat, n) - y0) * TILE_PX,
  }))
  console.log(`${((land.reduce((a, b) => a + b, 0) / (width * height)) * 100).toFixed(1)} % Landfläche`)

  const index = new Uint8Array(width * height)
  let done = 0
  const hist = new Array(STEPS.length).fill(0)
  let lifted = 0

  await mapLimited(jobs, 6, async ({ tx, ty }) => {
    const { width: tw, height: th, rgb } = decodeRgbPng(await fetchTile(ZOOM, tx, ty))
    if (tw !== TILE_PX || th !== TILE_PX) throw new Error(`Kachel ${tx}/${ty}: ${tw}×${th}`)
    const ox = (tx - x0) * TILE_PX
    const oy = (ty - y0) * TILE_PX
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const p = (y * tw + x) * 3
        const h = rgb[p] * 256 + rgb[p + 1] + rgb[p + 2] / 256 - 32768
        let s = 0
        while (s < STEPS.length - 1 && h > STEPS[s].upTo) s++
        // Land unter dem Meeresspiegel auf die unterste LANDstufe heben
        // (Polder, Marsch) — siehe rasterizeLand.
        const at = (oy + y) * width + ox + x
        if (s === 0 && land[at]) {
          s = 1
          lifted++
        }
        index[at] = s
        hist[s]++
      }
    }
    if (++done % 25 === 0 || done === jobs.length) process.stdout.write(`\r  ${done}/${jobs.length} Kacheln`)
  })
  process.stdout.write('\n')

  const png = encodeIndexedPng(width, height, index, STEPS.map((s) => s.color))
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, png)

  const bounds = {
    lonMin: xToLon(x0, n),
    lonMax: xToLon(x1, n),
    latMax: yToLat(y0, n),
    latMin: yToLat(y1, n),
  }
  const total = width * height
  console.log(`\n${OUT}: ${(png.length / 1024).toFixed(0)} KB (${width}×${height})`)
  console.log(`Ecken: lon ${bounds.lonMin.toFixed(4)}…${bounds.lonMax.toFixed(4)}  lat ${bounds.latMin.toFixed(4)}…${bounds.latMax.toFixed(4)}`)
  const midLat = (bounds.latMin + bounds.latMax) / 2
  const mPerPx = (40075017 * Math.cos((midLat * Math.PI) / 180)) / (TILE_PX * n)
  console.log(`Auflösung bei ${midLat.toFixed(0)}° N: ${(mPerPx / 1000).toFixed(2)} km/px`)
  console.log(`Unter Meeresniveau, als Land gehalten: ${lifted} px (${((lifted / total) * 100).toFixed(2)} %)`)
  console.log('Verteilung:')
  STEPS.forEach((s, i) => console.log(`  ${s.label.padEnd(14)} ${((hist[i] / total) * 100).toFixed(1)} %`))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
