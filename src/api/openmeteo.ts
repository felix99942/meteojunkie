// Typisierter Open-Meteo-API-Layer (SPEC §6) mit Request-Batching:
// Serien-Anfragen (Punkt × Modell × Variable), die im selben Tick anfallen,
// werden pro Punkt zu EINEM HTTP-Request gebündelt (Open-Meteo erlaubt mehrere
// Modelle und Variablen pro Call). Caching übernimmt TanStack Query darüber
// (siehe queries.ts) — hier wird nur dedupliziert und gebündelt.

import { FORECAST_DAYS } from '../config/time'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

export interface HourlySeries {
  /** Zeitstempel in Epoch-ms (UTC), stündlich. */
  times: number[]
  /** null = Modell liefert diese Variable/Stunde nicht (z.B. Horizont überschritten). */
  values: (number | null)[]
  unit: string
}

interface PendingEntry {
  model: string
  variable: string
  resolve: (s: HourlySeries) => void
  reject: (e: Error) => void
}

interface PendingLocation {
  lat: number
  lon: number
  entries: PendingEntry[]
}

const BATCH_WINDOW_MS = 25

const pending = new Map<string, PendingLocation>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Eine Zeitreihe (Punkt × Modell × Variable) anfordern. Anfragen innerhalb
 * des Batch-Fensters werden pro Punkt zu einem Request zusammengefasst.
 */
export function fetchHourlySeries(
  lat: number,
  lon: number,
  model: string,
  variable: string,
): Promise<HourlySeries> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  let existing = pending.get(key)
  if (!existing) {
    existing = { lat, lon, entries: [] }
    pending.set(key, existing)
  }
  const loc = existing
  const promise = new Promise<HourlySeries>((resolve, reject) => {
    loc.entries.push({ model, variable, resolve, reject })
  })
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, BATCH_WINDOW_MS)
  }
  return promise
}

function flush(): void {
  flushTimer = null
  const batches = [...pending.values()]
  pending.clear()
  for (const batch of batches) {
    void runBatch(batch)
  }
}

