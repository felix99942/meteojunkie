import { describe, expect, it } from 'vitest'
import { ENSEMBLE_MODELS } from './ensemble'
import { estimateRunInit, pickRunInit, runMetaDataset, runStartIndex } from './ensembleRun'

const H = 3_600_000
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m)

describe('estimateRunInit', () => {
  it('nimmt den letzten Termin, der schon bereitstehen dürfte', () => {
    // ICON-EU-EPS alle 6 h, ~3 h Bereitstellung: um 20 UTC ist es der 12-UTC-Lauf
    expect(estimateRunInit('icon_eu', 6, at(10, 20))).toBe(at(10, 12))
    // um 21:30 schon der 18-UTC-Lauf
    expect(estimateRunInit('icon_eu', 6, at(10, 21, 30))).toBe(at(10, 18))
    // ICON-D2-EPS alle 3 h, ~2 h: um 20 UTC der 18-UTC-Lauf
    expect(estimateRunInit('icon_d2_eps', 3, at(10, 20))).toBe(at(10, 18))
  })
  it('springt über Mitternacht zurück', () => {
    expect(estimateRunInit('ecmwf_ifs025', 6, at(11, 2))).toBe(at(10, 18))
  })
})

describe('pickRunInit', () => {
  it('nimmt frische Metadaten', () => {
    expect(pickRunInit(at(10, 6), at(10, 12), at(10, 20))).toBe(at(10, 6))
  })
  it('verwirft veraltete Metadaten (DWD stand am 10.11. auf dem 06.10.)', () => {
    expect(pickRunInit(Date.UTC(2026, 9, 6), at(10, 12), at(10, 20))).toBe(at(10, 12))
  })
  it('verwirft Metadaten aus der Zukunft und fehlende', () => {
    expect(pickRunInit(at(11, 0), at(10, 12), at(10, 20))).toBe(at(10, 12))
    expect(pickRunInit(null, at(10, 12), at(10, 20))).toBe(at(10, 12))
  })
})

describe('runStartIndex', () => {
  it('schneidet vor dem Laufstart ab', () => {
    const times = [0, 1, 2, 3, 4].map((i) => at(10, 10 + i))
    expect(runStartIndex(times, at(10, 12))).toBe(2)
    expect(runStartIndex(times, at(10, 0))).toBe(0)
  })
})

describe('Abdeckung', () => {
  it('jedes Ensemble der Registry hat eine Laufquelle', () => {
    for (const m of ENSEMBLE_MODELS) expect(runMetaDataset(m.id), m.id).not.toBeNull()
  })
  it('Schätzung liegt in der Vergangenheit und höchstens ein Intervall plus Bereitstellung zurück', () => {
    const now = at(10, 20, 17)
    for (const m of ENSEMBLE_MODELS) {
      const t = estimateRunInit(m.id, m.updateIntervalHours, now)
      expect(t).toBeLessThanOrEqual(now)
      expect(now - t).toBeLessThan((m.updateIntervalHours + 8) * H)
    }
  })
})
