// Serverseitige Gitterbeschaffung — die OM-Interaktion, die früher im Browser
// (openmeteo.ts runGridBatch) lief, jetzt zentral im Proxy: Multi-Location an
// der Forecast-API, Punkte in 250er-Chunks, Variablen in 10er-Bündeln (der
// Budget-Hebel — 10 Variablen zählen wie eine), gepaced über die RateAwareQueue
// und mit 429-Backoff. Weil ALLE Clients durch diesen einen Punkt laufen,
// gilt das gewichtete Minutenlimit hier zentral und korrekt.
//
// v1 holt dasselbe reguläre Domain-Gitter wie bisher (Free-API-tauglich). Der
// Sprung auf natives bounding_box-Gitter ist ein Upstream-/Logik-Wechsel hier
// (Professional/self-hosted, siehe upstream.ts) — der Proxy-Layer drumherum
// bleibt gleich.

import type { DomainPreset } from '../src/config/domains'
import { MAP_FORECAST_DAYS } from '../src/config/time'
import { RateAwareQueue } from '../src/api/queue'
import { getUpstream } from './upstream'

export interface ServerGridField {
  lats: number[]
  lons: number[]
  times: number[]
  /** null = fehlender Wert (NaN ist in JSON nicht darstellbar). */
  values: (number | null)[]
  unit: string
}

/** Mehr Punkte pro GET sprengen die URL-Länge (~15 KB bei 961 Punkten). */
const MAX_POINTS_PER_REQUEST = 250
/** Open-Meteo-Gewichtsheuristik: bis ~10 Variablen zählen wie eine. */
const MAX_VARS_PER_REQUEST = 10

// Ein Bucket für alle Clients: das echte gewichtete Minutenlimit (600/min)
// mit Marge für Meteogramm-Serien, die weiterhin direkt vom Client kommen.
const queue = new RateAwareQueue({ locationsPerMinute: 500, maxConcurrent: 2 })

const MAX_RETRIES = 4
const RETRY_BASE_DELAY_MS = 1500

function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** Geschätztes Gewicht eines Requests (Formel unveröffentlicht, SPEC §5). */
export function estimateWeight(locations: number, variables: number): number {
  return Math.max(locations, Math.round((locations * variables) / MAX_VARS_PER_REQUEST))
}

// Transiente Upstream-Fehler, bei denen ein Retry mit Backoff sinnvoll ist:
// Rate-Limit (429/„limit"), Überlast („service is overloaded"/„busy"/„try
// again") und 5xx-Serverfehler. Open-Meteo antwortet unter Last mit
// wechselnden Codes UND Texten — beide Achsen prüfen, nicht nur 429/„limit".
function isTransient(status: number, reason: string): boolean {
  return (
    status === 429 ||
    (status >= 500 && status <= 599) ||
    /limit|overload|too many|temporar|try again|busy|unavailable/i.test(reason)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fehlerkörper `{error:true,reason}` erkennen (auch bei HTTP 200, SPEC §6). */
function errorReason(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: boolean; reason?: string }
    if (body && body.error === true && typeof body.reason === 'string') return body.reason
  } catch {
    // kein JSON-Fehlerkörper
  }
  return null
}

