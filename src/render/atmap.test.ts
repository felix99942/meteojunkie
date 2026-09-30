import { describe, expect, it } from 'vitest'
import {
  AT_VIEW,
  DACH_VIEW,
  makeMapGeometry,
  project,
  tileRect,
  tileZoom,
  visibleTiles,
} from './atmap'

// Unabhängige Referenz: die Kachelformel aus dem OSM-Wiki („Slippy map
// tilenames"), NICHT die eigene Projektion — sonst prüfte der Test sich selbst.
function osmTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const phi = (lat * Math.PI) / 180
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n),
  }
}

const PLACES = [
  { name: 'Salzburg', lat: 47.8095, lon: 13.055 },
  { name: 'Wien', lat: 48.2082, lon: 16.3738 },
  { name: 'Bregenz', lat: 47.5031, lon: 9.7471 },
  { name: 'Hamburg', lat: 53.5511, lon: 9.9937 }, // DACH-Nordrand: dort wiche equirect ab
]

describe('Kacheln liegen deckungsgleich unter den Stationen', () => {
  for (const view of [AT_VIEW, DACH_VIEW]) {
    const g = makeMapGeometry(0, 0, 1200, 900, view)
    for (const z of [6, 9, 12]) {
      it(`${view === AT_VIEW ? 'AT' : 'DACH'} z${z}`, () => {
        for (const p of PLACES) {
          const t = osmTile(p.lat, p.lon, z)
          const r = tileRect(g, z, t.x, t.y)
          const { x, y } = project(g, p.lon, p.lat)
          // Punkt liegt in der Kachel, die OSM für ihn führt.
          expect(x).toBeGreaterThanOrEqual(r.px - 1e-6)
          expect(x).toBeLessThan(r.px + r.size + 1e-6)
          expect(y).toBeGreaterThanOrEqual(r.py - 1e-6)
          expect(y).toBeLessThan(r.py + r.size + 1e-6)
        }
      })
    }
  }
})

describe('visibleTiles', () => {
  it('deckt die ganze Fläche lückenlos ab', () => {
    const w = 1000
    const h = 700
    const g = makeMapGeometry(0, 0, w, h, AT_VIEW)
    const z = tileZoom(g.scale)
    const tiles = visibleTiles(g, z, w, h)
    const minX = Math.min(...tiles.map((t) => t.px))
    const minY = Math.min(...tiles.map((t) => t.py))
    const maxX = Math.max(...tiles.map((t) => t.px + t.size))
    const maxY = Math.max(...tiles.map((t) => t.py + t.size))
    expect(minX).toBeLessThanOrEqual(0)
    expect(minY).toBeLessThanOrEqual(0)
    expect(maxX).toBeGreaterThanOrEqual(w)
    expect(maxY).toBeGreaterThanOrEqual(h)
    // Nachbarkacheln stossen exakt aneinander.
    const a = tiles[0]
    const right = tiles.find((t) => t.x === a.x + 1 && t.y === a.y)!
    expect(right.px).toBeCloseTo(a.px + a.size, 6)
  })
})

describe('tileZoom', () => {
  it('wählt die Stufe mit ~1:1 Gerätepixeln', () => {
    const g = makeMapGeometry(0, 0, 1200, 900, AT_VIEW)
    const z = tileZoom(g.scale)
    const size = tileRect(g, z, 0, 0).size
    expect(size).toBeGreaterThan(256 / Math.SQRT2 - 1e-6)
    expect(size).toBeLessThan(256 * Math.SQRT2 + 1e-6)
    // Doppelte Pixeldichte → eine Stufe feiner.
    expect(tileZoom(g.scale, 2)).toBe(z + 1)
  })
  it('bleibt in 0…19', () => {
    expect(tileZoom(1e-6)).toBe(0)
    expect(tileZoom(1e9)).toBe(19)
  })
})
