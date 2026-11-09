// Höhenkacheln der Topografie-Ebene in den Modellkarten: Terrain Tiles (AWS Open
// Data, Kodierung „terrarium"), vor der Schummerung bereinigt. Sie liegen als Spiegel
// in R2 unter /topo/ (`scripts/topo-mirror.mjs`), damit AWS die Besucher nicht sieht,
// und dort als verlustfreies WebP (`scripts/topo-pack.py`, 22 % kleiner, Pixel gleich).
// Im Spiegel fehlt das Meer: ein 404 ist dort der Normalfall und wird zur flachen
// Kachel. Lokal gibt es den Spiegel nicht, `npm run dev` holt die PNG direkt bei AWS.
//
// MEERESBODEN WEG: die Kacheln führen auch die Bathymetrie. Über einem Wetterfeld
// sehen Schelfkante und Mittelatlantischer Rücken wie Struktur im Feld aus, und
// bei den Modellen spielen sie keine Rolle. Alles unter null wird deshalb zu null;
// flach heißt in der Schummerung durchsichtig. Das trifft auch Polder und Kaspisee,
// die dadurch nur flach werden.
//
// POLRAND FLACH: dieselbe Falle wie bei Feld und Isolinien (`POLE_ROWS`) — im Globus
// streckt MapLibre die Randzeile bis an den Pol, und die Schummerung zeichnet daraus
// einen Strahlenfächer. Die Randzeilen bekommen deshalb die mittlere Höhe der ersten
// Zeile darunter.

import type maplibregl from 'maplibre-gl'
import { POLE_ROWS } from '../config/globe'
import detail from '../config/topoDetail.json'
import { GLOBE_TILE_SIZE } from './globeTiles'

export const GLOBE_TOPO_PROTOCOL = 'globedem'
/** Gleiche Kennung für Quelle und Ebene */
export const GLOBE_TOPO_LAYER = 'globe-topo'

