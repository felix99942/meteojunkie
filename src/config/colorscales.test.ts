// Tests der Wert→Farbe-Zuordnung für Punkt-/Stationskarten — Schritt 6.

import { describe, expect, it } from 'vitest'
import { colorForValue, type ColorScale } from './colorscales'

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
