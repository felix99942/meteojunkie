// Tests des Föhn-Rechenkerns.

import { describe, expect, it } from 'vitest'
import {
  alignSeries,
  difference,
  exceedanceProbability,
  foehnCriteria,
  foehnPhases,
  horizonEdge,
  inSector,
  memberDifferences,
  thetaDifference,
} from './foehn'
import { CREST_SECTORS } from '../config/foehn'

const H = 3_600_000

describe('alignSeries', () => {
  it('legt nach Zeitstempel an, nicht nach Index', () => {
    expect(alignSeries([0, H, 2 * H], [H, 2 * H], [5, 6])).toEqual([null, 5, 6])
  })
  it('ohne Daten nur Lücken', () => {
    expect(alignSeries([0, H], undefined, undefined)).toEqual([null, null])
  })
})

describe('difference / memberDifferences', () => {
  it('Süd − Nord, Lücke bleibt Lücke', () => {
    expect(difference([1015, null, 1010], [1010, 1000, null])).toEqual([5, null, null])
  })
  it('rechnet je Member und kappt auf die kürzere Memberliste', () => {
    const d = memberDifferences([[10], [20], [30]], [[1], [2]])
    expect(d).toEqual([[9], [18]])
  })
})

describe('exceedanceProbability', () => {
  const members = [[5], [3], [-6], [4]]
  it('Südföhn zählt ΔP ≥ Schwelle', () => {
    expect(exceedanceProbability(members, 4, 'south')).toEqual([50])
  })
  it('Nordföhn zählt ΔP ≤ −Schwelle', () => {
    expect(exceedanceProbability(members, 4, 'north')).toEqual([25])
  })
  it('fehlende Member zählen nicht in den Nenner', () => {
    expect(exceedanceProbability([[5], [null], [1], [null]], 4, 'south')).toEqual([50])
  })
  it('unter der Hälfte gültiger Member keine Zahl', () => {
    expect(exceedanceProbability([[5], [null], [null], [null]], 4, 'south')).toEqual([null])
  })
})

describe('inSector', () => {
  it('Südsektor ohne Umlauf', () => {
    expect(inSector(200, CREST_SECTORS.south)).toBe(true)
    expect(inSector(90, CREST_SECTORS.south)).toBe(false)
  })
  it('Nordsektor läuft über 360°', () => {
    expect(inSector(350, CREST_SECTORS.north)).toBe(true)
    expect(inSector(20, CREST_SECTORS.north)).toBe(true)
    expect(inSector(180, CREST_SECTORS.north)).toBe(false)
    expect(inSector(-10, CREST_SECTORS.north)).toBe(true)
  })
})

describe('thetaDifference', () => {
  it('durchmischte Schicht ergibt ~0 K', () => {
    // θ(−2 °C, 700 hPa) ≈ 300,2 K; dieselbe θ bei 950 hPa entspricht ≈ 22,7 °C.
    const [d] = thetaDifference([22.7], [950], [-2])
    expect(Math.abs(d!)).toBeLessThan(0.3)
  })
  it('Kaltluftsee im Tal ergibt deutlich negative Differenz', () => {
    const [d] = thetaDifference([2], [950], [-2])
    expect(d!).toBeLessThan(-15)
  })
})

describe('foehnCriteria', () => {
  const base = {
    dp: [6, 6, 2, null],
    crestSpeed: [50, 50, 50, null],
    crestDir: [200, 10, 200, null],
    leeRh: [35, 80, 35, null],
    dTheta: [-1, -8, -1, null],
  }
  it('bewertet jedes Kriterium in Föhnrichtung', () => {
    const c = foehnCriteria(base, 'south', 4)
    expect(c.pressure).toEqual([1, 1, 0, null])
    expect(c.crest).toEqual([1, 0, 1, null])
    expect(c.dry).toEqual([1, 0, 1, null])
    expect(c.mixed).toEqual([1, 0, 1, null])
    expect(c.score).toEqual([1, 0.25, 0.75, null])
  })
  it('Signal braucht Gradient UND keinen Gegenwind am Kamm', () => {
    const c = foehnCriteria(base, 'south', 4)
    expect(c.signal).toEqual([1, 0, 0, null])
  })
  it('fehlender Kammwind (Modell ohne 700 hPa): Gradient entscheidet allein, Score zählt n. v. mit', () => {
    const c = foehnCriteria(
      { ...base, crestSpeed: [null, null, null, null], crestDir: [null, null, null, null] },
      'south',
      4,
    )
    expect(c.signal).toEqual([1, 1, 0, null])
    expect(c.score[0]).toBe(0.75)
    expect(c.scoreText[0]).toBe('3/4 · 1 n. v.')
  })
})

describe('foehnPhases', () => {
  const grid = [0, 1, 2, 3, 4, 5, 6].map((h) => h * H)
  it('fasst zusammenhängende Stunden zusammen und verwirft Flackern', () => {
    const signal = [1, 1, 1, 0, 1, 0, 0]
    const dp = [4, 7, 5, 2, 9, 1, 0]
    expect(foehnPhases(grid, signal, dp, 'south')).toEqual([{ start: 0, end: 2 * H, peak: 7 }])
  })
  it('Phase am Rasterende wird geschlossen, Nordföhn-Peak positiv', () => {
    const signal = [0, 0, 0, 0, 1, 1, 1]
    const dp = [0, 0, 0, 0, -5, -9, -6]
    expect(foehnPhases(grid, signal, dp, 'north')).toEqual([{ start: 4 * H, end: 6 * H, peak: 9 }])
  })
})

describe('horizonEdge', () => {
  const grid = [0, 1, 2, 3, 4].map((h) => h * 3600_000)

  it('findet den ersten Zeitschritt hinter dem längsten Modell', () => {
    // Modell A endet nach Index 1, Modell B nach Index 2 → Rand bei Index 3.
    expect(horizonEdge(grid, [[1, 2, null, null, null], [1, 2, 3, null, null]])).toBe(
      3 * 3600_000,
    )
  })

  it('gibt null, wenn die Reihen bis zum Ende reichen', () => {
    expect(horizonEdge(grid, [[1, 2, 3, 4, 5]])).toBeNull()
  })

  it('gibt null bei komplett leeren Reihen — dort greift der empty-Text', () => {
    expect(horizonEdge(grid, [[null, null, null, null, null]])).toBeNull()
  })

  // Eine Lücke MITTEN in der Reihe ist kein Horizont: der Rand richtet sich
  // nach dem letzten vorhandenen Wert, nicht nach der ersten Lücke.
  it('ignoriert innere Lücken', () => {
    expect(horizonEdge(grid, [[1, null, 3, null, null]])).toBe(3 * 3600_000)
  })
})