const SOURCE_URL = (z: number, x: number, y: number) =>
  import.meta.env.DEV
    ? `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    : `/topo/${z}/${x}/${y}.webp`

/**
 * So lange wartet eine Kachel, bevor sie abgerufen wird. Beim Zoomen bestellt MapLibre
 * Kacheln der Zwischenstufen und bestellt sie gleich wieder ab (gemessen 17–32 je
 * Zoomschritt neben den 28 gebrauchten, je ~140 KB). Bis dahin ist nichts übertragen.
 */
export const TOPO_FETCH_DELAY_MS = 120

/**
 * Pausen zwischen den Versuchen, zusammen rund 16 s. Während der Versuche zeigt MapLibre
 * weiter die gröbere Stufe. Danach wird die Kachel flach und bleibt es für die Sitzung:
 * eine abgelehnte Kachel lässt MapLibre stolpern (s. `flatTile`).
 */
export const TOPO_RETRY_DELAYS_MS = [500, 1500, 4000, 10000]

/**
 * Feinste Stufe im Spiegel. Weltweit endet er bei `baseZoom`, nur DACH und die Alpen
 * reichen weiter (`topoDetail.json`) — dort zoomt man hinein, um Täler zu sehen.
 */
export const TOPO_MAX_ZOOM = Math.max(...detail.regions.map((r) => r.maxZoom))

const tileX = (lon: number, n: number) => Math.floor(((lon + 180) / 360) * n)
const tileY = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
}

function inMirror(z: number, x: number, y: number): boolean {
  if (z <= detail.baseZoom) return true
  const n = 2 ** z
  return detail.regions.some(
    (r) => z <= r.maxZoom && x >= tileX(r.west, n) && x <= tileX(r.east, n) && y >= tileY(r.north, n) && y <= tileY(r.south, n),
  )
}

/**
 * Die Kachel, die eine angefragte Kachel trägt: sie selbst oder ihr nächster Vorfahr im
 * Spiegel. `factor` = so viele Kacheln der angefragten Stufe je Vorfahr-Kante, `col`/`row`
 * = Lage darin.
 */
export function topoTile(z: number, x: number, y: number): { z: number; x: number; y: number; factor: number; col: number; row: number } {
  let up = 0
  while (!inMirror(z - up, x >> up, y >> up)) up++
  const factor = 2 ** up
  return { z: z - up, x: x >> up, y: y >> up, factor, col: x % factor, row: y % factor }
}

/** Gewichte des kubischen B-Splines für die vier Stützstellen um `t` (0…1). */
function splineWeights(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6]
}

/**
 * Ausschnitt einer Höhenkachel auf die volle Größe hochrechnen. Über die HÖHE, nicht
 * über die Kanäle: Rot und Grün kodieren zusammen einen Wert. Und KUBISCH, nicht
 * bilinear: die Schummerung zeichnet die Steigung, und die ist bilinear je Zelle
 * konstant — bei 16-facher Vergrößerung stand über den Pyrenäen ein Karomuster da.
 */
export function upsampleTopoTile(px: Uint8ClampedArray, size: number, factor: number, col: number, row: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length)
  const clamp = (i: number) => Math.max(0, Math.min(size - 1, i))
  for (let r = 0; r < size; r++) {
    const sy = (row + (r + 0.5) / size) * (size / factor) - 0.5
    const y0 = Math.floor(sy)
    const wy = splineWeights(sy - y0)
    for (let c = 0; c < size; c++) {
      const sx = (col + (c + 0.5) / size) * (size / factor) - 0.5
      const x0 = Math.floor(sx)
      const wx = splineWeights(sx - x0)
      let h = 0
      for (let j = 0; j < 4; j++) {
        const rowAt = clamp(y0 + j - 1) * size
        for (let i = 0; i < 4; i++) h += wy[j] * wx[i] * heightAt(px, (rowAt + clamp(x0 + i - 1)) * 4)
      }
      const v = h + 32768
      const k = (r * size + c) * 4
      out[k] = Math.floor(v / 256)
      out[k + 1] = Math.floor(v) % 256
      out[k + 2] = Math.floor((v % 1) * 256)
      out[k + 3] = 255
    }
  }
  return out
}

/** h = R·256 + G + B/256 − 32768, also ist Rot 128 bei G = B = 0 genau Meeresniveau. */
const SEA_LEVEL_RED = 128

const heightAt = (px: Uint8ClampedArray, i: number) => px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768

function fillRows(px: Uint8ClampedArray, size: number, from: number, to: number, refRow: number): void {
  let sum = 0
  for (let c = 0; c < size; c++) sum += heightAt(px, (refRow * size + c) * 4)
  const v = sum / size + 32768
  const r = Math.floor(v / 256)
  const g = Math.floor(v) % 256
  const b = Math.floor((v % 1) * 256)
  for (let i = from * size * 4; i < to * size * 4; i += 4) {
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
  }
}

/** Bereinigt eine RGBA-Höhenkachel (Seitenlänge `size`) an Ort und Stelle. */
export function cleanTopoTile(px: Uint8ClampedArray, size: number, z: number, y: number): void {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] < SEA_LEVEL_RED) {
      px[i] = SEA_LEVEL_RED
      px[i + 1] = 0
      px[i + 2] = 0
    }
  }
  if (y === 0) fillRows(px, size, 0, POLE_ROWS, POLE_ROWS)
  if (y === 2 ** z - 1) fillRows(px, size, size - POLE_ROWS, size, size - POLE_ROWS - 1)
}

/**
 * Schummerung als Ebene: nur Schatten und Licht, flaches Land bleibt durchsichtig,
 * die Farbe des Felds trägt weiter den Wert. `before` = die Ebene darüber.
 */
export function addTopoLayer(map: maplibregl.Map, before: string): void {
  if (map.getSource(GLOBE_TOPO_LAYER)) return
  map.addSource(GLOBE_TOPO_LAYER, {
    type: 'raster-dem',
    encoding: 'terrarium',
    tiles: [`${GLOBE_TOPO_PROTOCOL}://{z}/{x}/{y}`],
    tileSize: GLOBE_TILE_SIZE,
    maxzoom: TOPO_MAX_ZOOM,
  })
  map.addLayer(
    {
      id: GLOBE_TOPO_LAYER,
      type: 'hillshade',
      source: GLOBE_TOPO_LAYER,
      paint: {
        'hillshade-illumination-anchor': 'map',
        'hillshade-exaggeration': 0.6,
        'hillshade-shadow-color': 'rgba(0, 0, 0, 0.7)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.35)',
        'hillshade-accent-color': 'rgba(0, 0, 0, 0)',
      },
    },
    before,
  )
}

