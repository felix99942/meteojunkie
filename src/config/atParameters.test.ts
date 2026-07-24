// Tests der reinen Klima-Rechenkerne (Aggregation, Anomalie) — Schritt 6.

import { describe, expect, it } from 'vitest'
import { aggregate, anomaly } from './atParameters'

describe('aggregate', () => {
  it('reduziert je Modus korrekt', () => {
    const v = [1, 2, 3, 4]
    expect(aggregate(v, 'mean')).toBe(2.5)
    expect(aggregate(v, 'sum')).toBe(10)
    expect(aggregate(v, 'max')).toBe(4)
    expect(aggregate(v, 'min')).toBe(1)
    expect(aggregate(v, 'last')).toBe(4)
  })

  it('ignoriert null/NaN-Lücken', () => {
    expect(aggregate([1, null, 3], 'mean')).toBe(2)
    expect(aggregate([null, 5, null], 'last')).toBe(5)
    expect(aggregate([Number.NaN, 2], 'sum')).toBe(2)
  })

  it('gibt null bei ausschließlich fehlenden Werten', () => {
    expect(aggregate([], 'mean')).toBeNull()
    expect(aggregate([null, null], 'sum')).toBeNull()
  })
})

describe('anomaly', () => {
  it('delta = Wert − Normal', () => {
    expect(anomaly(12, 10, 'delta')).toBe(2)
    expect(anomaly(8, 10, 'delta')).toBe(-2)
  })

  it('percent = 100·Wert/Normal', () => {
    expect(anomaly(150, 100, 'percent')).toBe(150)
    expect(anomaly(65, 130, 'percent')).toBe(50)
  })

  it('percent bei Normal 0 → null (keine Division durch 0)', () => {
    expect(anomaly(5, 0, 'percent')).toBeNull()
  })
})
