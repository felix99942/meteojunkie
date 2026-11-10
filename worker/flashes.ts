// MTG-Einzelblitze: holt die neuen Dateien „LI Lightning Flashes"
// (EO:EUM:DAT:0691) aus dem EUMETSAT Data Store, schneidet Mitteleuropa heraus und
// legt die Blitze in 5-Minuten-Fenstern nach R2 (`radar/mtgflash/<Ende>.json`,
// Index wie die eigenen Radarbilder). Format und Fläche: `FlashBucket` in
// src/config/radar.ts.
//
// Zugang: Consumer Key/Secret als Worker-Secrets EUMETSAT_KEY/EUMETSAT_SECRET.
// Die SUCHE geht ohne Token, nur der Abruf der Datei braucht einen (gemessen
// 2026-11-10: ohne Token 404). Geholt wird nicht die ZIP des Produkts, sondern
// direkt der NetCDF-Teil (`sip-entries`, „CHK-BODY"): ~790 KB, unkomprimiert,
// jsfive liest die vier Felder in ~15 ms.

import * as hdf5 from 'jsfive'
import {
  FLASH_AREA_BOX,
  FLASH_STEP_MS,
  FLASH_STORE_BOX,
  FLASH_SOURCE_ID,
  flashBucketKey,
  type FlashBucket,
  type OwnRadarIndex,
} from '../src/config/radar'
import type { R2BucketLike } from './r2'

export interface EumetsatCreds {
  EUMETSAT_KEY?: string
  EUMETSAT_SECRET?: string
}

const API = 'https://api.eumetsat.int'
const COLLECTION = 'EO:EUM:DAT:0691'
/** So weit zurück werden Lücken nachgeholt (Ausfall des Crons, Data Store spät). */
const BACKFILL_MS = 3 * 3_600_000
/** So lange bleiben Fenster im Index — wie die eigenen Radarbilder. */
const INDEX_MS = 6 * 3_600_000
/** Dateien je Lauf: nach einer Pause wird in Raten nachgeholt. */
const MAX_PER_RUN = 4
/** `seconds since 2000-01-01` → Unix-ms */
const EPOCH_2000 = Date.UTC(2000, 0, 1)
/**
 * `flash_filter_confidence` ≥ dieser Schwelle fällt raus. Die Datei kennt drei
 * Werte (10.11.2026: 0 → 81 %, 0,052 → 11 %, 1 → 8 %); die mit 0 sind die
 * kräftigen Blitze (Median 22 Ereignisse, 7 Gruppen), die mit 1 schwach und
 * kurz. Gelesen als „Sicherheit, dass es ein Fehlalarm ist" — die
 * Variablenbeschreibung sagt nur „L2 filtered flash confidence".
 */
const MAX_FILTER_CONFIDENCE = 0.5

let token: { value: string; until: number } | null = null

async function accessToken(creds: EumetsatCreds): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value
  const res = await fetch(`${API}/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${creds.EUMETSAT_KEY}:${creds.EUMETSAT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Token HTTP ${res.status}`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 }
  return token.value
}

interface Product {
  start: number
  end: number
  bodies: string[]
}

async function searchProducts(from: number, to: number): Promise<Product[]> {
  const q = new URLSearchParams({
    format: 'json',
    pi: COLLECTION,
    dtstart: new Date(from).toISOString(),
    dtend: new Date(to).toISOString(),
    c: '40',
    sort: 'start,time,1',
  })
  const res = await fetch(`${API}/data/search-products/1.0.0/os?${q}`)
  if (!res.ok) throw new Error(`Suche HTTP ${res.status}`)
  const j = (await res.json()) as {
    features: {
      properties: {
        date: string
        links?: { 'sip-entries'?: { title?: string; href: string }[] }
      }
    }[]
  }
  return j.features
    .map((f) => {
      const [s, e] = f.properties.date.split('/')
      const bodies = (f.properties.links?.['sip-entries'] ?? [])
        .filter((x) => x.title?.includes('CHK-BODY') && x.title.endsWith('.nc'))
        .map((x) => x.href)
      return { start: Date.parse(s), end: Date.parse(e), bodies }
    })
    .filter((p) => p.bodies.length > 0 && Number.isFinite(p.start))
    .sort((a, b) => a.start - b.start)
}

/**
 * Die 5-Minuten-Fenster einer Datei. Ein Dateifenster läuft z. B. 12:20:05 bis
 * 12:30:05; daraus werden die Fenster mit Ende 12:25 und 12:30 — die 5 Sekunden
 * Versatz gehen im Rundungsrauschen unter, und so gehört jedes Fenster zu genau
 * EINER Datei (sonst müsste ein Fenster aus zwei Dateien zusammengesetzt werden).
 */
export function bucketEnds(start: number, end: number): number[] {
  const n = Math.max(1, Math.round((end - start) / FLASH_STEP_MS))
  const first = Math.floor(start / FLASH_STEP_MS) * FLASH_STEP_MS + FLASH_STEP_MS
  return Array.from({ length: n }, (_, k) => first + k * FLASH_STEP_MS)
}

interface Var {
  value: ArrayLike<number>
  attrs: Record<string, unknown>
}

function num(attrs: Record<string, unknown>, key: string, fallback: number): number {
  const v = attrs[key]
  const x = Array.isArray(v) ? v[0] : v
  return typeof x === 'number' ? x : fallback
}

