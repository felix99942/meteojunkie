import { describe, expect, it } from 'vitest'
import { globeBarbGrid, screenBearing, windFromDeg } from './windBarbs'

describe('windFromDeg', () => {
  it('meteorologische Herkunftsrichtung aus u/v', () => {
    expect(windFromDeg(10, 0)).toBeCloseTo(270) // Westwind weht nach Osten
    expect(windFromDeg(0, -10)).toBeCloseTo(0) // Nordwind weht nach Süden
    expect(windFromDeg(-10, 0)).toBeCloseTo(90)
    expect(windFromDeg(0, 10)).toBeCloseTo(180)
  })
})

describe('screenBearing', () => {
  it('misst im Uhrzeigersinn ab oben', () => {
    expect(screenBearing({ x: 0, y: 0 }, { x: 0, y: -5 })).toBeCloseTo(0)
    expect(screenBearing({ x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(90)
    expect(Math.abs(screenBearing({ x: 0, y: 0 }, { x: 0, y: 5 }))).toBeCloseTo(180)
    expect(screenBearing({ x: 0, y: 0 }, { x: -5, y: 0 })).toBeCloseTo(-90)
  })
})

describe('globeBarbGrid', () => {
  it('nimmt nur die zugewandte Seite und lässt den Kugelrand weg', () => {
    const pts = globeBarbGrid(0, 0, 10)
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.every((p) => Math.abs(p.lon) < 73 && Math.abs(p.lat) < 73)).toBe(true)
  })

  it('wickelt über die Datumsgrenze', () => {
    expect(globeBarbGrid(0, 180, 10).some((p) => p.lon > 150 || p.lon < -150)).toBe(true)
  })

  it('drängt die Punkte nicht zu den Polen', () => {
    const row = (lat: number) => globeBarbGrid(90, 0, 10).filter((p) => p.lat === lat).length
    expect(row(60)).toBeCloseTo(36 * Math.cos((60 * Math.PI) / 180), 0)
    expect(row(80)).toBeLessThan(row(60))
  })
})
