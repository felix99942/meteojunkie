// Bezugszeitraum der Abweichung. Der Fehler, den diese Tests festhalten: ein
// LAUFENDER Zeitraum (Sommer im August) wurde gegen das VOLLE Normal gestellt.
// Bei der Sonnenscheindauer erreichte dadurch keine Station 100 %, obwohl der
// Sommer außergewöhnlich sonnig war — zwei Monate Messung gegen drei Monate
// Normal ergibt rechnerisch nie mehr als ~2/3.

import { describe, expect, it } from 'vitest'
import { normalFor, type NormalsMap, type PeriodCoverage } from './atValues'
import { getAtParameter } from '../config/atParameters'

const so = getAtParameter('so_h') // Summenparameter, annualAgg 'sum'
const tl = getAtParameter('tl_mittel') // Mittelparameter, annualAgg 'mean'
const tmax = getAtParameter('tlmax') // Maximum — Teil-Normal NICHT ableitbar

/** Monatsnormale Jun/Jul/Aug = 200/210/220 h bzw. °C-Mittel 15/17/16. */
const normals: NormalsMap = {
  1: {
    so_h: {
      monthly: [50, 70, 120, 160, 190, 200, 210, 220, 160, 110, 60, 40],
      seasonal: [160, 470, 630, 330],
      annual: 1590,
    },
    tl_mittel: {
      monthly: [-1, 1, 5, 9, 14, 15, 17, 16, 12, 8, 3, 0],
      seasonal: [0, 9.3, 16, 7.7],
      annual: 8.3,
    },
    tlmax: {
      monthly: [9, 12, 17, 21, 26, 29, 30, 29, 25, 21, 15, 9],
      seasonal: [13, 26, 31, 25],
      annual: 31,
    },
  },
}

const period = { kind: 'season', year: 2026, season: 'JJA' } as const

const fullSummer: PeriodCoverage = {
  months: [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
    { year: 2026, month: 8 },
  ],
  expected: 3,
  complete: true,
}

/** Juni + Juli abgeschlossen, August bis zum 17. gelaufen. */
const runningSummer: PeriodCoverage = {
  months: [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
  ],
  partial: { year: 2026, month: 8, days: 17, daysInMonth: 31 },
  expected: 3,
  complete: false,
}

describe('normalFor bei laufendem Zeitraum', () => {
  it('nimmt bei vollständiger Saison das vorberechnete Saison-Normal', () => {
    expect(normalFor(normals, so, period, 1, fullSummer)).toBe(630)
  })

  it('rechnet den laufenden Monat ANTEILIG in das Normal (Summenparameter)', () => {
    // 200 + 210 + 220·17/31 = 530,6 — nicht 630. Genau diese Differenz hat die
    // Sonnenscheinkarte um rund ein Drittel zu dunkel gemacht.
    const n = normalFor(normals, so, period, 1, runningSummer) as number
    expect(n).toBeCloseTo(200 + 210 + (220 * 17) / 31, 5)
    expect(n).toBeLessThan(630)
  })

  it('macht aus einem sonnigen Sommer keine Unterschreitung mehr', () => {
    const gemessen = 574 // Jun+Jul abgeschlossen plus 17 Augusttage
    const alt = (100 * gemessen) / 630
    const neu = (100 * gemessen) / (normalFor(normals, so, period, 1, runningSummer) as number)
    expect(alt).toBeLessThan(100) // der falsche Wert lag UNTER dem Normal
    expect(neu).toBeGreaterThan(100) // der richtige darüber
  })

  it('zählt den laufenden Monat bei Mittelparametern VOLL — ein Mittel hat keine Tageszahl', () => {
    const n = normalFor(normals, tl, period, 1, runningSummer) as number
    expect(n).toBeCloseTo((15 + 17 + 16) / 3, 5)
  })

  it('liefert für Maximum-Parameter KEIN Teil-Normal statt eines falschen', () => {
    // Das Mittel der Saisonmaxima ist etwas anderes als das Maximum der
    // Monatsnormale — nicht ableitbar, also lieber keine Abweichung
    expect(normalFor(normals, tmax, period, 1, runningSummer)).toBeNull()
    // vollständig geht es weiterhin über das vorberechnete Saison-Normal
    expect(normalFor(normals, tmax, period, 1, fullSummer)).toBe(31)
  })

  it('gibt null, wenn ein gebrauchtes Monatsnormal fehlt', () => {
    const gaps: NormalsMap = { 1: { so_h: { monthly: new Array(12).fill(null), annual: null } } }
    expect(normalFor(gaps, so, period, 1, runningSummer)).toBeNull()
  })
})