/** Blitze einer Datei auf die Fenster verteilt (nur `FLASH_STORE_BOX`). */
export function decodeFlashes(buf: ArrayBuffer, start: number, end: number, box = FLASH_STORE_BOX): FlashBucket[] {
  const f = new hdf5.File(buf, 'li.nc')
  const get = (k: string) => f.get(k) as Var
  const lat = get('latitude')
  const lon = get('longitude')
  const time = get('flash_time')
  const rad = get('radiance')
  const conf = get('flash_filter_confidence')
  const latS = num(lat.attrs, 'scale_factor', 1)
  const lonS = num(lon.attrs, 'scale_factor', 1)
  const latFill = num(lat.attrs, '_FillValue', -32767)
  const confS = num(conf.attrs, 'scale_factor', 1)
  const confFill = num(conf.attrs, '_FillValue', 255)

  const ends = bucketEnds(start, end)
  const buckets: FlashBucket[] = ends.map((e) => ({ start: e - FLASH_STEP_MS, end: e, f: [] }))
  for (let i = 0; i < lat.value.length; i++) {
    const rawLat = lat.value[i]
    if (rawLat === latFill) continue
    const y = rawLat * latS
    const x = lon.value[i] * lonS
    if (y < box.south || y > box.north || x < box.west || x > box.east) continue
    const c = conf.value[i]
    if (c !== confFill && c * confS >= MAX_FILTER_CONFIDENCE) continue
    const t = EPOCH_2000 + time.value[i] * 1000
    const k = Math.min(ends.length - 1, Math.max(0, Math.floor((t - start) / FLASH_STEP_MS)))
    const b = buckets[k]
    b.f.push(Math.round(y * 1000) / 1000, Math.round(x * 1000) / 1000, Math.round((t - b.start) / 100) / 10, rad.value[i])
  }
  return buckets
}

async function fetchWithRetry(href: string, headers: Record<string, string>): Promise<ArrayBuffer> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(href, { headers })
      if (!res.ok) throw new Error(`Abruf HTTP ${res.status}`)
      return await res.arrayBuffer()
    } catch (err) {
      last = err
    }
  }
  throw last
}

async function readIndex(bucket: R2BucketLike, key: string): Promise<OwnRadarIndex | null> {
  const obj = await bucket.get(key)
  if (!obj || !('text' in obj)) return null
  try {
    return JSON.parse(await obj.text()) as OwnRadarIndex
  } catch {
    return null
  }
}

export async function updateFlashes(bucket: R2BucketLike, creds: EumetsatCreds, now = Date.now()): Promise<string> {
  if (!creds.EUMETSAT_KEY || !creds.EUMETSAT_SECRET) return 'MTG-Blitze: keine Zugangsdaten (Secrets EUMETSAT_KEY/EUMETSAT_SECRET)'
  const indexKey = `radar/${FLASH_SOURCE_ID}/index.json`
  const index = await readIndex(bucket, indexKey)
  const have = new Set(index?.times ?? [])

  const products = (await searchProducts(now - BACKFILL_MS, now)).filter(
    (p) => !bucketEnds(p.start, p.end).every((e) => have.has(e)),
  )
  // Neueste zuerst: nach einer Pause zählt das Jetzt mehr als die Lücke
  const todo = products.reverse().slice(0, MAX_PER_RUN)
  if (todo.length === 0) return 'MTG-Blitze: nichts Neues'

  const auth = { authorization: `Bearer ${await accessToken(creds)}` }
  let flashes = 0
  let done = 0
  const errors: string[] = []
  // Je Datei für sich: ein abgebrochener Abruf (gemessen: der Download-Server
  // schließt die Verbindung gelegentlich mitten im Lauf) kostet nur diese
  // Datei, der nächste Lauf holt sie nach — und der Index der übrigen wird
  // trotzdem geschrieben
  for (const p of todo) {
    try {
      const merged = bucketEnds(p.start, p.end).map((e) => ({ start: e - FLASH_STEP_MS, end: e, f: [] as number[] }))
      for (const href of p.bodies) {
        const buf = await fetchWithRetry(href, auth)
        decodeFlashes(buf, p.start, p.end).forEach((b, k) => merged[k].f.push(...b.f))
      }
      for (const b of merged) {
        await bucket.put(flashBucketKey(b.end), JSON.stringify(b), {
          httpMetadata: { contentType: 'application/json' },
        })
        have.add(b.end)
        flashes += b.f.length / 4
      }
      done++
    } catch (err) {
      errors.push(`${new Date(p.start).toISOString().slice(11, 16)}: ${err}`)
    }
  }
  if (done === 0) return `MTG-Blitze: Fehler ${errors.join(' · ')}`

  const keep = [...have].filter((t) => t > now - INDEX_MS).sort((a, b) => a - b)
  const next: OwnRadarIndex = { stepMs: FLASH_STEP_MS, times: keep, geo: FLASH_AREA_BOX }
  await bucket.put(indexKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } })
  const old = [...have].filter((t) => t <= now - INDEX_MS).map(flashBucketKey)
  if (old.length) await bucket.delete(old.slice(0, 1000))
  return `MTG-Blitze: ${done} Datei(en), ${flashes} Blitze, ${keep.length} Fenster im Index${errors.length ? ` · Fehler ${errors.join(' · ')}` : ''}`
}
