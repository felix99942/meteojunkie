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
  satelliteCapabilitiesUrl,
  satelliteImageUrl,
  type SatelliteProduct,
} from '../config/satellite'
import type { TimeExtent } from '../config/wmsTime'
import { compositeClouds } from '../render/cloudComposite'

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
      const url = satelliteImageUrl(product, {
        time,
        width: opts.width,
        height: opts.height,
      })
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
