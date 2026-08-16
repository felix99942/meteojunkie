// Perioden-/Anomalie-Auflösung der Österreich-Klimakarte (Schritt 5).
// Bündelt die Kartenwerte je nach Zeitbezug (Tag/Monat/Jahr) in EINEM
// Bulk-Request und liefert optional die Abweichung vom Normal.
//
//   Tag         → Tagesdatensatz klima-v2-1d, Einzeltag
//   Monat       → Monatsdatensatz klima-v2-1m, ein Monatswert je Station
//   Jahr        → Monatsdatensatz, 12 Monatswerte je Station → annualAgg
//   Klimaperiode→ vorberechnete Normale (public/at/normals-<id>.json), KEIN Request
//
// Schnee (kein Monatswert) ist nur im Tag-Modus verfügbar.

import {
  DATASET_10MIN,
  DATASET_DAILY,
  DATASET_MONTHLY,
  fetchStationSeries,
  type AtStation,
} from './geosphere'
import { aggregate, type AtParameterSpec } from '../config/atParameters'
import type { NormalPeriodId } from '../config/atNormals'

export type Period =
  | { kind: 'day'; day: string } // YYYY-MM-DD
  | { kind: 'month'; year: number; month: number } // month 1..12
  | { kind: 'year'; year: number }
  /** Langjähriges Mittel einer Klimaperiode; month = null → Jahreswert. */
  | { kind: 'normal'; periodId: NormalPeriodId; month: number | null }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Heutiges Datum in UTC — GeoSphere-Klimatage laufen 00–24 UTC. */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10)

const dayOffsetUtc = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Live-Werte des laufenden Tages sind noch unvollständig und ändern sich alle
 * 10 min — Cache deshalb kurz halten (der historische Pfad cacht für immer).
 */
const LIVE_TTL_MS = 5 * 60 * 1000

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
  /**
   * `live` = aus 10-Minuten-Messwerten des laufenden Tages zusammengefasst
   * (vorläufig, ungeprüft); `daily`/`monthly` = fertiges Klima-Aggregat;
   * `normal` = vorberechnetes 30-Jahres-Mittel aus dem Asset.
   */
  source: 'daily' | 'monthly' | 'live' | 'normal'
  /** Nur bei `live`: Zeitstempel des jüngsten verwendeten Messwerts (ISO). */
  asOf?: string
}

/**
 * Tageswerte des LAUFENDEN Tages aus dem 10-Minuten-Datensatz zusammenfassen.
 * klima-v2-1d aggregiert erst nach Tagesende, deshalb gibt es „heute" nur so.
 * Ein Bulk-Request über alle Stationen, wie im historischen Pfad.
 */
export async function fetchLiveDayValues(
  spec: AtParameterSpec,
  day: string,
  stations: AtStation[],
  force = false,
): Promise<PeriodValues> {
  const byStation: Record<number, number | null> = {}
  if (!spec.liveCode) return { byStation, unit: spec.unit, source: 'live' }

  // Nur Stationen, die der 10-Minuten-Datensatz kennt — unbekannte IDs lassen
  // den GESAMTEN Request mit HTTP 400 scheitern, nicht nur ihren Anteil.
  const ids = stations.filter((s) => s.has10min).map((s) => s.id)
  if (ids.length === 0) return { byStation, unit: spec.unit, source: 'live' }

  const s = await fetchStationSeries(
    spec.liveCode,
    `${day}T00:00`,
    `${day}T23:50`,
    ids,
    DATASET_10MIN,
    LIVE_TTL_MS,
    force,
  )

  const factor = spec.liveFactor ?? 1
  let lastIdx = -1
  for (const id of ids) {
    const data = s.byStation[id]
    if (!data) {
      byStation[id] = null
      continue
    }
    const cleaned = data.map((v) => clean(spec, v))
    for (let i = cleaned.length - 1; i > lastIdx; i--) {
      if (cleaned[i] != null) {
        lastIdx = i
        break
      }
    }
    const v = aggregate(cleaned, spec.liveAgg ?? spec.agg)
    byStation[id] = v == null ? null : v * factor
  }
  return {
    byStation,
    unit: spec.unit,
    source: 'live',
    asOf: lastIdx >= 0 ? s.timestamps[lastIdx] : undefined,
  }
}

