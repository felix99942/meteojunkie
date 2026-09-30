// Kartenkacheln als Hintergrund der Canvas-Karten (Klima, MOS): CARTO
// „Dark Matter" — OpenStreetMap-Daten in einem Stil für dunkle Oberflächen.
//
// Bewusst KEIN Kachel-Framework: die Karte ist ein eigenes Canvas mit
// Mercator-Projektion (render/atmap.ts), hier werden nur Bilder geholt,
// gemerkt und in ihr Rechteck gezeichnet.
//
// Dark Matter statt des OSM-Standardstils: der war hell und bunt und musste
// entsättigt und abgedunkelt werden, damit er nicht mit den farbigen Werten
// konkurriert — gedämpft sah er matschig aus. Dark Matter ist von sich aus
// ruhig und dunkel, die Werte stehen darauf ohne Nachbearbeitung.
//
// Geholt wird NUR, was gerade im Bild steht, nichts vorauseilend.
//
// SCHLÜSSELPFLICHTIG seit September 2026: ohne `?key=` liefert CARTO statt
// der Karte ein Wasserzeichen „API KEY REQUIRED" (HTTP 200, gleiches
// Format — man sieht es erst im Bild). Der Schlüssel ist kostenlos, ohne
// Konto, nicht kommerziell bis 5 Mio. Abrufe im Monat
// (carto.com/basemaps/apikey). Er kommt beim BAUEN herein
// (`VITE_CARTO_KEY`), nicht aus dem Code — ein Schlüssel gehört zu EINEM
// Projekt und nicht in einen öffentlichen Git-Verlauf. Im Bundle steht er
// dann im Klartext; das ist bei einem Browser-Schlüssel unvermeidbar und so
// vorgesehen. FEHLT er, wird GAR NICHTS geholt: ein dunkler Hintergrund ist
// die ehrlichere Anzeige als ein Wasserzeichenteppich über der Karte.

import { TILE_MAX_ZOOM, visibleTiles, type MapGeometry } from './atmap'

/** Leer zählt als fehlend — eine nicht gesetzte GitHub-Variable kommt als ''. */
const KEY = import.meta.env.VITE_CARTO_KEY?.trim() || null

/** Ohne Schlüssel keine Kacheln (siehe oben). */
export const TILES_AVAILABLE = KEY != null
/** Obergrenze im Speicher; eine volle Karte bei 2× Pixeldichte sind ~100 Kacheln. */
const MAX_CACHED = 600
/** So viele Stufen gröber wird ein Platzhalter gesucht, solange die Kachel lädt. */
const FALLBACK_LEVELS = 4

interface Entry {
  img: HTMLImageElement
  ok: boolean
  failed: boolean
}

// Einfügereihenfolge der Map = Alter; ein Treffer rückt nach hinten (LRU).
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

/** Benachrichtigung, sobald eine Kachel fertig ist (zum Neuzeichnen). */
export function onTileLoad(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function key(z: number, x: number, y: number): string {
  return `${retina ? 'r' : ''}${z}/${x}/${y}`
}

function peek(z: number, x: number, y: number): Entry | undefined {
  const k = key(z, x, y)
  const e = cache.get(k)
  if (e) {
    cache.delete(k)
    cache.set(k, e)
  }
  return e
}

/**
 * Kacheln in doppelter Auflösung (512 px, `@2x`) für hohe Pixeldichte.
 * Nicht über eine feinere Zoomstufe gelöst: die hätte die richtige Schärfe,
 * aber Beschriftung und Linien in HALBER Grösse — die Stile sind für eine
 * Stufe gezeichnet, nicht für ihre Pixelzahl.
 */
let retina = false
export function setRetinaTiles(on: boolean): void {
  retina = on
}

function request(z: number, x: number, y: number): Entry {
  const hit = peek(z, x, y)
  if (hit) return hit
  const img = new Image()
  // Der Server schickt `Access-Control-Allow-Origin: *` — so bleibt das
  // Canvas lesbar, falls die Karte je als Bild exportiert wird.
  img.crossOrigin = 'anonymous'
  const e: Entry = { img, ok: false, failed: false }
  img.onload = () => {
    e.ok = true
    for (const fn of listeners) fn()
  }
  // Fehler bleiben gemerkt: sonst fragte jedes Neuzeichnen dieselbe Kachel
  // erneut an — bei einem fremden, kostenlosen Dienst genau das Falsche.
  img.onerror = () => {
    e.failed = true
  }
  img.src =
    `https://basemaps.cartocdn.com/rastertiles/dark_all/${z}/${x}/${y}${retina ? '@2x' : ''}.png` +
    `?key=${encodeURIComponent(KEY ?? '')}`
  cache.set(key(z, x, y), e)
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string
    cache.delete(oldest)
  }
  return e
}

/**
 * Sichtbare Kacheln der passenden Stufe zeichnen. Fehlt eine noch, springt
 * ein Ausschnitt einer gröberen, schon geladenen Kachel ein — sonst blitzte
 * beim Zoomen jedes Mal der leere Hintergrund durch.
 */
export function drawOsmTiles(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  z: number,
  w: number,
  h: number,
): void {
  if (!TILES_AVAILABLE) return
  z = Math.min(z, TILE_MAX_ZOOM)
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  for (const t of visibleTiles(g, z, w, h)) {
    const e = request(t.z, t.x, t.y)
    // Kanten auf ganze Pixel, sonst stehen zwischen den Kacheln feine Fugen.
    const x0 = Math.floor(t.px)
    const y0 = Math.floor(t.py)
    const s = Math.ceil(t.px + t.size) - x0
    const sy = Math.ceil(t.py + t.size) - y0
    if (e.ok) {
      ctx.drawImage(e.img, x0, y0, s, sy)
      continue
    }
    for (let d = 1; d <= FALLBACK_LEVELS && t.z - d >= 0; d++) {
      const f = 2 ** d
      const p = peek(t.z - d, Math.floor(t.x / f), Math.floor(t.y / f))
      if (!p?.ok) continue
      const sub = p.img.naturalWidth / f
      ctx.drawImage(p.img, (t.x % f) * sub, (t.y % f) * sub, sub, sub, x0, y0, s, sy)
      break
    }
  }
  ctx.restore()
}
