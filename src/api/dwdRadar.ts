// Abruf des DWD-Radars (siehe `config/radar.ts` für Quelle, Abdeckung und
// Farbskala).
//
// Läuft über **plain `fetch`, NICHT über `apiGet`**: das ist der DWD-WMS und
// hat mit dem Open-Meteo-Budget und dessen Zähler nichts zu tun — dieselbe
// Trennung wie bei der Ortssuche.
//
// Zwei Dinge holt dieser Layer: die ZEITDIMENSION (welche Zeitschritte gibt es
// gerade?) und die BILDER. Die Zeitschritte dürfen nicht geraten werden: eine
// Zeit abseits des 5-Minuten-Rasters beantwortet der Dienst mit einer
// ServiceException statt mit einem Bild.

import { maskRadarEdge } from '../render/radarImage'
import {
  parseRadarCapabilities,
  radarCapabilitiesUrl,
  radarImageUrl,
  type RadarFrame,
  type RadarMeta,
  type RadarProduct,
} from '../config/radar'

/**
 * Zeitdimension und Fläche des Produkts.
 *
 * TTL-Cache: der Dienst schiebt alle 5 Minuten einen Schritt nach, öfter als
 * jede Minute nachzufragen bringt also nichts. Ein Fehlschlag wird NICHT
 * gecacht (sonst hängt der Bereich minutenlang an einem Aussetzer fest).
 */
const META_TTL_MS = 60_000
const metaCache = new Map<string, { at: number; meta: RadarMeta }>()

export async function fetchRadarMeta(
  product: RadarProduct,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<RadarMeta> {
  const hit = metaCache.get(product.id)
  if (!opts.force && hit && Date.now() - hit.at < META_TTL_MS) return hit.meta

  const res = await fetch(radarCapabilitiesUrl(product), { signal: opts.signal })
  if (!res.ok) throw new Error(`DWD-WMS: HTTP ${res.status}`)
  const xml = await res.text()
  const meta = parseRadarCapabilities(xml)
  if (!meta) throw new Error('DWD-WMS: Zeitdimension nicht lesbar')
  metaCache.set(product.id, { at: Date.now(), meta })
  return meta
}

/**
 * Reihenfolge, in der die Bilder geholt werden: erst der aktuell ANGEZEIGTE
 * Zeitschritt, dann vorwärts bis zum Ende, danach die älteren rückwärts.
 *
 * Das ist keine Feinheit — bei knapp 40 Bildern à ~1 s entscheidet sie
 * darüber, ob nach einer Sekunde das gefragte Bild steht oder ob man eine
 * halbe Minute auf eine chronologische Warteschlange wartet.
 */
export function frameLoadOrder(count: number, startIndex: number): number[] {
  const start = Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0))
  const order: number[] = []
  for (let i = start; i < count; i++) order.push(i)
  for (let i = start - 1; i >= 0; i--) order.push(i)
  return order
}

/**
 * PNG → fertige Bild-URL, mit der magentafarbenen Randlinie des Produkts
 * ausgeräumt (Begründung in `render/radarImage.ts`).
 *
 * Ergebnis ist eine **Data-URL**, kein Blob: `toDataURL()` ist synchron, die
 * Umfärbung läuft also in EINEM Block mit dem Zeichnen — bei vier parallel
 * ladenden Bildern kann kein zweites dazwischen auf dieselbe Leinwand malen.
 * Ein eigenes Canvas je Bild kostet nichts, es wird sofort wieder freigegeben.
 */
async function toCleanImageUrl(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas-Kontext nicht verfügbar')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (maskRadarEdge(frame.data) > 0) ctx.putImageData(frame, 0, 0)
  return canvas.toDataURL('image/png')
}

export interface RadarImageLoadOptions {
  width: number
  height: number
  /** Startindex der Ladereihenfolge (siehe `frameLoadOrder`). */
  startIndex?: number
  /**
   * Gleichzeitige Abrufe. Vier ist ein Kompromiss: schnell genug, um die
   * Schleife in wenigen Sekunden vollständig zu haben, und zurückhaltend
   * genug gegenüber einem fremden, kostenlosen Dienst.
   */
  concurrency?: number
  signal?: AbortSignal
  /** Wird je fertigem Bild gerufen — Index bezieht sich auf `frames`. */
  onLoaded: (index: number, imageUrl: string) => void
  onError?: (index: number, err: unknown) => void
}

/**
 * Lädt die Bilder der Folge. Bewusst vollständig HERUNTERLADEN und nicht nur
 * als `<img>` vorladen: so hängt die ruckfreie Schleife nicht daran, ob der
 * HTTP-Cache mitspielt, der Fortschritt ist zählbar — und die Randlinie des
 * Produkts lässt sich vor der Anzeige ausräumen.
 */
export async function loadRadarImages(
  product: RadarProduct,
  meta: RadarMeta,
  frames: RadarFrame[],
  opts: RadarImageLoadOptions,
): Promise<void> {
  const order = frameLoadOrder(frames.length, opts.startIndex ?? 0)
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  let next = 0

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const slot = next++
      if (slot >= order.length) return
      const idx = order[slot]
      const url = radarImageUrl(product, meta, {
        time: frames[idx].time,
        width: opts.width,
        height: opts.height,
      })
      try {
        const res = await fetch(url, { signal: opts.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        // Eine ServiceException kommt als XML mit HTTP 200 — das ist genau die
        // Falle aus SPEC §6, nur bei einem anderen Dienst.
        if (!blob.type.startsWith('image/')) throw new Error(`Antwort ist ${blob.type || 'kein Bild'}`)
        const imageUrl = await toCleanImageUrl(blob)
        if (opts.signal?.aborted) return
        opts.onLoaded(idx, imageUrl)
      } catch (err) {
        if (opts.signal?.aborted) return
        opts.onError?.(idx, err)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
}
