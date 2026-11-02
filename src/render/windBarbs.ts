// Windfiedern über der Modellkarte (Höhenwind der Regionalmodelle, auf
// Wunsch statt der Windpartikel): je Rasterpunkt eine Fieder aus den
// Windkomponenten (`uv300`) — Richtung UND Stärke in einem Symbol, wie in der
// Höhenwetterkarte. Partikel zeigen die Strömung schön, aber keine Zahl; über
// einem 1–7-km-Gitter will man ablesen, wie stark es wo weht.
//
// Ein eigenes Canvas direkt über der Kartenzeichenfläche (wie die Partikel),
// neu gezeichnet nach jeder Kamerabewegung. Das Raster hängt an festen
// Gradvielfachen (`valueGrid`) — die Fiedern bleiben beim Verschieben an
// ihrem Ort. Während der Bewegung ruht die Ebene, sonst stünden die Fiedern
// eine Bewegung lang am falschen Ort.

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
    const b = map.getBounds()
    const stepLon = GAP_PX / ((512 * 2 ** map.getZoom()) / 360)
    const latRef = Math.round(map.getCenter().lat / 5) * 5
    for (const q of valueGrid(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), stepLon, latRef)) {
      const uv = this.sampler(q.lat, q.lon)
      if (!uv) continue
      const p = map.project([q.lon, q.lat])
      if (p.x < 8 || p.y < 8 || p.x > w - 8 || p.y > h - 8) continue
      const kmh = Math.hypot(uv[0], uv[1]) * 3.6
      // breiter dunkler Rand unter der hellen Fieder — auf jeder Farbe der
      // Skala lesbar, auch auf dem hellblauen Rand des Strahlstroms
      const dir = windFromDeg(uv[0], uv[1])
      drawWindBarb(ctx, p.x, p.y, kmh, dir, LEN_PX, 'rgba(10, 11, 13, 0.9)', 3.6)
      drawWindBarb(ctx, p.x, p.y, kmh, dir, LEN_PX, '#f4f5f7', 1.6)
    }
  }
}
