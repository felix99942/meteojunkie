// Satelliten-Vorrat: holt für die meistbenutzten Produkte jedes neue Bild
// EINMAL bei EUMETView ab und legt es in R2 (Begründung bei
// `MIRRORED_SATELLITE_IDS` in src/config/satellite.ts). Läuft aus dem Cron des
// Workers alle 10 Minuten.
//
// URL und Schlüssel kommen aus DENSELBEN Funktionen wie im Browser — das Bild
// in R2 ist bytegleich mit dem, das der Browser sonst selbst geholt hätte.
//
// Neueste Bilder zuerst und höchstens `MAX_FETCH` je Lauf: beim allerersten
// Lauf fehlt ein ganzer Tag (~1.150 Bilder), den holt der Cron über ein paar
// Stunden nach, ohne EUMETView mit einem Schlag zu überfahren — derselbe
// Dienst antwortete schon bei sechs parallelen Browser-Abrufen mit HTTP 500.

import {
  MIRROR_SPAN_MS,
  MIRRORED_SATELLITE_IDS,
  SATELLITE_PRODUCTS,
  mirrorKeyTime,
  mirrorSourceUrl,
  parseSatelliteCapabilities,
  satelliteCapabilitiesUrl,
  satelliteMirrorKey,
  satelliteTimes,
  type ImageTier,
  type SatelliteProduct,
} from '../src/config/satellite'
import { listKeys, type R2BucketLike } from './r2'

/** Abrufe je Cron-Lauf (alle Produkte zusammen). */
const MAX_FETCH = 80
/** Gleichzeitige Abrufe bei EUMETView — wie im Browser höchstens 4. */
const CONCURRENCY = 4
/** Ältere Bilder fliegen raus (Ziehleiste 24 h plus Reserve). */
const KEEP_MS = MIRROR_SPAN_MS + 2 * 3_600_000

interface Job {
  product: SatelliteProduct
  time: number
  tier: ImageTier
}

/**
 * Neuester Termin, von dem BEIDE Stufen im Vorrat liegen, als
 * `sat/<id>/latest.json` — die Startseite liest ihn statt des Capabilities
 * von EUMETView (seit 2026-11-02): das Capabilities nennt oft schon einen
 * Termin, den der Vorrat (alle 10 Minuten) noch nicht hat, und dann rendert
 * EUMETView das scharfe Bild auf Anfrage — gemessen 1 bis über 10 Sekunden.
 */
export const latestKey = (id: string) => `sat/${id}/latest.json`

export async function mirrorSatellite(bucket: R2BucketLike, now = Date.now()): Promise<string> {
  const jobs: Job[] = []
  const stale: string[] = []
  const present = new Map<string, Set<string>>()
  for (const id of MIRRORED_SATELLITE_IDS) {
    const product = SATELLITE_PRODUCTS.find((p) => p.id === id)
    if (!product) continue
    const capsRes = await fetch(satelliteCapabilitiesUrl(product))
    if (!capsRes.ok) continue
    const extent = parseSatelliteCapabilities(await capsRes.text(), product)
    if (!extent) continue
    const have = await listKeys(bucket, `sat/${id}/`)
    present.set(id, have)
    for (const key of have) {
      const t = mirrorKeyTime(key)
      if (t !== null && t < now - KEEP_MS) stale.push(key)
    }
    const times = satelliteTimes(extent, MIRROR_SPAN_MS)
    for (const tier of ['lo', 'hi'] as const) {
      for (const time of times) {
        if (!have.has(satelliteMirrorKey(product, time, tier))) jobs.push({ product, time, tier })
      }
    }
  }
  // Neueste zuerst; bei gleicher Zeit die Vorschau vor dem scharfen Bild
  jobs.sort((a, b) => b.time - a.time || (a.tier === 'lo' ? -1 : 1))
  const todo = jobs.slice(0, MAX_FETCH)

  let ok = 0
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const job = todo[next++]
      try {
        const res = await fetch(mirrorSourceUrl(job.product, job.time, job.tier), {
          signal: AbortSignal.timeout(30_000),
        })
        const type = res.headers.get('content-type') ?? ''
        // Eine ServiceException kommt als XML mit HTTP 200 — nicht ablegen
        if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`)
        const key = satelliteMirrorKey(job.product, job.time, job.tier)
        await bucket.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: type } })
        present.get(job.product.id)?.add(key)
        ok++
      } catch {
        // Beim nächsten Lauf erneut — der Dienst wirft vereinzelt 500er
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (stale.length) await bucket.delete(stale.slice(0, 1000))
  // Neuesten vollständigen Termin je Produkt ausweisen
  for (const [id, keys] of present) {
    const product = SATELLITE_PRODUCTS.find((p) => p.id === id)!
    let newest = 0
    for (const key of keys) {
      const t = mirrorKeyTime(key)
      if (t !== null && t > newest && key.includes('/hi/') && keys.has(satelliteMirrorKey(product, t, 'lo'))) newest = t
    }
    if (newest) await bucket.put(latestKey(id), JSON.stringify({ time: newest }), { httpMetadata: { contentType: 'application/json' } })
  }
  return `Satellit: ${ok} geholt, ${failed} gescheitert, ${jobs.length - todo.length} offen, ${stale.length} gelöscht`
}
