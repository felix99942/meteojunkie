// Höhenkacheln der Topografie-Ebene in den Modellkarten: Terrain Tiles (AWS Open
// Data, Kodierung „terrarium"), vor der Schummerung bereinigt. Sie liegen als Spiegel
// in R2 unter /topo/ (`scripts/topo-mirror.mjs`), damit AWS die Besucher nicht sieht.
// Im Spiegel fehlt das Meer: ein 404 ist dort der Normalfall und wird zur flachen
// Kachel. Lokal gibt es den Spiegel nicht, `npm run dev` holt direkt bei AWS.
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
import { GLOBE_TILE_SIZE } from './globeTiles'

export const GLOBE_TOPO_PROTOCOL = 'globedem'
/** Gleiche Kennung für Quelle und Ebene */
export const GLOBE_TOPO_LAYER = 'globe-topo'

const SOURCE_URL = (z: string, x: string, y: string) =>
  import.meta.env.DEV
    ? `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    : `/topo/${z}/${x}/${y}.png`

/** Tiefste Stufe im Spiegel — feiner lösen auch die Modelle nicht auf (`GlobeModel.maxzoom`). */
const TOPO_MAX_ZOOM = 8

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

/** Handler des Protokolls: `globedem://z/x/y` holen und bereinigen; ein Abbruch geht an MapLibre zurück. */
export async function loadTopoTile(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const [z, x, y] = url.slice(GLOBE_TOPO_PROTOCOL.length + 3).split('/')
  try {
    const res = await fetch(SOURCE_URL(z, x, y), { signal })
    if (res.status === 404) return await flatTile(256)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await createImageBitmap(await res.blob(), BITMAP_OPTIONS)
    const size = raw.width
    const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('kein 2D-Kontext')
    ctx.drawImage(raw, 0, 0)
    raw.close()
    const img = ctx.getImageData(0, 0, size, size)
    cleanTopoTile(img.data, size, Number(z), Number(y))
    return await createImageBitmap(img, BITMAP_OPTIONS)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return flatTile(256)
  }
}
