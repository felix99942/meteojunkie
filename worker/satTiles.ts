// Detailkacheln der Satellitenbilder (Begründung bei `TILE_MIN_ZOOM` in
// src/config/satellite.ts): eine Kachel wird beim ersten Abruf EINMAL bei
// EUMETView geholt und in R2 abgelegt, danach kommt sie für alle von
// Cloudflare. Nur der Pfad, den `parseSatelliteTilePath` annimmt — Produkte
// mit Kacheln, erlaubte Zoomstufen, Termine der letzten 26 h auf dem Raster
// des Produkts —, sonst wäre der Worker ein offener Proxy auf einen fremden
// Dienst.

import {
  MIRROR_SPAN_MS,
  TILE_MIN_AGE_MS,
  parseSatelliteTilePath,
  satelliteTileSourceUrl,
} from '../src/config/satellite'
import type { R2BucketLike } from './r2'

const IMMUTABLE = 'public, max-age=31536000, immutable'

export async function satelliteTile(
  path: string,
  bucket: R2BucketLike,
  waitUntil: (p: Promise<unknown>) => void,
  now = Date.now(),
): Promise<Response> {
  const t = parseSatelliteTilePath(path)
  if (!t) return new Response('Not Found', { status: 404 })
  // Zu jung: EUMETView beantwortet einen Termin, den es noch nicht gibt, STILL
  // mit dem nächstgelegenen Bild (`nearestValue`) — das läge dann für immer
  // unter der falschen Zeit in R2. Zu alt: liegt außerhalb der Ziehleiste.
  if (t.time > now - TILE_MIN_AGE_MS || t.time < now - MIRROR_SPAN_MS - 2 * 3_600_000) {
    return new Response('Not Found', { status: 404 })
  }
  const key = path.replace(/^sat-tiles\//, 'sattile/')
  const hit = await bucket.get(key)
  if (hit && 'body' in hit) {
    return new Response(hit.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': IMMUTABLE } })
  }
  const res = await fetch(satelliteTileSourceUrl(t.product, t.time, t.z, t.x, t.y), {
    signal: AbortSignal.timeout(25_000),
  })
  const type = res.headers.get('content-type') ?? ''
  // ServiceException kommt als XML mit HTTP 200 — weder ablegen noch weitergeben
  if (!res.ok || !type.startsWith('image/')) return new Response('Bad Gateway', { status: 502 })
  const bytes = await res.arrayBuffer()
  waitUntil(bucket.put(key, bytes, { httpMetadata: { contentType: type } }))
  return new Response(bytes, { headers: { 'content-type': type, 'cache-control': IMMUTABLE } })
}
