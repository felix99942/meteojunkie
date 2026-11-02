import { describe, expect, it } from 'vitest'
import type { GlobeField, GlobeGrid } from './globe'
import { formatMax, inFilledArea, maxInBox, spacedMaxima } from './globeMaxima'

/** Feld aus Werten (Zeile 0 = lat0), Kodierung lo 0 / step 0,05 wie `precip`; NaN = kein Wert. */
function field(values: number[][], grid: Partial<GlobeGrid> = {}): GlobeField {
  const nj = values.length
  const ni = values[0].length
  const g: GlobeGrid = { ni, nj, lon0: 10, lat0: 45, dlon: 1, dlat: 1, global: false, ...grid }
  const codes = new Uint16Array(ni * nj)
  values.forEach((row, j) => row.forEach((v, i) => (codes[j * ni + i] = Number.isNaN(v) ? 0 : Math.round(v / 0.05) + 1)))
  return { grid: g, lo: 0, step: 0.05, codes }
}

describe('maxInBox', () => {
  const f = field([
    [0, 0.5, 0, 0],
    [0, 0, 2.5, 0],
    [NaN, 0, 0, 7],
  ])

  it('findet das Maximum samt Lage der Zelle', () => {
    const m = maxInBox(f, 10, 45, 13, 47)!
    expect(m.value).toBeCloseTo(7)
    expect(m).toMatchObject({ lat: 47, lon: 13 })
  })

  it('sucht nur im Kasten', () => {
    expect(maxInBox(f, 10, 45, 12, 46)!.value).toBeCloseTo(2.5)
  })

  it('gilt auch für ein Gitter von Nord nach Süd (dlat negativ)', () => {
    const n = field([[1], [3], [2]], { lat0: 47, dlat: -1, ni: 1 })
    expect(maxInBox(n, 9.5, 45, 10.5, 47)).toMatchObject({ lat: 46 })
  })

  it('nimmt beim starken Hineinzoomen die Zelle unter der Kastenmitte', () => {
    expect(maxInBox(f, 11.9, 45.9, 12.1, 46.1)!.value).toBeCloseTo(2.5)
  })

  it('außerhalb eines regionalen Gitters gibt es keinen Wert', () => {
    expect(maxInBox(f, 20, 45, 21, 46)).toBeNull()
  })

  it('wickelt ein globales Gitter über die Datumsgrenze', () => {
    const g = field([[0, 0, 0, 5]], { lon0: -180, dlon: 90, global: true })
    // Spalte 3 = 90° O; ein Kasten 80…100° O und derselbe als 440…460°
    expect(maxInBox(g, 80, 44, 100, 46)!.value).toBeCloseTo(5)
    expect(maxInBox(g, 80 + 360, 44, 100 + 360, 46)!.value).toBeCloseTo(5)
  })
})

describe('inFilledArea', () => {
  const idx = (f: GlobeField, j: number, i: number) => j * f.grid.ni + i

  it('ein einzelner nasser Gitterpunkt steht nicht in einer Farbfläche', () => {
    const f = field([
      [0, 0, 0],
      [0, 2, 0],
      [0, 0, 0],
    ])
    expect(inFilledArea(f, idx(f, 1, 1), 0.1)).toBe(false)
  })

  it('eine Zelle inmitten eingefärbter Nachbarn schon', () => {
    const f = field([
      [0.2, 0.3, 0],
      [0.2, 2, 0.1],
      [0.4, 0.2, 0],
    ])
    expect(inFilledArea(f, idx(f, 1, 1), 0.1)).toBe(true)
  })

  it('unter der untersten Farbstufe ist auch die Zelle selbst nicht eingefärbt', () => {
    const f = field([
      [0.05, 0.05, 0.05],
      [0.05, 0.05, 0.05],
      [0.05, 0.05, 0.05],
    ])
    expect(inFilledArea(f, idx(f, 1, 1), 0.1)).toBe(false)
  })
})

describe('spacedMaxima', () => {
  const c = (value: number, x: number, y = 0) => ({ value, x, y })

  it('der höhere Wert gewinnt, wenn zwei Zahlen zu nah stehen', () => {
    expect(spacedMaxima([c(3, 0), c(5, 30)], 50, 0.1).map((m) => m.value)).toEqual([5])
  })

  it('eine große Fläche behält mehrere Zahlen, solange sie Abstand haben', () => {
    const got = spacedMaxima([c(9, 0), c(7, 100), c(8, 200), c(6, 300)], 50, 0.1)
    expect(got.map((m) => m.value)).toEqual([9, 8, 7, 6])
  })

  it('unter der Schwelle steht nichts', () => {
    expect(spacedMaxima([c(0.05, 0), c(0, 100)], 50, 0.1)).toEqual([])
  })
})

describe('formatMax', () => {
  it('eine Nachkommastelle unter 10, darüber ganze, deutsch', () => {
    expect(formatMax(1.5)).toBe('1,5')
    expect(formatMax(0.149)).toBe('0,1')
    expect(formatMax(12.4)).toBe('12')
    expect(formatMax(9.97)).toBe('10')
    expect(formatMax(9, 0)).toBe('9')
  })
})
