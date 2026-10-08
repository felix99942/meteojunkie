// Gebietsmittel Deutschland — amtliche Flächenmittel des DWD je Bundesland
// und für Deutschland (`regional_averages_DE`, erzeugt in
// `scripts/de-ingest-climate.mjs` → public/de/regional.json).
//
// In der Karte steht jedes Land als EIN beschrifteter Wert an einem festen
// Punkt in seiner Fläche — dieselbe Darstellung wie die Stationskarte
// (`AtClimateMap`), deshalb als Pseudo-Stationen. Deutschland selbst steht
// nicht in der Karte, sondern in der Überschrift (Schlüssel `DE_ID`).
//
// Das NORMAL wird aus derselben Reihe gerechnet (Mittel der Jahre der
// Periode) und hat die Form von `NormalsMap` — `normalFor` und die ganze
// Abweichungslogik der Karte laufen damit unverändert.

import type { AtStation } from './geosphere'
import { SEASONS, type NormalsMap, type Period, type PeriodValues } from './atValues'
import type { AtParameterSpec } from '../config/atParameters'
import { normalPeriod, type NormalPeriodId } from '../config/atNormals'

/** Kennung für Deutschland im Ergebnis (`byStation[DE_ID]`), steht in keiner Stationsliste. */
export const DE_ID = 0

interface RegionPoint {
  /** Spaltenname beim DWD */
  key: string
  name: string
  /** Beschriftungspunkt — sichtbar in der Fläche, nicht der Schwerpunkt um jeden Preis */
  lat: number
  lon: number
}

/**
 * Die Länder, wie der DWD sie flächendeckend führt: Berlin, Hamburg und
 * Bremen nur zusammen mit dem Umland. Die Punkte liegen so, dass die Zahl
 * in der Fläche steht und Nachbarn sich nicht überdecken (Saarland,
 * Rheinland-Pfalz und Hessen liegen eng).
 */
export const REGION_POINTS: RegionPoint[] = [
  { key: 'Schleswig-Holstein', name: 'Schleswig-Holstein', lat: 54.25, lon: 9.7 },
  { key: 'Mecklenburg-Vorpommern', name: 'Mecklenburg-Vorpommern', lat: 53.75, lon: 12.55 },
  { key: 'Niedersachsen/Hamburg/Bremen', name: 'Niedersachsen mit Hamburg und Bremen', lat: 52.75, lon: 9.2 },
  { key: 'Brandenburg/Berlin', name: 'Brandenburg mit Berlin', lat: 52.4, lon: 13.4 },
  { key: 'Sachsen-Anhalt', name: 'Sachsen-Anhalt', lat: 52.0, lon: 11.7 },
  { key: 'Nordrhein-Westfalen', name: 'Nordrhein-Westfalen', lat: 51.45, lon: 7.55 },
  { key: 'Hessen', name: 'Hessen', lat: 50.6, lon: 9.05 },
  { key: 'Thueringen', name: 'Thüringen', lat: 50.85, lon: 11.05 },
  { key: 'Sachsen', name: 'Sachsen', lat: 51.05, lon: 13.35 },
  { key: 'Rheinland-Pfalz', name: 'Rheinland-Pfalz', lat: 49.95, lon: 7.35 },
  { key: 'Saarland', name: 'Saarland', lat: 49.38, lon: 6.95 },
  { key: 'Baden-Wuerttemberg', name: 'Baden-Württemberg', lat: 48.55, lon: 9.0 },
  { key: 'Bayern', name: 'Bayern', lat: 48.95, lon: 11.55 },
]

/** Die Länder als Pseudo-Stationen (Kennung 1 … 13) für Karte und Rangliste. */
export const REGION_STATIONS: AtStation[] = REGION_POINTS.map((r, i) => ({
  id: i + 1,
  name: r.name,
  state: null,
  lat: r.lat,
  lon: r.lon,
  altitude: null,
  validFrom: null,
  validTo: null,
  isActive: true,
  hasSunshine: false,
  hasRadiation: false,
  has10min: false,
}))

const keyOf = (id: number) => (id === DE_ID ? 'Deutschland' : REGION_POINTS[id - 1]?.key)

type ByYear<T> = Record<string, Record<string, T>> // region → Jahr → T
interface RegionalCode {
  annual: ByYear<number>
  monthly?: ByYear<(number | null)[]>
  seasonal?: ByYear<(number | null)[]>
}
interface RegionalFile {
  regions: string[]
  codes: Record<string, RegionalCode>
}

let filePromise: Promise<RegionalFile> | null = null
export function loadRegional(): Promise<RegionalFile> {
  filePromise ??= fetch(`${import.meta.env.BASE_URL}de/regional.json`)
    .then((r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json'))
        throw new Error('Gebietsmittel nicht ladbar')
      return r.json() as Promise<RegionalFile>
    })
    .catch((e) => {
      filePromise = null
      throw e
    })
  return filePromise
}

/** Größen mit Gebietsmittel — Kenntage nur jährlich (so führt sie der DWD). */
const CODES = new Set(['tl_mittel', 'rr', 'so_h', 'tage_frost', 'tage_eis', 'tage_sommer', 'tage_tropen'])
const ANNUAL_ONLY = new Set(['tage_frost', 'tage_eis', 'tage_sommer', 'tage_tropen'])

