// Eigene Modelle in der Verifikation (seit 2026-11-24, auf Wunsch): Varda und
// C-LAEF. Beide stehen NICHT bei Open-Meteo, ihre vergangenen Läufe gibt es
// also nicht über `previous_dayN`. GeoSphere hält von C-LAEF nur die letzten
// sechs Läufe vor (gemessen 2026-11-24: `available_forecast_reftimes`, 15 h),
// Varda rechnen wir selbst. Deshalb ein EIGENES Archiv, das ab dem ersten
// Lauf mitwächst:
//
//   Ingest (scripts/nwp_common.py, `points=True`) → je Lauf die Werte an den
//   aktiven Klimastationen: verify/points/<modell>/<lauf>.json
//   Worker (worker/verifyArchive.ts, stündlich) → je Station ein Archiv mit
//   denselben „gleitenden" Vorlaufreihen, die Open-Meteo als `previous_dayN`
//   liefert: verify/<modell>/<station>.json
//   Verifikation (api/ownRuns.ts) → liest das Archiv als `PastRunSeries`.
//
// Der reine Kern (Archiv fortschreiben, Reihe lesen) steht hier, damit Worker
// und Browser dieselbe Regel benutzen und sie ohne beides testbar ist.

import type { ModelInfo } from './models'

export interface OwnVerifyModel extends ModelInfo {
  /** Vorlaufzeiten in Tagen, die das Archiv führt. */
  leads: number[]
}

/**
 * Die Vorlaufzeiten folgen dem Horizont: Lead n braucht für JEDE Stunde einen
 * Lauf mit Init ≤ t − n·24 h, dessen Horizont t noch erreicht — also n·24 h
 * plus mindestens ein Lauftakt. C-LAEF (60 h, alle 3 h): +1 und +2 Tage.
 * Varda (120 h, alle 6 h): +1 bis +4.
 */
export const OWN_VERIFY_MODELS: OwnVerifyModel[] = [
  {
    id: 'arome-at',
    label: 'C-LAEF',
    provider: 'GeoSphere Austria',
    resolutionKm: 1,
    updateIntervalHours: 3,
    forecastHours: 60,
    // GeoSphere nwp-v2-1h-1km (bbox aus den Metadaten)
    coverage: { latMin: 43.0, latMax: 51.5, lonMin: 5.03, lonMax: 22.57 },
    supportsBoundingBox: false,
    availableVariables: ['temperature_2m', 'precipitation'],
    leads: [1, 2],
  },
  {
    id: 'varda',
    label: 'Varda (KI)',
    provider: 'MeteoSwiss Varda, eigene Rechnung',
    resolutionKm: 1,
    updateIntervalHours: 6,
    forecastHours: 120,
    // 1-km-Gebiet (ICON-CH1/KENDA)
    coverage: { latMin: 42.0, latMax: 50.5, lonMin: -0.8, lonMax: 17.7 },
    supportsBoundingBox: false,
    availableVariables: ['temperature_2m', 'precipitation'],
    leads: [1, 2, 3, 4],
  },
]

export const ownVerifyModel = (id: string): OwnVerifyModel | undefined => OWN_VERIFY_MODELS.find((m) => m.id === id)

/** So weit reicht das Archiv zurück — der längste Zeitraum der Verifikation ist 180 Tage. */
export const ARCHIVE_DAYS = 185
const HOUR = 3_600_000

/** Punktwerte EINES Laufs (vom Ingest geschrieben). */
export interface PointRun {
  model: string
  runId: string
  initMs: number
  /** Stunden seit Init. */
  steps: number[]
  /** Stations-IDs, Reihenfolge der Zeilen unten. */
  stations: number[]
  /** T2m in 0,1 °C je Station × Schritt. */
  t2m: (number | null)[][]
  /** Niederschlag als SUMME seit Init in 0,1 mm je Station × Schritt. */
  tp: (number | null)[][]
}

/** Archiv einer Station: stündliche Reihen je Vorlauf ab `startMs`. */
export interface StationArchive {
  startMs: number
  /** Init des jüngsten übernommenen Laufs — ältere, zu spät gekommene werden verworfen. */
  lastInit: number
  /** Vorlauf (Tage, als Schlüssel) → T2m (0,1 °C) und Stundenniederschlag (0,1 mm). */
  leads: Record<string, { t: (number | null)[]; p: (number | null)[] }>
}

export function emptyArchive(startMs: number): StationArchive {
  return { startMs, lastInit: 0, leads: {} }
}

/** Archiv auf einen neuen Beginn schieben (ältere Stunden fallen weg, Lücken vorn werden null). */
export function rebaseArchive(a: StationArchive, startMs: number): StationArchive {
  const shift = Math.round((startMs - a.startMs) / HOUR)
  if (shift === 0) return a
  const move = (arr: (number | null)[]) =>
    shift > 0 ? arr.slice(shift) : [...Array<null>(-shift).fill(null), ...arr]
  const leads: StationArchive['leads'] = {}
  for (const [k, v] of Object.entries(a.leads)) leads[k] = { t: move(v.t), p: move(v.p) }
  return { startMs, lastInit: a.lastInit, leads }
}

