// Tests der reinen Normal-Auflösung (Klimaperioden-Zeitbezug).

import { describe, expect, it } from 'vitest'
import { normalFor, normalValue, type NormalsMap, type Period } from './atValues'
import { comparePeriod, normalPeriod } from '../config/atNormals'
import { getAtParameter } from '../config/atParameters'

const rr = getAtParameter('rr')
const monthly = Array.from({ length: 12 }, (_, i) => 50 + i)
const normals: NormalsMap = { 1: { rr: { monthly, annual: 1100, ny: 29 } } }

describe('normalValue', () => {
  it('month = null → Jahresnormal', () => {
    expect(normalValue(normals[1].rr, null)).toBe(1100)
  })

  it('month 1..12 → Monatsnormal', () => {
    expect(normalValue(normals[1].rr, 1)).toBe(50)
    expect(normalValue(normals[1].rr, 12)).toBe(61)
  })

  it('fehlender Eintrag → null (kein Scheinwert)', () => {
    expect(normalValue(undefined, null)).toBeNull()
  })
})

describe('normalFor', () => {
  it('Jahr und Klimaperiode ohne Monat ziehen das Jahresnormal', () => {
    const year: Period = { kind: 'year', year: 2024 }
    const clim: Period = { kind: 'normal', periodId: '1961-1990', month: null }
    expect(normalFor(normals, rr, year, 1)).toBe(1100)
    expect(normalFor(normals, rr, clim, 1)).toBe(1100)
  })

  it('Monat und Klimaperioden-Monat ziehen dasselbe Monatsnormal', () => {
    const month: Period = { kind: 'month', year: 2024, month: 3 }
    const clim: Period = { kind: 'normal', periodId: '1991-2020', month: 3 }
    expect(normalFor(normals, rr, month, 1)).toBe(52)
    expect(normalFor(normals, rr, clim, 1)).toBe(52)
  })

  it('Tag hat kein Normal', () => {
    expect(normalFor(normals, rr, { kind: 'day', day: '2024-03-01' }, 1)).toBeNull()
  })

  it('Parameter ohne Monatscode (Schnee) hat kein Normal', () => {
    const sh = getAtParameter('sh')
    expect(normalFor(normals, sh, { kind: 'year', year: 2024 }, 1)).toBeNull()
  })
})

describe('comparePeriod', () => {
  it('vergleicht mit der nächstälteren Periode', () => {
    expect(comparePeriod('1991-2020')).toBe('1961-1990')
  })

  it('die älteste Periode vergleicht sich mit der jüngeren — nie mit sich selbst', () => {
    expect(comparePeriod('1961-1990')).toBe('1991-2020')
  })

  it('Perioden sind 30-jährig und lückenlos gestaffelt', () => {
    for (const id of ['1991-2020', '1961-1990'] as const) {
      const p = normalPeriod(id)
      expect(p.lastYear - p.firstYear + 1).toBe(30)
    }
  })
})
