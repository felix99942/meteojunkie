// Saison-Zuordnung: der Dezember gehört zum Winter des FOLGEJAHRS. Diese
// Konvention teilen Karte, Rekorde und der Normale-Ingest — läuft sie
// auseinander, zeigt die Karte stillschweigend das falsche Quartal.

import { describe, expect, it } from 'vitest'
import { seasonMonths, seasonYearLabel, SEASONS, SEASON_LABEL } from './atValues'

describe('seasonMonths', () => {
  it('legt den Dezember des VORJAHRS in den Winter', () => {
    expect(seasonMonths('DJF')).toEqual([
      { month: 12, yearOffset: -1 },
      { month: 1, yearOffset: 0 },
      { month: 2, yearOffset: 0 },
    ])
  })

  it('hält die übrigen Jahreszeiten im selben Jahr', () => {
    expect(seasonMonths('MAM').map((m) => m.month)).toEqual([3, 4, 5])
    expect(seasonMonths('JJA').map((m) => m.month)).toEqual([6, 7, 8])
    expect(seasonMonths('SON').map((m) => m.month)).toEqual([9, 10, 11])
    for (const s of ['MAM', 'JJA', 'SON'] as const) {
      expect(seasonMonths(s).every((m) => m.yearOffset === 0)).toBe(true)
    }
  })

  it('deckt mit allen vier Saisons genau die zwölf Monate ab', () => {
    const all = SEASONS.flatMap((s) => seasonMonths(s).map((m) => m.month)).sort((a, b) => a - b)
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('seasonYearLabel', () => {
  it('nennt beim Winter BEIDE Jahre — sonst ist er zweideutig', () => {
    expect(seasonYearLabel('DJF', 2026)).toBe('Winter 2025/26')
  })

  it('nennt sonst nur das Jahr', () => {
    expect(seasonYearLabel('JJA', 2025)).toBe('Sommer 2025')
    expect(seasonYearLabel('SON', 2025)).toBe(`${SEASON_LABEL.SON} 2025`)
  })
})