function put(arr: (number | null)[], i: number, v: number | null) {
  while (arr.length <= i) arr.push(null)
  arr[i] = v
}

/**
 * Einen Lauf in das Archiv einer Station übernehmen (Zeile `row` der
 * Punktdatei). Regel wie Open-Meteos `previous_dayN`: für jede Stunde t gilt
 * bei Vorlauf n der Wert des JÜNGSTEN Laufs mit Init ≤ t − n·24 h. Läufe
 * kommen in Init-Reihenfolge, also überschreibt ein späterer Lauf einfach —
 * ein zu spät gekommener ÄLTERER Lauf würde dagegen einen jüngeren
 * überschreiben und wird deshalb verworfen (Rückgabe false).
 *
 * Niederschlag: aus der Summe seit Init die Stundenmenge; liegen Schritte
 * mehr als eine Stunde auseinander, wird die Menge gleichmäßig verteilt (wie
 * Open-Meteo es bei 3-stündlichen Modellen tut).
 */
export function applyRun(a: StationArchive, run: PointRun, row: number, leads: number[]): boolean {
  if (run.initMs < a.lastInit) return false
  const t2m = run.t2m[row]
  const tp = run.tp[row]
  for (let i = 0; i < run.steps.length; i++) {
    const h = run.steps[i]
    const at = run.initMs + h * HOUR
    const idx = Math.round((at - a.startMs) / HOUR)
    // Stundenmengen des Intervalls (h_prev, h]
    let hourly: { idx: number; h: number; v: number | null }[] = []
    // Bei +0 gibt es keine Stundenmenge
    if (i > 0) {
      const gap = h - run.steps[i - 1]
      const a1 = tp[i]
      const a0 = tp[i - 1]
      const per = a1 == null || a0 == null || gap <= 0 ? null : Math.max(0, a1 - a0) / gap
      hourly = Array.from({ length: Math.max(0, gap) }, (_, k) => ({
        idx: idx - k,
        h: h - k,
        v: per == null ? null : Math.round(per),
      }))
    }
    for (const n of leads) {
      const key = String(n)
      const slot = (a.leads[key] ??= { t: [], p: [] })
      if (h >= n * 24 && idx >= 0) put(slot.t, idx, t2m[i])
      for (const q of hourly) if (q.h >= n * 24 && q.idx >= 0) put(slot.p, q.idx, q.v)
    }
  }
  a.lastInit = run.initMs
  return true
}

/**
 * Archiv → stündliche Reihe je Vorlauf in der Einheit der Größe (°C bzw. mm),
 * in der Form, die die Verifikation von Open-Meteo kennt (`PastRunSeries`).
 */
export function archiveSeries(
  a: StationArchive,
  variable: 'temperature_2m' | 'precipitation',
  leads: number[],
): { timeMs: number[]; byLead: Map<number, (number | null)[]> } {
  const len = Math.max(0, ...Object.values(a.leads).map((l) => Math.max(l.t.length, l.p.length)))
  const timeMs = Array.from({ length: len }, (_, i) => a.startMs + i * HOUR)
  const byLead = new Map<number, (number | null)[]>()
  for (const n of leads) {
    const src = a.leads[String(n)]
    const arr = src ? (variable === 'temperature_2m' ? src.t : src.p) : []
    byLead.set(
      n,
      timeMs.map((_, i) => {
        const v = arr[i]
        return v == null ? null : v / 10
      }),
    )
  }
  return { timeMs, byLead }
}

export const archiveKey = (model: string, station: number) => `verify/${model}/${station}.json`
export const POINTS_PREFIX = 'verify/points/'

/**
 * Höhenumrechnung der Temperatur auf die Station, wie Open-Meteo sie für die
 * übrigen Modelle macht: Standardgradient 0,65 K je 100 m. `cellHeight` ist die
 * genäherte Modellhöhe (scripts/build-verify-heights.py → ownVerifyHeights.json);
 * liegt die Station TIEFER als die Zelle, wird es wärmer. Eine Näherung — die
 * tatsächliche Schichtung (Inversion im Tal!) kennt sie nicht, aber es ist
 * dieselbe, die die Vergleichsmodelle bekommen.
 */
export const LAPSE_K_PER_M = 0.0065
export function heightCorrection(cellHeight: number | undefined, stationAltitude: number | null | undefined): number {
  if (cellHeight == null || stationAltitude == null || !Number.isFinite(stationAltitude)) return 0
  return LAPSE_K_PER_M * (cellHeight - stationAltitude)
}

