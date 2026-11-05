// Windfiedern über der Modellkarte (auf Wunsch im Wechsel mit den Windpartikeln):
// je Rasterpunkt eine Fieder aus den
// Windkomponenten (`uv300`) — Richtung UND Stärke in einem Symbol, wie in der
// Höhenwetterkarte. Partikel zeigen die Strömung schön, aber keine Zahl; über
// einem 1–7-km-Gitter will man ablesen, wie stark es wo weht.
//
// Ein eigenes Canvas direkt über der Kartenzeichenfläche (wie die Partikel),
// neu gezeichnet nach jeder Kamerabewegung. Das Raster hängt an festen
// Gradvielfachen (`valueGrid`) — die Fiedern bleiben beim Verschieben an
// ihrem Ort. Während der Bewegung ruht die Ebene, sonst stünden die Fiedern
// eine Bewegung lang am falschen Ort.
//
// AUF DER KUGEL zeigt Norden nicht nach oben: die Richtung wird deshalb je Fieder auf
// die Bildschirmlage von Norden bezogen (`screenBearing`), und das Raster läuft über
// Breitenkreise mit nach Breite gestrecktem Längenabstand (`globeBarbGrid`), sonst
// drängten sich die Fiedern zu den Polen. Nahe dem Kugelrand wären sie nur noch Striche.

import type maplibregl from 'maplibre-gl'
import { valueGrid } from '../config/globeMaxima'
import { drawWindBarb } from './wxsymbols'

export type WindSampler = (lat: number, lon: number) => [number, number] | null

/** Abstand der Fiedern in Bildschirm-px und ihre Schaftlänge */
const GAP_PX = 46
const LEN_PX = 26

/** Herkunftsrichtung (meteorologisch, Grad) aus u/v (Strömung nach Osten/Norden). */
export function windFromDeg(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
}

/** Richtung, in die ein Punkt von `from` aus auf dem Schirm liegt (Grad, 0 = oben, im Uhrzeigersinn). */
export function screenBearing(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI
}

/** Winkelabstand vom Blickpunkt, ab dem eine Fieder wegfällt (Kugelrand) */
const GLOBE_MAX_ANGLE = 62
/** Größer als flach: zum Kugelrand hin rücken die Fiedern durch die Verkürzung zusammen */
const GLOBE_GAP_PX = 66
const GLOBE_MAX_LAT = 85

/**
 * Rasterpunkte der Kugelansicht, `stepDeg` Grad auseinander: feste Breitenkreise, je
 * Kreis so viele gleich verteilte Längen, wie bei dieser Breite Platz haben. Fest an der
 * Geografie, die Fiedern bleiben beim Drehen an ihrem Ort.
 */
export function globeBarbGrid(centerLat: number, centerLon: number, stepDeg: number): { lat: number; lon: number }[] {
  if (!(stepDeg > 0)) return []
  const rad = Math.PI / 180
  const minCos = Math.cos(GLOBE_MAX_ANGLE * rad)
  const out: { lat: number; lon: number }[] = []
  const rows = Math.floor(GLOBE_MAX_LAT / stepDeg)
  for (let r = -rows; r <= rows; r++) {
    const lat = r * stepDeg
    const n = Math.max(1, Math.round((360 * Math.cos(lat * rad)) / stepDeg))
    for (let k = 0; k < n; k++) {
      const lon = (k * 360) / n - 180
      const cosAngle =
        Math.sin(lat * rad) * Math.sin(centerLat * rad) +
        Math.cos(lat * rad) * Math.cos(centerLat * rad) * Math.cos((lon - centerLon) * rad)
      if (cosAngle >= minCos) out.push({ lat, lon })
    }
  }
  return out
}

export class WindBarbs {
  private readonly map: maplibregl.Map
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private sampler: WindSampler | null = null

  constructor(map: maplibregl.Map) {
    this.map = map
    const c = document.createElement('canvas')
    c.className = 'wind-particles wind-barbs'
    map.getCanvas().after(c)
    this.canvas = c
    this.ctx = c.getContext('2d')!
    map.on('movestart', this.clear)
    map.on('moveend', this.draw)
    map.on('resize', this.draw)
  }

  set(s: WindSampler | null): void {
    this.sampler = s
    this.draw()
  }

  destroy(): void {
    this.map.off('movestart', this.clear)
    this.map.off('moveend', this.draw)
    this.map.off('resize', this.draw)
    this.canvas.remove()
  }

  private clear = (): void => {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private draw = (): void => {
    const map = this.map
    const src = map.getCanvas()
    const w = src.clientWidth
    const h = src.clientHeight
    const dpr = map.getPixelRatio()
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this.canvas.style.width = `${w}px`
      this.canvas.style.height = `${h}px`
    }
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.clear()
    if (!this.sampler) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const q of this.points()) {
      const uv = this.sampler(q.lat, q.lon)
      if (!uv) continue
      const p = map.project([q.lon, q.lat])
      if (p.x < 8 || p.y < 8 || p.x > w - 8 || p.y > h - 8) continue
      const kmh = Math.hypot(uv[0], uv[1]) * 3.6
      // Norden auf dem Schirm: auf der Kugel je Punkt anders, flach nur bei gedrehter Karte
      const north = screenBearing(p, map.project([q.lon, Math.min(89.9, q.lat + 0.1)]))
      // breiter dunkler Rand unter der hellen Fieder — auf jeder Farbe der
      // Skala lesbar, auch auf dem hellblauen Rand des Strahlstroms
      const dir = windFromDeg(uv[0], uv[1]) + north
      drawWindBarb(ctx, p.x, p.y, kmh, dir, LEN_PX, 'rgba(10, 11, 13, 0.9)', 3.6)
      drawWindBarb(ctx, p.x, p.y, kmh, dir, LEN_PX, '#f4f5f7', 1.6)
    }
  }

  private points(): { lat: number; lon: number }[] {
    const map = this.map
    const c = map.getCenter()
    if (map.getProjection()?.type === 'globe') {
      // Maßstab am Blickpunkt messen: MapLibre gleicht den Zoom auf der Kugel nach Breite aus
      const dLat = c.lat > 0 ? -1 : 1
      const a = map.project(c)
      const pb = map.project([c.lng, c.lat + dLat])
      const pxPerDeg = Math.hypot(pb.x - a.x, pb.y - a.y)
      return globeBarbGrid(c.lat, c.lng, GLOBE_GAP_PX / pxPerDeg)
    }
    const b = map.getBounds()
    const stepLon = GAP_PX / ((512 * 2 ** map.getZoom()) / 360)
    const latRef = Math.round(c.lat / 5) * 5
    return valueGrid(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), stepLon, latRef)
  }
}
