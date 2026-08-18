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
  fetchStationSeriesMulti,
  type AtStation,
} from './geosphere'
import { aggregate, type AtParameterSpec } from '../config/atParameters'
import { apparentTemperature, vaporPressureFromRH } from '../config/apparentTemperature'
import type { NormalPeriodId } from '../config/atNormals'

export type Season = 'DJF' | 'MAM' | 'JJA' | 'SON'
export const SEASONS: Season[] = ['DJF', 'MAM', 'JJA', 'SON']

export const SEASON_LABEL: Record<Season, string> = {
  DJF: 'Winter',
  MAM: 'Frühling',
  JJA: 'Sommer',
  SON: 'Herbst',
}

/**
 * Kalendermonate einer Saison. Der DEZEMBER gehört zum Winter des FOLGEJAHRS —
 * dieselbe Konvention wie bei den Rekorden (api/atRecords.ts, at-ingest-records)
 * und in der Klimatologie üblich. `year` ist deshalb bei DJF das Jahr von Januar
 * und Februar, der Dezember stammt aus `year - 1`.
 */
export function seasonMonths(season: Season): { month: number; yearOffset: number }[] {
  switch (season) {
    case 'DJF':
      return [
        { month: 12, yearOffset: -1 },
        { month: 1, yearOffset: 0 },
        { month: 2, yearOffset: 0 },
      ]
    case 'MAM':
      return [3, 4, 5].map((month) => ({ month, yearOffset: 0 }))
    case 'JJA':
      return [6, 7, 8].map((month) => ({ month, yearOffset: 0 }))
    case 'SON':
      return [9, 10, 11].map((month) => ({ month, yearOffset: 0 }))
  }
}

/** Beschriftung samt Jahr — beim Winter beide Jahre, sonst wäre er zweideutig. */
export function seasonYearLabel(season: Season, year: number): string {
  return season === 'DJF'
    ? `${SEASON_LABEL[season]} ${year - 1}/${String(year).slice(2)}`
    : `${SEASON_LABEL[season]} ${year}`
}

export type Period =
  | { kind: 'day'; day: string } // YYYY-MM-DD
  | { kind: 'month'; year: number; month: number } // month 1..12
  /** Meteorologische Jahreszeit; `year` = Jahr von Jan/Feb (Dezember aus year-1). */
  | { kind: 'season'; year: number; season: Season }
  | { kind: 'year'; year: number }
  /**
   * Langjähriges Mittel einer Klimaperiode. Genau EINER der beiden Bezüge ist
   * gesetzt: `month` (Kalendermonat) oder `season`; beide null → Jahreswert.
   */
  | { kind: 'normal'; periodId: NormalPeriodId; month: number | null; season?: Season | null }

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

/**
 * klima-v2-1m aggregiert erst mit spürbarer Verzögerung nach Monatsende (QC),
 * nicht sofort am 1. des Folgemonats. Ein Monat/Saison/Jahr, dessen Ende noch
 * in dieses Fenster fällt, KANN beim Abruf serverseitig noch null sein, obwohl
 * er kurz danach längst veröffentlicht ist — ohne TTL bliebe ein zu früh
 * gecachtes `null` aber FÜR IMMER hängen (`atcache.ts` cached historische
 * Abrufe standardmäßig ohne Ablauf). Innerhalb des Fensters deshalb eine kurze
 * TTL, damit sich der Eintrag von selbst korrigiert; danach gilt der Zeitraum
 * als endgültig und wird wie bisher für immer gecacht.
 */
const RECENT_PERIOD_GRACE_DAYS = 60
const RECENT_PERIOD_TTL_MS = 24 * 60 * 60 * 1000

/** TTL für einen Monats-/Saison-/Jahres-Abruf, dessen Ende `end` noch „frisch" ist. */
export function recentPeriodTtl(end: string): number | undefined {
  return end >= dayOffsetUtc(todayUtc(), -RECENT_PERIOD_GRACE_DAYS) ? RECENT_PERIOD_TTL_MS : undefined
}