/**
 * Höhenquelle des 3D-Reliefs. Eine eigene neben der Schummerung: MapLibre warnt sonst,
 * dieselbe Quelle für beides koste Darstellungsqualität. Die Kacheln sind dieselben, der
 * Browser holt sie also nicht doppelt.
 */
export const GLOBE_TERRAIN_SOURCE = 'globe-terrain'
/** Überhöhung: bei 1 wirken die Alpen aus der Übersicht fast flach */
export const RELIEF_EXAGGERATION = 1.5
/**
 * Bis zu dieser Stufe lädt „Alpen 3D" vorab, das Feinere kommt beim Hineinzoomen nach wie
 * in der 2D-Karte (Alpen bis Stufe 12, zusammen Tausende Kacheln: vorab wäre das zu viel).
 * Die Stufe ist nicht der Engpass: gemessen brachten z7, z8 und z9 dieselbe Bildrate,
 * teuer ist die Schummerung (6 gegen 9 Bilder/s in der Software-Grafik).
 */
export const RELIEF_PRELOAD_ZOOM = 9
const RELIEF_MIN_ZOOM = 4
/** Bereich, in dem sich die Ansicht bewegen darf: alles darin ist vorgeladen. [[W, S], [O, N]] */
export const RELIEF_BOUNDS: [[number, number], [number, number]] = [[4.0, 44.0], [18.2, 49.5]]

export function addReliefTerrain(map: maplibregl.Map): void {
  if (!map.getSource(GLOBE_TERRAIN_SOURCE)) {
    map.addSource(GLOBE_TERRAIN_SOURCE, {
      type: 'raster-dem',
      encoding: 'terrarium',
      tiles: [`${GLOBE_TOPO_PROTOCOL}://{z}/{x}/{y}`],
      // 512 statt 256: MapLibre nimmt dann eine Stufe gröber, ein Viertel der Kacheln fürs Gelände
      tileSize: 512,
      maxzoom: TOPO_MAX_ZOOM,
    })
  }
  map.setTerrain({ source: GLOBE_TERRAIN_SOURCE, exaggeration: RELIEF_EXAGGERATION })
}

function inReliefBounds(z: number, x: number, y: number): boolean {
  const [[w, s], [e, n]] = RELIEF_BOUNDS
  const count = 2 ** z
  return x >= tileX(w, count) && x <= tileX(e, count) && y >= tileY(n, count) && y <= tileY(s, count)
}

/** Die Kacheln, die „Alpen 3D" vorab lädt, grob vor fein. */
export function reliefTiles(): [number, number, number][] {
  const [[w, s], [e, n]] = RELIEF_BOUNDS
  const out: [number, number, number][] = []
  for (let z = RELIEF_MIN_ZOOM; z <= RELIEF_PRELOAD_ZOOM; z++) {
    const count = 2 ** z
    for (let y = tileY(n, count); y <= tileY(s, count); y++) {
      for (let x = tileX(w, count); x <= tileX(e, count); x++) out.push([z, x, y])
    }
  }
  return out
}

// Vorgeladene Kacheln. Das Bild wird je Abruf kopiert: MapLibre reicht es an seinen
// Worker weiter, und dabei wird es ungültig. Beim Verlassen der Ansicht geht alles wieder
// weg (~100 MB), der Browser hält die Dateien ohnehin im Cache.
const preloaded = new Map<string, ImageBitmap>()
/** Vorladen fertig: was außerhalb des Bereichs liegt, ist nur noch Horizont und bleibt flach */
let preloadComplete = false
const PRELOAD_WORKERS = 10

