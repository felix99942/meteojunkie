// Rechenkern des Bereichs TAWES: aus den 10-Minuten-Reihen (`tawesStore.ts`) den Kartenwert je
// Station zum gewählten Termin. Rein, ohne Abruf — Tests in `tawesValues.test.ts`.

import { apparentTemperature, vaporPressureFromRH } from './apparentTemperature'
import { dewpoint } from '../lib/thermo'
import { tawesSeries, tawesStepMs, tawesStepOf, TAWES_NT, type TawesCode, type TawesStore } from './tawesStore'
import { displayOf, stepsFor, synopticWindow, type SynopticWindow, type TawesAgg, type TawesParam } from './tawesParameters'

export type Series = (number | null)[]

/**
 * Lückenregel je Fenster. Über eine Stunde darf die Hälfte fehlen (einzelne Termine fehlen
 * oft), darüber nur ein Viertel — sonst läge die Spitze womöglich gerade in der Lücke. Eine
 * SUMME verträgt auch über eine Stunde nur ein Viertel: sie würde mit jeder Lücke kleiner und
 * sähe trockener aus, als es war.
 */
export function minPresent(steps: number, agg: TawesAgg): number {
  if (steps <= 1) return 1
  const share = agg !== 'sum' && steps <= 6 ? 0.5 : 0.75
  return Math.ceil(steps * share)
}

function lastIndex(s: Series, at: number): number {
  for (let i = Math.min(at, s.length - 1); i >= 0; i--) if (s[i] != null) return i
  return -1
}

/** Wert nahe `i` (genau, sonst ein Schritt daneben) */
function near(s: Series, i: number): number | null {
  if (i < 0 || i >= s.length) return null
  return s[i] ?? s[i - 1] ?? s[i + 1] ?? null
}

/**
 * Wert einer Station zum Termin `at` (Index in der Reihe).
 * - `last`: der letzte Wert bis `at`, höchstens `maxAge` Schritte alt (ein stehengebliebener
 *   Fühler sähe sonst aktuell aus)
 * - `sum`/`max`/`min`/`mean`: über die `steps` Termine bis einschließlich `at`; reicht das
 *   Fenster vor den Anfang der Reihe, gibt es keinen Wert
 * - `change`: Wert bei `at` minus Wert `steps` Termine davor, je ±1 Termin Spielraum
 */
export function stationValue(s: Series, at: number, agg: TawesAgg, steps: number, maxAge = 6): number | null {
  if (at < 0) return null
  if (agg === 'last') {
    const i = lastIndex(s, at)
    return i < 0 || at - i > maxAge ? null : s[i]
  }
  if (agg === 'change') {
    const a = near(s, at)
    const b = near(s, at - steps)
    return a == null || b == null ? null : a - b
  }
  const from = at - steps + 1
  if (from < 0) return null
  let have = 0
  let acc = agg === 'max' ? -Infinity : agg === 'min' ? Infinity : 0
  for (let i = from; i <= at; i++) {
    const v = s[i]
    if (v == null) continue
    have++
    if (agg === 'max') acc = Math.max(acc, v)
    else if (agg === 'min') acc = Math.min(acc, v)
    else acc += v
  }
  if (have < minPresent(steps, agg)) return null
  return agg === 'mean' ? acc / have : acc
}

// --- Reihen je Größe, einmal je Speicher gerechnet ---------------------------------------------

export interface Prepared {
  series: Map<number, Series>
  /** Jüngster Termin, an dem irgendeine Station einen Wert hat (Stand des Netzes) */
  last: number
}

const cache = new WeakMap<TawesStore, Map<string, Prepared>>()

function clip(s: Series | undefined, valid?: [number, number]): Series | undefined {
  if (!s || !valid) return s
  return s.map((v) => (v == null || v < valid[0] || v > valid[1] ? null : v))
}

