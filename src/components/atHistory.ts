// Rechenkern der Perioden-Historie im Stationsdetail (getrennt von der
// Komponente, damit er ohne DOM testbar bleibt — wie atRank.ts).
//
// Idee: Klickt man eine Station an, während die Karte „Niederschlagssumme,
// Sommer, Abweichung" zeigt, sind Tagessummen des letzten Jahres nutzlos. Was
// interessiert, ist DIESELBE Größe über die letzten Jahre — also die Reihe der
// Sommersummen. Der Kern baut aus Monatswerten genau diese Reihe.
//
// VOLLSTÄNDIGKEIT ist Pflicht: eine Saison zählt nur mit allen drei Monaten,
// ein Jahr nur mit allen zwölf. Sonst stünde ein halber, noch laufender Sommer
// als auffällig trockener Sommer im Diagramm — dieselbe Regel, mit der
// scripts/at-ingest-normals.mjs die Normale bildet.

import { aggregate, type AggMode } from '../config/atParameters'
import { seasonMonths, type Season } from '../api/atValues'

export type HistoryScope =
  | { kind: 'month'; month: number }
  | { kind: 'season'; season: Season }
  | { kind: 'year' }

export interface HistoryPoint {
  /** Bei DJF das Jahr von Januar/Februar (Dezember stammt aus year-1). */
  year: number
  value: number | null
}

/** Die (Jahr, Monat)-Paare, aus denen ein Wert dieses Zeitbezugs entsteht. */
function requiredMonths(scope: HistoryScope, year: number): { year: number; month: number }[] {
  if (scope.kind === 'month') return [{ year, month: scope.month }]
  if (scope.kind === 'season')
    return seasonMonths(scope.season).map((m) => ({ year: year + m.yearOffset, month: m.month }))
  return Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }))
}

/**
 * Monatsreihe einer Station zu einer Reihe von Periodenwerten verdichten.
 * `timestamps` sind ISO-Strings des Monatsdatensatzes (YYYY-MM-…), `values`
 * liegt parallel dazu. `agg` ist dieselbe Reduktion, die auch die Karte nutzt
 * (`annualAgg` für Saison/Jahr) — sonst zeigte das Detail eine andere Größe als
 * die Karte, aus der man es geöffnet hat.
 */
export function buildHistory(
  timestamps: string[],
  values: (number | null)[],
  scope: HistoryScope,
  firstYear: number,
  lastYear: number,
  agg: AggMode,
): HistoryPoint[] {
  const byKey = new Map<string, number>()
  for (let i = 0; i < timestamps.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    byKey.set(`${timestamps[i].slice(0, 4)}-${timestamps[i].slice(5, 7)}`, v)
  }

  const out: HistoryPoint[] = []
  for (let year = firstYear; year <= lastYear; year++) {
    const need = requiredMonths(scope, year)
    const vals: number[] = []
    for (const m of need) {
      const v = byKey.get(`${m.year}-${String(m.month).padStart(2, '0')}`)
      if (v === undefined) break
      vals.push(v)
    }
    out.push({ year, value: vals.length === need.length ? aggregate(vals, agg) : null })
  }
  return out
}

/** Ab welchem Monat der Abruf beginnen muss (der Winter braucht den Dezember davor). */
export function historyStart(scope: HistoryScope, firstYear: number): string {
  if (scope.kind === 'season' && seasonMonths(scope.season).some((m) => m.yearOffset < 0)) {
    return `${firstYear - 1}-12-01`
  }
  return `${firstYear}-01-01`
}

export interface HistoryStats {
  n: number
  min: number
  max: number
  mean: number
}

export function historyStats(points: HistoryPoint[]): HistoryStats | null {
  const nums = points.map((p) => p.value).filter((v): v is number => v != null)
  if (nums.length === 0) return null
  return {
    n: nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    mean: nums.reduce((a, b) => a + b, 0) / nums.length,
  }
}
