// Örtliche Höchstwerte als Zahlen IM Farbfeld (Modellkarten, Niederschlag):
// „wie viel ungefähr" auf einen Blick, ohne die Farbe gegen die Legende zu
// halten. Gilt für jedes Modell, gerechnet aus dem schon geladenen Feld der
// Werteanzeige — kein zusätzlicher Abruf.
//
// Verfahren im BILDSCHIRMRAUM, wie Beschriftung und Windpartikel: der
// Ausschnitt wird in Blöcke von ~BLOCK_PX geteilt, je Block das Gittermaximum
// gesucht (exakt über alle Zellen darin, nicht über Stichproben — sonst
// fiele ein 1-km-Kern zwischen zwei Abtastpunkte). JEDER Block nennt sein
// Maximum, ausgedünnt nur nach Abstand (der höhere Wert gewinnt) — auf
// Wunsch dicht: rund um einen Kern stehen mehrere Zahlen, und die Fläche
// lässt sich als grobes Mengenbild lesen. Die erste Fassung beschriftete nur
// Blöcke über allen acht Nachbarn und ließ je Region genau eine Zahl. Neu
// gerechnet nach jeder Kamerabewegung und jedem Feldwechsel; beim Hineinzoomen
// werden die Blöcke kleiner und die Maxima damit örtlicher.

import maplibregl from 'maplibre-gl'
import type { GlobeField } from '../config/globe'
import { formatMax, inFilledArea, maxInBox, spacedMaxima, type FieldMax } from '../config/globeMaxima'

export interface MaximaOptions {
  /** Kleinster beschrifteter Wert (nach `factor`). */
  min: number
  /** Umrechnung des Feldwerts, z. B. Rate (mm/h) × Intervall (h) = Menge. */
  factor: number
  /** Nachkommastellen unter 10 — die Summe ist in ganzen mm gespeichert. */
  decimals: number
  /** Unterste eingefärbte Stufe (Feldeinheit) — Zahlen nur in einer Farbfläche. */
  fillMin: number
}

// Je Block ein Kandidat, Zahlen mindestens MIN_DIST_PX auseinander
const BLOCK_PX = 55
const MIN_DIST_PX = 40

/**
 * Zahlenebene über der Karte; `set` mit Feld (oder null zum Leeren),
 * gibt die Aufräumfunktion über `destroy` zurück. `avoid` = Selektor der
 * Bedienelemente über der Karte, unter die keine Zahl gesetzt wird.
 */
export function addFieldMaxima(map: maplibregl.Map, avoid?: string) {
  let field: GlobeField | null = null
  let opts: MaximaOptions = { min: 0.5, factor: 1, decimals: 1, fillMin: 0.1 }
  let markers: maplibregl.Marker[] = []

  const clear = () => {
    for (const m of markers) m.remove()
    markers = []
  }

  // Auf der Kugel liegt ein Bildpunkt neben der Kugel, wenn die
  // Rückprojektion nicht zu ihm zurückführt
  const onMap = (p: maplibregl.Point): maplibregl.LngLat | null => {
    const ll = map.unproject(p)
    const back = map.project(ll)
    return Math.hypot(back.x - p.x, back.y - p.y) < 2 ? ll : null
  }

  const update = () => {
    clear()
    if (!field) return
    const canvas = map.getCanvas()
    const W = canvas.clientWidth
    const H = canvas.clientHeight
    const cols = Math.ceil(W / BLOCK_PX)
    const rows = Math.ceil(H / BLOCK_PX)
    const bw = W / cols
    const bh = H / rows
    const blocks: (FieldMax | null)[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pts = [
          [c * bw, r * bh], [(c + 1) * bw, r * bh], [c * bw, (r + 1) * bh], [(c + 1) * bw, (r + 1) * bh],
          [(c + 0.5) * bw, (r + 0.5) * bh],
        ].map(([x, y]) => onMap(new maplibregl.Point(x, y)))
        if (pts.some((p) => !p)) {
          blocks.push(null)
          continue
        }
        // Längen um die Blockmitte entfalten (Mercator-Weltkopien, Datumsgrenze)
        const cl = ((pts[4]!.lng + 540) % 360) - 180
        const lons = pts.map((p) => cl + ((((p!.lng - cl + 540) % 360) + 360) % 360) - 180)
        const lats = pts.map((p) => p!.lat)
        const w = Math.min(...lons)
        const e = Math.max(...lons)
        if (e - w > 180) {
          blocks.push(null)
          continue
        }
        const m = maxInBox(field, w, Math.min(...lats), e, Math.max(...lats))
        blocks.push(m && inFilledArea(field, m.idx, opts.fillMin) ? { ...m, value: m.value * opts.factor } : null)
      }
    }
    const busy = overlayRects(map, avoid)
    // Ortsnamen: die Zahl rückt darüber oder darunter, statt den Namen zu
    // überdecken — fällt kein Platz, entfällt sie (der Name steht schon)
    const box = map.getContainer().getBoundingClientRect()
    const names = [...map.getContainer().querySelectorAll('.world-label, .city-label')].map((el) => {
      const r = el.getBoundingClientRect()
      return { x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top }
    })
    const cands = blocks
      .filter((b): b is FieldMax => b != null)
      .map((b) => {
        const p = map.project([b.lon, b.lat])
        return { ...b, x: p.x, y: p.y }
      })
    for (const m of spacedMaxima(cands, MIN_DIST_PX, opts.min)) {
      const p = new maplibregl.Point(m.x, m.y)
      if (p.x < 12 || p.y < 10 || p.x > W - 12 || p.y > H - 10) continue
      if (busy.some((b) => p.x > b.x0 - 14 && p.x < b.x1 + 14 && p.y > b.y0 - 8 && p.y < b.y1 + 8)) continue
      if (!onMap(p)) continue
      const text = formatMax(m.value, opts.decimals)
      const hw = text.length * 4 + 3
      const dy = [0, 15, -15].find((d) =>
        !names.some((b) => p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + d + 8 > b.y0 && p.y + d - 8 < b.y1),
      )
      if (dy == null) continue
      const el = document.createElement('div')
      el.className = 'globe-max'
      el.textContent = text
      markers.push(new maplibregl.Marker({ element: el, offset: [0, dy] }).setLngLat([m.lon, m.lat]).addTo(map))
    }
  }

  map.on('moveend', update)
  map.on('resize', update)
  return {
    set(f: GlobeField | null, o?: MaximaOptions) {
      field = f
      if (o) opts = o
      update()
    },
    destroy() {
      map.off('moveend', update)
      map.off('resize', update)
      clear()
    },
  }
}

function overlayRects(map: maplibregl.Map, selector?: string) {
  if (!selector) return []
  const box = map.getContainer().getBoundingClientRect()
  const scope = map.getContainer().parentElement ?? document.body
  return [...scope.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect()
    return { x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top }
  })
}
