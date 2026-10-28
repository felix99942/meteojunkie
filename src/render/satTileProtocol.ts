// Detailkacheln des Satellitenbereichs (Begründung bei `TILE_MIN_ZOOM` in
// config/satellite.ts) über ein eigenes MapLibre-Protokoll:
// `sattile://<produkt>/<termin>/<z>/<x>/<y>` → `/sat-tiles/…jpg` beim Worker.
// Ein eigenes Protokoll statt der https-URL direkt, weil die beiden
// Graustufenkanäle je Kachel dasselbe Wolkenkomposit brauchen wie das
// Europabild darunter — sonst stünde im Detail dunkler Boden, wo in der
// Übersicht das Bodenbild liegt, und die Kachelkante wäre eine sichtbare Linie.

import maplibregl from 'maplibre-gl'
import { SATELLITE_PRODUCTS, mirrorKeyTime, tileMerc } from '../config/satellite'
import { compositeClouds } from './cloudComposite'

export const SAT_TILE_PROTOCOL = 'sattile'

let registered = false
let empty: Promise<ImageBitmap> | null = null

/** Durchsichtige Kachel — fehlt eine (zu jung, Dienst gestört), bleibt die Übersicht sichtbar. */
function emptyTile(): Promise<ImageBitmap> {
  empty ??= createImageBitmap(new ImageData(1, 1))
  return empty
}

export function registerSatTileProtocol(): void {
  if (registered) return
  registered = true
  // Derselbe MapLibre-Fehler wie bei den Modellkarten (render/globeProtocol.ts):
  // eine abgebrochene Kachel ohne AbortController legt die Bild-Warteschlange
  // still. Warteschlange nicht volllaufen lassen, fehlenden Controller als
  // Abbruch beantworten.
  maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = Math.max(maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS, 256)
  maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = Math.max(
    maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME,
    256,
  )
  maplibregl.addProtocol(SAT_TILE_PROTOCOL, async (params: { url: string }, ac: AbortController | undefined) => {
    if (!ac) throw new DOMException('Kachel bereits abgebrochen', 'AbortError')
    const path = params.url.slice(SAT_TILE_PROTOCOL.length + 3)
    const [id, stamp, zs, xs, ys] = path.split('/')
    const product = SATELLITE_PRODUCTS.find((p) => p.id === id)
    const time = mirrorKeyTime(`/${stamp}.jpg`)
    if (!product || time === null) return { data: await emptyTile() }
    const res = await fetch(`${import.meta.env.BASE_URL}sat-tiles/${path}.jpg`, { signal: ac.signal })
    if (!res.ok) return { data: await emptyTile() }
    let blob = await res.blob()
    if (!blob.type.startsWith('image/')) return { data: await emptyTile() }
    if (product.cloudMask) {
      try {
        blob = await compositeClouds(product, product.cloudMask, time, blob, tileMerc(+zs, +xs, +ys))
      } catch (err) {
        // Lieber die rohe Kachel als keine — wie beim Europabild
        console.error('[satellit] Kachel-Untergrund', err)
      }
    }
    return { data: await createImageBitmap(blob) }
  })
}
