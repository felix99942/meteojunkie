// Klimamonitor DEUTSCHLAND — Datenzugriff auf die vorgenerierten Assets unter
// public/de/ (erzeugt von `scripts/de-ingest-climate.mjs` im Deploy).
//
// Der DWD schickt keine CORS-Header, deshalb gibt es hier keinen Abruf beim
// Anbieter, nur same-origin-Dateien. Die Rückgabe hat dieselbe Form wie
// `fetchPeriodValues` der Österreich-Karte (`PeriodValues` samt Deckung des
// Zeitraums) — Karte, Abweichung, Rangliste und Teilzeiträume laufen damit
// ohne Sonderweg für beide Länder.

import type { AtStation } from './geosphere'
import {
  hasRecords,
  loadRecordIndex,
  recordLevel,
  seasonMonths,
  type NormalsMap,
  type Period,
  type PeriodCoverage,
  type PeriodValues,
} from './atValues'
import { aggregate, type AtParameterSpec } from '../config/atParameters'
import type { NormalPeriodId } from '../config/atNormals'

const BASE = `${import.meta.env.BASE_URL}de/`

export interface DeMeta {
  generated: string
  /** Jüngster Tag mit Tageswerten (YYYY-MM-DD) — meist gestern. */
  lastDay: string
  /** Ältester Tag mit Tageswerten (das „recent"-Fenster des DWD, ~1,5 Jahre). */
  dailyFrom: string
  /** Erstes Jahr mit Monatswerten. */
  monthlyFrom: number
  /** Jüngster abgeschlossener Monat (YYYY-MM). */
  lastMonth: string | null
  /**
   * Der laufende Tag aus den 10-Minuten-Werten (`today.json`), falls beim
   * letzten Ingest vorhanden — vorläufig, Stand `todayAsOf`.
   */
  today?: string | null
  todayAsOf?: string | null
  stations: number
  active: number
}

/** Größen mit TAGESwerten (Codes der Registry). */
const DAILY_CODES = new Set(['tl_mittel', 'tlmax', 'tlmin', 'rr', 'so_h', 'sh', 'rfb_mittel'])
/** Größen mit MONATSwerten (`monthlyCode` der Registry). */
const MONTHLY_CODES = new Set([
  'tl_mittel',
  'tlmax',
  'tlmin',
  'tlmax_mittel',
  'tlmin_mittel',
  'rr',
  'so_h',
  'tage_sommer',
  'tage_tropen',
  'tage_frost',
  'tage_eis',
  'tage_rr_1',
])


/**
 * Ob der DWD-Datensatz die Größe im Zeitbezug führt. Ergänzt
 * `isParamAvailable` (die Regeln je Größe gelten weiter): die gefühlte
 * Temperatur, rel. Feuchte als Monatswert und die Allzeit-Rekorde gibt es hier
 * nicht.
 */
export function deParamAvailable(spec: AtParameterSpec, period: Period): boolean {
  if (spec.derived) return false
  // Allzeit: Rekorde aus den Monatswerten (`de/records`), wie bei Österreich —
  // nur für Größen, die der DWD als Monatswert führt
  if (period.kind === 'record') return hasRecords(spec) && MONTHLY_CODES.has(spec.monthlyCode!)
  if (period.kind === 'day') return !spec.countRule && !spec.monthlyOnly && DAILY_CODES.has(spec.code)
  return spec.monthlyCode != null && MONTHLY_CODES.has(spec.monthlyCode)
}

// --- Laden ----------------------------------------------------------------

const cache = new Map<string, Promise<unknown>>()

