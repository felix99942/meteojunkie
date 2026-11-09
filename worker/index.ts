// Cloudflare-Worker der Seite: prüft die Anmeldung (`auth.ts`) und liefert die gebaute
// App als statische Dateien (`dist/`, über die ASSETS-Bindung; `run_worker_first` lässt
// auch sie durch dieses Skript laufen) und die im Deploy erzeugten DATEN aus
// R2, unter DENSELBEN Pfaden wie bisher auf GitHub Pages (`/nwp/…`, `/de/…`,
// `/mos/forecast/…`, `/sondes/…`). Das Frontend merkt vom Umzug nichts: kein
// zweiter Host, kein CORS, keine Basis-URL.
//
// Warum die Daten nicht mehr im Asset-Paket liegen: GitHub Pages deckelt bei
// 1 GB (die Seite lag bei ~980 MB), und ein Worker-Deploy erlaubt 20.000
// Dateien — die Modellkarten allein haben ~5.000 je Lauf. Ausserdem wechseln
// die Daten stündlich, die App nur bei einem Push; getrennt muss nicht jede
// Stunde die ganze Seite neu deployt werden (scripts/upload-data.sh).
//
// Bewusst ohne @cloudflare/workers-types: die paar Typen stehen unten, und
// das Projekt bekommt keine zweite Typwelt neben DOM/Node.

import { authGate, type AuthEnv } from './auth'
import { updateRadar } from './radar'
import { updateRadar3d } from './radar3d'
import { mirrorSatellite } from './satellite'
import { satelliteTile } from './satTiles'
import type { R2BucketLike } from './r2'

interface Env extends AuthEnv {
  ASSETS: { fetch(req: Request): Promise<Response> }
  DATA: R2BucketLike
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}
interface ScheduledEvent {
  scheduledTime: number
  cron: string
}

/** Cron des 3D-Radars — muss mit wrangler.jsonc übereinstimmen */
const R3D_CRON = '2-59/5 * * * *'

/** Pfade, die aus R2 kommen — alles andere ist die App selbst. */
const DATA_PREFIXES = ['nwp/', 'de/', 'mos/forecast/', 'sondes/', 'sat/', 'radar/', 'topo/']

// Ein Modelllauf liegt unter seiner Kennung und ändert sich nie mehr
// (nwp/<modell>/<lauf>/<größe>/<schritt>.webp, Lauf = 10 Ziffern).
// Dasselbe gilt für Satelliten- und Radarbilder, die unter ihrem Termin liegen,
// und für das Relief (topo/, scripts/topo-mirror.mjs).
const IMMUTABLE = /^(nwp\/[^/]+\/\d{10}\/|sat\/[^/]+\/(lo|hi)\/|radar\/[^/]+\/\d{8}T\d{4}Z|topo\/)/

/** Cache-Dauer je Pfad. Alles ausser den Laufdateien wechselt stündlich. */
function cacheControl(key: string): string {
  if (IMMUTABLE.test(key)) return 'public, max-age=31536000, immutable'
  if (key.endsWith('/meta.json') || key.endsWith('/latest.json') || key.startsWith('radar/')) return 'public, max-age=60'
  return 'public, max-age=300'
}

// Der Cache wirkt nur auf einer eigenen Domain; unter workers.dev ist
// `caches.default` ein No-op — dort geht jeder Abruf an R2, was bei privater
// Nutzung weit im Freikontingent bleibt.
declare const caches: { default: Cache }

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    // Vor jedem Cache-Zugriff: sonst käme eine gespeicherte Datei ohne Anmeldung heraus
    const denied = await authGate(req, env)
    if (denied) return denied
    const url = new URL(req.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    if (key.startsWith('sat-tiles/') && req.method === 'GET') {
      // Detailkacheln: aus R2 oder einmal von EUMETView (worker/satTiles.ts)
      const cacheKey = new Request(url.origin + url.pathname)
      const cached = await caches.default.match(cacheKey)
      if (cached) return cached
      const res = await satelliteTile(key, env.DATA, (p) => ctx.waitUntil(p))
      if (res.ok) ctx.waitUntil(caches.default.put(cacheKey, res.clone()))
      return res
    }
    if (!DATA_PREFIXES.some((p) => key.startsWith(p))) return env.ASSETS.fetch(req)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    // Nur der Pfad zählt — Abfrageparameter würden sonst den Cache zerteilen
    const cacheKey = new Request(url.origin + url.pathname)
    const conditional = req.headers.has('if-none-match') || req.headers.has('if-modified-since')
    if (!conditional) {
      const hit = await caches.default.match(cacheKey)
      if (hit) return req.method === 'HEAD' ? new Response(null, hit) : hit
    }

    const obj = await env.DATA.get(key, { onlyIf: req.headers })
    if (!obj) {
      if (!key.startsWith('topo/')) return new Response('Not Found', { status: 404 })
      // Im Relief-Spiegel fehlt das Meer absichtlich, und das bleibt so: ungecacht
      // kostete jede Meereskachel jedes Mal einen R2-Abruf
      const missing = new Response('Not Found', { status: 404, headers: { 'cache-control': cacheControl(key) } })
      ctx.waitUntil(caches.default.put(cacheKey, missing.clone()))
      return missing
    }
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    // rclone setzt den Typ aus der Endung; fehlt er doch, liefe die Datei als
    // application/octet-stream, und MapLibre/fetch().json() kämen ins Stolpern
    if (!headers.has('content-type')) {
      const ext = key.slice(key.lastIndexOf('.') + 1)
      const type = { webp: 'image/webp', json: 'application/json', png: 'image/png' }[ext]
      if (type) headers.set('content-type', type)
    }
    headers.set('etag', obj.httpEtag)
    headers.set('cache-control', cacheControl(key))
    // Vorbedingung erfüllt (If-None-Match passt) → R2 liefert das Objekt ohne Body
    if (!('body' in obj)) return new Response(null, { status: 304, headers })

    if (req.method === 'HEAD') return new Response(null, { headers })
    const res = new Response(obj.body, { headers })
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()))
    return res
  },

  // Cron (wrangler.jsonc, alle 5 Minuten): Radar jedes Mal, der Satellit
  // jedes zweite Mal — EUMETView schiebt nur alle 10 bzw. 15 Minuten nach.
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // 3D-Radar im EIGENEN Cron (2 min versetzt): eigenes CPU-Budget von 30 s,
    // ein Fehler dort reisst Radar und Satellit nicht mit — und das Volumen
    // ist beim DWD dann vollständig (letzte Elevation ~4 min nach dem Termin)
    if (event.cron === R3D_CRON) {
      console.log(await updateRadar3d(env.DATA).catch((err) => `3D-Radar: Fehler ${err}`))
      return
    }
    const minute = new Date(event.scheduledTime).getUTCMinutes()
    const jobs: Promise<string>[] = [updateRadar(env.DATA)]
    if (minute % 10 < 5) jobs.push(mirrorSatellite(env.DATA))
    // Abgewartet statt waitUntil: ein Cron-Lauf darf bis zu 15 Minuten
    // dauern, solange sein Promise offen ist
    const results = await Promise.allSettled(jobs)
    for (const r of results) console.log(r.status === 'fulfilled' ? r.value : `Fehler: ${r.reason}`)
  },
}
