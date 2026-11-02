import { describe, expect, it } from 'vitest'
import { distanceKm, R3D_LUT, R3D_NODATA, r3dDbz, r3dLevelLabel, r3dPixel, r3dSection, sectionStats, type R3dIndex } from './radar3d'
import { WN_LEGEND } from './radar'

const index: R3dIndex = {
  stepMs: 300000,
  times: [],
  stations: [],
  geo: { west: 3.4, east: 17.2, south: 45.8, north: 56 },
  width: 1000,
  height: 1178,
  levels: [1000, 1500, 2000],
}

describe('r3dPixel', () => {
  it('Ecken und Ränder', () => {
    expect(r3dPixel(index, 3.4001, 55.9999)).toEqual({ x: 0, y: 0 })
    expect(r3dPixel(index, 17.1999, 45.8001)).toEqual({ x: 999, y: 1177 })
    expect(r3dPixel(index, 3.3, 50)).toBeNull()
    expect(r3dPixel(index, 10, 56.1)).toBeNull()
  })
  it('Mercator, nicht linear in der Breite: die Mitte der Breiten liegt NICHT in der Bildmitte', () => {
    const mid = r3dPixel(index, 10, (45.8 + 56) / 2)!
    expect(mid.y).toBeGreaterThan(1178 / 2)
  })
})

describe('Farben', () => {
  it('dieselbe Skala wie die Reflektivität, unter 7 dBZ durchsichtig, keine Daten grau', () => {
    expect(r3dDbz(78)).toBe(7)
    expect(R3D_LUT[77][3]).toBe(0) // 6,5 dBZ
    expect(R3D_LUT[78]).toEqual([0x99, 0xff, 0xff, 255])
    expect(R3D_LUT[0][3]).toBe(0)
    expect(R3D_LUT[R3D_NODATA][3]).toBe(128)
    // 46 dBZ → rote Klasse wie im Komposit
    const red = WN_LEGEND.find((s) => s.label === '46')!.color
    expect(R3D_LUT[(46 + 32) * 2].slice(0, 3)).toEqual([1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16)))
  })
  it('Höhe als km mit Komma', () => {
    expect(r3dLevelLabel(3000)).toBe('3,0 km')
    expect(r3dLevelLabel(10500)).toBe('10,5 km')
  })
})

describe('r3dSection', () => {
  it('liest die Säule je Spalte aus allen Schichten, ausserhalb ist nicht abgedeckt', () => {
    const n = index.width * index.height
    const stack = new Uint8Array(n * 3).fill(R3D_NODATA)
    const p = r3dPixel(index, 11, 48)!
    const k = p.y * index.width + p.x
    stack[k] = 100
    stack[n + k] = 120
    stack[2 * n + k] = 0
    const s = r3dSection(stack, index, [11, 48], [11, 49], 1)
    expect(s.lengthKm).toBeCloseTo(111.2, 0)
    expect(s.distKm.length).toBe(112)
    expect(Array.from(s.values.slice(0, 3))).toEqual([100, 120, 0])
    const out = r3dSection(stack, index, [2, 48], [2.5, 48], 5)
    expect(out.values.every((v) => v === R3D_NODATA)).toBe(true)
    expect(sectionStats(s)).toEqual({ maxDbz: r3dDbz(120), topM: 1500 })
  })
  it('Entfernung: 1° Breite ≈ 111 km', () => {
    expect(distanceKm([10, 50], [10, 51])).toBeCloseTo(111.2, 0)
  })
})
