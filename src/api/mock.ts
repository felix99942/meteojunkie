// Mock-Modus: Entwicklung ohne API-Verbrauch. Eingehängt im API-Layer
// (openmeteo.ts ruft maybeMockApiGet auf), NICHT auf fetch-Ebene — die
// Antwort hat exakt die Form der echten API inkl. Key-Suffixing bei
// Multi-Modell-Requests, damit der reale Parsing-Pfad durchlaufen wird.
//
// Aktivierung: ?mock=1 (ohne Dev-Server-Neustart), ?mock=ratelimit,
// ?mock=empty — oder VITE_MOCK=1 für automatisierte Läufe. Im
// Produktions-Build ohne VITE_MOCK ist der Modus hart abgeschaltet.
//
// Felder sind seed-basiert deterministisch (Screenshots vergleichbar) und
// über Zeitschritte stetig (Play-Modus ohne Springen). Modelle bekommen
// eigene Offsets/Phasen, damit der Modellvergleich sichtbar bleibt, und der
// Mock respektiert forecastHours der Registry (Horizontbehandlung testbar).

import type { DomainPreset } from '../config/domains'
import { getModel } from '../config/models'
import { TIME_RANGE } from '../config/time'

export type MockMode = 'off' | 'data' | 'ratelimit' | 'empty'

export interface HttpResult {
  ok: boolean
  status: number
  text: string
}

// Produktions-Gate: ohne DEV bzw. explizites VITE_MOCK=1 bleibt der Modus aus
const MOCK_ALLOWED = import.meta.env.DEV || import.meta.env.VITE_MOCK === '1'

function resolveMode(): MockMode {
  if (!MOCK_ALLOWED) return 'off'
  const q = new URLSearchParams(window.location.search).get('mock')
  if (q === 'ratelimit') return 'ratelimit'
  if (q === 'empty') return 'empty'
  if (q === '1' || q === 'true') return 'data'
  if (q !== null) return 'off' // ?mock=0 u.ä. schaltet explizit ab
  return import.meta.env.VITE_MOCK === '1' ? 'data' : 'off'
}

export const MOCK_MODE: MockMode = resolveMode()

// --- Mock-Auflösung (?mockres=N) -------------------------------------------
// Mock kostet kein API-Budget, also ist die Gitterauflösung frei wählbar.
// N = Punkte entlang der LÄNGEREN Domain-Achse (in km, nicht Grad);
// Default bleibt die echte Gitterauflösung, damit der Realfall Standard ist.

/** Obergrenze: darüber werden Feldsynthese + Rendering browserlastig. */
const MAX_MOCK_RES = 256

export const MOCK_GRID_RES: number | null = (() => {
  if (MOCK_MODE !== 'data') return null
  const raw = new URLSearchParams(window.location.search).get('mockres')
  if (raw === null) return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 2) {
    console.warn(`[mock] mockres=${raw} ungültig — Realauflösung bleibt aktiv`)
    return null
  }
  if (n > MAX_MOCK_RES) {
    console.warn(
      `[mock] mockres=${n} über der Obergrenze ${MAX_MOCK_RES} — geclampt, damit der Browser nicht einfriert`,
    )
    return MAX_MOCK_RES
  }
  return n
})()

/**
 * Mock-Gitterdimensionen für eine Domain: N Punkte auf der längeren Achse
 * (km-basiert, damit die Zellen annähernd quadratisch bleiben), null wenn
 * die Realauflösung gilt.
 */
export function mockGridDims(domain: DomainPreset): { ny: number; nx: number } | null {
  if (MOCK_GRID_RES === null) return null
  const { latMin, latMax, lonMin, lonMax } = domain.bbox
  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180)
  const kmLat = (latMax - latMin) * 111
  const kmLon = (lonMax - lonMin) * 111 * Math.cos(midLat)
  if (kmLon >= kmLat) {
    return { nx: MOCK_GRID_RES, ny: Math.max(2, Math.round((MOCK_GRID_RES * kmLat) / kmLon)) }
  }
  return { ny: MOCK_GRID_RES, nx: Math.max(2, Math.round((MOCK_GRID_RES * kmLon) / kmLat)) }
}

// --- deterministische Feldsynthese ----------------------------------------

