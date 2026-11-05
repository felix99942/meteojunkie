// Spiegelt die Höhenkacheln der Topografie (Terrain Tiles, AWS Open Data) einmalig
// in ein lokales Verzeichnis; `scripts/topo-upload.sh` lädt sie nach R2.
//
// Aufruf: `node scripts/topo-mirror.mjs [--out verzeichnis] [--detail-only]`
//
// WARUM EIN SPIEGEL: so sieht AWS die Besucher der Seite nicht, die Karte kommt
// von der eigenen Domain. Das Relief ist statisch, der Spiegel läuft also einmal und
// bleibt. Ein zweiter Lauf holt nur, was fehlt.
//
// UNVERÄNDERT ABGELEGT: auf ganze Meter gerundet und neu gepackt waren die Kacheln
// nicht kleiner (gemessen 2026-11-05, je nach Gegend ±20 %). Bereinigt wird weiter im
// Browser (`cleanTopoTile`).
//
// STUFEN: weltweit bis `baseZoom`, feiner nur in den Regionen aus
// src/config/topoDetail.json (DACH, Alpen). Der Browser kennt dieselbe Datei und rechnet
// außerhalb aus der gröberen Kachel hoch. Die Kachelbereiche rechnet `topoTile` in
// render/globeTopo.ts genauso.
//
// NUR LAND: eine Kachel ohne Punkt über null fehlt im Spiegel, samt ihren Kindern;
// der Browser macht aus dem 404 eine flache Kachel. Das spart zwei Drittel.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeRgbPng } from './lib/png.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const OUT = arg('--out', '.cache/topo')
const DETAIL = JSON.parse(readFileSync(new URL('../src/config/topoDetail.json', import.meta.url), 'utf8'))
const DETAIL_ONLY = process.argv.includes('--detail-only')
const PARALLEL = 16
const RETRIES = 4
const SOURCE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

const hasLand = ({ rgb }) => {
  // h > 0 heißt Rot > 128, oder Rot = 128 mit Rest
  for (let i = 0; i < rgb.length; i += 3) if (rgb[i] > 128 || (rgb[i] === 128 && (rgb[i + 1] || rgb[i + 2]))) return true
  return false
}

async function fetchTile(z, x, y) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(SOURCE(z, x, y), { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= RETRIES) throw new Error(`Kachel ${z}/${x}/${y}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

let kept = 0
let sea = 0
let bytes = 0
let skipped = 0

/** Eine Stufe holen, liefert die Kacheln mit Land — deren Kinder sind die nächste Stufe. */
async function level(z, tiles) {
  const land = []
  let next = 0
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < tiles.length) {
        const [x, y] = tiles[next++]
        const file = join(OUT, String(z), String(x), `${y}.png`)
        if (existsSync(file)) {
          // Schon im Spiegel, also Land
          skipped++
          land.push([x, y])
          continue
        }
        const buf = await fetchTile(z, x, y)
        if (!hasLand(decodeRgbPng(buf))) {
          sea++
          continue
        }
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(`${file}.tmp`, buf)
        renameSync(`${file}.tmp`, file)
        kept++
        bytes += buf.length
        land.push([x, y])
      }
    }),
  )
  return land
}

const report = (z, checked, land, t0) =>
  console.log(
    `z${z}: ${checked} geprüft, ${land} mit Land · gesamt neu ${kept} Kacheln, ` +
      `${(bytes / 1e6).toFixed(0)} MB, Meer ${sea}, schon da ${skipped} · ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  )

if (!DETAIL_ONLY) {
  let tiles = [[0, 0]]
  for (let z = 0; z <= DETAIL.baseZoom; z++) {
    const t0 = Date.now()
    const land = await level(z, tiles)
    report(z, tiles.length, land.length, t0)
    tiles = land.flatMap(([x, y]) => [
      [2 * x, 2 * y],
      [2 * x + 1, 2 * y],
      [2 * x, 2 * y + 1],
      [2 * x + 1, 2 * y + 1],
    ])
  }
}

const lonX = (lon, n) => Math.floor(((lon + 180) / 360) * n)
const latY = (lat, n) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
}
const topZoom = Math.max(...DETAIL.regions.map((r) => r.maxZoom))
for (let z = DETAIL.baseZoom + 1; z <= topZoom; z++) {
  const n = 2 ** z
  const wanted = new Map()
  for (const r of DETAIL.regions) {
    if (z > r.maxZoom) continue
    for (let x = lonX(r.west, n); x <= lonX(r.east, n); x++) {
      for (let y = latY(r.north, n); y <= latY(r.south, n); y++) wanted.set(`${x}/${y}`, [x, y])
    }
  }
  const t0 = Date.now()
  const list = [...wanted.values()]
  const land = await level(z, list)
  report(z, list.length, land.length, t0)
}
