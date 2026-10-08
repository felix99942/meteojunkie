// Wert am Mauszeiger aus GIBS — lädt Farbtabelle und WMTS-Kachel und liest
// dort ab (Rechenkern und Begründung: `config/gibsReadout.ts`).
//
// Je Termin und Kachel EIN Abruf (~50 KB, eine Kachel deckt auf Stufe 6
// rund 600 km), danach liest jede Mausbewegung aus dem Speicher. Höchstens
// `TILE_LRU` Kacheln bleiben dekodiert im Speicher.

import { parseGibsColormap, tilePixel, valueAtPixel, type ColorStop } from '../config/gibsReadout'
import type { SatelliteProduct } from '../config/satellite'

const TILE_LRU = 24
const colormaps = new Map<string, Promise<ColorStop[]>>()
const tiles = new Map<string, Promise<{ data: Uint8ClampedArray; size: number }>>()

/** Ergebnis am Punkt: Wert, „nicht eindeutig" (Mischfarbe am Wolkenrand) oder „kein Wert". */
export type Readout = { kind: 'value'; value: number } | { kind: 'ambiguous' } | { kind: 'nodata' }

function loadColormap(url: string): Promise<ColorStop[]> {
  let p = colormaps.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Farbtabelle: HTTP ${r.status}`)
        return r.text()
      })
      .then(parseGibsColormap)
    p.catch(() => colormaps.delete(url))
    colormaps.set(url, p)
  }
  return p
}

function loadTile(url: string): Promise<{ data: Uint8ClampedArray; size: number }> {
  const hit = tiles.get(url)
  if (hit) {
    tiles.delete(url)
    tiles.set(url, hit)
    return hit
  }
  const p = (async () => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Kachel: HTTP ${r.status}`)
    // Ohne Farbraumumrechnung und Vormultiplikation — sonst sind es nicht mehr
    // die Farben der Tabelle
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const size = bmp.width
    const canvas = new OffscreenCanvas(size, bmp.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    return { data: ctx.getImageData(0, 0, size, canvas.height).data, size }
  })()
  p.catch(() => tiles.get(url) === p && tiles.delete(url))
  tiles.set(url, p)
  while (tiles.size > TILE_LRU) tiles.delete(tiles.keys().next().value!)
  return p
}

export async function gibsReadout(product: SatelliteProduct, time: number, lat: number, lon: number): Promise<Readout> {
  const spec = product.readout
  if (!spec) return { kind: 'nodata' }
  const { x, y, px, py } = tilePixel(lat, lon, spec.zoom)
  const iso = new Date(time).toISOString().replace('.000', '')
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${product.name}/default/${iso}/${spec.tileMatrix}/${spec.zoom}/${y}/${x}.png`
  const [stops, tile] = await Promise.all([loadColormap(spec.colormap), loadTile(url)])
  const v = valueAtPixel(tile.data, tile.size, px, py, stops)
  return v === 'none' ? { kind: 'nodata' } : v == null ? { kind: 'ambiguous' } : { kind: 'value', value: v }
}