/** FNV-1a-Hash → [0, 1); fester Seed pro Modell-/Blob-Name, kein Math.random. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const round1 = (v: number) => Math.round(v * 10) / 10
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

// --- mehrskaliges Rauschen --------------------------------------------------
// Bei hoher Mock-Auflösung (?mockres) muss echte Feinstruktur sichtbar werden,
// nicht nur ein weichgezeichnetes Grobmuster. Deshalb fBm: mehrere überlagerte
// Frequenzen aus deterministischem Gitter-Value-Noise (schneller Integer-Hash,
// kein String-Hash im Pixel-Pfad).

function latticeHash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smooth = (f: number) => f * f * (3 - 2 * f)

/** Value-Noise in [0,1], glatt interpoliert. */
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const v00 = latticeHash(ix, iy, seed)
  const v01 = latticeHash(ix + 1, iy, seed)
  const v10 = latticeHash(ix, iy + 1, seed)
  const v11 = latticeHash(ix + 1, iy + 1, seed)
  return (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy
}

/** fBm in [0,1]: 5 Oktaven, Basisskala `scaleDeg` bis hinunter zu scaleDeg/16. */
function fbm(lon: number, lat: number, seed: number, scaleDeg: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1 / scaleDeg
  for (let o = 0; o < 5; o++) {
    sum += amp * noise2(lon * f, lat * f, seed + o * 101)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

/** numerischer Seed pro Modell(+Salt) für den Noise-Pfad */
function modelSeed(model: string, salt: number): number {
  return ((hash01(model) * 1e9) | 0) + salt
}

// Niederschlags-/CAPE-Blobs: fleckige Struktur mit großen Nullflächen.
// 8 über Europa verteilt plus 2 fest im Österreich-Ausschnitt, Zentren
// wandern sinusförmig (stetig) statt zufällig.
interface Blob {
  lat: number
  lon: number
  amp: number
  sigma: number
  phase: number
}

function makeBlobs(model: string): Blob[] {
  const blobs: Blob[] = []
  for (let i = 0; i < 8; i++) {
    const r = (k: string) => hash01(`${model}:blob${i}:${k}`)
    blobs.push({
      lat: 37 + r('lat') * 30,
      lon: -10 + r('lon') * 46,
      amp: 2 + r('amp') * (i === 0 ? 28 : 7), // ein Maximum reizt die oberen Klassen aus
      sigma: 1.2 + r('sig') * 1.6,
      phase: r('ph') * Math.PI * 2,
    })
  }
  for (let i = 0; i < 2; i++) {
    const r = (k: string) => hash01(`${model}:atblob${i}:${k}`)
    blobs.push({
      lat: 46.4 + r('lat') * 2.5,
      lon: 9.8 + r('lon') * 7,
      amp: 3 + r('amp') * 9,
      sigma: 0.8 + r('sig') * 0.8,
      phase: r('ph') * Math.PI * 2,
    })
  }
  return blobs
}

const blobCache = new Map<string, Blob[]>()
function blobsFor(model: string): Blob[] {
  let b = blobCache.get(model)
  if (!b) {
    b = makeBlobs(model)
    blobCache.set(model, b)
  }
  return b
}

function blobField(model: string, lat: number, lon: number, t: number, threshold: number): number {
  let v = -threshold // Schwelle → große Nullflächen
  for (const b of blobsFor(model)) {
    const by = b.lat + 1.5 * Math.sin(t / 18 + b.phase)
    const bx = b.lon + 3 * Math.sin(t / 14 + b.phase * 1.7)
    const d2 = (lat - by) ** 2 + ((lon - bx) * 0.7) ** 2
    v += b.amp * Math.exp(-d2 / (2 * b.sigma ** 2))
  }
  return Math.max(0, v)
}

function mockTemperature(model: string, lat: number, lon: number, t: number): number {
  const shift = (hash01(model) - 0.5) * 6 // Modelle unterscheidbar (±3 °C)
  const diurnal = 8 * Math.sin((2 * Math.PI * (t % 24)) / 24 - Math.PI / 2) // Tagesgang
  const wave = 6 * Math.sin(lon / 6 + t / 30 + hash01(model) * 6)
  // mehrskalige Störung, driftet langsam mit t (stetig im Play-Modus)
  const detail = 7 * (fbm(lon + t * 0.12, lat, modelSeed(model, 1), 3) - 0.5)
  // Nord-Süd-Gradient über die Europa-Domain: Süden ~+40, Norden bis unter −20
  // → Nulldurchgang im Feld, divergierende Skala prüfbar
  return 32 - (lat - 35) * 1.4 + diurnal + wave + detail + shift
}

function mockWind(model: string, lat: number, lon: number, t: number): number {
  const phase = hash01(model) * Math.PI * 2
  // glattes Grundfeld + ein ausgeprägtes, wanderndes Maximum + Feinstruktur
  const cy = 48 + 8 * Math.sin(t / 22 + phase)
  const cx = 5 + 12 * Math.sin(t / 17 + phase * 1.3)
  const d2 = (lat - cy) ** 2 + ((lon - cx) * 0.7) ** 2
  const detail = 10 * (fbm(lon - t * 0.15, lat, modelSeed(model, 2), 2.5) - 0.5)
  return Math.max(
    0,
    8 + 6 * Math.sin(lat / 5 + t / 25 + phase) + 75 * Math.exp(-d2 / (2 * 3 ** 2)) + detail,
  )
}

/** Barometrische Höhe (m) aus Druck (hPa) — für Level-Profile. */
function heightFromP(p: number): number {
  return 44330 * (1 - (p / 1013.25) ** 0.1903)
}

// Drucklevel-Profile fürs Skew-T: physikalisch plausibel (T fällt mit Höhe bis
// zur Tropopause, dann Stratosphäre; feuchte Grundschicht + trockene
// Mittelschicht; Jet nahe 250 hPa; Wind dreht mit Höhe), deterministisch und
// stetig in t wie der Rest des Mocks.
function mockProfile(
  baseVar: string,
  level: number,
  model: string,
  lat: number,
  lon: number,
  t: number,
): number {
  const z = heightFromP(level) / 1000 // km
  const phase = hash01(model) * Math.PI * 2
  const shift = (hash01(model) - 0.5) * 4
  const ztrop = 11 + 1.5 * Math.sin(lat / 10 + t / 40 + phase) // Tropopausenhöhe variiert
  switch (baseVar) {
    case 'temperature': {
      const tsurf = mockTemperature(model, lat, lon, t)
      const temp = z < ztrop ? tsurf - 6.5 * z : tsurf - 6.5 * ztrop + 1.2 * (z - ztrop)
      const detail = 2 * (fbm(z * 2 + t * 0.05, lat, modelSeed(model, 5), 1.5) - 0.5)
      const inversion = z < 1.5 ? 3 * Math.max(0, Math.sin(t / 9 + phase)) * (1 - z / 1.5) : 0
      return round1(temp + detail + inversion + shift)
    }
    case 'relative_humidity': {
      const moist = 85 - 8 * z
      const dryZ = 3 + 2 * Math.sin(t / 20 + phase)
      const dryLayer = -45 * Math.exp(-((z - dryZ) ** 2) / 4)
      const noise = 20 * (fbm(z + t * 0.07, lat, modelSeed(model, 6), 1.2) - 0.5)
      return round1(clamp(moist + dryLayer + noise, 3, 100))
    }
    case 'wind_speed': {
      const jet = 60 * Math.exp(-((z - 10) ** 2) / 8)
      const detail = 8 * (fbm(z + t * 0.1, lat, modelSeed(model, 7), 1) - 0.5)
      return round1(Math.max(0, 5 + 2.5 * z + jet + detail + shift))
    }
    case 'wind_direction':
      return Math.round((200 + 12 * z + 60 * Math.sin(t / 22 + phase) + 720) % 360)
    case 'geopotential_height':
      return Math.round(heightFromP(level))
    default:
      return 0
  }
}

const LEVEL_VAR = /^(temperature|relative_humidity|wind_speed|wind_direction|geopotential_height)_(\d+)hPa$/

function mockValue(variable: string, model: string, lat: number, lon: number, t: number): number {
  const level = LEVEL_VAR.exec(variable)
  if (level) return mockProfile(level[1], Number(level[2]), model, lat, lon, t)
  const phase = hash01(model) * Math.PI * 2
  switch (variable) {
    case 'temperature_2m':
      return round1(mockTemperature(model, lat, lon, t))
    case 'dew_point_2m':
      return round1(mockTemperature(model, lat, lon, t) - 4 - 2 * Math.sin(t / 12 + phase))
    case 'relative_humidity_2m':
      return round1(clamp(65 + 30 * Math.sin(lat / 3 + t / 16 + phase), 5, 100))
    case 'precipitation': {
      // Blobs geben die Flecken, fBm die Zellstruktur darin — bei hoher
      // Auflösung wird das Feld körnig statt nur weichgezeichnet.
      // Potenz erhöht den Kontrast, damit die Struktur Stufenklassen springt.
      const texture = 0.15 + 2.4 * fbm(lon + t * 0.1, lat, modelSeed(model, 3), 0.9) ** 1.6
      return round1(blobField(model, lat, lon, t, 1.2) * texture)
    }
    case 'snowfall': {
      // nur wo es kalt ist, mit stetigem Übergang statt hartem Schnitt
      const cold = clamp((1 - mockTemperature(model, lat, lon, t)) / 4, 0, 1)
      return round1(blobField(model, lat, lon, t, 1.2) * 0.7 * cold)
    }
    case 'cloud_cover':
      return round1(
        clamp(120 * fbm(lon + t * 0.2, lat + t * 0.05, modelSeed(model, 4), 4) - 10, 0, 100),
      )
    case 'pressure_msl':
      return round1(1013 + 14 * Math.sin(lon / 10 - t / 40 + phase) - (lat - 50) * 0.3)
    case 'wind_speed_10m':
      return round1(mockWind(model, lat, lon, t))
    case 'wind_gusts_10m':
      return round1(mockWind(model, lat, lon, t) * 1.45 + 4)
    case 'wind_direction_10m':
      return Math.round((180 + 120 * Math.sin(t / 20 + lon / 15 + phase) + 360) % 360)
    case 'cape':
      return Math.round(blobField(model, lat, lon, t, 2) * 180)
    case 'shortwave_radiation': {
      const h = t % 24
      const sun = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12))
      return Math.round(850 * sun * (1 - 0.5 * (lat - 35) / 35))
    }
    default:
      return round1(10 * Math.sin(t / 10 + phase))
  }
}