/**
 * Kartenwerte für die Periode holen — ein Bulk-Request über alle Stationen.
 * `force` gilt nur dem laufenden Tag: dort umgeht es den TTL-Cache, damit der
 * „Aktuell"-Knopf wirklich den jüngsten Messpunkt holt. Historische Perioden
 * sind statisch und bleiben gecacht.
 */
export async function fetchPeriodValues(
  spec: AtParameterSpec,
  period: Period,
  stations: AtStation[],
  force = false,
): Promise<PeriodValues> {
  const ids = stations.map((s) => s.id)
  const byStation: Record<number, number | null> = {}

  // Klimaperiode: die Normale sind vorberechnet — kein GeoSphere-Abruf.
  if (period.kind === 'normal') {
    if (!spec.monthlyCode) return { byStation, unit: spec.unit, source: 'normal' }
    const normals = await loadNormals(period.periodId)
    for (const id of ids) {
      byStation[id] = normalValue(normals[id]?.[spec.monthlyCode], period.month)
    }
    return { byStation, unit: spec.unit, source: 'normal' }
  }

  if (period.kind === 'day') {
    // Laufender Tag: klima-v2-1d ist durchgehend null — direkt live holen.
    const today = todayUtc()
    if (period.day >= today) return fetchLiveDayValues(spec, period.day, stations, force)

    const s = await fetchStationSeries(spec.code, period.day, period.day, ids, DATASET_DAILY)
    let covered = 0
    for (const id of ids) {
      const data = s.byStation[id]
      const v = data ? aggregate(data.map((x) => clean(spec, x)), spec.agg) : null
      byStation[id] = v
      if (v != null) covered++
    }
    // Der Tagesdatensatz hinkt gelegentlich nach; für gestern dann live nachladen,
    // statt eine leere Karte zu zeigen.
    if (covered === 0 && period.day >= dayOffsetUtc(today, -1)) {
      return fetchLiveDayValues(spec, period.day, stations, force)
    }
    return { byStation, unit: s.unit || spec.unit, source: 'daily' }
  }

  // Monat/Jahr über den Monatsdatensatz
  if (!spec.monthlyCode) return { byStation, unit: spec.unit, source: 'monthly' }
  const [start, end, annual] =
    period.kind === 'month'
      ? [`${period.year}-${pad2(period.month)}-01`, `${period.year}-${pad2(period.month)}-01`, false]
      : [`${period.year}-01-01`, `${period.year}-12-01`, true]

  const s = await fetchStationSeries(spec.monthlyCode, start as string, end as string, ids, DATASET_MONTHLY)
  for (const id of ids) {
    const data = s.byStation[id]?.map((v) => clean(spec, v))
    byStation[id] = data ? (annual ? aggregate(data, spec.annualAgg) : (data[0] ?? null)) : null
  }
  return { byStation, unit: s.unit || spec.unit, source: 'monthly' }
}

// --- Normale je Klimaperiode (vorberechnet, public/at/normals-<id>.json) ---
//
// Eine Datei je Periode (1991–2020, 1961–1990), erzeugt von
// scripts/at-ingest-normals.mjs. Ein Normal entsteht dort nur aus mindestens 24
// VOLLSTÄNDIGEN Jahren der Periode — Stationen mit kurzer Reihe haben deshalb
// bewusst keinen Wert statt eines aus wenigen Jahren gemittelten Scheinnormals.

/** stationId → monthlyCode → { monthly[12], annual, ny }. */
export interface NormalsEntry {
  monthly: (number | null)[]
  annual: number | null
  /** Zahl der vollständigen Jahre hinter `annual` (Deckung der Periode). */
  ny?: number
}
export type NormalsMap = Record<number, Record<string, NormalsEntry>>

