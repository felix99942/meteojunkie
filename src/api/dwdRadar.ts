// Abruf der Bildquellen des Radarbereichs (siehe `config/radar.ts` für
// Quelle, Abdeckung und Farbskala).
//
// Fast alles kommt vom DWD-WMS; die EINE Ausnahme ist der MTG Lightning
// Imager bei EUMETSAT, der als Overlay dazukommt, weil er die Abdeckungslücke
// im Süden und Osten schließt. Er läuft durch DIESELBEN Funktionen — die
// Quelle bringt ihre Endpunkte und ihre Fläche mit (`WmsImageSource`).
//
// Läuft über **plain `fetch`, NICHT über `apiGet`**: das ist der DWD-WMS und
// hat mit dem Open-Meteo-Budget und dessen Zähler nichts zu tun — dieselbe
// Trennung wie bei der Ortssuche.
//
// Zwei Dinge holt dieser Layer: die ZEITDIMENSION (welche Zeitschritte gibt es
// gerade?) und die BILDER. Die Zeitschritte dürfen nicht geraten werden: eine
// Zeit abseits des 5-Minuten-Rasters beantwortet der Dienst mit einer
// ServiceException statt mit einem Bild.

import { extractLightningCells, toPalette, type LightningCell } from '../render/lightning'
import { maskRadarEdge } from '../render/radarImage'
import {
  metaForSource,
  parseRadarCapabilities,
  radarCapabilitiesUrl,
  radarImageUrl,
  type CellSymbols,
  type RadarMeta,
  type WmsImageSource,
} from '../config/radar'
import { extractTimeDimension, parseTimeExtent } from '../config/wmsTime'

/**
 * Zeitdimension und Fläche des Produkts.
 *
 * TTL-Cache: der Dienst schiebt alle 5 Minuten einen Schritt nach, öfter als
 * jede Minute nachzufragen bringt also nichts. Ein Fehlschlag wird NICHT
 * gecacht (sonst hängt der Bereich minutenlang an einem Aussetzer fest).
 */
const META_TTL_MS = 60_000
/** Schlüssel ist der CAPS-LAYER: mehrere Quellen dürfen sich einen teilen. */
const metaCache = new Map<string, { at: number; meta: RadarMeta }>()