async function runBatch(batch: PendingLocation): Promise<void> {
  const models = [...new Set(batch.entries.map((e) => e.model))]
  const variables = [...new Set(batch.entries.map((e) => e.variable))]
  try {
    const params = new URLSearchParams({
      latitude: batch.lat.toFixed(4),
      longitude: batch.lon.toFixed(4),
      hourly: variables.join(','),
      models: models.join(','),
      forecast_days: String(FORECAST_DAYS),
      timezone: 'UTC',
      timeformat: 'unixtime',
    })
    const res = await apiGet(`${FORECAST_URL}?${params}`, 1, 'point')
    if (!res.ok) {
      let reason = `HTTP ${res.status}`
      try {
        const body = JSON.parse(res.text) as { reason?: string }
        if (body.reason) reason = body.reason
      } catch {
        // Body nicht lesbar — HTTP-Status reicht
      }
      throw new Error(`Open-Meteo: ${reason}`)
    }
    const data = JSON.parse(res.text) as {
      hourly: Record<string, number[] | (number | null)[]>
      hourly_units: Record<string, string>
    }
    const times = (data.hourly.time as number[]).map((t) => t * 1000)

    for (const entry of batch.entries) {
      // Bei mehreren Modellen suffixt Open-Meteo die Keys mit dem Modellnamen.
      const key = models.length > 1 ? `${entry.variable}_${entry.model}` : entry.variable
      const values = data.hourly[key] as (number | null)[] | undefined
      if (!values) {
        entry.reject(new Error(`Keine Daten für ${entry.variable} (${entry.model})`))
        continue
      }
      entry.resolve({
        times,
        values,
        unit: data.hourly_units[key] ?? '',
      })
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    for (const entry of batch.entries) entry.reject(e)
  }
}

// --- Kartenfelder (Phase 2) ------------------------------------------------
// Reguläres lat/lon-Gitter über Multi-Location-Requests an die Forecast-API
// (kommaseparierte Koordinatenlisten) — NICHT bounding_box der Single-Runs-API:
// steuerbare Auflösung, reguläres Gitter, funktioniert mit allen Modellen
// inkl. Seamless. Volle Zeitreihe pro Punkt einmal holen und cachen, nicht
// pro Zeitschritt neu.
//
// Rate-Limit-Budget: Open-Meteo gewichtet nach Locations, Variablen (in
// Bruchteilen, Größenordnung „~10 Variablen ≈ 1 Call“), Modellen und
// Zeitraum. Deshalb: kleine Gitter, nur MAP_FORECAST_DAYS Tage, rate-aware
// Pacing der gewichteten Locations pro Minute (gridRequestQueue, Token-Bucket),
// Backoff bei 429, persistenter IndexedDB-Cache (gridcache.ts) — und vor allem
// BÜNDELUNG: alle im selben
// Tick angeforderten Variablen desselben (Domain, Modell)-Paars laufen als
// EIN Multi-Variablen-Request (bis MAX_VARS_PER_REQUEST) statt als N
// Einzelrequests. Cache-Treffer je Variable verkleinern das Bündel vorab.

import type { DomainPreset } from '../config/domains'
import { MAP_FORECAST_DAYS } from '../config/time'
import { getModel } from '../config/models'
import { latestRun } from '../config/runs'
import { useApiUsage, type UsageKind } from '../state/apiUsage'
import { getCachedGrid, putCachedGrid } from './gridcache'
import { gridRequestQueue } from './queue'
import { maybeMockApiGet, MOCK_MODE, mockGridDims, type HttpResult } from './mock'

/**
 * Einziger Weg zur Forecast-API: im Mock-Modus antwortet mock.ts in exakter
 * API-Form (kein Netz, kein Verbrauch), sonst wird gezählt und echt gefetcht.
 * `locationCost` = gewichtete Locations dieses Versuchs.
 */
async function apiGet(url: string, locationCost: number, kind: UsageKind): Promise<HttpResult> {
  const mock = await maybeMockApiGet(url)
  if (mock) return mock
  useApiUsage.getState().addUsage(locationCost, kind)
  const res = await fetch(url)
  return { ok: res.ok, status: res.status, text: await res.text() }
}

/** Mehr Punkte pro GET sprengen die URL-Länge (~15 KB bei 961 Punkten). */
const MAX_POINTS_PER_REQUEST = 250

const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 2000

export class RateLimitError extends Error {
  constructor(reason: string) {
    super(`Open-Meteo Rate-Limit erreicht — kurz warten, dann erneut versuchen. (${reason})`)
    this.name = 'RateLimitError'
  }
}

function isRateLimited(status: number, reason: string): boolean {
  return status === 429 || /limit/i.test(reason)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GET mit exponentiellem Backoff bei Rate-Limit-Antworten — statt in einer
 * Fehlerschleife weiterzufeuern. `locationCost` wird pro tatsächlichem
 * HTTP-Versuch gezählt (auch fehlgeschlagene Versuche kosten Budget).
 */
async function fetchTextWithBackoff(url: string, locationCost: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await apiGet(url, locationCost, 'grid')
    if (res.ok) return res.text

    let reason = `HTTP ${res.status}`
    try {
      const body = JSON.parse(res.text) as { reason?: string }
      if (body.reason) reason = body.reason
    } catch {
      // Body nicht lesbar — HTTP-Status reicht
    }
    if (isRateLimited(res.status, reason)) {
      if (attempt < RATE_LIMIT_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500
        console.warn(`[grid] Rate-Limit — Retry ${attempt + 1}/${RATE_LIMIT_RETRIES} in ${Math.round(delay)} ms`)
        await sleep(delay)
        continue
      }
      throw new RateLimitError(reason)
    }
    throw new Error(`Open-Meteo: ${reason}`)
  }
}

export interface GridField {
  /** Gitterachsen, aufsteigend. */
  lats: number[]
  lons: number[]
  /** Zeitstempel in Epoch-ms (UTC), stündlich. */
  times: number[]
  /** [t * ny*nx + iy*nx + ix], Zeilen von Süd nach Nord; NaN = fehlender Wert. */
  values: Float32Array
  unit: string
}

function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

interface GridLocationResponse {
  hourly: Record<string, (number | null)[] | number[]>
  hourly_units?: Record<string, string>
}

/** Open-Meteo-Gewichtsheuristik: bis ~10 Variablen zählen wie eine. */
const MAX_VARS_PER_REQUEST = 10

/** Geschätztes Gewicht eines Requests (Formel unveröffentlicht, SPEC §5). */
function estimateWeight(locations: number, variables: number): number {
  return Math.max(locations, Math.round((locations * variables) / MAX_VARS_PER_REQUEST))
}

interface GridResolver {
  resolve: (f: GridField) => void
  reject: (e: Error) => void
}

interface PendingGridBatch {
  domain: DomainPreset
  model: string
  vars: Map<string, GridResolver[]>
}

const pendingGrids = new Map<string, PendingGridBatch>()
let gridFlushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Ein Kartenfeld anfordern. Anfragen desselben Ticks für dasselbe
 * (Domain, Modell)-Paar werden zu EINEM Multi-Variablen-Request gebündelt —
 * bei ~10 Feldern pro Synoptik-Preset der größte Budget-Hebel.
 */
export function fetchGridField(
  domain: DomainPreset,
  model: string,
  variable: string,
): Promise<GridField> {
  const key = `${domain.id}|${model}`
  let existing = pendingGrids.get(key)
  if (!existing) {
    existing = { domain, model, vars: new Map() }
    pendingGrids.set(key, existing)
  }
  const batch = existing
  return new Promise<GridField>((resolve, reject) => {
    const resolvers = batch.vars.get(variable) ?? []
    resolvers.push({ resolve, reject })
    batch.vars.set(variable, resolvers)
    if (gridFlushTimer === null) gridFlushTimer = setTimeout(flushGridBatches, BATCH_WINDOW_MS)
  })
}

function flushGridBatches(): void {
  gridFlushTimer = null
  const batches = [...pendingGrids.values()]
  pendingGrids.clear()
  for (const batch of batches) void runGridBatch(batch)
}

async function runGridBatch(batch: PendingGridBatch): Promise<void> {
  const { domain, model } = batch
  const modelInfo = getModel(model)
  // Mock kostet kein Budget → Auflösung dort frei wählbar (?mockres=N)
  const mockDims = mockGridDims(domain)
  const ny = mockDims?.ny ?? domain.gridLat
  const nx = mockDims?.nx ?? domain.gridLon

  // Persistenter Cache zuerst, je Variable: Treffer lösen sofort auf und
  // verkleinern das Bündel. Key trägt den Modelllauf-Bucket (Init-Zeit des
  // neuesten verfügbaren Laufs) — neuer Lauf invalidiert, ein Reload innerhalb
  // desselben Laufs kostet nichts. Dieselbe Lauf-Logik wie die Panel-Anzeige,
  // damit gezeigter Lauf und gecachte Daten kohärent bleiben.
  // (Mock liest/schreibt den Cache nie — nicht mit echten Daten verwechselbar.)
  const runBucket = latestRun(modelInfo, Date.now()).initTime
  const cacheKeyFor = (v: string) => `${domain.id}:${ny}x${nx}:${model}:${v}:${MAP_FORECAST_DAYS}d`

  const toFetch: [string, GridResolver[]][] = []
  for (const [variable, resolvers] of batch.vars) {
    const cached = MOCK_MODE === 'off' ? await getCachedGrid(cacheKeyFor(variable), runBucket) : null
    if (cached) {
      console.info(`[grid] Cache-Hit ${cacheKeyFor(variable)} — 0 API-Locations`)
      for (const r of resolvers) r.resolve(cached)
    } else {
      toFetch.push([variable, resolvers])
    }
  }
  if (toFetch.length === 0) return

  const lats = linspace(domain.bbox.latMin, domain.bbox.latMax, ny)
  const lons = linspace(domain.bbox.lonMin, domain.bbox.lonMax, nx)
  const points: { lat: number; lon: number }[] = []
  for (const lat of lats) for (const lon of lons) points.push({ lat, lon })
  const chunks: { lat: number; lon: number }[][] = []
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
    chunks.push(points.slice(i, i + MAX_POINTS_PER_REQUEST))
  }

  // Variablen in 10er-Gruppen (Gewichtsheuristik), Punkte in 250er-Chunks;
  // alles durch die Queue (max. 2 gleichzeitig)
  for (let g = 0; g < toFetch.length; g += MAX_VARS_PER_REQUEST) {
    const group = toFetch.slice(g, g + MAX_VARS_PER_REQUEST)
    const groupVars = group.map(([v]) => v)
    try {
      const responses = await Promise.all(
        chunks.map((chunk) => {
          // Location-Gewicht dieses Chunks — steuert das Pacing der Queue UND
          // den Verbrauchszähler (fetchTextWithBackoff), damit beide dieselbe
          // Schätzung sehen.
          const cost = estimateWeight(chunk.length, groupVars.length)
          return gridRequestQueue.run(cost, async () => {
            const params = new URLSearchParams({
              latitude: chunk.map((p) => p.lat.toFixed(4)).join(','),
              longitude: chunk.map((p) => p.lon.toFixed(4)).join(','),
              hourly: groupVars.join(','),
              models: model,
              forecast_days: String(MAP_FORECAST_DAYS),
              timezone: 'UTC',
              timeformat: 'unixtime',
            })
            const text = await fetchTextWithBackoff(`${FORECAST_URL}?${params}`, cost)
            const json = JSON.parse(text) as GridLocationResponse | GridLocationResponse[]
            return { locations: Array.isArray(json) ? json : [json], bytes: text.length }
          })
        }),
      )

      const locations = responses.flatMap((r) => r.locations)
      if (locations.length !== points.length) {
        throw new Error(
          `Gitter unvollständig: ${locations.length}/${points.length} Punkte (${model})`,
        )
      }

      // Payload und (geschätzten) Verbrauch im Blick behalten
      const totalKb = Math.round(responses.reduce((s, r) => s + r.bytes, 0) / 1024)
      console.info(
        `[grid] ${model} ${domain.id} ${ny}×${nx}: ${groupVars.join('+')} gebündelt in ` +
          `${chunks.length} Request(s), ${totalKb} KB, ` +
          (MOCK_MODE === 'off'
            ? `~${estimateWeight(points.length, groupVars.length)} gewichtete Locations`
            : 'MOCK — 0 API-Locations'),
      )

      const times = (locations[0].hourly.time as number[]).map((t) => t * 1000)
      const nt = times.length

      for (const [variable, resolvers] of group) {
        const values = new Float32Array(nt * ny * nx).fill(NaN)
        let anyData = false
        locations.forEach((loc, p) => {
          const series = loc.hourly[variable] as (number | null)[] | undefined
          if (!series) return
          anyData = true
          const len = Math.min(nt, series.length)
          for (let t = 0; t < len; t++) {
            const v = series[t]
            if (v != null) values[t * ny * nx + p] = v
          }
        })
        if (!anyData) {
          const e = new Error(`Keine Daten für ${variable} (${model})`)
          for (const r of resolvers) r.reject(e)
          continue
        }
        const field: GridField = {
          lats,
          lons,
          times,
          values,
          unit: locations[0].hourly_units?.[variable] ?? '',
        }
        if (MOCK_MODE === 'off') void putCachedGrid(cacheKeyFor(variable), runBucket, field)
        for (const r of resolvers) r.resolve(field)
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      for (const [, resolvers] of group) for (const r of resolvers) r.reject(e)
    }
  }
}

// --- Geocoding -------------------------------------------------------------

export interface GeoResult {
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
  elevation?: number
}

export async function searchLocations(query: string): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    name: query,
    count: '6',
    language: 'de',
    format: 'json',
  })
  const res = await fetch(`${GEOCODING_URL}?${params}`)
  if (!res.ok) throw new Error(`Geocoding: HTTP ${res.status}`)
  const data = (await res.json()) as { results?: GeoResult[] }
  return data.results ?? []
}
