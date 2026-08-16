// Registry der Klimaperioden (WMO-Normalperioden) der Österreich-Klimakarte.
//
// Eine Normalperiode ist der 30-jährige Bezugszeitraum, gegen den Anomalien
// gerechnet werden — und zugleich ein eigener Zeitbezug der Karte: „so viel
// Niederschlag fällt in einem DURCHSCHNITTLICHEN Jahr dieser Periode".
// Die Werte sind vorberechnet (public/at/normals-<id>.json,
// scripts/at-ingest-normals.mjs) und kosten deshalb keinen Request.
//
// Die Liste ist von NEU nach ALT sortiert; scripts/at-ingest-normals.mjs führt
// dieselben IDs — neue Periode immer in BEIDEN pflegen.

export type NormalPeriodId = '1991-2020' | '1961-1990'

export interface AtNormalPeriod {
  id: NormalPeriodId
  /** Anzeige mit Halbgeviertstrich. */
  label: string
  firstYear: number
  lastYear: number
}

export const AT_NORMAL_PERIODS: AtNormalPeriod[] = [
  { id: '1991-2020', label: '1991–2020', firstYear: 1991, lastYear: 2020 },
  { id: '1961-1990', label: '1961–1990', firstYear: 1961, lastYear: 1990 },
]

/** Bezugsperiode für Anomalien von Tag/Monat/Jahr — die aktuell gültige. */
export const DEFAULT_NORMAL_PERIOD: NormalPeriodId = AT_NORMAL_PERIODS[0].id

export function normalPeriod(id: NormalPeriodId): AtNormalPeriod {
  const p = AT_NORMAL_PERIODS.find((x) => x.id === id)
  if (!p) throw new Error(`Unbekannte Klimaperiode: ${id}`)
  return p
}

/**
 * Vergleichspartner einer Periode: die nächstältere, für die älteste die
 * nächstjüngere. Damit zeigt der Abweichungsmodus im Perioden-Zeitbezug immer
 * das Klimasignal ZWISCHEN zwei Perioden statt einer Reihe von Nullen.
 */
export function comparePeriod(id: NormalPeriodId): NormalPeriodId {
  const i = AT_NORMAL_PERIODS.findIndex((p) => p.id === id)
  const older = AT_NORMAL_PERIODS[i + 1]
  return (older ?? AT_NORMAL_PERIODS[i - 1] ?? AT_NORMAL_PERIODS[0]).id
}
