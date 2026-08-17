import { describe, expect, it } from 'vitest'
import {
  accumulateMembers,
  accumulateSeries,
  bucketMembers,
  percentileOf,
  plumeStats,
  readoutAt,
} from './plume'

describe('percentileOf', () => {
  it('trifft die Ränder', () => {
    expect(percentileOf([1, 2, 3, 4], 0)).toBe(1)
    expect(percentileOf([1, 2, 3, 4], 1)).toBe(4)
  })

  it('interpoliert linear zwischen den Stützstellen', () => {
    expect(percentileOf([0, 10], 0.5)).toBe(5)
    expect(percentileOf([0, 10, 20, 30], 0.5)).toBe(15)
    expect(percentileOf([0, 100], 0.1)).toBeCloseTo(10)
  })

  it('kommt mit ein und null Werten zurecht', () => {
    expect(percentileOf([7], 0.9)).toBe(7)
    expect(Number.isNaN(percentileOf([], 0.5))).toBe(true)
  })
})

describe('plumeStats', () => {
  const members = [
    [10, 20],
    [12, 24],
    [14, 28],
    [16, 32],
    [18, 36],
  ]

  it('rechnet Median und Extreme je Zeitschritt', () => {
    const s = plumeStats(members)
    expect(s.count).toEqual([5, 5])
    expect(s.median).toEqual([14, 28])
    expect(s.min).toEqual([10, 20])
    expect(s.max).toEqual([18, 36])
  })

  it('wertet je Zeitschritt nur die vorhandenen Mitglieder aus', () => {
    const s = plumeStats([
      [10, null],
      [20, 5],
      [30, 15],
    ])
    expect(s.count).toEqual([3, 2])
    expect(s.median).toEqual([20, 10])
  })

  it('liefert null, wo kein Mitglied einen Wert hat', () => {
    const s = plumeStats([[null], [null]])
    expect(s.count).toEqual([0])
    expect(s.median).toEqual([null])
    expect(readoutAt(s, 0)).toBeNull()
  })

  it('richtet sich nach der längsten Mitgliedsreihe', () => {
    const s = plumeStats([[1, 2, 3], [5]])
    expect(s.count).toEqual([2, 1, 1])
    expect(s.max).toEqual([5, 2, 3])
  })

  it('ignoriert NaN als fehlenden Wert', () => {
    const s = plumeStats([[Number.NaN], [4]])
    expect(s.count).toEqual([1])
    expect(s.median).toEqual([4])
  })
})

describe('accumulateMembers', () => {
  it('summiert je Mitglied über die Zeit auf', () => {
    expect(accumulateMembers([[1, 2, 3], [0, 0, 5]])).toEqual([
      [1, 3, 6],
      [0, 0, 5],
    ])
  })

  it('behandelt Lücken als 0 und bleibt monoton', () => {
    expect(accumulateMembers([[1, null, 2]])).toEqual([[1, 1, 3]])
  })
})

describe('readoutAt', () => {
  it('liefert die Spannweite p10…p90', () => {
    const s = plumeStats([[0], [10], [20], [30], [40]])
    const r = readoutAt(s, 0)
    expect(r?.count).toBe(5)
    expect(r?.median).toBe(20)
    expect(r?.spread).toBeCloseTo((r?.p90 as number) - (r?.p10 as number))
    expect(r?.min).toBe(0)
    expect(r?.max).toBe(40)
  })

  it('liefert null außerhalb des Zeitrasters', () => {
    const s = plumeStats([[1, 2]])
    expect(readoutAt(s, -1)).toBeNull()
    expect(readoutAt(s, 5)).toBeNull()
  })
})

describe('accumulateSeries', () => {
  it('summiert auf und behandelt Lücken mitten drin als 0', () => {
    expect(accumulateSeries([1, null, 2, 3])).toEqual([1, 1, 3, 6])
  })

  it('lässt den Schwanz nach dem letzten bekannten Wert null', () => {
    // dort endet der Modellhorizont — eine waagrecht weiterlaufende Summe
    // würde „ab hier trocken" behaupten, wo es keine Vorhersage mehr gibt
    expect(accumulateSeries([1, 2, null, null])).toEqual([1, 3, null, null])
  })

  it('gibt bei durchweg null nur null zurück', () => {
    expect(accumulateSeries([null, null])).toEqual([null, null])
  })
})

describe('bucketMembers', () => {
  const H = 3_600_000
  // Raster ab einem UTC-Mitternachtszeitpunkt, 13 Stunden
  const t0 = Date.UTC(2026, 0, 2)
  const times = Array.from({ length: 13 }, (_, i) => t0 + i * H)

  it('summiert je Mitglied die vorangegangenen 6 Stunden', () => {
    const m = [Array.from({ length: 13 }, () => 1)]
    const b = bucketMembers(times, m, 6)
    // Stützstellen sind 06 und 12 UTC — 00 UTC fehlt, weil das Fenster davor läge
    expect(b.times).toEqual([t0 + 6 * H, t0 + 12 * H])
    expect(b.members[0]).toEqual([6, 6])
  })

  it('richtet die Stützstellen an UTC-Vielfachen aus, nicht am Datenbeginn', () => {
    // Raster beginnt um 02 UTC → erste mögliche 6-h-Grenze ist 12 UTC
    const shifted = Array.from({ length: 13 }, (_, i) => t0 + (2 + i) * H)
    const b = bucketMembers(shifted, [Array.from({ length: 13 }, () => 2)], 6)
    expect(b.times).toEqual([t0 + 12 * H])
    expect(b.members[0]).toEqual([12])
  })

  it('lässt unvollständige Fenster leer statt eine Teilsumme zu zeigen', () => {
    const m = [[1, 1, 1, 1, 1, 1, 1, null, 1, 1, 1, 1, 1]]
    const b = bucketMembers(times, m, 6)
    expect(b.members[0]).toEqual([6, null]) // 06 UTC vollständig, 12 UTC nicht
  })

  it('bündelt alle Reihen auf identische Stützstellen', () => {
    const m = [Array.from({ length: 13 }, () => 1), Array.from({ length: 13 }, () => 3)]
    const b = bucketMembers(times, m, 6)
    expect(b.members).toEqual([
      [6, 6],
      [18, 18],
    ])
  })
})
