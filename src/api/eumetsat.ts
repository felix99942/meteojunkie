// Abruf der Satellitenbilder (siehe `config/satellite.ts` für Quelle, Fläche
// und Produkte).
//
// Läuft über **plain `fetch`, NICHT über `apiGet`**: das ist der EUMETSAT-WMS
// und hat mit dem Open-Meteo-Budget und dessen Zähler nichts zu tun —
// dieselbe Trennung wie beim Radar und bei der Ortssuche.
//
// Ein Canvas läuft nur dort dazwischen, wo es etwas zu tun gibt: die beiden
// GRAUSTUFEN-Kanäle werden zu „Wolken über echtem Boden" zusammengesetzt
// (`render/cloudComposite.ts`, `cloudMask` in der Registry) — der Anblick, den
// man von Wetterseiten kennt; ohne ihn zeigt der sichtbare Kanal wolkenfreies
// Land als kontrastarmes Grau. Geocolour und die Deutungs-RGBs gehen
// unverändert durch, sie bringen ihre Farben selbst mit.
//
// Heraus kommt wieder ein JPEG in einem Blob-URL: das Komposit ist deckend,
// Alpha wird also nicht gebraucht, und der Umweg über `canvas.toDataURL()`
// würde aus 500 KB JPEG mehrere Megabyte PNG machen — für jedes einzelne Bild
// der Schleife. Zusammengesetzt wird EINMAL je geladenem Bild, nicht bei
// jedem Anzeigen.

import {
  parseSatelliteCapabilities,
  productImageSize,
  productMerc,
  satelliteCapabilitiesUrl,
  satelliteImageUrl,
  sharpenLayer,
  sharpenPanTime,
  type SatelliteProduct,
  type SharpenSpec,
} from '../config/satellite'
import type { TimeExtent } from '../config/wmsTime'
import { compositeClouds } from '../render/cloudComposite'
import { panSharpen } from '../render/panSharpen'

/**
 * TTL-Cache der Zeitdimension: der Dienst schiebt alle 10 bzw. 15 Minuten
 * einen Schritt nach, öfter als jede Minute nachzufragen bringt also nichts.
 * Ein Fehlschlag wird NICHT gecacht (sonst hängt der Bereich minutenlang an
 * einem Aussetzer fest).
 */
const META_TTL_MS = 60_000
const metaCache = new Map<string, { at: number; extent: TimeExtent }>()

