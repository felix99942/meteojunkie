import { describe, expect, it } from 'vitest'
import { colorForValue } from './colorscales'
import { displayValue, isoLevels, isoSegments, nearestLevel, nearestSectionStep, SECTION_SCALES } from './foehnSection'

describe('Zeitschritt', () => {
  it('nimmt den nächsten Schritt, auch im 3-stündlichen Teil', () => {
    const run = Date.UTC(2026, 10, 9, 9)
    const steps = [0, 1, 24, 27, 30]
    expect(nearestSectionStep(run, steps, run + 0.4 * 3_600_000)).toBe(0)
    expect(nearestSectionStep(run, steps, run + 25 * 3_600_000)).toBe(2)
    expect(nearestSectionStep(run, steps, run + 26 * 3_600_000)).toBe(3)
    expect(nearestSectionStep(run, steps, run + 99 * 3_600_000)).toBe(4)
  })
})

describe('Isolinien', () => {
  // Linear mit der Höhe, über ein ansteigendes Gelände: die Linie liegt auf konstanter Höhe
  const x = [0, 2, 4]
  const z = [
    [100, 300, 500],
    [1100, 1300, 1500],
    [2100, 2300, 2500],
  ]
  const f = z.map((row) => row.map((h) => 280 + h / 100))

  it('liegt auf der richtigen Höhe, obwohl das Gitter dem Gelände folgt', () => {
    const seg = isoSegments(x, z, f, 295)
    expect(seg.length).toBeGreaterThan(0)
    for (const [, z1, , z2] of seg) {
      expect(z1).toBeCloseTo(1500, 6)
      expect(z2).toBeCloseTo(1500, 6)
    }
  })

  it('zeichnet nichts durch Zellen ohne Wert und nichts außerhalb des Wertebereichs', () => {
    const lücke = f.map((row, k) => row.map((v, i) => (k === 0 && i === 0 ? null : v)))
    expect(isoSegments(x, z, lücke, 282).every(([x1]) => x1 >= 2)).toBe(true)
    expect(isoSegments(x, z, f, 400)).toEqual([])
  })

  it('wählt Linienwerte auf Vielfachen der Schrittweite', () => {
    expect(isoLevels(281.3, 288.1, 2)).toEqual([282, 284, 286, 288])
  })
})

describe('Anzeige', () => {
  it('rechnet in m/s bzw. km/h um', () => {
    expect(displayValue('w', -150)).toBeCloseTo(-1.5)
    expect(displayValue('along', 100)).toBeCloseTo(36)
  })

  it('hat eine neutrale Mitte und symmetrische Stufen', () => {
    for (const { scale } of Object.values(SECTION_SCALES)) {
      const v = scale.stops.map((s) => s.value)
      expect(v.map((x) => -x).reverse()).toEqual(v)
      expect(v.every((x, i) => i === 0 || x > v[i - 1])).toBe(true)
      expect(colorForValue(scale, 0)).toBe('#25282d')
      // Jenseits der Skala bleibt die äußerste Stufe, kein Loch
      expect(colorForValue(scale, -1000)).toBe(scale.stops[0].color)
      expect(colorForValue(scale, 1000)).toBe(scale.stops[scale.stops.length - 1].color)
    }
  })

  it('findet die nächste Fläche in der Spalte', () => {
    expect(nearestLevel([[100, 900], [1000, 1800], [2000, 2800]], 1, 1500)).toBe(1)
  })
})
