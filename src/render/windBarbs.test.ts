import { describe, expect, it } from 'vitest'
import { windFromDeg } from './windBarbs'

describe('windFromDeg', () => {
  it('meteorologische Herkunftsrichtung aus u/v', () => {
    expect(windFromDeg(10, 0)).toBeCloseTo(270) // Westwind weht nach Osten
    expect(windFromDeg(0, -10)).toBeCloseTo(0) // Nordwind weht nach Süden
    expect(windFromDeg(-10, 0)).toBeCloseTo(90)
    expect(windFromDeg(0, 10)).toBeCloseTo(180)
  })
})
