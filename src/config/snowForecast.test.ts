import { describe, expect, it } from 'vitest'
import {
  groupChanges,
  parseAromeSnow,
  pooledStats,
  snowGrid,
  sumFromStart,
  weightedQuantile,
  HOUR_MS,
} from './snowForecast'

describe('snowGrid', () => {
  it('beginnt an der laufenden Stunde und läuft stündlich', () => {
    const g = snowGrid(Date.UTC(2026, 10, 10, 17, 42), 1)
    expect(g[0]).toBe(Date.UTC(2026, 10, 10, 17))
    expect(g).toHaveLength(25)
    expect(g[1] - g[0]).toBe(HOUR_MS)
  })
})

describe('sumFromStart', () => {
  it('ist am ersten Punkt 0 und zählt erst die Stunden danach', () => {
    // Index 0 ist die Menge VOR dem Start — gehört nicht in die Summe
    expect(sumFromStart([5, 1, 2, null, 3])).toEqual([0, 1, 3, 3, 6])
  })
  it('endet hinter dem letzten Wert statt waagrecht weiterzulaufen', () => {
    expect(sumFromStart([0, 1, 1, null, null])).toEqual([0, 1, 2, null, null])
  })
  it('bleibt ganz leer ohne Werte', () => {
    expect(sumFromStart([null, null, null])).toEqual([null, null, null])
  })
})

describe('weightedQuantile', () => {
  it('trifft bei gleichen Gewichten den Median', () => {
    const pairs: [number, number][] = [1, 2, 3, 4, 5].map((v) => [v, 1])
    expect(weightedQuantile(pairs, 0.5)).toBe(3)
  })
  it('folgt dem Gewicht', () => {
    // 0 mit Gewicht 3, 10 mit Gewicht 1 → Median näher an 0
    expect(weightedQuantile([[0, 3], [10, 1]], 0.5)).toBeLessThan(5)
    expect(weightedQuantile([[0, 1], [10, 3]], 0.5)).toBeGreaterThan(5)
  })
  it('klemmt an den Rändern', () => {
    expect(weightedQuantile([[2, 1], [4, 1]], 0)).toBe(2)
    expect(weightedQuantile([[2, 1], [4, 1]], 1)).toBe(4)
  })
})

describe('pooledStats', () => {
  it('gibt jedem Ensemble dasselbe Gewicht, egal wie viele Member', () => {
    // Ensemble A: 50 Member bei 0, Ensemble B: 2 Member bei 10
    const a = Array.from({ length: 50 }, () => [0])
    const b = [[10], [10]]
    const s = pooledStats([a, b], 1)
    // je Member gezählt lägen Median UND P75 bei 0 (50 von 52 Werten); je
    // Ensemble gewichtet ist die obere Hälfte der Verteilung Ensemble B
    expect(s.median[0]).toBeGreaterThan(0)
    expect(s.p75[0]).toBe(10)
    expect(s.p10[0]).toBe(0)
    expect(s.groups[0]).toBe(2)
  })
  it('lässt ein beendetes Ensemble weg und meldet den Wechsel', () => {
    const a = [[0, 0, null], [0, 0, null]]
    const b = [[4, 4, 4]]
    const s = pooledStats([a, b], 3)
    expect(s.groups).toEqual([2, 2, 1])
    expect(s.median[2]).toBe(4)
    expect(groupChanges([0, 1, 2], s.groups)).toEqual([{ t: 2, from: 2, to: 1 }])
  })
})

describe('parseAromeSnow', () => {
  it('rechnet kg/m² wie Open-Meteo in cm (× 0,7)', () => {
    const r = parseAromeSnow({
      reference_time: '2026-11-10T12:00+00:00',
      timestamps: ['2026-11-10T18:00+00:00', '2026-11-10T19:00+00:00'],
      features: [{ properties: { parameters: { sf: { data: [10, null] } } } }],
    })
    expect(r.values).toEqual([7, null])
    expect(r.times[0]).toBe(Date.UTC(2026, 10, 10, 18))
    expect(r.run).toBe(Date.UTC(2026, 10, 10, 12))
  })
})
