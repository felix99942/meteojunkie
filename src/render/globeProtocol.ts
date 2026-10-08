// Registriert das Kachelprotokoll des Globus bei MapLibre (siehe
// `globeTiles.ts`). Kein Netz: MapLibre ruft den Handler für raster-Kacheln auf
// dem Hauptthread auf und übernimmt ein zurückgegebenes ImageBitmap direkt
// (`image_request.ts`). Der Zeitschritt steckt in der URL — ein Wechsel ist ein
// `setTiles`, und MapLibre fragt die sichtbaren Kacheln neu an.
//
// GERECHNET wird im Worker-Pool (`globePool.ts`/`globeWorker.ts`), nicht hier:
// der Handler reicht nur weiter und merkt sich fertige Kacheln.

import maplibregl from 'maplibre-gl'
import { GLOBE_PROTOCOL, GLOBE_TILE_SIZE } from './globeTiles'
import { requestTile, type FieldSource } from './globePool'
import { CONTOURS, type ContourId, type GlobeModelId, type GlobeVarId } from '../config/globe'

/** Quelle eines Felds für den Worker — gesetzt vom Bereich, damit dieses Modul nichts von der Meta weiß. */
export type GlobeFieldSourceFn = (model: GlobeModelId, runId: string, varId: GlobeVarId, step: number) => FieldSource | null

let registered = false

/**
 * Fertige Kacheln, über die URL (Modell/Lauf/Größe/Schritt/z/x/y) gemerkt.
 * MapLibre leert seinen eigenen Kachelspeicher bei jedem `setTiles` — beim
 * Hin- und Herblättern wurde deshalb jede Kachel neu gerechnet. MapLibre
 * schließt zurückgegebene Bilder nicht (geprüft), sie lassen sich also
 * wiederverwenden. 256 Kacheln ≈ 64 MB im schlimmsten Fall.
 */
const TILE_LRU = 256
const tileCache = new Map<string, ImageBitmap>()

function remember(url: string, bmp: ImageBitmap): ImageBitmap {
  tileCache.set(url, bmp)
  while (tileCache.size > TILE_LRU) {
    const [k, old] = tileCache.entries().next().value!
    tileCache.delete(k)
    old.close()
  }
  return bmp
}

function cached(url: string): ImageBitmap | undefined {
  const hit = tileCache.get(url)
  if (hit) {
    tileCache.delete(url)
    tileCache.set(url, hit)
  }
  return hit
}

/**
 * Kachel, wenn das Feld nicht ladbar ist: leer statt Fehler. Ein abgelehnter
 * Protokoll-Aufruf ließ MapLibre 5 über eine Kachel ohne Textur stolpern
 * („reading 'bind'") — gemessen, als der Dev-Server für noch unbekannte Dateien
 * die Startseite auslieferte. Den Fehler selbst meldet der Bereich über das
 * aktuelle Feld (`fieldError`), die Kacheln brauchen ihn nicht noch einmal.
 */
let emptyTile: Promise<ImageBitmap> | null = null
function empty(): Promise<ImageBitmap> {
  emptyTile ??= createImageBitmap(new ImageData(GLOBE_TILE_SIZE, GLOBE_TILE_SIZE))
  return emptyTile
}

/**
 * Kachel aus dem Pool; ein nicht ladbares Feld ergibt eine leere Kachel, ein
 * Abbruch (`AbortError`) geht unverändert an MapLibre zurück.
 */
async function tile(url: string, src: FieldSource | null, run: (src: FieldSource) => Promise<ImageBitmap>): Promise<{ data: ImageBitmap }> {
  const hit = cached(url)
  if (hit) return { data: hit }
  if (!src) return { data: await empty() }
  try {
    return { data: remember(url, await run(src)) }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return { data: await empty() }
  }
}

/** Registriert das Protokoll einmal je Seite (MapLibre hält Protokolle global). */
export function registerGlobeProtocol(source: GlobeFieldSourceFn): void {
  if (registered) return
  registered = true
  maplibregl.addProtocol(GLOBE_PROTOCOL, async (params, ac) => {
    const m = /^globe:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
    if (!m) throw new Error(`Modellkarten-Kachel: unbekannte URL ${params.url}`)
    const [, model, runId, varId, step, z, x, y] = m
    const src = source(model as GlobeModelId, runId, varId as GlobeVarId, Number(step))
    return tile(params.url, src, (s) => requestTile(s, varId as GlobeVarId, +z, +x, +y, ac.signal))
  })

  // Isolinien als eigene Ebene: globeiso://modell/lauf/größe/schritt/z/x/y,
  // die Größe ist zugleich die Linienart (msl → Isobaren, gh500 → 500 hPa)
  maplibregl.addProtocol(GLOBE_ISO_PROTOCOL, async (params, ac) => {
    const m = /^globeiso:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
    if (!m) throw new Error(`Isolinien-Kachel: unbekannte URL ${params.url}`)
    const [, model, runId, varId, step, z, x, y] = m
    const def = CONTOURS.find((c) => c.id === varId)
    if (!def) throw new Error(`keine Isolinien für ${varId}`)
    const contour = { id: def.id as ContourId, interval: def.interval, smooth: def.smooth[model as GlobeModelId] ?? 0 }
    const src = source(model as GlobeModelId, runId, varId as GlobeVarId, Number(step))
    return tile(params.url, src, (s) => requestTile(s, varId as GlobeVarId, +z, +x, +y, ac.signal, contour))
  })
}

export const GLOBE_ISO_PROTOCOL = 'globeiso'

export function globeIsoUrl(model: GlobeModelId, runId: string, contour: ContourId, step: number): string {
  return `${GLOBE_ISO_PROTOCOL}://${model}/${runId}/${contour}/${step}/{z}/{x}/{y}`
}
