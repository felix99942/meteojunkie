import { describe, expect, it } from 'vitest'
import { accumulateMembers, percentileOf, plumeStats, readoutAt } from './plume'

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
