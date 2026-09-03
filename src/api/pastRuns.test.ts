// Zuschnitt gecachter Laufreihen. Der Cache gibt einen GRÖSSEREN Zeitraum
// heraus und schneidet ihn zu — liegt die Grenze falsch, verschiebt sich die
// ganze Verifikation still um einen Tag.

import { describe, expect, it } from 'vitest'
import { sliceRuns, type PastRunSeries } from './pastRuns'

const H = 3600_000
/** Drei volle UTC-Tage ab 20.08. 00 UTC, Wert = Stundenindex. */
function series(): PastRunSeries {
  const t0 = Date.parse('2026-08-20T00:00:00Z')
  const timeMs = Array.from({ length: 72 }, (_, i) => t0 + i * H)
  const vals = timeMs.map((_, i) => i)
  return { elevation: 200, timeMs, best: [...vals], byLead: new Map([[1, [...vals]]]) }
}

describe('sliceRuns', () => {
  it('schneidet auf GANZE UTC-Tage, Endtag eingeschlossen', () => {
    const s = sliceRuns(series(), '2026-08-21', '2026-08-21')
    expect(s.timeMs).toHaveLength(24)
    expect(new Date(s.timeMs[0]).toISOString()).toBe('2026-08-21T00:00:00.000Z')
    expect(new Date(s.timeMs[23]).toISOString()).toBe('2026-08-21T23:00:00.000Z')
  })

  it('schneidet alle Reihen deckungsgleich mit der Zeitachse', () => {
    // Verrutschte eine Lead-Reihe gegen timeMs, sähe das Ergebnis plausibel
    // aus und wäre um Stunden verschoben — der teuerste denkbare Fehler hier.
    const s = sliceRuns(series(), '2026-08-21', '2026-08-22')
    expect(s.best).toHaveLength(48)
    expect(s.byLead.get(1)).toHaveLength(48)
    expect(s.best[0]).toBe(24)
    expect(s.byLead.get(1)![0]).toBe(24)
    expect(s.best[47]).toBe(71)
  })

  it('gibt den vollen Zeitraum zurück, wenn er genau passt', () => {
    expect(sliceRuns(series(), '2026-08-20', '2026-08-22').timeMs).toHaveLength(72)
  })

  it('behält die Höhe — sie gehört zur Reihe, nicht zum Ausschnitt', () => {
    expect(sliceRuns(series(), '2026-08-21', '2026-08-21').elevation).toBe(200)
  })

  it('liefert eine leere Reihe statt zu raten, wenn nichts im Fenster liegt', () => {
    expect(sliceRuns(series(), '2026-09-01', '2026-09-02').timeMs).toHaveLength(0)
  })
})
