// Beschriftung der Modellkarten: Städte, Länder und Meere weltweit, mit
// deutschen Namen (Natural Earth, `scripts/build-labels.mjs`), dazu die
// kuratierten Orte aus `config/cities.ts` (Alpenorte, Regionalzentren — die
// fehlen in Natural Earth).
//
// DOM-Marker wie überall auf der Seite — ein Symbol-Layer bräuchte eine
// externe Glyphs-Quelle. Bei ~7.000 Kandidaten geht das nur mit
// AUSDÜNNUNG NACH PLATZ: je Kamerastand wird neu entschieden, was sichtbar
// ist (im Bild, ab seinem Zoom, nicht hinter der Kugel), in Rangfolge
// gesetzt und verworfen, was sich mit schon gesetzten Beschriftungen
// überdeckt. Gesetzt werden höchstens `MAX_LABELS` Marker — MapLibre
// verschiebt jeden Marker bei jedem Frame, mit Tausenden würde das Drehen
// zäh. Neu entschieden wird nach dem Ende einer Bewegung, nicht währenddessen.

import maplibregl from 'maplibre-gl'
import labelsUrl from '../mapdata/world.labels.json?url'
import { CITIES } from '../config/cities'
import { THAI_PLACES } from '../config/thaiPlaces'

/** 0 Stadt · 1 Hauptstadt · 2 Land · 3 Meer */
export type LabelKind = 0 | 1 | 2 | 3
export type LabelTuple = [name: string, lon: number, lat: number, minZoom: number, kind: LabelKind]

export interface LabelCandidate {
  name: string
  lon: number
  lat: number
  minZoom: number
  kind: LabelKind
}

const MAX_LABELS = 220
/** Freiraum um jede Beschriftung (px), damit sie nicht Kante an Kante stehen. */
const PAD = 4

let labelsPromise: Promise<LabelCandidate[]> | null = null

function loadLabels(): Promise<LabelCandidate[]> {
  labelsPromise ??= fetch(labelsUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`Beschriftung: HTTP ${r.status}`)
      return r.json() as Promise<{ labels: LabelTuple[] }>
    })
    .then(({ labels }) =>
      mergeCandidates(
        labels.map(([name, lon, lat, minZoom, kind]) => ({ name, lon, lat, minZoom: displayMinZoom(kind, minZoom), kind })),
        curatedCities(),
      ),
    )
  return labelsPromise
}

/**
 * Zoomleiter der Bildkarten (Radar/Satellit): Priorität → ab welchem Zoom
 * sichtbar. Die erste Stufe beginnt hier bei 4 statt bei 0: Radar und Satellit
 * zoomen nie so weit heraus, auf dem Globus stünde Köln (Priorität 1) sonst
 * schon bei Zoom 0 und verdrängte „Deutschland" und Berlin.
 */
const IMAGERY_MIN_ZOOM = [4, 4.8, 6, 7, 8]
/** Hauptstädte Europas: schon in der Übersicht. */
const EUROPE_MIN_ZOOM = [2, 3.5, 4.5]

/**
 * Die kuratierten Orte aus `config/cities.ts`: Hauptstädte der Domain
 * `europe` und die Orte der Pseudo-Domain `imagery` mit der Zoomleiter der
 * Bildkarten, dazu die Urlaubsorte aus `config/thaiPlaces.ts`. Doppelte Namen
 * zählen einmal.
 */
export function curatedCities(): LabelCandidate[] {
  const seen = new Set<string>()
  const out: LabelCandidate[] = []
  const add = (domain: 'europe' | 'imagery', ladder: number[]) => {
    for (const c of CITIES) {
      if (!c.domains.includes(domain) || seen.has(c.name)) continue
      seen.add(c.name)
      out.push({ name: c.name, lon: c.lon, lat: c.lat, minZoom: ladder[Math.min(c.priority, ladder.length) - 1], kind: 0 })
    }
  }
  add('europe', EUROPE_MIN_ZOOM)
  add('imagery', IMAGERY_MIN_ZOOM)
  // Thailand-Tropendienst: die Orte der Schnellwahl ab der Thailand-Ansicht
  // (Zoom ~5), die Inseln eine Stufe später
  for (const p of THAI_PLACES) {
    if (seen.has(p.label)) continue
    seen.add(p.label)
    out.push({ name: p.label, lon: p.lon, lat: p.lat, minZoom: p.quick ? 4.5 : 5.5, kind: 0 })
  }
  return out
}

