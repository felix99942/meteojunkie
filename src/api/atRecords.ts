// Tagesgenaue Auflösung der Stationsrekorde.
//
// Die vorgenerierten Rekord-Assets (public/at/records/) stammen aus dem
// MONATSdatensatz und kennen deshalb nur Monat bzw. Jahr. Der exakte Tag steckt
// aber im Tagesdatensatz: für `tlmax`/`tlmin` IST der Monatswert per Definition
// ein Tagesextrem ("Monats-Maximum aus 24-Stunden-Maximalwerten"), also genügt
// EIN Tagesabruf über den Rekordzeitraum, um den Tag zu finden — kein neuer
// Ingest über die gesamte Stationshistorie.
//
// Für Mittel- und Summenparameter (tl_mittel, rr, so_h) gibt es bewusst KEINE
// Auflösung: ein Monatsmittel bzw. eine Monatssumme hat keinen "Rekordtag".
//
// Die Abrufe laufen über fetchStationSeries und liegen damit für immer im
// IndexedDB-Cache (historische Tage ändern sich nicht).

import { DATASET_DAILY, fetchStationSeries } from './geosphere'
import type { Season } from './atValues'

/** Monatscodes, deren Monatswert ein echtes Tagesextrem ist → Tag auflösbar. */
export const DAY_RESOLVABLE: Record<string, 'max' | 'min'> = {
  tlmax: 'max',
  tlmin: 'min',
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Letzter Tag eines Monats (1..12), Schaltjahre inklusive. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `YYYY-MM` → Tagesbereich des Monats. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  return { start: `${month}-01`, end: `${month}-${pad2(lastDayOfMonth(y, m))}` }
}

/**
 * Saison → Tagesbereich. Winter (DJF) beginnt im DEZEMBER DES VORJAHRS — genau
 * die Konvention, mit der scripts/at-ingest-records.mjs die Saisonwerte bildet
 * (Dez zählt zum Winter des Folgejahrs). Eine andere Zuordnung würde den
 * Rekordwert im Zeitraum schlicht nicht finden.
 */
export function seasonRange(season: Season, year: number): { start: string; end: string } {
  switch (season) {
    case 'DJF':
      return { start: `${year - 1}-12-01`, end: `${year}-02-${pad2(lastDayOfMonth(year, 2))}` }
    case 'MAM':
      return { start: `${year}-03-01`, end: `${year}-05-31` }
    case 'JJA':
      return { start: `${year}-06-01`, end: `${year}-08-31` }
    case 'SON':
      return { start: `${year}-09-01`, end: `${year}-11-30` }
  }
}

/** Jahr + Kalendermonat (1..12) → Tagesbereich (für die Monatsrekorde). */
export function monthOfYearRange(year: number, month: number): { start: string; end: string } {
  return monthRange(`${year}-${pad2(month)}`)
}

export interface ExtremeDay {
  /** Tag des Rekords (YYYY-MM-DD). */
  day: string
  /** Wie oft der Wert im Zeitraum vorkommt (>1 → erstes Auftreten wird gezeigt). */
  ties: number
}

/**
 * Den Tag zum Rekordwert in einer Tagesreihe finden. Verglichen wird mit
 * Toleranz: die Assets runden auf zwei Nachkommastellen, die Tageswerte kommen
 * mit einer. Gibt es keinen Treffer (revidierte Reihe, Datenlücke), ist das
 * Ergebnis null — dann bleibt es beim Monat, statt einen falschen Tag zu
 * behaupten.
 */
export function pickExtremeDay(
  timestamps: string[],
  values: (number | null)[],
  target: number,
): ExtremeDay | null {
  let day: string | null = null
  let ties = 0
  for (let i = 0; i < timestamps.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    if (Math.abs(v - target) > 0.051) continue
    ties++
    if (day == null) day = timestamps[i].slice(0, 10)
  }
  return day == null ? null : { day, ties }
}

/** Ergebnis pro (Station, Code, Zeitraum, Wert) — auch Fehlschläge merken. */
const memo = new Map<string, Promise<ExtremeDay | null>>()

/**
 * Exakten Rekordtag holen. `code` ist der Parametercode (im Tagesdatensatz
 * identisch zum Monatscode), `start`/`end` der Zeitraum des Rekords.
 * Nicht auflösbare Codes ergeben null, ohne einen Request zu stellen.
 */
export function resolveExtremeDay(
  code: string,
  stationId: number,
  start: string,
  end: string,
  value: number,
): Promise<ExtremeDay | null> {
  if (!DAY_RESOLVABLE[code]) return Promise.resolve(null)
  const key = `${code}|${stationId}|${start}|${end}|${value}`
  let p = memo.get(key)
  if (!p) {
    p = fetchStationSeries(code, start, end, [stationId], DATASET_DAILY)
      .then((s) => pickExtremeDay(s.timestamps, s.byStation[stationId] ?? [], value))
      .catch(() => null)
    memo.set(key, p)
  }
  return p
}
