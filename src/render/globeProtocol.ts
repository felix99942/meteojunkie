// Registriert das Kachelprotokoll des Globus bei MapLibre (siehe
// `globeTiles.ts`). Kein Netz: MapLibre ruft den Handler für raster-Kacheln auf
// dem Hauptthread auf und übernimmt ein zurückgegebenes ImageBitmap direkt
// (`image_request.ts`). Der Zeitschritt steckt in der URL — ein Wechsel ist ein
// `setTiles`, und MapLibre fragt die sichtbaren Kacheln neu an.

import maplibregl from 'maplibre-gl'
import { colorizeRgbTile, colorizeTile, GLOBE_PROTOCOL, GLOBE_TILE_SIZE } from './globeTiles'
import { CONTOUR_STYLES, contourTile, smoothField } from './globeContours'
import { CONTOURS, getGlobeVariable, type ContourId, type GlobeField, type GlobeModelId, type GlobeVarId } from '../config/globe'

/** Feldquelle des Protokolls — gesetzt vom Bereich, damit dieses Modul nichts vom Laden weiß. */
export type GlobeFieldLoader = (model: GlobeModelId, runId: string, varId: GlobeVarId, step: number) => Promise<GlobeField>

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
 * Wurde die Kachel inzwischen abbestellt, wird sie NICHT mehr gerechnet.
 * Beim schnellen Durchblättern bestellt MapLibre die Kacheln des vorigen
 * Schritts ab; vorher rechnete das Protokoll sie trotzdem fertig, und der
 * Rückstau war genau das „Nachziehen" (gemessen: ~1 s Rechenzeit je Schritt
 * beim IFS-Globus mit Isobaren). Der Name `AbortError` ist das, woran
 * MapLibre einen Abbruch erkennt — dann meldet es keinen Fehler.
 */
function bail(ac: AbortController): void {
  if (ac.signal.aborted) {
    const e = new Error('AbortError')
    e.name = 'AbortError'
    throw e
  }
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

/** Registriert das Protokoll einmal je Seite (MapLibre hält Protokolle global). */
export function registerGlobeProtocol(load: GlobeFieldLoader): void {
  if (registered) return
  registered = true
  maplibregl.addProtocol(GLOBE_PROTOCOL, async (params, ac) => {
    const hit = cached(params.url)
    if (hit) return { data: hit }
    const m = /^globe:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
    if (!m) throw new Error(`Modellkarten-Kachel: unbekannte URL ${params.url}`)
    const [, model, runId, varId, step, z, x, y] = m
    let field: GlobeField
    try {
      field = await load(model as GlobeModelId, runId, varId as GlobeVarId, Number(step))
    } catch {
      return { data: await empty() }
    }
    bail(ac)
    const rgba = field.rgb
      ? colorizeRgbTile(field, Number(z), Number(x), Number(y))
      : colorizeTile(field, getGlobeVariable(varId).scale, Number(z), Number(x), Number(y))
    const data = await createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, GLOBE_TILE_SIZE, GLOBE_TILE_SIZE))
    return { data: remember(params.url, data) }
  })

  // Isolinien als eigene Ebene: globeiso://modell/lauf/größe/schritt/z/x/y,
  // die Größe ist zugleich die Linienart (msl → Isobaren, gh500 → 500 hPa)
  maplibregl.addProtocol(GLOBE_ISO_PROTOCOL, async (params, ac) => {
    const hit = cached(params.url)
    if (hit) return { data: hit }
    const m = /^globeiso:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
    if (!m) throw new Error(`Isolinien-Kachel: unbekannte URL ${params.url}`)
    const [, model, runId, varId, step, z, x, y] = m
    const def = CONTOURS.find((c) => c.id === varId)
    if (!def) throw new Error(`keine Isolinien für ${varId}`)
    let field: GlobeField
    try {
      field = await load(model as GlobeModelId, runId, varId as GlobeVarId, Number(step))
    } catch {
      return { data: await empty() }
    }
    bail(ac)
    const smooth = smoothField(field, def.smooth[model as GlobeModelId] ?? 0)
    bail(ac)
    const { rgba, labels } = contourTile(field, smooth, def.interval, CONTOUR_STYLES[def.id as ContourId], Number(z), Number(x), Number(y), GLOBE_TILE_SIZE)
    return { data: remember(params.url, await drawContourTile(rgba, labels, def.id as ContourId)) }
  })
}

export const GLOBE_ISO_PROTOCOL = 'globeiso'

export function globeIsoUrl(model: GlobeModelId, runId: string, contour: ContourId, step: number): string {
  return `${GLOBE_ISO_PROTOCOL}://${model}/${runId}/${contour}/${step}/{z}/{x}/{y}`
}

/**
 * Linien plus Beschriftung auf eine Leinwand. Unter der Zahl wird die Linie
 * AUSGESPART (destination-out), sonst liefe sie mitten durch die Ziffern —
 * so wie in jeder gedruckten Wetterkarte.
 */
async function drawContourTile(
  rgba: Uint8ClampedArray,
  labels: { x: number; y: number; text: string }[],
  id: ContourId,
): Promise<ImageBitmap> {
  const size = GLOBE_TILE_SIZE
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size })
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0)
  const st = CONTOUR_STYLES[id]
  ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const l of labels) {
    const w = ctx.measureText(l.text).width
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillRect(l.x - w / 2 - 3, l.y - 7, w + 6, 14)
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = 3
    ctx.strokeStyle = `rgba(${st.halo.join(',')},0.85)`
    ctx.strokeText(l.text, l.x, l.y)
    ctx.fillStyle = `rgb(${st.core.join(',')})`
    ctx.fillText(l.text, l.x, l.y)
  }
  return createImageBitmap(canvas)
}