/**
 * Länder- und Meeresnamen kommen SPÄTER ins Bild, als Natural Earth es
 * vorsieht: auf dem ganzen Globus machten sie die Kugel voll, die Namen
 * standen dichter als die Grenzen, die sie benennen. Erst beim Hineinzoomen
 * ordnen sie die Karte; die Kugel selbst zeigt Grenzen und große Städte.
 */
const COUNTRY_DELAY = 1.5
const COUNTRY_MIN = 3
const SEA_DELAY = 1
export function displayMinZoom(kind: LabelKind, neMinZoom: number): number {
  if (kind === 2) return Math.max(COUNTRY_MIN, neMinZoom + COUNTRY_DELAY)
  if (kind === 3) return neMinZoom + SEA_DELAY
  return neMinZoom
}

/** Abstand zweier Punkte in km (Haversine). */
function distKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/**
 * Kuratierte Orte zu den Natural-Earth-Städten nehmen. Derselbe Ort in beiden
 * Listen (gleicher Name, < 30 km) zählt einmal, und zwar mit dem FRÜHEREN
 * Zoom — die kuratierte Liste hebt Alpenorte bewusst früher ins Bild, als ihre
 * Größe es täte.
 */
export function mergeCandidates(base: LabelCandidate[], extra: LabelCandidate[]): LabelCandidate[] {
  const out = base.slice()
  const byName = new Map<string, number[]>()
  out.forEach((c, i) => {
    if (c.kind > 1) return
    const k = c.name.toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), i])
  })
  for (const e of extra) {
    const hit = (byName.get(e.name.toLowerCase()) ?? []).find((i) => distKm(out[i], e) < 30)
    if (hit === undefined) out.push(e)
    else out[hit] = { ...out[hit], minZoom: Math.min(out[hit].minZoom, e.minZoom) }
  }
  return out
}

/**
 * Rangfolge beim Ausdünnen: wer früher ins Bild darf, ist wichtiger. Bei
 * gleichem Zoom: Land vor Meer vor Hauptstadt vor Stadt — die Ländernamen
 * ordnen die Karte, Städte füllen sie.
 */
const KIND_ORDER: Record<LabelKind, number> = { 2: 0, 3: 1, 1: 2, 0: 3 }
export function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  return a.minZoom - b.minZoom || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
}