export function deRegionalAvailable(spec: AtParameterSpec, period: Period): boolean {
  const code = spec.monthlyCode
  if (!code || !CODES.has(code)) return false
  if (period.kind === 'day' || period.kind === 'record') return false
  if (!ANNUAL_ONLY.has(code)) return true
  return period.kind === 'year' || (period.kind === 'normal' && period.month == null && !period.season)
}

/** Ein Wert der Reihe für Monat/Saison/Jahr. */
function valueAt(c: RegionalCode, region: string, year: number, month: number | null, season: number | null) {
  if (month != null) return c.monthly?.[region]?.[year]?.[month - 1] ?? null
  if (season != null) return c.seasonal?.[region]?.[year]?.[season] ?? null
  return c.annual[region]?.[year] ?? null
}

/** Mittel über die Jahre einer Normalperiode (nur, wenn mindestens 24 der 30 da sind — WMO-Regel). */
function periodMean(c: RegionalCode, region: string, first: number, last: number, month: number | null, season: number | null) {
  const vals: number[] = []
  for (let y = first; y <= last; y++) {
    const v = valueAt(c, region, y, month, season)
    if (v != null) vals.push(v)
  }
  return vals.length >= 24 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

const normalsCache = new Map<NormalPeriodId, NormalsMap>()

/** Normale aus der Reihe selbst, in der Form von `NormalsMap` (Kennungen wie `REGION_STATIONS`, dazu `DE_ID`). */
export async function loadRegionalNormals(periodId: NormalPeriodId): Promise<NormalsMap> {
  const hit = normalsCache.get(periodId)
  if (hit) return hit
  const f = await loadRegional()
  const { firstYear, lastYear } = normalPeriod(periodId)
  const out: NormalsMap = {}
  for (let id = 0; id <= REGION_POINTS.length; id++) {
    const region = keyOf(id)
    out[id] = {}
    for (const [code, c] of Object.entries(f.codes)) {
      out[id][code] = {
        monthly: Array.from({ length: 12 }, (_, m) => periodMean(c, region, firstYear, lastYear, m + 1, null)),
        seasonal: [0, 1, 2, 3].map((s) => periodMean(c, region, firstYear, lastYear, null, s)),
        annual: periodMean(c, region, firstYear, lastYear, null, null),
      }
    }
  }
  normalsCache.set(periodId, out)
  return out
}

export async function fetchDeRegionalValues(spec: AtParameterSpec, period: Period): Promise<PeriodValues> {
  const byStation: Record<number, number | null> = {}
  const code = spec.monthlyCode
  const f = await loadRegional()
  const c = code ? f.codes[code] : undefined
  const ids = [DE_ID, ...REGION_STATIONS.map((s) => s.id)]
  if (!c || period.kind === 'day' || period.kind === 'record') {
    for (const id of ids) byStation[id] = null
    return { byStation, unit: spec.unit, source: 'monthly' }
  }
  if (period.kind === 'normal') {
    const n = await loadRegionalNormals(period.periodId)
    for (const id of ids) {
      const e = n[id]?.[code!]
      byStation[id] = !e
        ? null
        : period.season
          ? (e.seasonal?.[SEASONS.indexOf(period.season)] ?? null)
          : period.month == null
            ? e.annual
            : (e.monthly[period.month - 1] ?? null)
    }
    return { byStation, unit: spec.unit, source: 'normal' }
  }
  const month = period.kind === 'month' ? period.month : null
  const season = period.kind === 'season' ? SEASONS.indexOf(period.season) : null
  for (const id of ids) byStation[id] = valueAt(c, keyOf(id), period.year, month, season)
  return { byStation, unit: spec.unit, source: 'monthly' }
}

export interface RegionSeriesPoint {
  year: number
  value: number
}

/** Die ganze Reihe einer Region für den Ausschnitt des Zeitbezugs (Monat, Saison oder Jahr). */
export async function regionSeries(
  spec: AtParameterSpec,
  id: number,
  month: number | null,
  season: number | null,
): Promise<RegionSeriesPoint[]> {
  const f = await loadRegional()
  const c = spec.monthlyCode ? f.codes[spec.monthlyCode] : undefined
  if (!c) return []
  const region = keyOf(id)
  const src = month != null ? c.monthly?.[region] : season != null ? c.seasonal?.[region] : c.annual[region]
  if (!src) return []
  const out: RegionSeriesPoint[] = []
  for (const y of Object.keys(src).map(Number).sort((a, b) => a - b)) {
    const v = valueAt(c, region, y, month, season)
    if (v != null) out.push({ year: y, value: v })
  }
  return out
}

/**
 * Rang eines Jahres in der Reihe: 1 = höchster Wert. `of` zählt alle Jahre mit
 * Wert. Gleichstand teilt sich den besseren Rang.
 */
export function rankOf(series: RegionSeriesPoint[], year: number): { high: number; low: number; of: number } | null {
  const at = series.find((p) => p.year === year)
  if (!at) return null
  const high = 1 + series.filter((p) => p.value > at.value).length
  const low = 1 + series.filter((p) => p.value < at.value).length
  return { high, low, of: series.length }
}