async function fetchTextWithBackoff(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    // Verzögerung fürs nächste Retry oder null, wenn erschöpft.
    const backoff = (why: string): number | null => {
      if (attempt >= MAX_RETRIES) return null
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500
      console.warn(`[proxy] ${why} — Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)} ms`)
      return delay
    }

    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      // Netzwerkabbruch ist ebenfalls transient. undici wirft nacktes
      // „fetch failed" — die eigentliche Ursache steckt in err.cause.code
      // (ECONNREFUSED = Upstream unerreichbar, ECONNRESET/UND_ERR_* = Reset).
      const cause = (err as { cause?: { code?: string } })?.cause?.code
      const delay = backoff(`Netzwerkfehler${cause ? ` (${cause})` : ''}`)
      if (delay !== null) {
        await sleep(delay)
        continue
      }
      throw new Error(`Open-Meteo nicht erreichbar${cause ? ` (${cause})` : ''}`)
    }

    const text = await res.text()

    if (res.ok) {
      // Multi-Location-Erfolg ist IMMER ein Array. Ein Objekt bei HTTP 200 ist
      // ein Fehlerkörper (Open-Meteo antwortet unter Last teils so, SPEC §6) —
      // nicht als Erfolg durchreichen, sonst scheitert erst das Parsing downstream.
      if (text.trimStart().startsWith('[')) return text
      const reason = errorReason(text)
      if (!reason) return text // Nicht-Array ohne Fehlerflag (z.B. Single-Location) — durchreichen
      const delay = isTransient(200, reason) ? backoff(`Upstream-Fehler (${reason})`) : null
      if (delay !== null) {
        await sleep(delay)
        continue
      }
      throw new Error(`Open-Meteo: ${reason}`)
    }

    const reason = errorReason(text) ?? `HTTP ${res.status}`
    const delay = isTransient(res.status, reason) ? backoff(`Transienter Upstream-Fehler (${reason})`) : null
    if (delay !== null) {
      await sleep(delay)
      continue
    }
    throw new Error(`Open-Meteo: ${reason}`)
  }
}

interface GridLocationResponse {
  hourly: Record<string, (number | null)[] | number[]>
  hourly_units?: Record<string, string>
}

export interface FetchResult {
  fields: Record<string, ServerGridField>
  /** Gewichtete Locations, die dieser Fetch tatsächlich bei Open-Meteo verbraucht hat. */
  cost: number
}

/**
 * Ein oder mehrere Variablenfelder eines (Domain, Modell)-Paars holen. Die
 * Variablen werden als EIN Multi-Variablen-Request (≤10) gebündelt — Punkte in
 * 250er-Chunks. Rückgabe pro Variable ein Feld plus der reale OM-Verbrauch.
 */
export async function fetchGridFields(
  domain: DomainPreset,
  model: string,
  variables: string[],
): Promise<FetchResult> {
  const ny = domain.gridLat
  const nx = domain.gridLon
  const lats = linspace(domain.bbox.latMin, domain.bbox.latMax, ny)
  const lons = linspace(domain.bbox.lonMin, domain.bbox.lonMax, nx)
  const points: { lat: number; lon: number }[] = []
  for (const lat of lats) for (const lon of lons) points.push({ lat, lon })

  const chunks: { lat: number; lon: number }[][] = []
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
    chunks.push(points.slice(i, i + MAX_POINTS_PER_REQUEST))
  }

  const upstream = getUpstream()
  const groupVars = variables.slice(0, MAX_VARS_PER_REQUEST)
  let cost = 0

  const responses = await Promise.all(
    chunks.map((chunk) => {
      const chunkCost = estimateWeight(chunk.length, groupVars.length)
      return queue.run(chunkCost, async () => {
        const params = new URLSearchParams({
          latitude: chunk.map((p) => p.lat.toFixed(4)).join(','),
          longitude: chunk.map((p) => p.lon.toFixed(4)).join(','),
          hourly: groupVars.join(','),
          models: model,
          forecast_days: String(MAP_FORECAST_DAYS),
          timezone: 'UTC',
          timeformat: 'unixtime',
        })
        if (upstream.apiKey) params.set('apikey', upstream.apiKey)
        const text = await fetchTextWithBackoff(`${upstream.forecastUrl}?${params}`)
        cost += chunkCost
        const json = JSON.parse(text) as GridLocationResponse | GridLocationResponse[]
        return Array.isArray(json) ? json : [json]
      })
    }),
  )

  const locations = responses.flat()
  if (locations.length !== points.length) {
    throw new Error(`Gitter unvollständig: ${locations.length}/${points.length} Punkte (${model})`)
  }

  const times = (locations[0].hourly.time as number[]).map((t) => t * 1000)
  const nt = times.length
  const fields: Record<string, ServerGridField> = {}

  for (const variable of groupVars) {
    const values: (number | null)[] = new Array<number | null>(nt * ny * nx).fill(null)
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
    if (!anyData) continue // Modell liefert die Variable nicht — Feld weglassen
    fields[variable] = {
      lats,
      lons,
      times,
      values,
      unit: locations[0].hourly_units?.[variable] ?? '',
    }
  }

  return { fields, cost }
}
