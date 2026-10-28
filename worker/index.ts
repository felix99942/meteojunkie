// Cloudflare-Worker der Seite: liefert die gebaute App als statische Dateien
// (`dist/`, über die ASSETS-Bindung — Abrufe dort kosten nichts und laufen
// gar nicht erst durch dieses Skript) und die im Deploy erzeugten DATEN aus
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

interface R2ObjectLike {
  httpEtag: string
  writeHttpMetadata(headers: Headers): void
}
interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream
}
interface R2BucketLike {
  get(
    key: string,
    options?: { onlyIf?: Headers },
  ): Promise<R2ObjectBodyLike | R2ObjectLike | null>
}
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> }
  DATA: R2BucketLike
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

/** Pfade, die aus R2 kommen — alles andere ist die App selbst. */
const DATA_PREFIXES = ['nwp/', 'de/', 'mos/forecast/', 'sondes/']

// Ein Modelllauf liegt unter seiner Kennung und ändert sich nie mehr
// (nwp/<modell>/<lauf>/<größe>/<schritt>.webp, Lauf = 10 Ziffern).
const IMMUTABLE = /^nwp\/[^/]+\/\d{10}\//

/** Cache-Dauer je Pfad. Alles ausser den Laufdateien wechselt stündlich. */
function cacheControl(key: string): string {
  if (IMMUTABLE.test(key)) return 'public, max-age=31536000, immutable'
  if (key.endsWith('/meta.json')) return 'public, max-age=60'
  return 'public, max-age=300'
}

// Der Cache wirkt nur auf einer eigenen Domain; unter workers.dev ist
// `caches.default` ein No-op — dort geht jeder Abruf an R2, was bei privater
// Nutzung weit im Freikontingent bleibt.
declare const caches: { default: Cache }

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url)
    const key = decodeURIComponent(url.pathname.slice(1))
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
    if (!obj) return new Response('Not Found', { status: 404 })
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
}
