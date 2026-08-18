import { describe, expect, it } from 'vitest'
import { apparentTemperature, vaporPressureFromDewPoint, vaporPressureFromRH } from './apparentTemperature'

describe('vaporPressureFromRH', () => {
  it('steigt mit Temperatur und Feuchte', () => {
    expect(vaporPressureFromRH(25, 50)).toBeCloseTo(15.79, 1)
    expect(vaporPressureFromRH(25, 100)).toBeCloseTo(31.58, 1)
    expect(vaporPressureFromRH(0, 100)).toBeCloseTo(6.1, 1)
  })
})

describe('vaporPressureFromDewPoint', () => {
  it('entspricht der Sättigung bei Taupunkt-Temperatur', () => {
    expect(vaporPressureFromDewPoint(10)).toBeCloseTo(vaporPressureFromRH(10, 100), 6)
  })
})

describe('apparentTemperature', () => {
  it('wärmt bei Feuchte, kühlt bei Wind — AU-BOM-Formel', () => {
    // Warm, feucht, windstill: fühlt sich wärmer an als die Lufttemperatur.
    const warm = apparentTemperature(25, vaporPressureFromRH(25, 50), 0)
    expect(warm).toBeGreaterThan(25)

    // Kalt, windig: fühlt sich deutlich kälter an.
    const cold = apparentTemperature(0, vaporPressureFromRH(0, 80), 10)
    expect(cold).toBeLessThan(-5)

    // Referenzwert nachgerechnet: T=25°C, e=15,79 hPa, v=0 → 25+0,33·15,79-4.
    expect(apparentTemperature(25, 15.79, 0)).toBeCloseTo(26.21, 1)
  })

  it('ist linear in T, e und v (reine Formelprüfung)', () => {
    expect(apparentTemperature(10, 10, 5) - apparentTemperature(0, 10, 5)).toBeCloseTo(10, 6)
    expect(apparentTemperature(10, 20, 5) - apparentTemperature(10, 10, 5)).toBeCloseTo(3.3, 6)
    expect(apparentTemperature(10, 10, 15) - apparentTemperature(10, 10, 5)).toBeCloseTo(-7, 6)
  })
})
