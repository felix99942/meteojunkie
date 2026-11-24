import { describe, expect, it } from 'vitest'
import { OPERA_AREA } from '../src/config/radar'
import { CLUTTER_MIN_PERSIST, filterEchoes, laeaGrid, operaUrl, updatePersistence, type OperaField } from './opera'

describe('OPERA-Komposit', () => {
  it('trifft mit der LAEA die Ecken aus `where` der Datei', () => {
    // UL/LR sind die Außenkanten des 3800×4400-Gitters (gemessen 2026-11-24)
    const ul = laeaGrid(-39.5357864125034, 67.0228327624372)
    const lr = laeaGrid(29.421038635578, 31.987650276733)
    expect(ul[0]).toBeCloseTo(0, 3)
    expect(ul[1]).toBeCloseTo(0, 3)
    expect(lr[0]).toBeCloseTo(3800, 3)
    expect(lr[1]).toBeCloseTo(4400, 3)
  })

  it('legt den Ausschnitt ganz ins Gitter', () => {
    for (const lon of [OPERA_AREA.west, OPERA_AREA.east])
      for (const lat of [OPERA_AREA.south, OPERA_AREA.north]) {
        const [x, y] = laeaGrid(lon, lat)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(3800)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(4400)
      }
  })

  it('bildet den Dateinamen aus dem Termin (Ende des 10-Minuten-Fensters)', () => {
    expect(operaUrl(Date.UTC(2026, 10, 24, 12, 45))).toBe(
      'https://object-store.os-api.cci1.ecmwf.int/openradar-24h-backup/2026/11/24/OPERA/COMP/OPERA@20261124T1245@0@DBZH.h5',
    )
  })
})

/** 40×40-Feld, Klasse 3 (~9,5 dBZ) an den genannten Punkten. */
function field(echo: [number, number][], cls = 3): OperaField {
  const classes = new Uint8Array(40 * 40)
  for (const [x, y] of echo) classes[y * 40 + x] = cls
  return { c0: 0, r0: 0, width: 40, height: 40, classes, atRadars: 13, nodes: 160 }
}
const block = (x0: number, y0: number, n: number): [number, number][] =>
  Array.from({ length: n * n }, (_, i) => [x0 + (i % n), y0 + Math.floor(i / n)])

describe('Störechofilter', () => {
  it('entfernt Sprenkel, lässt Niederschlagsflächen stehen', () => {
    const f = field([...block(2, 2, 2), ...block(20, 20, 6)]) // 4 km² und 36 km²
    expect(filterEchoes(f, null)).toBe(4)
    expect(f.classes[2 * 40 + 2]).toBe(0)
    expect(f.classes[22 * 40 + 22]).toBe(3)
  })

  it('lässt einen kleinen, aber kräftigen Kern stehen (junge Zelle)', () => {
    const f = field(block(5, 5, 2), 12) // ≥ 37 dBZ
    expect(filterEchoes(f, null)).toBe(0)
  })

  it('entfernt kleine ORTSFESTE Echos, auch kräftige — große ortsfeste nicht (Staulage)', () => {
    const small = block(5, 5, 3) // Windpark, 9 km²
    const big = block(15, 15, 10) // stehendes Regengebiet, 100 km²
    const state = new Uint8Array(40 * 40)
    for (let i = 0; i < 30; i++) updatePersistence(state, field([...small, ...big], 12))
    expect(state[6 * 40 + 6]).toBeGreaterThanOrEqual(CLUTTER_MIN_PERSIST)
    const f = field([...small, ...big], 12)
    expect(filterEchoes(f, state)).toBe(9)
    expect(f.classes[20 * 40 + 20]).toBe(12)
  })

  it('lässt einen durchziehenden Schauer stehen', () => {
    const state = new Uint8Array(40 * 40)
    // derselbe Ort hat nur in 4 von 30 Terminen Echo
    for (let i = 0; i < 30; i++) updatePersistence(state, field(i % 8 === 0 ? block(5, 5, 3) : [], 12))
    const f = field(block(5, 5, 3), 12)
    expect(filterEchoes(f, state)).toBe(0)
  })
})

