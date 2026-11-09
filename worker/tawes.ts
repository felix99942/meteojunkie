// Führt die TAWES-10-Minuten-Werte der letzten 96 Stunden in R2 (`src/config/tawesStore.ts`),
// für den Zeitschieber der Klimakarte. Eigener Cron alle 10 Minuten.
//
// Jeder Lauf holt die letzten 6 Stunden neu: Stationen melden einzelne Termine verspätet, die
// Lücken füllen sich damit von selbst. Fehlt der Speicher, holt ein Lauf alle 96 Stunden.

import {
  applyTawesSeries,
  newTawesStore,
  packTawesStore,
  TAWES_CODES,
  TAWES_STEP_MS,
  TAWES_STORE_HOURS,
  TAWES_STORE_KEY,
  unpackTawesStore,
  type TawesCode,
  type TawesStore,
} from '../src/config/tawesStore'
import type { R2BucketLike } from './r2'

const API = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-10min'
const HOUR_MS = 3_600_000
const REFETCH_H = 6
/** GeoSphere deckelt bei 1 Mio. Datenpunkten: 5 Größen × 290 Stationen × 48 h liegen bei 420.000 */
const CHUNK_H = 48
const CODES = Object.keys(TAWES_CODES) as TawesCode[]

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16)

interface GeoSphereAnswer {
  timestamps: string[]
  features: { properties: { station: string | number; parameters: Record<string, { data: (number | null)[] }> } }[]
}

async function fetchRange(store: TawesStore, startMs: number, endMs: number): Promise<number> {
  const url = `${API}?parameters=${CODES.join(',')}&start=${iso(startMs)}&end=${iso(endMs)}&station_ids=${store.ids.join(',')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GeoSphere HTTP ${res.status}`)
  const data = (await res.json()) as GeoSphereAnswer
  let written = 0
  for (const code of CODES) {
    const byStation: Record<number, (number | null)[]> = {}
    for (const f of data.features) {
      const series = f.properties.parameters[code]?.data
      if (series) byStation[Number(f.properties.station)] = series
    }
    written += applyTawesSeries(store, code, data.timestamps, byStation)
  }
  return written
}

async function readStore(bucket: R2BucketLike): Promise<TawesStore | null> {
  const obj = await bucket.get(TAWES_STORE_KEY)
  if (!obj || !('body' in obj)) return null
  return unpackTawesStore(await new Response(obj.body).arrayBuffer())
}

export async function updateTawes(bucket: R2BucketLike, ids: number[], now = Date.now()): Promise<string> {
  const endMs = Math.floor(now / TAWES_STEP_MS) * TAWES_STEP_MS
  const old = await readStore(bucket)
  const storeStart = endMs - TAWES_STORE_HOURS * HOUR_MS
  const startMs = old ? Math.max(storeStart, old.endMs - REFETCH_H * HOUR_MS) : storeStart
  const store = newTawesStore(endMs, ids, old)

  let written = 0
  for (let a = startMs; a < endMs; a += CHUNK_H * HOUR_MS + TAWES_STEP_MS) {
    written += await fetchRange(store, a, Math.min(endMs, a + CHUNK_H * HOUR_MS))
  }
  // Eine leere Antwort darf den letzten guten Stand nicht ersetzen
  if (written === 0) throw new Error('GeoSphere lieferte keine Werte')
  await bucket.put(TAWES_STORE_KEY, await packTawesStore(store), {
    httpMetadata: { contentType: 'application/octet-stream' },
  })
  return `TAWES: ${written} Werte bis ${iso(endMs)}`
}
