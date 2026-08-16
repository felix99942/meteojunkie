// Tests der reinen Klima-Rechenkerne (Aggregation, Anomalie) — Schritt 6.

import { describe, expect, it } from 'vitest'
import { aggregate, anomaly, anomalyScaleFor, getAtParameter, scaleFor } from './atParameters'
import { colorForValue } from './colorscales'

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

describe('scaleFor', () => {
  const rr = getAtParameter('rr')
  const t = getAtParameter('tl_mittel')

  it('streckt die Niederschlagsskala auf Monat und Jahr', () => {
    expect(scaleFor(rr, 'day').stops.at(-1)!.value).toBe(100)
    expect(scaleFor(rr, 'month').stops.at(-1)!.value).toBe(1000)
    expect(scaleFor(rr, 'year').stops.at(-1)!.value).toBe(3000)
  })

  it('trennt Jahresniederschläge farblich, statt alles ins oberste Band zu legen', () => {
    const year = scaleFor(rr, 'year')
    const [dry, wet] = [600, 2000].map((v) => colorForValue(year, v))
    expect(dry).not.toBe(wet)
    // auf der Tagesskala lägen beide im obersten Band
    expect(colorForValue(rr.scale, 600)).toBe(colorForValue(rr.scale, 2000))
  })

  it('lässt Größen ohne Zeitbezugs-Skala unverändert', () => {
    expect(scaleFor(t, 'year')).toBe(t.scale)
  })
})

describe('anomalyScaleFor', () => {
  const t = getAtParameter('tl_mittel')

  it('nutzt die Wetterskala für Monat/Jahr', () => {
    expect(anomalyScaleFor(t, false)).toBe(t.anomalyScale)
  })

  it('löst das Klimasignal zwischen zwei Perioden feiner auf', () => {
    const climate = anomalyScaleFor(t, true)
    // +0,6 K und +1,2 K sind in der Wetterskala dasselbe Band, im Periodenvergleich nicht
    expect(colorForValue(t.anomalyScale, 0.6)).toBe(colorForValue(t.anomalyScale, 1.2))
    expect(colorForValue(climate, 0.6)).not.toBe(colorForValue(climate, 1.2))
  })
})