function load<T>(path: string, optional = false): Promise<T | null> {
  let p = cache.get(path) as Promise<T | null> | undefined
  if (!p) {
    p = fetch(BASE + path)
      .then(async (r) => {
        // Der Dev-Server liefert für fehlende Dateien die Startseite (HTML)
        const json = r.ok && (r.headers.get('content-type') ?? '').includes('json')
        if (!json) {
          // Ein FEHLEN nicht merken: sonst bliebe eine Datei, die ein neuer
          // Deploy nachliefert, für die ganze Sitzung „nicht da"
          cache.delete(path)
          if (optional) return null
          throw new Error(`${path}: HTTP ${r.status}`)
        }
        return (await r.json()) as T
      })
      .catch((e) => {
        cache.delete(path)
        throw e
      })
    cache.set(path, p)
  }
  return p
}

export function loadDeMeta(): Promise<DeMeta> {
  return load<DeMeta>('meta.json').then((m) => {
    if (!m) throw new Error('Klimadaten Deutschland fehlen')
    return m
  })
}

export function loadDeStations(): Promise<AtStation[]> {
  return load<{ stations: AtStation[] }>('stations.json').then((d) => d?.stations ?? [])
}

export function loadDeNormals(periodId: NormalPeriodId): Promise<NormalsMap> {
  return load<{ normals: NormalsMap }>(`normals-${periodId}.json`).then((d) => d?.normals ?? {})
}

type CodeTable = Record<string, Record<string, (number | null)[]>>
interface YearFile {
  year: number
  codes: CodeTable
}
interface DayFile {
  day: string
  codes: Record<string, Record<string, number | null>>
}
interface RunningFile {
  year: number
  month: number
  days: number
  daysInMonth: number
  codes: Record<string, Record<string, number | null>>
}

const loadYear = (y: number) => load<YearFile>(`monthly/${y}.json`, true)

// --- Monatsreihe einer Station (Perioden-Historie) -----------------------

/**
 * Monatswerte einer Station zwischen `start` und `end` (beide YYYY-MM-01) in
 * der Form, die `fetchStationSeries` für Österreich liefert — damit
 * `AtPeriodHistory` beide Länder gleich zeichnet. Quelle ist die vorab
 * erzeugte Reihe `de/series/<id>.json` (ein Abruf je Station, gecacht).
 */