const UNITS: Record<string, string> = {
  temperature_2m: '°C',
  dew_point_2m: '°C',
  relative_humidity_2m: '%',
  precipitation: 'mm',
  snowfall: 'cm',
  cloud_cover: '%',
  pressure_msl: 'hPa',
  wind_speed_10m: 'km/h',
  wind_gusts_10m: 'km/h',
  wind_direction_10m: '°',
  cape: 'J/kg',
  shortwave_radiation: 'W/m²',
}

// --- Antwort in exakter API-Form ------------------------------------------

interface MockLocation {
  latitude: number
  longitude: number
  hourly: Record<string, number[] | (number | null)[]>
  hourly_units: Record<string, string>
}

function buildForecastBody(u: URL): MockLocation | MockLocation[] {
  const lats = (u.searchParams.get('latitude') ?? '0').split(',').map(Number)
  const lons = (u.searchParams.get('longitude') ?? '0').split(',').map(Number)
  const models = (u.searchParams.get('models') ?? 'best_match').split(',')
  const variables = (u.searchParams.get('hourly') ?? '').split(',').filter(Boolean)
  const days = Number(u.searchParams.get('forecast_days') ?? '7')
  const startSec = TIME_RANGE.start / 1000
  const nt = days * 24
  const time = Array.from({ length: nt }, (_, i) => startSec + i * 3600)
  // Multi-Modell-Antworten suffixen die Keys — exakt wie die echte API
  const suffix = models.length > 1

  const makeLocation = (lat: number, lon: number): MockLocation => {
    const hourly: MockLocation['hourly'] = { time }
    const hourly_units: Record<string, string> = { time: 'unixtime' }
    for (const model of models) {
      const horizon = getModel(model).forecastHours // Registry-Horizont respektieren
      for (const v of variables) {
        const key = suffix ? `${v}_${model}` : v
        hourly[key] = time.map((_, t) =>
          MOCK_MODE === 'empty' || t > horizon ? null : mockValue(v, model, lat, lon, t),
        )
        hourly_units[key] = UNITS[v] ?? ''
      }
    }
    return { latitude: lat, longitude: lon, hourly, hourly_units }
  }

  return lats.length > 1
    ? lats.map((lat, i) => makeLocation(lat, lons[i]))
    : makeLocation(lats[0], lons[0])
}

/**
 * Mock-Interception für den API-Layer: null = kein Mock, echt fetchen.
 * Gilt nur für den Forecast-Endpoint; Geocoding bleibt echt (zählt nicht
 * gegen das gewichtete Limit und ist nur nutzerausgelöst).
 */
export async function maybeMockApiGet(url: string): Promise<HttpResult | null> {
  if (MOCK_MODE === 'off') return null
  const u = new URL(url)
  if (!u.pathname.startsWith('/v1/forecast')) return null
  await new Promise((r) => setTimeout(r, 120)) // Ladezustände bleiben sichtbar
  if (MOCK_MODE === 'ratelimit') {
    return {
      ok: false,
      status: 429,
      text: JSON.stringify({ error: true, reason: 'Mock: Minutely API request limit exceeded.' }),
    }
  }
  return { ok: true, status: 200, text: JSON.stringify(buildForecastBody(u)) }
}
