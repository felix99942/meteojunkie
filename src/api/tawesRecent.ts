// Liest den rollenden TAWES-Speicher (`config/tawesStore.ts`) und rechnet daraus die Jetzt-Werte
// der Klimakarte für einen beliebigen Termin der letzten 3 Tage.

import { apparentTemperature, vaporPressureFromRH } from '../config/apparentTemperature'
import type { AtParameterSpec } from '../config/atParameters'
import {
  tawesSeries,
  tawesStepMs,
  TAWES_NT,
  TAWES_SLIDER_HOURS,
  TAWES_STEP_MS,
  TAWES_STORE_KEY,
  unpackTawesStore,
  type TawesCode,
  type TawesStore,
} from '../config/tawesStore'
import { clean, currentStationValue, lastValueIndex, type PeriodValues } from './atValues'

/** Älter als das, und der Speicher gilt als ausgefallen: dann direkt bei GeoSphere fragen */
const MAX_AGE_MS = 2 * 3_600_000

export async function loadTawesStore(force = false): Promise<TawesStore | null> {
  const r = await fetch(`${import.meta.env.BASE_URL}${TAWES_STORE_KEY}`, { cache: force ? 'no-cache' : 'default' }).catch(() => null)
  if (!r?.ok) return null
  const store = await unpackTawesStore(await r.arrayBuffer())
  return store && Date.now() - store.endMs < MAX_AGE_MS ? store : null
}

type Series = Map<number, (number | null)[]>

interface Prepared {
  series: Series
  /** Jüngster Termin, an dem irgendeine Station einen Wert hat */
  last: number
}

// Die Reihen werden beim Ziehen des Schiebers je Termin gebraucht, gerechnet nur einmal je Größe
const prepared = new WeakMap<TawesStore, Map<string, Prepared>>()
const rawSeries = new WeakMap<TawesStore, Map<TawesCode, Series>>()

function raw(store: TawesStore, code: TawesCode): Series {
  let m = rawSeries.get(store)
  if (!m) rawSeries.set(store, (m = new Map()))
  let s = m.get(code)
  if (!s) m.set(code, (s = tawesSeries(store, code)))
  return s
}

function prepare(spec: AtParameterSpec, store: TawesStore): Prepared {
  let m = prepared.get(store)
  if (!m) prepared.set(store, (m = new Map()))
  const hit = m.get(spec.code)
  if (hit) return hit
  const series: Series = new Map()
  if (spec.derived === 'apparentTemperature') {
    const [tl, rf, ff] = [raw(store, 'tl'), raw(store, 'rf'), raw(store, 'ff')]
    for (const id of store.ids) {
      const h = rf.get(id)
      const w = ff.get(id)
      series.set(
        id,
        tl.get(id)!.map((t, i) => {
          const hv = h?.[i]
          const wv = w?.[i]
          return t == null || hv == null || wv == null ? null : apparentTemperature(t, vaporPressureFromRH(t, hv), wv)
        }),
      )
    }
  } else {
    const source = raw(store, spec.liveCode as TawesCode)
    for (const id of store.ids) series.set(id, source.get(id)!.map((v) => clean(spec, v)))
  }
  let last = -1
  for (const s of series.values()) {
    for (let i = TAWES_NT - 1; i > last; i--) {
      if (s[i] != null) {
        last = i
        break
      }
    }
  }
  const out = { series, last }
  m.set(spec.code, out)
  return out
}

/** Bereich des Schiebers: `null`, wenn die Größe (noch) keine Werte hat */
export function tawesTimeRange(spec: AtParameterSpec, store: TawesStore): { firstMs: number; lastMs: number } | null {
  const { last } = prepare(spec, store)
  if (last < 0) return null
  const lastMs = tawesStepMs(store, last)
  return { firstMs: lastMs - TAWES_SLIDER_HOURS * 3_600_000, lastMs }
}

/** Werte aller Stationen zum Termin `atMs` (null = jüngster Stand) */
export function tawesValuesAt(
  spec: AtParameterSpec,
  store: TawesStore,
  ids: number[],
  atMs: number | null,
): PeriodValues {
  const { series, last } = prepare(spec, store)
  const at = atMs == null ? last : Math.min(last, TAWES_NT - 1 - Math.round((store.endMs - atMs) / TAWES_STEP_MS))
  const windowSteps = spec.liveWindowH ? spec.liveWindowH * 6 : null
  const factor = spec.liveFactor ?? 1
  const dd = spec.barbs ? raw(store, 'dd') : null
  const byStation: Record<number, number | null> = {}
  const direction: Record<number, number | null> = {}
  for (const id of ids) {
    const s = series.get(id)
    const v = s && at >= 0 ? currentStationValue(s, at, windowSteps, spec.liveAgg ?? spec.agg) : null
    byStation[id] = v == null ? null : spec.category === 'Wind' ? Math.round(v * factor) : v * factor
    if (dd && s && v != null) direction[id] = dd.get(id)?.[lastValueIndex(s, at)] ?? null
  }
  return {
    byStation,
    unit: spec.unit,
    source: 'live',
    asOf: at >= 0 ? new Date(tawesStepMs(store, at)).toISOString() : undefined,
    direction: spec.barbs ? direction : undefined,
  }
}