const normalsPromises = new Map<NormalPeriodId, Promise<NormalsMap>>()

/** Normale EINER Klimaperiode laden (je Periode einmal, prozessweit geteilt). */
export function loadNormals(periodId: NormalPeriodId): Promise<NormalsMap> {
  let p = normalsPromises.get(periodId)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}at/normals-${periodId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Normale ${periodId} nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { normals: NormalsMap }) => d.normals)
      .catch((err) => {
        normalsPromises.delete(periodId)
        throw err
      })
    normalsPromises.set(periodId, p)
  }
  return p
}

/** Monats- oder Jahresnormal aus einem Eintrag (month = null → Jahr). */
export function normalValue(entry: NormalsEntry | undefined, month: number | null): number | null {
  if (!entry) return null
  return month == null ? entry.annual : (entry.monthly[month - 1] ?? null)
}

// --- Rekorde (vorberechnet, public/at/records/<id>.json + _national.json) --
//
// Drei Ebenen je Parameter: abs (absoluter Stationsrekord), mon[12]
// (Monatsrekorde je Kalendermonat) und sea (Saisonrekorde DJF/MAM/JJA/SON).
// Pro Station eine kleine Datei — nur die angeklickte wird geladen.

export type Season = 'DJF' | 'MAM' | 'JJA' | 'SON'
export const SEASONS: Season[] = ['DJF', 'MAM', 'JJA', 'SON']
export const SEASON_LABEL: Record<Season, string> = {
  DJF: 'Winter',
  MAM: 'Frühling',
  JJA: 'Sommer',
  SON: 'Herbst',
}

/** Ein Extremwert: v = Wert; d = Monat (YYYY-MM, nur abs); y = Jahr; s/n = Station (nur national). */
export interface Extreme {
  v: number
  d?: string
  y?: number
  s?: number
  n?: string
}
export interface MaxMin {
  max: Extreme
  min: Extreme
}
export interface ParamRecords {
  abs: MaxMin
  mon: MaxMin[] // 12, Jänner … Dezember
  sea: Record<Season, MaxMin>
}
/** code → Rekorde einer Station. */
export type StationRecords = Record<string, ParamRecords>
/** code → absolute nationale Rekorde. */
export type NationalRecords = Record<string, MaxMin>

const stationRecordsCache = new Map<number, Promise<StationRecords | null>>()
let nationalPromise: Promise<NationalRecords> | null = null

/** Rekorde EINER Station laden (klein, je Station gecacht). null wenn keine. */
export function loadStationRecords(id: number): Promise<StationRecords | null> {
  let p = stationRecordsCache.get(id)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}at/records/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<StationRecords>) : null))
      .catch(() => null)
    stationRecordsCache.set(id, p)
  }
  return p
}

/** Österreichweite absolute Rekorde laden (einmal). */
export function loadNationalRecords(): Promise<NationalRecords> {
  if (!nationalPromise) {
    nationalPromise = fetch(`${import.meta.env.BASE_URL}at/records/_national.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Rekorde nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { national: NationalRecords }) => d.national)
      .catch((err) => {
        nationalPromise = null
        throw err
      })
  }
  return nationalPromise
}

/**
 * Bezugs-Normalwert für Station + Parameter + Periode. Der Zeitausschnitt der
 * Periode bestimmt, WELCHES Normal gilt (Monatswert ↔ Monatsnormal,
 * Jahreswert ↔ Jahresnormal); aus WELCHER Periode die Normale stammen,
 * entscheidet der Aufrufer über die übergebene Karte. null im Tag-Modus.
 */
export function normalFor(
  normals: NormalsMap,
  spec: AtParameterSpec,
  period: Period,
  stationId: number,
): number | null {
  if (period.kind === 'day' || !spec.monthlyCode) return null
  const month = period.kind === 'month' ? period.month : period.kind === 'normal' ? period.month : null
  return normalValue(normals[stationId]?.[spec.monthlyCode], month)
}
