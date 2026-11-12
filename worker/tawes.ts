// Führt die TAWES-10-Minuten-Werte der letzten 120 Stunden in R2 (`src/config/tawesStore.ts`),
// eine Datei je Größe, für den Bereich TAWES und den Zeitschieber der Klimakarte. Eigener Cron
// alle 10 Minuten.
//
// Jeder Lauf holt die letzten 6 Stunden neu: Stationen melden einzelne Termine verspätet, die
// Lücken füllen sich damit von selbst. Fehlt eine Datei, holt der Lauf die ganzen 120 Stunden.
//
// R2-Schreibvorgänge: 23 Dateien × 144 Läufe = ~3.300 am Tag, ~100.000 im Monat (Freikontingent
// 1 Mio.). Gemessen 2026-11-12: 6 h aller Größen über 290 Stationen = 1,6 MB JSON in 7 s.

import {
  ALL_TAWES_CODES,
  applyTawesSeries,
  mergeTawesStores,
  newTawesStore,
  packTawesStore,
  TAWES_STEP_MS,
  TAWES_STORE_HOURS,
  tawesStoreKey,
  unpackTawesStore,
  type TawesCode,
  type TawesStore,
} from '../src/config/tawesStore'
import type { R2BucketLike } from './r2'

const API = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-10min'
const HOUR_MS = 3_600_000
const REFETCH_H = 6
/**
 * GeoSphere deckelt bei 1 Mio. Datenpunkten; 23 Größen × 290 Stationen × 12 h liegen bei
 * 480.000 und ~3 MB JSON — größere Stücke kosteten im Worker (128 MB) unnötig Speicher.
 */
const CHUNK_H = 12

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16)

interface GeoSphereAnswer {
  timestamps: string[]
  features: { properties: { station: string | number; parameters: Record<string, { data: (number | null)[] }> } }[]
}

async function fetchRange(store: TawesStore, codes: TawesCode[], startMs: number, endMs: number): Promise<number> {
  const url = `${API}?parameters=${codes.join(',')}&start=${iso(startMs)}&end=${iso(endMs)}&station_ids=${store.ids.join(',')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GeoSphere HTTP ${res.status}`)
  const data = (await res.json()) as GeoSphereAnswer
  let written = 0
  for (const code of codes) {
    const byStation: Record<number, (number | null)[]> = {}
    for (const f of data.features) {
      const series = f.properties.parameters[code]?.data
      if (series) byStation[Number(f.properties.station)] = series
    }
    written += applyTawesSeries(store, code, data.timestamps, byStation)
  }
  return written
}

async function readCode(bucket: R2BucketLike, code: TawesCode): Promise<TawesStore | null> {
  const obj = await bucket.get(tawesStoreKey(code))
  if (!obj || !('body' in obj)) return null
  const s = await unpackTawesStore(await new Response(obj.body).arrayBuffer())
  return s?.values[code] ? s : null
}

export async function updateTawes(bucket: R2BucketLike, ids: number[], now = Date.now()): Promise<string> {
  const endMs = Math.floor(now / TAWES_STEP_MS) * TAWES_STEP_MS
  const storeStart = endMs - TAWES_STORE_HOURS * HOUR_MS
  const olds = await Promise.all(ALL_TAWES_CODES.map((c) => readCode(bucket, c)))
  const store = newTawesStore(endMs, ids, mergeTawesStores(olds.filter((s): s is TawesStore => s != null)))

  // Größen ohne Datei (erster Lauf, neue Größe) brauchen die ganzen 120 h, alle übrigen nur
  // die letzten Stunden ab ihrem eigenen Stand
  const groups = new Map<number, TawesCode[]>()
  ALL_TAWES_CODES.forEach((code, i) => {
    const old = olds[i]
    const start = old ? Math.max(storeStart, old.endMs - REFETCH_H * HOUR_MS) : storeStart
    groups.set(start, [...(groups.get(start) ?? []), code])
  })

  let written = 0
  for (const [startMs, codes] of groups) {
    for (let a = startMs; a < endMs; a += CHUNK_H * HOUR_MS + TAWES_STEP_MS) {
      written += await fetchRange(store, codes, a, Math.min(endMs, a + CHUNK_H * HOUR_MS))
    }
  }
  // Eine leere Antwort darf den letzten guten Stand nicht ersetzen
  if (written === 0) throw new Error('GeoSphere lieferte keine Werte')
  await Promise.all(
    ALL_TAWES_CODES.map(async (code) =>
      bucket.put(tawesStoreKey(code), await packTawesStore(store, [code]), {
        httpMetadata: { contentType: 'application/octet-stream' },
      }),
    ),
  )
  return `TAWES: ${written} Werte, ${ALL_TAWES_CODES.length} Größen bis ${iso(endMs)}`
}
