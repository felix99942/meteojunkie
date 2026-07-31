import { describe, expect, it } from 'vitest'
import { alignSeries, type ForecastData } from './mosApi'

const hourly = (steps: string[], byStation: Record<string, (number | null)[]>): ForecastData => ({
  meta: { run: '2026-07-31T00:00:00.000Z', generated: '2026-07-31T00:10:00.000Z', source: 'test' },
  param: 't2m',
  unit: '°C',
  kind: 'hourly',
  timeSteps: steps,
  byStation,
})

const REF = ['2026-07-31T00:00:00.000Z', '2026-07-31T01:00:00.000Z', '2026-07-31T02:00:00.000Z']

describe('alignSeries', () => {
  it('übernimmt Werte bei identischer Zeitachse', () => {
    const d = hourly(REF, { '11035': [10, 11, 12] })
    expect(alignSeries(REF, d, '11035')).toEqual([10, 11, 12])
  })

  it('legt Werte über die TERMINE, nicht über den Index', () => {
    // Parameter beginnt eine Stunde später — Index-Matching würde alles um
    // einen Schritt verschieben.
    const d = hourly(REF.slice(1), { '11035': [11, 12] })
    expect(alignSeries(REF, d, '11035')).toEqual([null, 11, 12])
  })

  it('füllt unbekannte Termine mit null', () => {
    const d = hourly(['2026-07-31T01:00:00.000Z'], { '11035': [11] })
    expect(alignSeries(REF, d, '11035')).toEqual([null, 11, null])
  })

  it('liefert lauter null für eine unbekannte Station', () => {
    const d = hourly(REF, { '11035': [10, 11, 12] })
    expect(alignSeries(REF, d, '99999')).toEqual([null, null, null])
  })

  it('liefert lauter null, wenn die Datei fehlt', () => {
    expect(alignSeries(REF, null, '11035')).toEqual([null, null, null])
  })

  it('nutzt bei Tagesdateien die days-Achse', () => {
    const daily: ForecastData = {
      meta: { run: '2026-07-31T00:00:00.000Z', generated: '2026-07-31T00:10:00.000Z', source: 'test' },
      param: 'tmax',
      unit: '°C',
      kind: 'daily',
      days: ['2026-07-31', '2026-08-01'],
      byStation: { '11035': [28, 30] },
    }
    expect(alignSeries(['2026-07-31', '2026-08-01', '2026-08-02'], daily, '11035')).toEqual([28, 30, null])
  })

  it('behandelt kürzere Wertelisten als Lücke statt undefined', () => {
    const d = hourly(REF, { '11035': [10] })
    expect(alignSeries(REF, d, '11035')).toEqual([10, null, null])
  })
})
