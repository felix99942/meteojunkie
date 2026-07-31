import { describe, expect, it } from 'vitest'
import { rankExtremes } from './atRank'

describe('rankExtremes', () => {
  it('reiht absteigend und liefert das untere Ende aufsteigend', () => {
    const values = [5, 1, 9, 3]
    const { top, bottom, n } = rankExtremes(values, 2)
    expect(n).toBe(4)
    expect(top).toEqual([2, 0]) // 9, 5
    expect(bottom).toEqual([1, 3]) // 1, 3
  })

  it('überspringt fehlende und ungültige Werte', () => {
    const values = [null, 4, Number.NaN, 2]
    const { top, bottom, n } = rankExtremes(values, 10)
    expect(n).toBe(2)
    expect(top).toEqual([1, 3])
    expect(bottom).toEqual([]) // beide stehen schon oben — kein zweites Ende
  })

  it('lässt die Enden nicht überlappen, wenn es weniger Werte als 2·count gibt', () => {
    const { top, bottom } = rankExtremes([1, 2, 3], 2)
    expect(top).toEqual([2, 1]) // 3, 2
    expect(bottom).toEqual([0]) // nur die 1 bleibt übrig
    expect(top.filter((i) => bottom.includes(i))).toEqual([])
  })

  it('gibt bei count ≥ n jede Station genau einmal aus', () => {
    const { top, bottom, n } = rankExtremes([7, 8], 5)
    expect(n).toBe(2)
    expect(top).toEqual([1, 0])
    expect(bottom).toEqual([])
  })

  it('kommt mit einer leeren Auswahl zurecht', () => {
    expect(rankExtremes([], 10)).toEqual({ top: [], bottom: [], n: 0 })
    expect(rankExtremes([null, null], 10)).toEqual({ top: [], bottom: [], n: 0 })
  })

  it('reiht auch negative Werte (Anomalien) korrekt', () => {
    const { top, bottom } = rankExtremes([-2.5, 1.5, -0.5], 1)
    expect(top).toEqual([1])
    expect(bottom).toEqual([0])
  })
})