/** Ob der Parameter im gewählten Zeitbezug überhaupt Werte hat. */
export function isParamAvailable(spec: AtParameterSpec, period: Period): boolean {
  // Abgeleitete Parameter (aktuell nur „gefühlte Temperatur") haben KEIN
  // GeoSphere-Feld und damit weder Tages- noch Monatsprodukt — nur der
  // laufende Tag lässt sich aus den zeitgleichen 10-Minuten-Messwerten
  // berechnen, ein vergangener Tag hätte nur einen Tagesmittel-Wind.
  if (spec.derived) return period.kind === 'day' && period.day >= todayUtc()
  return period.kind === 'day' || spec.monthlyCode != null
}

/**
 * Fehlwerte bereinigen. GeoSphere kodiert im TAGESdatensatz bei `rr`/`sh` NICHT
 * fehlende, sondern echte Nullmessungen als -1 ("kein Niederschlag" bzw. "kein
 * Schnee" laut Parameter-Metadata) — das ist ein gültiger Wert, keine Lücke,
 * und wird deshalb zu 0. Nur echte Ausreißer jenseits davon (< -1, sollte laut
 * Spezifikation nicht vorkommen) gelten weiter als Fehlwert. Vorher wurde JEDER
 * trockene Tag als fehlend behandelt — bei genug -1-Tagen in einer Periode kam
 * die Vollständigkeitsprüfung (`atHistory.ts`) nie auf ihre Sollzahl, und die
 * ganze Periode blieb leer, obwohl die Daten da waren.
 */
export function clean(spec: AtParameterSpec, v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (spec.category === 'Niederschlag' || spec.category === 'Schnee') {
    if (v === -1) return 0
    if (v < 0) return null
  }
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
  /**
   * Nur bei mehrmonatigen Zeitbezügen (Saison/Jahr): welche Kalendermonate
   * tatsächlich Daten geliefert haben. Der LAUFENDE Monat fehlt im
   * Monatsdatensatz (er wird erst nach Monatsende aggregiert) — eine
   * Saisonsumme aus zwei von drei Monaten gegen ein Drei-Monats-Normal zu
   * stellen ergibt systematisch zu niedrige Abweichungen. Die Karte rechnet
   * deshalb gegen das Normal DERSELBEN Monate und sagt es dazu.
   */
  coverage?: PeriodCoverage
}