/** Reihen der Quellgröße (gefiltert auf `valid`); null, wenn eine nötige Rohgröße fehlt */
export function prepareParam(p: TawesParam, store: TawesStore): Prepared | null {
  let m = cache.get(store)
  if (!m) cache.set(store, (m = new Map()))
  const hit = m.get(p.source + (p.valid ? p.valid.join() : ''))
  if (hit) return hit

  const raw = (c: TawesCode) => (store.values[c] ? tawesSeries(store, c) : null)
  const series = new Map<number, Series>()
  if (p.source === 'dewpoint' || p.source === 'apparent') {
    const tl = raw('tl')
    const rf = raw('rf')
    const ff = p.source === 'apparent' ? raw('ff') : null
    if (!tl || !rf || (p.source === 'apparent' && !ff)) return null
    for (const id of store.ids) {
      const t = tl.get(id)!
      const h = rf.get(id)!
      const w = ff?.get(id)
      series.set(
        id,
        t.map((tv, i) => {
          const hv = h[i]
          if (tv == null || hv == null || hv <= 0 || hv > 100 || tv < -50 || tv > 50) return null
          if (p.source === 'dewpoint') return dewpoint(tv, hv)
          const wv = w?.[i]
          return wv == null || wv < 0 ? null : apparentTemperature(tv, vaporPressureFromRH(tv, hv), wv)
        }),
      )
    }
  } else {
    const src = raw(p.source)
    if (!src) return null
    for (const id of store.ids) series.set(id, clip(src.get(id), p.valid)!)
  }
  let last = -1
  for (const s of series.values()) last = Math.max(last, lastIndex(s, TAWES_NT - 1))
  const out = { series, last }
  m.set(p.source + (p.valid ? p.valid.join() : ''), out)
  return out
}

export interface TawesValues {
  /** Anzeigewert je Station (bereits mit `factor`) */
  byStation: Map<number, number | null>
  /** Richtung (Grad, woher) je Station — nur mit `withDir` und `p.dir` */
  direction?: Map<number, number | null>
  /** Index des gezeigten Termins */
  at: number
  /** Nur bei synoptischen Größen: der gezeigte Zeitraum */
  window?: SynopticWindow
}

/**
 * Kartenwerte aller Stationen zum Termin `atStep` (null = jüngster Stand des Netzes). Der
 * Termin wird auf den Stand des Netzes gedeckelt: weiter vorn hat noch keine Station gemeldet.
 */
export function tawesValues(
  p: TawesParam,
  precipSteps: number,
  store: TawesStore,
  atStep: number | null,
  withDir = false,
): TawesValues | null {
  const prep = prepareParam(p, store)
  if (!prep || prep.last < 0) return null
  const at = atStep == null ? prep.last : Math.min(prep.last, atStep)
  let steps = stepsFor(p, precipSteps)
  const { factor } = displayOf(p, steps)
  // Synoptisch: vom Beginn des Zeitraums bis zum Termin bzw. bis zu seinem Ende
  let end = at
  let window: SynopticWindow | undefined
  if (p.synoptic) {
    window = synopticWindow(tawesStepMs(store, at), p.synoptic)
    end = Math.min(at, tawesStepOf(store, window.endMs))
    steps = end - tawesStepOf(store, window.startMs)
  }
  const dirSeries = withDir && p.dir && store.values[p.dir] ? tawesSeries(store, p.dir) : null
  const byStation = new Map<number, number | null>()
  const direction = dirSeries ? new Map<number, number | null>() : undefined
  for (const [id, s] of prep.series) {
    const v = stationValue(s, end, p.agg, steps, p.maxAgeSteps)
    byStation.set(id, v == null ? null : v * factor)
    if (direction && v != null) {
      const d = dirSeries!.get(id)
      direction.set(id, d ? (d[lastIndex(s, end)] ?? null) : null)
    }
  }
  return { byStation, direction, at, window }
}

/** Rundet für die Anzeige (−0 wird 0) */
export function formatTawes(v: number, decimals: number): string {
  const r = Number(v.toFixed(decimals))
  return (Object.is(r, -0) ? 0 : r).toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