export async function loadDeSeries(
  code: string,
  start: string,
  end: string,
  id: number,
): Promise<{ timestamps: string[]; values: (number | null)[] }> {
  const f = await load<{ from: number; codes: Record<string, (number | null)[]> }>(`series/${id}.json`, true)
  const timestamps: string[] = []
  const values: (number | null)[] = []
  const arr = f?.codes[code]
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const ey = Number(end.slice(0, 4))
  const em = Number(end.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    timestamps.push(`${y}-${String(m).padStart(2, '0')}-01T00:00`)
    const i = f ? (y - f.from) * 12 + (m - 1) : -1
    values.push(arr && i >= 0 && i < arr.length ? arr[i] : null)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return { timestamps, values }
}

// --- Zeitraumwerte --------------------------------------------------------

export async function fetchDePeriodValues(
  spec: AtParameterSpec,
  period: Period,
  stations: AtStation[],
): Promise<PeriodValues> {
  const ids = stations.map((s) => s.id)
  const byStation: Record<number, number | null> = {}
  const empty = (source: PeriodValues['source']): PeriodValues => {
    for (const id of ids) byStation[id] = null
    return { byStation, unit: spec.unit, source }
  }

  if (period.kind === 'record') {
    if (!spec.monthlyCode) return empty('record')
    const idx = await loadRecordIndex(spec.monthlyCode, 'de')
    const level = recordLevel(idx, period)
    for (let i = 0; i < idx.ids.length; i++) byStation[idx.ids[i]] = level.v[i] ?? null
    for (const id of ids) if (!(id in byStation)) byStation[id] = null
    return { byStation, unit: spec.unit, source: 'record' }
  }

  if (period.kind === 'normal') {
    const code = spec.monthlyCode
    if (!code) return empty('normal')
    const normals = await loadDeNormals(period.periodId)
    for (const id of ids) {
      const e = normals[id]?.[code]
      byStation[id] = !e
        ? null
        : period.season
          ? (e.seasonal?.[['DJF', 'MAM', 'JJA', 'SON'].indexOf(period.season)] ?? null)
          : period.month == null
            ? e.annual
            : (e.monthly[period.month - 1] ?? null)
    }
    return { byStation, unit: spec.unit, source: 'normal' }
  }

  if (period.kind === 'day') {
    // Heute: aus den 10-Minuten-Werten, VORLÄUFIG — dieselbe Lesart wie der
    // Live-Tag der Österreich-Karte (`source: 'live'` samt Messzeitpunkt)
    const meta = await loadDeMeta().catch(() => null)
    if (meta?.today && period.day === meta.today) {
      const t = await load<DayFile & { asOf: string | null }>('today.json', true)
      const col = t?.codes[spec.code] ?? {}
      for (const id of ids) byStation[id] = col[id] ?? null
      return { byStation, unit: spec.unit, source: 'live', asOf: t?.asOf ?? undefined }
    }
    const d = await load<DayFile>(`daily/${period.day}.json`, true)
    const col = d?.codes[spec.code] ?? {}
    for (const id of ids) byStation[id] = col[id] ?? null
    return { byStation, unit: spec.unit, source: 'daily' }
  }

  const code = spec.monthlyCode
  if (!code) return empty('monthly')

  const required =
    period.kind === 'month'
      ? [{ year: period.year, month: period.month }]
      : period.kind === 'season'
        ? seasonMonths(period.season).map((m) => ({ year: period.year + m.yearOffset, month: m.month }))
        : Array.from({ length: 12 }, (_, i) => ({ year: period.year, month: i + 1 }))

  const files = new Map<number, YearFile | null>()
  for (const y of new Set(required.map((m) => m.year))) files.set(y, await loadYear(y))
  const valueOf = (id: number, m: { year: number; month: number }) =>
    files.get(m.year)?.codes[code]?.[id]?.[m.month - 1] ?? null
  // Ein Monat gilt als vorhanden, sobald IRGENDEINE Station dort einen Wert hat
  const months = required.filter((m) => ids.some((id) => valueOf(id, m) != null))

  // Laufender Monat: aus Tageswerten zusammengefasst (`running.json`)
  let partial: PeriodCoverage['partial']
  let runningVals: Record<string, number | null> | null = null
  const run = await load<RunningFile>('running.json', true)
  if (run && run.days > 0) {
    const want = required.find((m) => m.year === run.year && m.month === run.month)
    if (want && !months.some((m) => m.year === want.year && m.month === want.month)) {
      runningVals = run.codes[code] ?? {}
      partial = { year: run.year, month: run.month, days: run.days, daysInMonth: run.daysInMonth }
    }
  }

  for (const id of ids) {
    const vals = months.map((m) => valueOf(id, m))
    if (runningVals) vals.push(runningVals[id] ?? null)
    // Saison und Jahr nur aus ALLEN Monaten der Station. Gemessen (2025):
    // 43 Stationen mit Lücken — Reit im Winkl hat nur Jänner bis März und
    // stand mit 1,0 °C „Jahresmittel" 6,4 K unter dem Normal, eine Summe
    // oder Kenntagzahl aus neun Monaten sähe genauso echt aus.
    byStation[id] =
      period.kind === 'month'
        ? (vals[0] ?? null)
        : vals.length > 0 && vals.every((v) => v != null)
          ? aggregate(vals, spec.annualAgg)
          : null
  }

  // Ein einzelner abgeschlossener Monat braucht keine Deckungsangabe
  if (period.kind === 'month' && !partial) return { byStation, unit: spec.unit, source: 'monthly' }
  return {
    byStation,
    unit: spec.unit,
    source: 'monthly',
    coverage: { months, partial, expected: required.length, complete: months.length >= required.length },
  }
}