/** Geschätzte Größe einer Beschriftung in px (ohne Messung im DOM — die wäre bei Tausenden zu teuer). */
export function labelBox(c: LabelCandidate): { w: number; h: number; centered: boolean } {
  if (c.kind === 2) return { w: c.name.length * 7.4 + 6, h: 14, centered: true }
  if (c.kind === 3) return { w: c.name.length * 6.6 + 4, h: 14, centered: true }
  return { w: c.name.length * 7.4 + 14, h: 17, centered: false }
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Wie weit der Punkt zur Kamera gewandt ist: 1 = Bildmitte der Kugel,
 * 0 = Kugelrand, negativ = Rückseite.
 */
function facing(c: LabelCandidate, center: maplibregl.LngLat): number {
  const rad = Math.PI / 180
  return (
    Math.sin(c.lat * rad) * Math.sin(center.lat * rad) +
    Math.cos(c.lat * rad) * Math.cos(center.lat * rad) * Math.cos((c.lon - center.lng) * rad)
  )
}
/**
 * Flächennamen (Land, Meer) brauchen mehr Abstand vom Kugelrand als Orte:
 * dort ist die Fläche perspektivisch gestaucht, ein gerader Name darüber
 * gehört sichtbar nicht mehr dazu.
 */
const FACING_MIN: Record<LabelKind, number> = { 0: 0.15, 1: 0.15, 2: 0.45, 3: 0.45 }

/** Liegt der Bildpunkt auf der Kugel (und nicht daneben im All)? */
function onSphere(map: maplibregl.Map, x: number, y: number): boolean {
  const p = map.project(map.unproject([x, y]))
  return Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1
}

/**
 * Was beim aktuellen Kamerastand stehen soll: Kandidaten in Rangfolge, jeder
 * nur, wenn er im Bild liegt und keinen schon gesetzten überdeckt.
 */
function choose(map: maplibregl.Map, sorted: LabelCandidate[], avoid: Rect[]): LabelCandidate[] {
  const zoom = map.getZoom()
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const globe = map.getProjection()?.type === 'globe'
  const center = map.getCenter()
  // Bedienelemente über der Karte zählen als schon belegt
  const placed: Rect[] = avoid.slice()
  const out: LabelCandidate[] = []
  for (const c of sorted) {
    if (c.minZoom > zoom) break // sortiert: alle weiteren kommen noch später
    if (globe && facing(c, center) < FACING_MIN[c.kind]) continue
    const p = map.project([c.lon, c.lat])
    const { w, h, centered } = labelBox(c)
    const x0 = centered ? p.x - w / 2 : p.x - 4
    // Nur ganz im Bild — ein am Rand abgeschnittener Name („elun") ist keiner
    if (x0 < 0 || x0 + w > W || p.y - h / 2 < 0 || p.y + h / 2 > H) continue
    // Auf der Kugel nur, was GANZ auf ihr liegt — kein Name ragt ins All
    if (globe && !(onSphere(map, x0, p.y - h / 2) && onSphere(map, x0 + w, p.y - h / 2) &&
      onSphere(map, x0, p.y + h / 2) && onSphere(map, x0 + w, p.y + h / 2))) continue
    const r = { x0: x0 - PAD, y0: p.y - h / 2 - PAD, x1: x0 + w + PAD, y1: p.y + h / 2 + PAD }
    if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue
    placed.push(r)
    out.push(c)
    if (out.length >= MAX_LABELS) break
  }
  return out
}

function makeMarker(c: LabelCandidate): maplibregl.Marker {
  const el = document.createElement('div')
  if (c.kind >= 2) {
    el.className = c.kind === 2 ? 'world-label world-country' : 'world-label world-sea'
    el.textContent = c.name
    return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([c.lon, c.lat])
  }
  el.className = c.kind === 1 ? 'city-marker city-capital' : 'city-marker'
  const dot = document.createElement('span')
  dot.className = 'city-dot'
  const label = document.createElement('span')
  label.className = 'city-label'
  label.textContent = c.name
  el.append(dot, label)
  // Offset = halber Punktdurchmesser der vergrößerten Bildkarten-Punkte
  return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-4, 0] }).setLngLat([c.lon, c.lat])
}

/**
 * Flächen der Elemente, die über der Karte liegen (Legende, Pfeile,
 * Werteanzeige), in Kartenkoordinaten — dort wäre ein Name verdeckt.
 */
function overlayRects(map: maplibregl.Map, selector: string | undefined): Rect[] {
  if (!selector) return []
  const box = map.getContainer().getBoundingClientRect()
  const scope = map.getContainer().parentElement ?? document.body
  return [...scope.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect()
    return { x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top }
  })
}

/**
 * Beschriftung setzen und mitführen; gibt die Aufräumfunktion zurück.
 * `avoid` = CSS-Selektor der Bedienelemente über der Karte (im selben
 * Elternelement wie der Kartencontainer), unter die kein Name gesetzt wird.
 */
export function addWorldLabels(map: maplibregl.Map, avoid?: string): () => void {
  let alive = true
  const shown = new Map<LabelCandidate, maplibregl.Marker>()
  let sorted: LabelCandidate[] = []

  const update = () => {
    if (!alive || sorted.length === 0) return
    const want = new Set(choose(map, sorted, overlayRects(map, avoid)))
    for (const [c, m] of shown) {
      if (!want.has(c)) {
        m.remove()
        shown.delete(c)
      }
    }
    for (const c of want) {
      if (shown.has(c)) continue
      // Hinter der Kugel ganz ausblenden statt halbdurchsichtig stehen lassen
      const m = makeMarker(c).setOpacity('1', '0').addTo(map)
      shown.set(c, m)
    }
  }

  loadLabels()
    .then((all) => {
      if (!alive) return
      sorted = all.slice().sort(compareCandidates)
      update()
    })
    .catch((err: unknown) => console.error('[labels]', err))

  map.on('moveend', update)
  map.on('resize', update)
  return () => {
    alive = false
    map.off('moveend', update)
    map.off('resize', update)
    for (const m of shown.values()) m.remove()
    shown.clear()
  }
}
