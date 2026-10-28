// Tests der Wert→Farbe-Zuordnung für Punkt-/Stationskarten — Schritt 6.

import { describe, expect, it } from 'vitest'
import { COLOR_SCALES, colorForValue, type ColorScale } from './colorscales'

const stepped: ColorScale = {
  kind: 'stepped',
  stops: [
    { value: 0, color: '#000000' },
    { value: 10, color: '#111111' },
    { value: 20, color: '#222222' },
  ],
}

const steppedClamp: ColorScale = { ...stepped, belowMin: 'clamp' }

const linear: ColorScale = {
  kind: 'linear',
  belowMin: 'clamp',
  stops: [
    { value: 0, color: '#000000' },
    { value: 10, color: '#ffffff' },
  ],
}

describe('colorForValue (stepped)', () => {
  it('wählt das Band des letzten Stops ≤ Wert', () => {
    expect(colorForValue(stepped, 0)).toBe('#000000')
    expect(colorForValue(stepped, 5)).toBe('#000000')
    expect(colorForValue(stepped, 10)).toBe('#111111')
    expect(colorForValue(stepped, 25)).toBe('#222222')
  })

  it('unter dem Minimum: transparent (null) als Default', () => {
    expect(colorForValue(stepped, -1)).toBeNull()
  })

  it('unter dem Minimum: clamp → unterste Farbe', () => {
    expect(colorForValue(steppedClamp, -1)).toBe('#000000')
  })
})

describe('colorForValue (linear)', () => {
  it('interpoliert zwischen Stops', () => {
    expect(colorForValue(linear, 0)).toBe('#000000')
    expect(colorForValue(linear, 10)).toBe('#ffffff')
    expect(colorForValue(linear, 5)).toBe('#808080') // Mittelpunkt
  })
})

describe('Niederschlag (mm/h)', () => {
  const stops = COLOR_SCALES.precipitation.stops
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((x, i) => x - rgb(b)[i]))

  // Gemeldet: „es muss vorher schon mehr Blauabstufungen geben" — der größte
  // Teil jeder Regenfläche liegt unter 2 mm/h und stand in fast einem Hellblau
  it('hat bis 2 mm/h acht Stufen, alle BLAU und klar voneinander getrennt', () => {
    const low = stops.filter((s) => s.value <= 2)
    expect(low.length).toBe(8)
    for (const s of low) {
      const [r, g, b] = rgb(s.color)
      expect(b, s.color).toBeGreaterThan(r)
      expect(b, s.color).toBeGreaterThan(g)
    }
    for (let i = 1; i < low.length; i++) expect(dist(low[i].color, low[i - 1].color)).toBeGreaterThan(30)
  })

  it('wechselt erst über 2 mm/h den Farbton', () => {
    const [r, g, b] = rgb(stops.find((s) => s.value === 3)!.color)
    expect(g).toBeGreaterThan(b)
    expect(g).toBeGreaterThan(r)
  })
})
