import { describe, expect, it } from 'vitest'
import { FALLBACK_WIND, HERO_BOUNDS, heroProjection } from './heroWind'

describe('heroProjection', () => {
  it('hin und zurück ergibt denselben Ort', () => {
    const p = heroProjection(1200, 500)
    for (const [lon, lat] of [[13.04, 47.8], [-10, 60], [30, 40]]) {
      const [x, y] = p.project(lon, lat)
      const [lon2, lat2] = p.unproject(x, y)
      expect(lon2).toBeCloseTo(lon, 6)
      expect(lat2).toBeCloseTo(lat, 6)
    }
  })

  it('füllt die Fläche: die Mitte des Ausschnitts liegt in der Bildmitte, die Ränder ragen höchstens hinaus', () => {
    const w = 900
    const h = 900 // hochkant: Breite begrenzt nicht, die Höhe füllt
    const p = heroProjection(w, h)
    const [W, S, E, N] = HERO_BOUNDS
    const [xw] = p.project(W, (S + N) / 2)
    const [xe] = p.project(E, (S + N) / 2)
    const [, yn] = p.project((W + E) / 2, N)
    const [, ys] = p.project((W + E) / 2, S)
    expect(xw).toBeLessThanOrEqual(0.5)
    expect(xe).toBeGreaterThanOrEqual(w - 0.5)
    expect(yn).toBeLessThanOrEqual(0.5)
    expect(ys).toBeGreaterThanOrEqual(h - 0.5)
  })
})

describe('FALLBACK_WIND', () => {
  it('liefert überall einen endlichen Wind, mit Westwind als Grundströmung', () => {
    const [u] = FALLBACK_WIND(40, 20)!
    expect(u).toBeGreaterThan(0)
    expect(FALLBACK_WIND(56, 2)!.every(Number.isFinite)).toBe(true)
  })
})
