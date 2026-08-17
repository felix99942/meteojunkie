// Rechenkern der Perioden-Historie. Der Kern der Zusage: das Stationsdetail
// zeigt DIESELBE Größe wie die Karte, nur über mehrere Jahre — also darf hier
// nichts anders aggregiert werden als dort.

import { describe, expect, it } from 'vitest'
import { buildHistory, historyStart, historyStats } from './atHistory'

/** Monatsreihe bauen: [year, month, value]. */
function series(rows: [number, number, number | null][]) {
  return {
    timestamps: rows.map(([y, m]) => `${y}-${String(m).padStart(2, '0')}-01T00:00+00:00`),
    values: rows.map(([, , v]) => v),
  }
}

describe('buildHistory', () => {
  it('summiert die drei Sommermonate je Jahr', () => {
    const s = series([
      [2024, 6, 100],
      [2024, 7, 120],
      [2024, 8, 80],
      [2025, 6, 50],
      [2025, 7, 60],
      [2025, 8, 40],
    ])
    const out = buildHistory(s.timestamps, s.values, { kind: 'season', season: 'JJA' }, 2024, 2025, 'sum')
    expect(out).toEqual([
      { year: 2024, value: 300 },
      { year: 2025, value: 150 },
    ])
  })

  it('holt den Dezember beim Winter aus dem VORJAHR', () => {
    // Winter 2025 = Dez 2024 + Jan/Feb 2025 — dieselbe Konvention wie Karte,
    // Rekorde und Normale-Ingest
    const s = series([
      [2024, 12, 3],
      [2025, 1, 1],
      [2025, 2, 2],
    ])
    const out = buildHistory(s.timestamps, s.values, { kind: 'season', season: 'DJF' }, 2025, 2025, 'mean')
    expect(out).toEqual([{ year: 2025, value: 2 }])
  })

  it('lässt unvollständige Perioden LEER statt eine Teilsumme zu zeigen', () => {
    // Ein halber, noch laufender Sommer stünde sonst als auffällig trockener
    // Sommer im Diagramm
    const s = series([
      [2025, 6, 50],
      [2025, 7, 60],
    ])
    const out = buildHistory(s.timestamps, s.values, { kind: 'season', season: 'JJA' }, 2025, 2025, 'sum')
    expect(out).toEqual([{ year: 2025, value: null }])
  })

  it('verlangt beim Jahr alle zwölf Monate', () => {
    const full = series(Array.from({ length: 12 }, (_, i) => [2024, i + 1, 10] as [number, number, number]))
    expect(
      buildHistory(full.timestamps, full.values, { kind: 'year' }, 2024, 2024, 'sum')[0].value,
    ).toBe(120)
    const short = series([[2024, 1, 10]])
    expect(
      buildHistory(short.timestamps, short.values, { kind: 'year' }, 2024, 2024, 'sum')[0].value,
    ).toBeNull()
  })

  it('nimmt beim Kalendermonat den einen Wert direkt', () => {
    const s = series([
      [2023, 7, 21],
      [2024, 7, 24],
    ])
    const out = buildHistory(s.timestamps, s.values, { kind: 'month', month: 7 }, 2023, 2024, 'mean')
    expect(out.map((p) => p.value)).toEqual([21, 24])
  })

  it('behält Maximum-Semantik (nicht als Mittel verrechnen)', () => {
    const s = series([
      [2024, 6, 28],
      [2024, 7, 34],
      [2024, 8, 31],
    ])
    const out = buildHistory(s.timestamps, s.values, { kind: 'season', season: 'JJA' }, 2024, 2024, 'max')
    expect(out[0].value).toBe(34)
  })

  it('gibt für Jahre ohne jede Messung einen Platzhalter zurück', () => {
    const s = series([[2025, 7, 5]])
    const out = buildHistory(s.timestamps, s.values, { kind: 'month', month: 7 }, 2023, 2025, 'mean')
    expect(out.map((p) => p.value)).toEqual([null, null, 5])
  })
})

describe('historyStart', () => {
  it('beginnt beim Winter einen Monat früher', () => {
    expect(historyStart({ kind: 'season', season: 'DJF' }, 2011)).toBe('2010-12-01')
  })

  it('beginnt sonst im Januar des ersten Jahres', () => {
    expect(historyStart({ kind: 'season', season: 'JJA' }, 2011)).toBe('2011-01-01')
    expect(historyStart({ kind: 'year' }, 2011)).toBe('2011-01-01')
  })
})

describe('historyStats', () => {
  it('ignoriert Lücken', () => {
    const st = historyStats([
      { year: 1, value: 10 },
      { year: 2, value: null },
      { year: 3, value: 20 },
    ])
    expect(st).toEqual({ n: 2, min: 10, max: 20, mean: 15 })
  })

  it('meldet null, wenn nichts vollständig ist', () => {
    expect(historyStats([{ year: 1, value: null }])).toBeNull()
  })
})