export interface PeriodCoverage {
  /** ABGESCHLOSSENE Monate mit Daten, in Reihenfolge des Zeitbezugs. */
  months: { year: number; month: number }[]
  /**
   * Der laufende Monat, aus Tageswerten zusammengefasst. Er fehlt im
   * Monatsdatensatz (der aggregiert erst nach Monatsende), zählt hier aber
   * gleitend mit — sonst bräche die Saisonsumme mitten in der Saison ab.
   */
  partial?: { year: number; month: number; days: number; daysInMonth: number }
  /** Wie viele Monate der Zeitbezug erwartet (3 bei Saison, 12 beim Jahr). */
  expected: number
  /** Kurz: alle erwarteten Monate liegen ABGESCHLOSSEN vor. */
  complete: boolean
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * „Gefühlte Temperatur" für den laufenden Tag. Temperatur, relative Feuchte
 * und Windgeschwindigkeit sind im 10-Minuten-Datensatz zeitgleich vorhanden
 * (anders als im Tagesdatensatz, der nur einen Tagesmittel-Wind kennt) — EIN
 * Multi-Parameter-Request (`tl`,`rf`,`ff`), daraus je Zeitschritt die Formel,
 * danach derselbe `last`-Reduktionspfad wie jeder andere Live-Parameter.
 */
async function fetchLiveApparentTemperature(
  spec: AtParameterSpec,
  day: string,
  ids: number[],
  force: boolean,
): Promise<PeriodValues> {
  const byStation: Record<number, number | null> = {}
  const multi = await fetchStationSeriesMulti(
    ['tl', 'rf', 'ff'],
    `${day}T00:00`,
    `${day}T23:50`,
    ids,
    DATASET_10MIN,
    LIVE_TTL_MS,
    force,
  )
  const { tl, rf, ff } = multi
  const timestamps = tl?.timestamps ?? []
  let lastIdx = -1
  for (const id of ids) {
    const tlData = tl?.byStation[id]
    const rfData = rf?.byStation[id]
    const ffData = ff?.byStation[id]
    if (!tlData || !rfData || !ffData) {
      byStation[id] = null
      continue
    }
    const series = tlData.map((t, i) => {
      const h = rfData[i]
      const w = ffData[i]
      if (t == null || h == null || w == null || !Number.isFinite(t + h + w)) return null
      return apparentTemperature(t, vaporPressureFromRH(t, h), w)
    })
    for (let i = series.length - 1; i > lastIdx; i--) {
      if (series[i] != null) {
        lastIdx = i
        break
      }
    }
    byStation[id] = aggregate(series, spec.liveAgg ?? spec.agg)
  }
  return {
    byStation,
    unit: spec.unit,
    source: 'live',
    asOf: lastIdx >= 0 ? timestamps[lastIdx] : undefined,
  }
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

  // Nur Stationen, die der 10-Minuten-Datensatz kennt — unbekannte IDs lassen
  // den GESAMTEN Request mit HTTP 400 scheitern, nicht nur ihren Anteil.
  const ids = stations.filter((s) => s.has10min).map((s) => s.id)
  if (ids.length === 0) return { byStation, unit: spec.unit, source: 'live' }

  if (spec.derived === 'apparentTemperature') {
    return fetchLiveApparentTemperature(spec, day, ids, force)
  }
  if (!spec.liveCode) return { byStation, unit: spec.unit, source: 'live' }

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
 * Laufenden Monat aus TAGESwerten zusammenfassen — klima-v2-1m aggregiert erst
 * nach Monatsende und liefert bis dahin überall null. Gemeinsamer Kern für die
 * direkte Monatsauswahl UND für Saison/Jahr, die den laufenden Monat GLEITEND
 * mitzählen (`coverage.partial`); `days` ist die höchste über alle Stationen
 * beobachtete Tagesabdeckung, für den Tagesanteil am Monat in `partialNormal`.
 */
async function fetchRunningMonthPartial(
  spec: AtParameterSpec,
  year: number,
  month: number,
  ids: number[],
): Promise<{ byStation: Record<number, number | null>; days: number } | null> {
  const from = `${year}-${pad2(month)}-01`
  const d = await fetchStationSeries(spec.code, from, todayUtc(), ids, DATASET_DAILY)
  const byStation: Record<number, number | null> = {}
  let days = 0
  for (const id of ids) {
    const raw = d.byStation[id]
    if (!raw) continue
    const vals = raw.map((v) => clean(spec, v))
    const n = vals.filter((v) => v != null).length
    if (n > days) days = n
    byStation[id] = aggregate(vals, spec.agg)
  }
  return days > 0 ? { byStation, days } : null
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
      byStation[id] = normalValue(normals[id]?.[spec.monthlyCode], period.month, period.season)
    }
    return { byStation, unit: spec.unit, source: 'normal' }
  }

