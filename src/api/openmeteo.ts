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
// Rate-Limit-Budget: Open-Meteo gewichtet nach Anzahl Locations — ein Gitter
// zählt ~ Punktzahl, nicht als 1 Call. Deshalb: kleine Gitter (MAP_GRID_SIZE),
// nur MAP_FORECAST_DAYS Tage, genau EINE Variable pro Grid-Request, begrenzte
// Nebenläufigkeit (gridRequestQueue), Backoff bei 429 und persistenter
// IndexedDB-Cache (gridcache.ts), damit Reloads keine Calls kosten.

import type { DomainPreset } from '../config/domains'
import { MAP_FORECAST_DAYS } from '../config/time'
import { getModel } from '../config/models'
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

export async function fetchGridField(
  domain: DomainPreset,
  model: string,
  variable: string,
): Promise<GridField> {
  // Mock kostet kein Budget → Auflösung dort frei wählbar (?mockres=N)
  const mockDims = mockGridDims(domain)
  const ny = mockDims?.ny ?? domain.gridLat
  const nx = mockDims?.nx ?? domain.gridLon
  const modelInfo = getModel(model)

  // Persistenter Cache zuerst: Key trägt den Modelllauf-Bucket — ein neuer
  // Lauf (updateIntervalHours) invalidiert, ein Reload innerhalb desselben
  // Laufs kostet keine API-Calls.
  const runBucket = Math.floor(Date.now() / (modelInfo.updateIntervalHours * 3_600_000))
  const cacheKey = `${domain.id}:${ny}x${nx}:${model}:${variable}:${MAP_FORECAST_DAYS}d`
  // Mock-Daten dürfen den persistenten Cache weder lesen noch füllen —
  // sonst wären sie später mit echten Daten verwechselbar
  const cached = MOCK_MODE === 'off' ? await getCachedGrid(cacheKey, runBucket) : null
  if (cached) {
    console.info(`[grid] Cache-Hit ${cacheKey} (Lauf-Bucket ${runBucket}) — 0 API-Locations`)
    return cached
  }

  const lats = linspace(domain.bbox.latMin, domain.bbox.latMax, ny)
  const lons = linspace(domain.bbox.lonMin, domain.bbox.lonMax, nx)

  // Punkte zeilenweise (Süd → Nord); Chunks laufen durch die Queue
  // (max. 2 gleichzeitig), genau EINE Variable pro Request
  const points: { lat: number; lon: number }[] = []
  for (const lat of lats) for (const lon of lons) points.push({ lat, lon })

  const chunks: { lat: number; lon: number }[][] = []
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
    chunks.push(points.slice(i, i + MAX_POINTS_PER_REQUEST))
  }

  const responses = await Promise.all(
    chunks.map((chunk) =>
      gridRequestQueue.run(async () => {
        const params = new URLSearchParams({
          latitude: chunk.map((p) => p.lat.toFixed(4)).join(','),
          longitude: chunk.map((p) => p.lon.toFixed(4)).join(','),
          hourly: variable,
          models: model,
          forecast_days: String(MAP_FORECAST_DAYS),
          timezone: 'UTC',
          timeformat: 'unixtime',
        })
        const text = await fetchTextWithBackoff(`${FORECAST_URL}?${params}`, chunk.length)
        const json = JSON.parse(text) as GridLocationResponse | GridLocationResponse[]
        return { locations: Array.isArray(json) ? json : [json], bytes: text.length }
      }),
    ),
  )

  const locations = responses.flatMap((r) => r.locations)
  if (locations.length !== points.length) {
    throw new Error(
      `Gitter unvollständig: ${locations.length}/${points.length} Punkte (${model}/${variable})`,
    )
  }

  // Payload und Location-Verbrauch im Blick behalten
  const totalKb = Math.round(responses.reduce((s, r) => s + r.bytes, 0) / 1024)
  console.info(
    `[grid] ${model}/${variable} ${domain.id} ${ny}×${nx} in ${chunks.length} Requests, ${totalKb} KB, ` +
      (MOCK_MODE === 'off' ? `~${points.length} API-Locations` : 'MOCK — 0 API-Locations'),
  )

  const times = (locations[0].hourly.time as number[]).map((t) => t * 1000)
  const nt = times.length
  const values = new Float32Array(nt * ny * nx).fill(NaN)
  locations.forEach((loc, p) => {
    const series = loc.hourly[variable] as (number | null)[] | undefined
    if (!series) return
    const len = Math.min(nt, series.length)
    for (let t = 0; t < len; t++) {
      const v = series[t]
      if (v != null) values[t * ny * nx + p] = v
    }
  })

  const field: GridField = {
    lats,
    lons,
    times,
    values,
    unit: locations[0].hourly_units?.[variable] ?? '',
  }
  if (MOCK_MODE === 'off') void putCachedGrid(cacheKey, runBucket, field)
  return field
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