export async function fetchRadarMeta(
  source: WmsImageSource,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<RadarMeta> {
  const hit = metaCache.get(source.capsLayer)
  if (!opts.force && hit && Date.now() - hit.at < META_TTL_MS) return hit.meta

  const res = await fetch(radarCapabilitiesUrl(source), { signal: opts.signal })
  if (!res.ok) throw new Error(`WMS: HTTP ${res.status}`)
  const xml = await res.text()
  // Bringt die Quelle ihre Fläche selbst mit, wird aus dem Capabilities NUR
  // die Zeitdimension gelesen: das MTG-Capabilities meldet die ganze
  // sichtbare Halbkugel und führt keine EPSG:3857-BoundingBox — der
  // Radar-Parser fiele dort auf `null` zurück, obwohl die Zeiten da sind.
  const meta = source.area
    ? (() => {
        const dim = extractTimeDimension(xml)
        const raw = dim ? parseTimeExtent(dim) : null
        if (!raw) return null
        const extent = raw.stepMs > 0 ? raw : { ...raw, stepMs: source.stepMs }
        return metaForSource(source, extent)
      })()
    : parseRadarCapabilities(xml)
  if (!meta) throw new Error('WMS: Zeitdimension nicht lesbar')
  metaCache.set(source.capsLayer, { at: Date.now(), meta })
  return meta
}

/**
 * Reihenfolge, in der die Bilder geholt werden: **vom neuesten nach hinten.**
 *
 * Das ist keine Feinheit — der neueste Stand ist das, was man beim Öffnen
 * sehen will, und die Vergangenheit füllt die Schleife danach auf. Bei
 * 13 bis 37 Bildern à ~1 s entscheidet die Reihenfolge darüber, ob nach einer
 * Sekunde das gefragte Bild steht.
 */
export function newestFirst(times: number[]): number[] {
  return [...times].sort((a, b) => b - a)
}

/**
 * PNG → fertige Bild-URL, mit der magentafarbenen Randlinie des Produkts
 * ausgeräumt (Begründung in `render/radarImage.ts`).
 *
 * Ergebnis ist eine **Data-URL**, kein Blob: `toDataURL()` ist synchron, die
 * Nachbearbeitung läuft also in EINEM Block mit dem Zeichnen — bei vier
 * parallel ladenden Bildern kann kein zweites dazwischen auf dieselbe Leinwand
 * malen. Ein eigenes Canvas je Bild kostet nichts, es wird sofort wieder
 * freigegeben.
 */
async function toCleanImageUrl(blob: Blob, maskOpacity: number | null): Promise<string> {
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
  // Nur die Radarprodukte tragen die Randlinie; auf einem Overlay hätte die
  // Regel nichts zu suchen (siehe `WmsImageSource.maskOpacity`).
  if (maskOpacity !== null) {
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (maskRadarEdge(frame.data, maskOpacity) > 0) ctx.putImageData(frame, 0, 0)
  }
  return canvas.toDataURL('image/png')
}

export interface RadarImageLoadOptions {
  width: number
  height: number
  /**
   * Gleichzeitige Abrufe. Vier ist ein Kompromiss: schnell genug, um die
   * Schleife in wenigen Sekunden vollständig zu haben, und zurückhaltend
   * genug gegenüber einem fremden, kostenlosen Dienst.
   */
  concurrency?: number
  signal?: AbortSignal
  /** Wird je fertigem Bild gerufen, `time` ist der Zeitstempel des Bildes. */
  onLoaded: (time: number, imageUrl: string) => void
  onError?: (time: number, err: unknown) => void
}

/**
 * Lädt die Bilder zu den angegebenen Zeitpunkten. Bewusst vollständig
 * HERUNTERLADEN und nicht nur als `<img>` vorladen: so hängt die ruckfreie
 * Schleife nicht daran, ob der HTTP-Cache mitspielt, der Fortschritt ist
 * zählbar — und die Randlinie des Produkts lässt sich vor der Anzeige
 * ausräumen.
 *
 * Der Aufrufer gibt NUR die Zeiten mit, die ihm fehlen: beim Nachrücken auf
 * einen neuen Stand ist das genau ein Bild, nicht die ganze Schleife.
 */
export async function loadRadarImages(
  source: WmsImageSource,
  meta: RadarMeta,
  times: number[],
  opts: RadarImageLoadOptions,
): Promise<void> {
  const order = newestFirst(times)
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  let next = 0

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const slot = next++
      if (slot >= order.length) return
      const time = order[slot]
      const url = radarImageUrl(source, meta, {
        time,
        width: opts.width,
        height: opts.height,
      })
      try {
        const res = await fetch(url, { signal: opts.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        // Eine ServiceException kommt als XML mit HTTP 200 — das ist genau die
        // Falle aus SPEC §6, nur bei einem anderen Dienst.
        if (!blob.type.startsWith('image/')) {
          throw new Error(`Antwort ist ${blob.type || 'kein Bild'}`)
        }
        // Die Randlinien-Regel läuft NUR, wo die Linie wirklich gezeichnet
        // wird (`edgeLine`) — nicht überall, wo es eine Maske gibt. RW und RY
        // haben beides getrennt: Maske ja, Randlinie nein, und ihre Rampe
        // führt eine Farbe, die der Regel gefährlich nahekommt.
        const imageUrl = await toCleanImageUrl(blob, source.edgeLine ? source.maskOpacity : null)
        if (opts.signal?.aborted) return
        opts.onLoaded(time, imageUrl)
      } catch (err) {
        if (opts.signal?.aborted) return
        opts.onError?.(time, err)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
}

/**
 * Farbtabellen einmal umgerechnet, nicht je Bild — je Quelle eine (die
 * DWD-Dichte hat 13 Stufen, die MTG-Blitzfläche 7).
 */
const paletteCache = new Map<string[], number[][]>()
function paletteFor(colors: string[]): number[][] {
  let p = paletteCache.get(colors)
  if (!p) {
    p = toPalette(colors)
    paletteCache.set(colors, p)
  }
  return p
}

/**
 * Blitze werden NICHT als Bild behalten, sondern zu ZELLEN eingekocht
 * (`render/lightning.ts`): gezeichnet wird daraus später ein Kreuzbild über
 * mehrere Altersstufen, und dafür braucht es die Positionen, nicht das
 * Dichtebild. Nebeneffekt: je Zeitschritt bleiben ein paar Dutzend Zahlen im
 * Speicher statt eines PNG.
 */
export async function loadLightningCells(
  source: WmsImageSource,
  cells: CellSymbols,
  meta: RadarMeta,
  times: number[],
  opts: {
    width: number
    height: number
    concurrency?: number
    signal?: AbortSignal
    onLoaded: (time: number, cells: LightningCell[]) => void
    onError?: (time: number, err: unknown) => void
  },
): Promise<void> {
  const order = newestFirst(times)
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  let next = 0

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const slot = next++
      if (slot >= order.length) return
      const time = order[slot]
      const url = radarImageUrl(source, meta, {
        time,
        width: opts.width,
        height: opts.height,
      })
      try {
        const res = await fetch(url, { signal: opts.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (!blob.type.startsWith('image/')) {
          throw new Error(`Antwort ist ${blob.type || 'kein Bild'}`)
        }
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
        const found = extractLightningCells(
          frame.data,
          canvas.width,
          canvas.height,
          cells.blockPx,
          paletteFor(cells.palette),
        )
        if (opts.signal?.aborted) return
        opts.onLoaded(time, found)
      } catch (err) {
        if (opts.signal?.aborted) return
        opts.onError?.(time, err)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
}
