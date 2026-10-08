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
let fieldSource: GlobeFieldSourceFn | null = null

// --- Fertige Kacheln ----------------------------------------------------
//
// MapLibre leert seinen eigenen Kachelspeicher bei jedem `setTiles` — ohne
// diesen Speicher würde jeder schon gesehene Zeitschritt neu gerechnet.
// MapLibre schließt zurückgegebene Bilder nicht (geprüft), sie lassen sich
// also wiederverwenden.
//
// DIE GRÖSSE IST DER PUNKT: früher 256 Kacheln, und ein Schritt auf der Kugel
// braucht 68 (Fläche + Isobaren) — schon der vierte Schritt zurück wurde
// komplett neu gerechnet (gemessen 2026-10-08). Jetzt ein Speicherbudget nach
// Gerätespeicher: eine Kachel sind 256 KB, bei 8 GB 384 MB ≈ 1.500 Kacheln ≈
// 22 Schritte mit Isobaren, gut 40 ohne. Ohne Angabe (Firefox, Safari kennen
// `deviceMemory` nicht) 256 MB.

const TILE_BYTES = GLOBE_TILE_SIZE * GLOBE_TILE_SIZE * 4

function tileBudget(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const mb = gb ? Math.max(128, Math.min(512, gb * 48)) : 256
  return Math.floor((mb * 1024 * 1024) / TILE_BYTES)
}

const TILE_LRU = tileBudget()
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

// --- Welche Kacheln sind sichtbar? -------------------------------------
//
// Fürs Vorladen: die Kacheln, die MapLibre zuletzt für eine EBENE angefragt
// hat (Fläche, Isobaren, 500 hPa), sind die, die im nächsten Zeitschritt
// wieder gebraucht werden — der Ausschnitt ändert sich beim Blättern nicht.
// Je Ebene zählt nur die jüngste Vorlage (URL ohne z/x/y); eine neue Vorlage
// beginnt eine neue Menge, Drehen fügt der laufenden Menge Kacheln hinzu.

interface Parsed {
  layer: string
  template: string
  model: GlobeModelId
  runId: string
  varId: GlobeVarId
  step: number
  z: number
  x: number
  y: number
}

const URL_RE = /^(globe|globeiso):\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/

function parse(url: string): Parsed | null {
  const m = URL_RE.exec(url)
  if (!m) return null
  const [, proto, model, runId, varId, step, z, x, y] = m
  return {
    layer: proto === GLOBE_PROTOCOL ? 'field' : `iso:${varId}`,
    template: `${proto}://${model}/${runId}/${varId}/${step}`,
    model: model as GlobeModelId,
    runId,
    varId: varId as GlobeVarId,
    step: Number(step),
    z: Number(z),
    x: Number(x),
    y: Number(y),
  }
}

const visible = new Map<string, { template: string; coords: Set<string> }>()

function noteVisible(p: Parsed): void {
  let v = visible.get(p.layer)
  if (!v || v.template !== p.template) {
    v = { template: p.template, coords: new Set() }
    visible.set(p.layer, v)
  }
  v.coords.add(`${p.z}/${p.x}/${p.y}`)
  // Nach viel Drehen nicht ewig wachsen: nur die jüngsten behalten
  if (v.coords.size > 160) v.coords.delete(v.coords.values().next().value!)
}

// --- Kachel rechnen ----------------------------------------------------

function contourFor(p: Parsed): { id: ContourId; interval: number; smooth: number } | undefined {
  if (p.layer === 'field') return undefined
  const def = CONTOURS.find((c) => c.id === p.varId)
  if (!def) throw new Error(`keine Isolinien für ${p.varId}`)
  return { id: def.id as ContourId, interval: def.interval, smooth: def.smooth[p.model] ?? 0 }
}

/**
 * Kachel aus Speicher oder Pool; ein nicht ladbares Feld ergibt eine leere
 * Kachel, ein Abbruch (`AbortError`) geht unverändert an MapLibre zurück.
 */
async function tile(url: string, p: Parsed, signal: AbortSignal, low: boolean): Promise<ImageBitmap> {
  const hit = cached(url)
  if (hit) return hit
  const src = fieldSource?.(p.model, p.runId, p.varId, p.step)
  if (!src) return empty()
  try {
    return remember(url, await requestTile(src, p.varId, p.z, p.x, p.y, signal, contourFor(p), low))
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return empty()
  }
}

/** Registriert das Protokoll einmal je Seite (MapLibre hält Protokolle global). */
export function registerGlobeProtocol(source: GlobeFieldSourceFn): void {
  fieldSource = source
  if (registered) return
  registered = true
  const handler = async (params: { url: string }, ac: AbortController) => {
    const p = parse(params.url)
    if (!p) throw new Error(`Modellkarten-Kachel: unbekannte URL ${params.url}`)
    noteVisible(p)
    return { data: await tile(params.url, p, ac.signal, false) }
  }
  maplibregl.addProtocol(GLOBE_PROTOCOL, handler)
  // Isolinien als eigene Ebene: globeiso://modell/lauf/größe/schritt/z/x/y,
  // die Größe ist zugleich die Linienart (msl → Isobaren, gh500 → 500 hPa)
  maplibregl.addProtocol(GLOBE_ISO_PROTOCOL, handler)
}

// --- Vorladen ----------------------------------------------------------

let prefetchAbort: AbortController | null = null
let prefetchKey = ''
/** Laufende Vorlade-Kacheln — ein `idle` mitten im Vorladen soll sie nicht doppelt anstoßen. */
const prefetching = new Map<string, AbortSignal>()

/**
 * Die gerade sichtbaren Kacheln für ANDERE Zeitschritte im Voraus rechnen
 * (`templates` = Vorlagen ohne `/{z}/{x}/{y}`, je Ebene passend zu ihrer
 * Größe). Läuft mit niedriger Priorität und wird beim nächsten Aufruf
 * abbestellt — wer weiterblättert, braucht die alten Nachbarn nicht mehr.
 * Ergebnis: ein Schritt vorwärts kommt aus dem Speicher, statt erst zu rechnen.
 */
export function prefetchVisibleTiles(templates: string[]): void {
  // Abbestellt wird nur bei ANDEREN Schritten. Ein `idle` nach dem Drehen ruft
  // mit denselben Vorlagen und soll Laufendes nicht verwerfen, nur ergänzen.
  const key = templates.join('|')
  if (key !== prefetchKey || !prefetchAbort) {
    prefetchAbort?.abort()
    prefetchAbort = new AbortController()
    prefetchKey = key
  }
  const ac = prefetchAbort
  for (const template of templates) {
    const head = parse(`${template}/0/0/0`)
    if (!head) continue
    const coords = visible.get(head.layer)?.coords
    if (!coords) continue
    for (const c of coords) {
      const url = `${template}/${c}`
      // Ein gerade abbestellter Lauf zählt nicht — die Schritte überlappen sich
      // beim Weiterblättern, sonst fiele die gemeinsame Kachel durchs Raster
      if (tileCache.has(url) || prefetching.get(url)?.aborted === false) continue
      const p = parse(url)
      if (!p) continue
      prefetching.set(url, ac.signal)
      tile(url, p, ac.signal, true)
        .catch(() => {})
        .finally(() => prefetching.get(url) === ac.signal && prefetching.delete(url))
    }
  }
}

export const GLOBE_ISO_PROTOCOL = 'globeiso'

export function globeIsoUrl(model: GlobeModelId, runId: string, contour: ContourId, step: number): string {
  return `${GLOBE_ISO_PROTOCOL}://${model}/${runId}/${contour}/${step}/{z}/{x}/{y}`
}
