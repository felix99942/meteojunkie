import { describe, expect, it } from 'vitest'
import { nearestWind3dStep, sampleWind3d, sampleWind3dAtHeight, speedColor, WIND3D_SPEED_STOPS, type Wind3dField, type Wind3dGrid } from './wind3d'

const grid: Wind3dGrid = { nx: 3, ny: 2, levels: 2, lon0: 10, lat0: 46, dlon: 1, dlat: 1, uvStep: 0.5, wStep: 0.1, missing: -128 }

/** u steigt nach Osten, v ist konstant, w unterscheidet die Flächen; Gelände 500 m */
function field(): Wind3dField {
  const plane = grid.nx * grid.ny
  const wind = new Int8Array(grid.levels * 3 * plane)
  for (let l = 0; l < grid.levels; l++) {
    for (let p = 0; p < plane; p++) {
      wind[l * 3 * plane + p] = (p % grid.nx) * 10
      wind[l * 3 * plane + plane + p] = 20
      wind[l * 3 * plane + 2 * plane + p] = l === 0 ? 10 : 30
    }
  }
  const heights = new Int16Array((grid.levels + 1) * plane)
  for (let p = 0; p < plane; p++) {
    heights[p] = 1000
    heights[plane + p] = 2000
    heights[2 * plane + p] = 500
  }
  return { grid, wind, heights }
}

describe('Windvolumen', () => {
  it('rechnet Stufen in m/s um und liest bilinear', () => {
    const s = sampleWind3d(field(), 10.5, 46.5, 0)!
    expect(s.u).toBeCloseTo(2.5)
    expect(s.v).toBeCloseTo(10)
    expect(s.w).toBeCloseTo(1)
  })

  it('liest zwischen den Flächen linear, samt Höhe und Höhe über Grund', () => {
    const s = sampleWind3d(field(), 10.5, 46.5, 0.5)!
    expect(s.w).toBeCloseTo(2)
    expect(s.z).toBeCloseTo(1500)
    expect(s.agl).toBeCloseTo(1000)
  })

  it('funktioniert auf der obersten Fläche', () => {
    expect(sampleWind3d(field(), 10.5, 46.5, 1)!.w).toBeCloseTo(3)
  })

  it('liefert nichts außerhalb und wenn ein Nachbar keinen Wert hat', () => {
    const f = field()
    expect(sampleWind3d(f, 9.5, 46.5, 0)).toBeNull()
    expect(sampleWind3d(f, 12.5, 46.5, 0)).toBeNull()
    expect(sampleWind3d(f, 10.5, 46.5, 1.5)).toBeNull()
    f.wind[0] = grid.missing
    expect(sampleWind3d(f, 10.5, 46.5, 0)).toBeNull()
  })
})

describe('Wind in einer Höhe', () => {
  it('findet die Fläche zur Höhe', () => {
    const s = sampleWind3dAtHeight(field(), 10.5, 46.5, 1500)!
    expect(s.z).toBeCloseTo(1500)
    expect(s.w).toBeCloseTo(2)
  })

  it('legt ein Partikel unter der untersten Fläche auf diese', () => {
    const s = sampleWind3dAtHeight(field(), 10.5, 46.5, 400)!
    expect(s.z).toBeCloseTo(1000)
    expect(s.agl).toBeCloseTo(500)
  })

  it('liefert nichts über der obersten Fläche und außerhalb', () => {
    expect(sampleWind3dAtHeight(field(), 10.5, 46.5, 2100)).toBeNull()
    expect(sampleWind3dAtHeight(field(), 9.5, 46.5, 1500)).toBeNull()
  })
})

describe('Auswahl', () => {
  it('nimmt das nächste Volumen, aber keines, das zu weit weg ist', () => {
    const run = Date.UTC(2026, 10, 9, 12)
    const steps = [0, 1, 24, 27]
    expect(nearestWind3dStep(run, steps, run + 25 * 3_600_000)).toBe(2)
    expect(nearestWind3dStep(run, steps, run + 40 * 3_600_000)).toBe(-1)
  })

  it('färbt nach Geschwindigkeit, begrenzt und stetig', () => {
    expect(speedColor(30)).toEqual([1, 0.92, 0.25])
    expect(speedColor(-5)).toEqual(WIND3D_SPEED_STOPS[0].rgb)
    expect(speedColor(500)).toEqual(WIND3D_SPEED_STOPS[WIND3D_SPEED_STOPS.length - 1].rgb)
    const mid = speedColor(37.5)
    expect(mid[1]).toBeCloseTo((0.92 + 0.62) / 2)
  })
})
