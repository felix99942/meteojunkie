import { describe, expect, it } from 'vitest'
import { lastDayOfMonth, monthOfYearRange, monthRange, pickExtremeDay, seasonRange } from './atRecords'

describe('monthRange', () => {
  it('deckt den ganzen Monat ab', () => {
    expect(monthRange('2013-08')).toEqual({ start: '2013-08-01', end: '2013-08-31' })
    expect(monthRange('2013-04')).toEqual({ start: '2013-04-01', end: '2013-04-30' })
  })

  it('berücksichtigt Schaltjahre', () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29)
    expect(lastDayOfMonth(2023, 2)).toBe(28)
    expect(monthRange('2024-02').end).toBe('2024-02-29')
  })

  it('füllt einstellige Monate auf', () => {
    expect(monthOfYearRange(1905, 1)).toEqual({ start: '1905-01-01', end: '1905-01-31' })
  })
})

describe('seasonRange', () => {
  it('beginnt den Winter im Dezember des VORJAHRS (Ingest-Konvention)', () => {
    expect(seasonRange('DJF', 1940)).toEqual({ start: '1939-12-01', end: '1940-02-29' })
  })

  it('deckt die übrigen Jahreszeiten ab', () => {
    expect(seasonRange('MAM', 2020)).toEqual({ start: '2020-03-01', end: '2020-05-31' })
    expect(seasonRange('JJA', 2013)).toEqual({ start: '2013-06-01', end: '2013-08-31' })
    expect(seasonRange('SON', 2013)).toEqual({ start: '2013-09-01', end: '2013-11-30' })
  })
})

describe('pickExtremeDay', () => {
  const ts = ['2013-08-06T00:00+00:00', '2013-08-07T00:00+00:00', '2013-08-08T00:00+00:00']

  it('findet den Tag zum Rekordwert', () => {
    expect(pickExtremeDay(ts, [36.1, 38.4, 40.5], 40.5)).toEqual({ day: '2013-08-08', ties: 1 })
  })

  it('toleriert die Rundung der Rekord-Assets', () => {
    expect(pickExtremeDay(ts, [36.1, 38.4, 40.5], 40.5)).toEqual({ day: '2013-08-08', ties: 1 })
    expect(pickExtremeDay(ts, [36.1, 38.4, 40.5], 40.55)?.day).toBe('2013-08-08')
    expect(pickExtremeDay(ts, [36.1, 38.4, 40.5], 40.7)).toBeNull()
  })

  it('zählt Mehrfachtreffer und nennt den ersten Tag', () => {
    expect(pickExtremeDay(ts, [40.5, 38.4, 40.5], 40.5)).toEqual({ day: '2013-08-06', ties: 2 })
  })

  it('überspringt Lücken und liefert ohne Treffer null', () => {
    expect(pickExtremeDay(ts, [null, Number.NaN, 40.5], 40.5)).toEqual({ day: '2013-08-08', ties: 1 })
    expect(pickExtremeDay(ts, [null, null, null], 40.5)).toBeNull()
    expect(pickExtremeDay([], [], 40.5)).toBeNull()
  })

  it('trifft auch negative Rekorde (Tiefstwerte)', () => {
    expect(pickExtremeDay(ts, [-30.2, -37.4, -31], -37.4)).toEqual({ day: '2013-08-07', ties: 1 })
  })
})