export async function fetchSatelliteExtent(
  product: SatelliteProduct,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<TimeExtent> {
  const key = `${product.workspace}:${product.name}`
  const hit = metaCache.get(key)
  if (!opts.force && hit && Date.now() - hit.at < META_TTL_MS) return hit.extent

  const res = await fetch(satelliteCapabilitiesUrl(product), { signal: opts.signal })
  if (!res.ok) throw new Error(`EUMETSAT-WMS: HTTP ${res.status}`)
  const xml = await res.text()
  const extent = parseSatelliteCapabilities(xml, product)
  if (!extent) throw new Error('EUMETSAT-WMS: Zeitdimension nicht lesbar')
  metaCache.set(key, { at: Date.now(), extent })
  return extent
}

export interface SatelliteLoadOptions {
  width: number
  height: number
  /**
   * Gleichzeitige Abrufe. Drei statt der vier des Radars: die Bilder sind
   * hier rund viermal so groß, und es ist ein fremder, kostenloser Dienst.
   */
  concurrency?: number
  signal?: AbortSignal
  onLoaded: (time: number, imageUrl: string) => void
  onError?: (time: number, err: unknown) => void
}

/**
 * Lädt die Bilder zu den angegebenen Zeitpunkten, **vom neuesten nach hinten**
 * — der neueste Stand ist das, was man beim Öffnen sehen will, die
 * Vergangenheit füllt die Schleife danach auf.
 *
 * Der Aufrufer gibt NUR die Zeiten mit, die ihm fehlen: beim Nachrücken auf
 * einen neuen Stand ist das genau ein Bild, nicht die ganze Schleife.
 *
 * Die zurückgegebenen URLs sind **Blob-URLs** und müssen vom Aufrufer wieder
 * freigegeben werden (`URL.revokeObjectURL`), sonst hält jeder Produktwechsel
 * seine alte Schleife im Speicher fest.
 */
export async function loadSatelliteImages(
  product: SatelliteProduct,
  times: number[],
  opts: SatelliteLoadOptions,
): Promise<void> {
  const order = [...times].sort((a, b) => b - a)
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  let next = 0

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const slot = next++
      if (slot >= order.length) return
      const time = order[slot]
      // Beim GESCHÄRFTEN Produkt wird die Farbe klein geholt (sie ist mit
      // 3 km nativ) und beim Zusammensetzen hochgezogen; die Zielgröße gibt
      // der Schärfungskanal vor.
      const colourSize = product.sharpen
        ? colourRequestSize(product, product.sharpen)
        : { width: opts.width, height: opts.height }
      const url = satelliteImageUrl(product, { time, ...colourSize })
      try {
        const res = await fetch(url, { signal: opts.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw = await res.blob()
        // Eine ServiceException kommt als XML mit HTTP 200 — dieselbe Falle
        // wie beim DWD (SPEC §6), nur bei einem anderen Dienst.
        if (!raw.type.startsWith('image/')) {
          throw new Error(`Antwort ist ${raw.type || 'kein Bild'}`)
        }
        let blob = raw
        if (product.sharpen) {
          try {
            blob = await sharpen(product, product.sharpen, time, raw, opts)
          } catch (err) {
            // Lieber die grobe Farbe als gar kein Bild: sie IST die Messung,
            // nur unschärfer. Der Fehler steht in der Konsole.
            console.error('[satellit] Schärfung', err)
          }
        }
        if (product.cloudMask) {
          try {
            blob = await compositeClouds(product, product.cloudMask, time, raw)
          } catch (err) {
            // Lieber das rohe Bild als gar keines: ohne Untergrund ist es
            // immer noch die Messung, und der Fehler steht in der Konsole.
            console.error('[satellit] Untergrund', err)
          }
        }
        if (opts.signal?.aborted) return
        opts.onLoaded(time, URL.createObjectURL(blob))
      } catch (err) {
        if (opts.signal?.aborted) return
        opts.onError?.(time, err)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
}

/**
 * Anforderungsgröße der FARBE beim geschärften Produkt: klein, weil sie mit
 * 3 km nativ ist. Die Höhe folgt dem Seitenverhältnis der Fläche, sonst
 * käme das Bild verzerrt und die Struktur läge quer zur Farbe.
 */
function colourRequestSize(
  product: SatelliteProduct,
  spec: SharpenSpec,
): { width: number; height: number } {
  const merc = productMerc(product)
  const width = spec.colourWidth
  return {
    width,
    height: Math.max(1, Math.round((width * (merc.maxy - merc.miny)) / (merc.maxx - merc.minx))),
  }
}

/**
 * Holt den Schärfungskanal zum nächstgelegenen Termin und setzt ihn mit der
 * Farbe zusammen (`render/panSharpen.ts`).
 *
 * Der Pan-Kanal wird über DIESELBE Fläche und in der ZIELgröße des Produkts
 * angefordert — beide Bilder müssen im selben Raster liegen, sonst läge die
 * Struktur neben der Farbe.
 */
async function sharpen(
  product: SatelliteProduct,
  spec: SharpenSpec,
  time: number,
  colour: Blob,
  opts: SatelliteLoadOptions,
): Promise<Blob> {
  const { width, height } = productImageSize(product)
  const url = satelliteImageUrl(product, {
    time: sharpenPanTime(time, spec),
    width,
    height,
    layer: sharpenLayer(spec),
  })
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`Schärfungskanal: HTTP ${res.status}`)
  const pan = await res.blob()
  if (!pan.type.startsWith('image/')) {
    throw new Error(`Schärfungskanal antwortet mit ${pan.type || 'kein Bild'}`)
  }
  const merc = productMerc(product)
  return await panSharpen(colour, pan, spec.colourMercM, (merc.maxx - merc.minx) / width)
}
