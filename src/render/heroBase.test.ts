import { describe, expect, it } from 'vitest'
import { dayFraction } from './heroBase'

describe('dayFraction', () => {
  it('Nacht unter der bürgerlichen Dämmerung, Tag knapp über dem Horizont, dazwischen stetig', () => {
    expect(dayFraction(-10)).toBe(0)
    expect(dayFraction(-6)).toBe(0)
    expect(dayFraction(4)).toBe(1)
    expect(dayFraction(30)).toBe(1)
    let prev = 0
    for (let e = -6; e <= 4; e += 0.5) {
      expect(dayFraction(e)).toBeGreaterThanOrEqual(prev)
      prev = dayFraction(e)
    }
  })
})
