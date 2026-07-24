// Zeichen-/Projektions-Helfer der statischen Österreich-Klimakarte (Schritt 2).
//
// Bewusst leichtgewichtig und Canvas-basiert (kein MapLibre/Slippy-Map): eine
// feste equirectangulare Projektion auf die Österreich-Bounding-Box, mit
// cos(φ)-Korrektur der Längengrade, damit das Land nicht verzerrt. Reicht für
// eine Übersichtskarte und rendert 1000+ Stationspunkte plus die Grenzlinien
// mühelos. Gleiche Idiome wie render/skewt.ts (Geometrie-Objekt + reine
// Zeichenfunktionen, DPR-Handling im Komponenten-Layer).

import type { AtStation } from '../api/geosphere'

/** Kartenausschnitt (Österreich mit etwas Rand). */
export const AT_VIEW = { latMin: 46.3, latMax: 49.1, lonMin: 9.4, lonMax: 17.2 }

export interface MapGeometry {
  left: number
  top: number
  width: number
  height: number
  /** Projektionsparameter (intern). */
  lonMin: number
  latMax: number
  scale: number
  kx: number // cos(latMid)
}

/** Projektionsgeometrie in ein Rechteck (CSS-Pixel) einpassen, Form erhalten. */
export function makeMapGeometry(
  left: number,
  top: number,
  width: number,
  height: number,
  view = AT_VIEW,
): MapGeometry {
  const latMid = (view.latMin + view.latMax) / 2
  const kx = Math.cos((latMid * Math.PI) / 180)
  const geoW = (view.lonMax - view.lonMin) * kx
  const geoH = view.latMax - view.latMin
  const scale = Math.min(width / geoW, height / geoH)
  // zentriert einpassen: verbleibenden Rand gleichmäßig verteilen
  const usedW = geoW * scale
  const usedH = geoH * scale
  return {
    left: left + (width - usedW) / 2,
    top: top + (height - usedH) / 2,
    width: usedW,
    height: usedH,
    lonMin: view.lonMin,
    latMax: view.latMax,
    scale,
    kx,
  }
}

/** Geo-Koordinate → Canvas-Pixel. */
export function project(g: MapGeometry, lon: number, lat: number): { x: number; y: number } {
  return {
    x: g.left + (lon - g.lonMin) * g.kx * g.scale,
    y: g.top + (g.latMax - lat) * g.scale,
  }
}

/** Grenz-/Küstenlinien (GeoJSON-LineStrings, [lon,lat]) zeichnen. */
export function drawBorderLines(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  features: { geometry: { type: string; coordinates: number[][] } }[],
  color: string,
  lineWidth: number,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (const f of features) {
    const coords = f.geometry?.coordinates
    if (!coords || f.geometry.type !== 'LineString') continue
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = coords[i]
      const { x, y } = project(g, lon, lat)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Stationspunkte als Kreise zeichnen; optionaler Index wird hervorgehoben.
 * `colors` (parallel zu stations) färbt je Station ein; null/fehlt → `noDataFill`
 * (kleiner, gedämpft = „kein Wert"). Ohne `colors` bekommen alle `fill`.
 */
export function drawStationPoints(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  stations: AtStation[],
  opts: {
    radius: number
    fill: string
    stroke: string
    highlightIdx?: number
    highlightFill?: string
    colors?: (string | null)[]
    noDataFill?: string
  },
): void {
  ctx.save()
  ctx.lineWidth = 1
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]
    const { x, y } = project(g, s.lon, s.lat)
    const hl = i === opts.highlightIdx
    const perStation = opts.colors ? opts.colors[i] : opts.fill
    const noData = opts.colors && perStation == null
    const r = noData ? opts.radius - 0.8 : hl ? opts.radius + 2 : opts.radius
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2)
    ctx.fillStyle = hl && opts.highlightFill ? opts.highlightFill : (perStation ?? opts.noDataFill ?? opts.fill)
    ctx.fill()
    ctx.strokeStyle = opts.stroke
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Nächste Station zu einem Pixelpunkt finden (Hit-Test für Hover), oder -1.
 * `maxDist` in CSS-Pixeln.
 */
export function nearestStation(
  g: MapGeometry,
  stations: AtStation[],
  px: number,
  py: number,
  maxDist: number,
): number {
  let best = -1
  let bestD2 = maxDist * maxDist
  for (let i = 0; i < stations.length; i++) {
    const { x, y } = project(g, stations[i].lon, stations[i].lat)
    const d2 = (x - px) ** 2 + (y - py) ** 2
    if (d2 <= bestD2) {
      bestD2 = d2
      best = i
    }
  }
  return best
}