  if (period.kind === 'day') {
    // Laufender Tag: klima-v2-1d ist durchgehend null — direkt live holen.
    const today = todayUtc()
    if (period.day >= today) return fetchLiveDayValues(spec, period.day, stations, force)
    // Abgeleitete Parameter (s. `isParamAvailable`) gibt es nur am laufenden
    // Tag — `spec.code` ist bei ihnen kein echtes GeoSphere-Feld, ein Abruf
    // dafür würde nur einen HTTP-Fehler produzieren.
    if (spec.derived) return { byStation, unit: spec.unit, source: 'daily' }

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

  // Monat/Saison/Jahr über den Monatsdatensatz. Saison und Jahr fassen mehrere
  // Monatswerte mit `annualAgg` zusammen (Summe bleibt Summe, Maximum bleibt
  // Maximum) — der Monat nimmt den einen Wert direkt.
  if (!spec.monthlyCode) return { byStation, unit: spec.unit, source: 'monthly' }
  let start: string
  let end: string
  if (period.kind === 'month') {
    start = `${period.year}-${pad2(period.month)}-01`
    end = start
  } else if (period.kind === 'season') {
    // Beim Winter liegt der erste Monat im VORJAHR (Dezember-Konvention).
    const months = seasonMonths(period.season)
    const first = months[0]
    const last = months[months.length - 1]
    start = `${period.year + first.yearOffset}-${pad2(first.month)}-01`
    end = `${period.year + last.yearOffset}-${pad2(last.month)}-01`
  } else {
    start = `${period.year}-01-01`
    end = `${period.year}-12-01`
  }

  const s = await fetchStationSeries(spec.monthlyCode, start, end, ids, DATASET_MONTHLY, recentPeriodTtl(end))
  if (period.kind === 'month') {
    let hasAny = false
    for (const id of ids) {
      const data = s.byStation[id]?.map((v) => clean(spec, v))
      const v = data ? (data[0] ?? null) : null
      byStation[id] = v
      if (v != null) hasAny = true
    }
    // Laufender Monat: klima-v2-1m aggregiert erst nach Monatsende und liefert
    // bis dahin überall null. Saison/Jahr zählen ihn weiter unten längst
    // GLEITEND aus Tageswerten mit — eine direkte Monatsauswahl auf denselben
    // laufenden Monat zeigte bisher trotzdem nichts. Dieselbe Quelle also auch
    // hier anzapfen, statt bis Monatsende zu warten.
    const today = todayUtc()
    const isRunning =
      period.year === Number(today.slice(0, 4)) && period.month === Number(today.slice(5, 7))
    if (!hasAny && isRunning) {
      const r = await fetchRunningMonthPartial(spec, period.year, period.month, ids)
      if (r) {
        for (const id of ids) byStation[id] = r.byStation[id] ?? null
        return {
          byStation,
          unit: s.unit || spec.unit,
          source: 'monthly',
          coverage: {
            months: [],
            partial: {
              year: period.year,
              month: period.month,
              days: r.days,
              daysInMonth: daysInMonth(period.year, period.month),
            },
            expected: 1,
            complete: false,
          },
        }
      }
    }
    return { byStation, unit: s.unit || spec.unit, source: 'monthly' }
  }

  // Welche Kalendermonate der Zeitbezug braucht.
  const required =
    period.kind === 'season'
      ? seasonMonths(period.season).map((m) => ({ year: period.year + m.yearOffset, month: m.month }))
      : Array.from({ length: 12 }, (_, i) => ({ year: period.year, month: i + 1 }))

  // Index der gelieferten Monate, und welche davon überhaupt Werte tragen. Ein
  // Monat gilt als vorhanden, sobald IRGENDEINE Station dort misst — die Grenze
  // verläuft am Datensatz (laufender Monat = überall null), nicht an Stationen.
  const idxOf = new Map<string, number>()
  for (let i = 0; i < s.timestamps.length; i++) {
    idxOf.set(`${s.timestamps[i].slice(0, 4)}-${s.timestamps[i].slice(5, 7)}`, i)
  }
  const key = (m: { year: number; month: number }) => `${m.year}-${pad2(m.month)}`
  const hasData = (i: number | undefined) =>
    i !== undefined && ids.some((id) => clean(spec, s.byStation[id]?.[i] ?? null) != null)

  const months = required.filter((m) => hasData(idxOf.get(key(m))))

  // Laufender Monat: fehlt im Monatsdatensatz, wird aus TAGESwerten
  // zusammengefasst, damit die Reihe gleitend weiterläuft.
  const today = todayUtc()
  const nowYear = Number(today.slice(0, 4))
  const nowMonth = Number(today.slice(5, 7))
  const running = required.find(
    (m) => m.year === nowYear && m.month === nowMonth && !months.some((x) => key(x) === key(m)),
  )
  let partial: PeriodCoverage['partial']
  const partialByStation: Record<number, number | null> = {}
  if (running) {
    const r = await fetchRunningMonthPartial(spec, running.year, running.month, ids)
    if (r) {
      for (const id of ids) partialByStation[id] = r.byStation[id] ?? null
      partial = {
        year: running.year,
        month: running.month,
        days: r.days,
        daysInMonth: daysInMonth(running.year, running.month),
      }
    }
  }

  for (const id of ids) {
    const vals: (number | null)[] = months.map((m) => {
      const i = idxOf.get(key(m))
      return i === undefined ? null : clean(spec, s.byStation[id]?.[i] ?? null)
    })
    if (partial) vals.push(partialByStation[id] ?? null)
    byStation[id] = vals.some((v) => v != null) ? aggregate(vals, spec.annualAgg) : null
  }

  return {
    byStation,
    unit: s.unit || spec.unit,
    source: 'monthly',
    coverage: { months, partial, expected: required.length, complete: months.length >= required.length },
  }
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
  /**
   * Saison-Normale in SEASONS-Reihenfolge (DJF, MAM, JJA, SON). Muss eigens
   * vorberechnet werden und lässt sich NICHT aus `monthly` ableiten: bei
   * Maximum-Parametern ist das Mittel der Saisonmaxima etwas anderes als das
   * Maximum der Monatsmittel. Fehlt in Assets, die vor der Saison-Erweiterung
   * erzeugt wurden — dann gibt es für diesen Zeitbezug schlicht keinen Wert.
   */
  seasonal?: (number | null)[]
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
export function normalValue(
  entry: NormalsEntry | undefined,
  month: number | null,
  season?: Season | null,
): number | null {
  if (!entry) return null
  if (season) return entry.seasonal?.[SEASONS.indexOf(season)] ?? null
  return month == null ? entry.annual : (entry.monthly[month - 1] ?? null)
}

/**
 * Normal für einen NOCH LAUFENDEN Zeitbezug — aufgebaut aus genau dem Zeitraum,
 * der auch gemessen vorliegt. Ohne das vergleicht man zwei Monate Messung mit
 * drei Monaten Normal; bei der Sonnenscheindauer im laufenden Sommer erreicht
 * dann keine Station 100 %, egal wie sonnig es war.
 *
 * `sum`  → Summe der Monatsnormale; der laufende Monat ANTEILIG nach Tagen.
 *          Die Näherung unterstellt gleichmäßige Verteilung über den Monat —
 *          gut genug für „bisher", aber eben eine Näherung.
 * `mean` → Mittel der Monatsnormale; der laufende Monat zählt voll mit, ein
 *          Monatsmittel ist von der Zahl der Tage unabhängig.
 * `max`/`min` → NICHT ableitbar (das Mittel der Saisonmaxima ist etwas anderes
 *          als das Maximum der Monatsnormale) → null. Lieber keine Abweichung
 *          als eine falsche; die UI sagt, warum.
 */
function partialNormal(
  entry: NormalsEntry | undefined,
  spec: AtParameterSpec,
  coverage: PeriodCoverage,
): number | null {
  if (!entry) return null
  if (spec.annualAgg !== 'sum' && spec.annualAgg !== 'mean') return null
  const vals: number[] = []
  for (const m of coverage.months) {
    const v = entry.monthly[m.month - 1]
    if (v == null) return null
    vals.push(v)
  }
  if (coverage.partial) {
    const v = entry.monthly[coverage.partial.month - 1]
    if (v == null) return null
    vals.push(
      spec.annualAgg === 'sum' ? (v * coverage.partial.days) / coverage.partial.daysInMonth : v,
    )
  }
  if (vals.length === 0) return null
  return aggregate(vals, spec.annualAgg)
}

// --- Rekorde (vorberechnet, public/at/records/<id>.json + _national.json) --
//
// Drei Ebenen je Parameter: abs (absoluter Stationsrekord), mon[12]
// (Monatsrekorde je Kalendermonat) und sea (Saisonrekorde DJF/MAM/JJA/SON).
// Pro Station eine kleine Datei — nur die angeklickte wird geladen.

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
  /**
   * Deckung des tatsächlich gezeigten Zeitraums. Ist eine Saison/ein Jahr noch
   * unvollständig, wird das Normal aus DENSELBEN Kalendermonaten gebildet —
   * sonst vergleicht man zwei Monate Messung mit drei Monaten Normal.
   */
  coverage?: PeriodCoverage,
): number | null {
  if (period.kind === 'day' || !spec.monthlyCode) return null
  // Bezugsgröße muss zum Zeitbezug passen: eine Saisonsumme gegen das
  // JAHRESnormal wäre keine Abweichung, sondern ein Größenordnungsfehler.
  const month =
    period.kind === 'month' ? period.month : period.kind === 'normal' ? period.month : null
  const season =
    period.kind === 'season' ? period.season : period.kind === 'normal' ? period.season : null
  const entry = normals[stationId]?.[spec.monthlyCode]
  // Unvollständig ODER mit laufendem Monat → Normal auf denselben Zeitraum
  if (coverage && (!coverage.complete || coverage.partial)) {
    return partialNormal(entry, spec, coverage)
  }
  return normalValue(entry, month, season)
}