/** Lädt das ganze Relief; `onProgress(fertig, gesamt)` nach jeder Kachel. */
export async function preloadRelief(onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<void> {
  const tiles = reliefTiles()
  let next = 0
  let done = 0
  onProgress(0, tiles.length)
  const worker = async () => {
    while (next < tiles.length) {
      const [z, x, y] = tiles[next++]
      const key = `${z}/${x}/${y}`
      if (!preloaded.has(key)) {
        let bmp: ImageBitmap | null = null
        try {
          bmp = await retryTopo(() => fetchTopoTile(topoTile(z, x, y), signal), signal)
        } catch (e) {
          if (isAbort(e)) throw e
        }
        preloaded.set(key, bmp ?? (await flatTile(256)))
      }
      onProgress(++done, tiles.length)
    }
  }
  await Promise.all(Array.from({ length: PRELOAD_WORKERS }, worker))
  preloadComplete = true
}

export function clearPreloadedRelief(): void {
  for (const bmp of preloaded.values()) bmp.close()
  preloaded.clear()
  preloadComplete = false
}

export function removeReliefTerrain(map: maplibregl.Map): void {
  map.setTerrain(null)
  if (map.getSource(GLOBE_TERRAIN_SOURCE)) map.removeSource(GLOBE_TERRAIN_SOURCE)
}

export function removeTopoLayer(map: maplibregl.Map): void {
  if (map.getLayer(GLOBE_TOPO_LAYER)) map.removeLayer(GLOBE_TOPO_LAYER)
  if (map.getSource(GLOBE_TOPO_LAYER)) map.removeSource(GLOBE_TOPO_LAYER)
}

const BITMAP_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

/** Eine nicht ladbare Kachel ist flach: die Stelle bleibt ohne Relief, statt MapLibre stolpern zu lassen. */
function flatTile(size: number): Promise<ImageBitmap> {
  const px = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < px.length; i += 4) {
    px[i] = SEA_LEVEL_RED
    px[i + 3] = 255
  }
  return createImageBitmap(new ImageData(px, size), BITMAP_OPTIONS)
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError'

/** Pause, die ein Abbruch sofort beendet — mit AbortError. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      reject(new DOMException('Kachel abgebrochen', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
}

/**
 * `run` ausführen, bei einem Fehler nach den Pausen erneut. Ein Abbruch wird nie
 * wiederholt; nach dem letzten Versuch geht der Fehler an den Aufrufer.
 */
export async function retryTopo<T>(run: () => Promise<T>, signal: AbortSignal, delays: readonly number[] = TOPO_RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (e) {
      if (isAbort(e) || attempt >= delays.length) throw e
      await pause(delays[attempt], signal)
    }
  }
}

/** Eine Kachel holen und bereinigen; `null` = die Stelle bleibt endgültig flach (Meer). */
async function fetchTopoTile(t: ReturnType<typeof topoTile>, signal: AbortSignal): Promise<ImageBitmap | null> {
  const res = await fetch(SOURCE_URL(t.z, t.x, t.y), { signal })
  // Überlastung und Serverfehler gehen vorbei, ein anderes 4xx kommt beim nächsten Mal wieder
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
  if (!res.ok) return null
  const raw = await createImageBitmap(await res.blob(), BITMAP_OPTIONS)
  const size = raw.width
  const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('kein 2D-Kontext')
  ctx.drawImage(raw, 0, 0)
  raw.close()
  const img = ctx.getImageData(0, 0, size, size)
  // Erst bereinigen, solange Stufe und Zeile die der gespiegelten Kachel sind
  cleanTopoTile(img.data, size, t.z, t.y)
  if (t.factor === 1) return createImageBitmap(img, BITMAP_OPTIONS)
  const data = upsampleTopoTile(img.data, size, t.factor, t.col, t.row)
  return createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size), BITMAP_OPTIONS)
}

/** Handler des Protokolls: `globedem://z/x/y` holen; ein Abbruch geht an MapLibre zurück. */
export async function loadTopoTile(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const [z, x, y] = url.slice(GLOBE_TOPO_PROTOCOL.length + 3).split('/').map(Number)
  const ready = preloaded.get(`${z}/${x}/${y}`)
  if (ready) return createImageBitmap(ready, BITMAP_OPTIONS)
  if (preloadComplete && !inReliefBounds(z, x, y)) return flatTile(256)
  const t = topoTile(z, x, y)
  await pause(TOPO_FETCH_DELAY_MS, signal)
  try {
    return (await retryTopo(() => fetchTopoTile(t, signal), signal)) ?? (await flatTile(256))
  } catch (e) {
    if (isAbort(e)) throw e
    return flatTile(256)
  }
}
