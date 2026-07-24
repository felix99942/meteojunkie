// Perioden-/Anomalie-Auflösung der Österreich-Klimakarte (Schritt 5).
// Bündelt die Kartenwerte je nach Zeitbezug (Tag/Monat/Jahr) in EINEM
// Bulk-Request und liefert optional die Abweichung vom Normal 1991–2020.
//
//   Tag   → Tagesdatensatz klima-v2-1d, Einzeltag
//   Monat → Monatsdatensatz klima-v2-1m, ein Monatswert je Station
//   Jahr  → Monatsdatensatz, 12 Monatswerte je Station → annualAgg
//
// Schnee (kein Monatswert) ist nur im Tag-Modus verfügbar.

import {
  DATASET_DAILY,
  DATASET_MONTHLY,
  fetchStationSeries,
  type AtStation,
} from './geosphere'
import { aggregate, type AtParameterSpec } from '../config/atParameters'

export type Period =
  | { kind: 'day'; day: string } // YYYY-MM-DD
  | { kind: 'month'; year: number; month: number } // month 1..12
  | { kind: 'year'; year: number }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Ob der Parameter im gewählten Zeitbezug überhaupt Werte hat. */
export function isParamAvailable(spec: AtParameterSpec, period: Period): boolean {
  return period.kind === 'day' || spec.monthlyCode != null
}

/** Fehlwerte bereinigen: bei Niederschlag/Schnee sind negative Werte Sentinels. */
function clean(spec: AtParameterSpec, v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if ((spec.category === 'Niederschlag' || spec.category === 'Schnee') && v < 0) return null
  return v
}

export interface PeriodValues {
  /** stationId → Absolutwert der Periode. */
  byStation: Record<number, number | null>
  unit: string
}

/** Kartenwerte für die Periode holen — ein Bulk-Request über alle Stationen. */
export async function fetchPeriodValues(
  spec: AtParameterSpec,
  period: Period,
  stations: AtStation[],
): Promise<PeriodValues> {
  const ids = stations.map((s) => s.id)
  const byStation: Record<number, number | null> = {}

  if (period.kind === 'day') {
    const s = await fetchStationSeries(spec.code, period.day, period.day, ids, DATASET_DAILY)
    for (const id of ids) {
      const data = s.byStation[id]
      byStation[id] = data ? aggregate(data.map((v) => clean(spec, v)), spec.agg) : null
    }
    return { byStation, unit: s.unit || spec.unit }
  }

  // Monat/Jahr über den Monatsdatensatz
  if (!spec.monthlyCode) return { byStation, unit: spec.unit }
  const [start, end, annual] =
    period.kind === 'month'
      ? [`${period.year}-${pad2(period.month)}-01`, `${period.year}-${pad2(period.month)}-01`, false]
      : [`${period.year}-01-01`, `${period.year}-12-01`, true]

  const s = await fetchStationSeries(spec.monthlyCode, start as string, end as string, ids, DATASET_MONTHLY)
  for (const id of ids) {
    const data = s.byStation[id]?.map((v) => clean(spec, v))
    byStation[id] = data ? (annual ? aggregate(data, spec.annualAgg) : (data[0] ?? null)) : null
  }
  return { byStation, unit: s.unit || spec.unit }
}

// --- Normale 1991–2020 (vorberechnet, public/at/normals.json) ------------

/** stationId → monthlyCode → { monthly[12], annual }. */
export interface NormalsEntry {
  monthly: (number | null)[]
  annual: number | null
}
export type NormalsMap = Record<number, Record<string, NormalsEntry>>

let normalsPromise: Promise<NormalsMap> | null = null

export function loadNormals(): Promise<NormalsMap> {
  if (!normalsPromise) {
    normalsPromise = fetch(`${import.meta.env.BASE_URL}at/normals.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Normale nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { normals: NormalsMap }) => d.normals)
      .catch((err) => {
        normalsPromise = null
        throw err
      })
  }
  return normalsPromise
}

// --- Rekorde (vorberechnet, public/at/records.json) ----------------------

export interface RecordExtreme {
  value: number
  date: string // YYYY-MM
  station?: number
  name?: string
}
export interface RecordsData {
  byStation: Record<number, Record<string, { max: RecordExtreme; min: RecordExtreme }>>
  national: Record<string, { max: RecordExtreme; min: RecordExtreme }>
}

let recordsPromise: Promise<RecordsData> | null = null

export function loadRecords(): Promise<RecordsData> {
  if (!recordsPromise) {
    recordsPromise = fetch(`${import.meta.env.BASE_URL}at/records.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Rekorde nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { byStation: RecordsData['byStation']; national: RecordsData['national'] }) => ({
        byStation: d.byStation,
        national: d.national,
      }))
      .catch((err) => {
        recordsPromise = null
        throw err
      })
  }
  return recordsPromise
}

/** Normalwert für Station + Parameter + Periode (Monat/Jahr). null im Tag-Modus. */
export function normalFor(
  normals: NormalsMap,
  spec: AtParameterSpec,
  period: Period,
  stationId: number,
): number | null {
  if (period.kind === 'day' || !spec.monthlyCode) return null
  const entry = normals[stationId]?.[spec.monthlyCode]
  if (!entry) return null
  return period.kind === 'month' ? (entry.monthly[period.month - 1] ?? null) : entry.annual
}
