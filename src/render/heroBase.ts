// Untergrund der Startseite unter der Windströmung (auf Wunsch, 2026-11-02).
//
// VORN das AKTUELLE Satellitenbild: MTG Geocolour, das neueste scharfe Bild
// aus dem Vorrat in R2 (worker/satellite.ts, alle 10 Minuten). Geocolour
// bringt Tag UND Nacht selbst mit — tags Echtfarben samt Schnee, wo es
// wolkenfrei ist, nachts Infrarotwolken über den Lichtern der Städte — und
// liegt auf genau der Fläche, die hier gebraucht wird (`SATELLITE_AREA`).
//
// RÜCKFALL, wenn kein Satellitenbild zu bekommen ist: Blue Marble (Tag) und
// Black Marble 2016 (Nacht) der NASA, deckungsgleich im selben Fenster
// (scripts/build-ground.mjs), dazwischen die DÄMMERUNGSLINIE je Bildpunkt
// nach dem Sonnenstand. Eine erste Fassung legte auf das Tagbild noch den
// aktuellen Schnee (MODIS mit ICON-EU als Maske) — mit Geocolour vorn ist
// sie entfallen.

import { solarElevationDeg } from '../lib/solar'
import type { HeroProjection } from './heroWind'

export interface GeoRect {
  lonMin: number
  lonMax: number
  latMin: number
  latMax: number
}

/** Anteil „Tag" nach Sonnenhöhe: bürgerliche Dämmerung (−6°) bis knapp über dem Horizont */
export function dayFraction(elevDeg: number): number {
  const t = Math.min(1, Math.max(0, (elevDeg + 6) / 10))
  return t * t * (3 - 2 * t)
}

/** Bildschirmrechteck eines Mercator-Bilds über `rect` */
function screenRect(p: HeroProjection, rect: GeoRect): [number, number, number, number] {
  const [x0, y0] = p.project(rect.lonMin, rect.latMax)
  const [x1, y1] = p.project(rect.lonMax, rect.latMin)
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Zelle der Dämmerungsmaske in CSS-Pixeln — die Linie ist ohnehin weich */
const MASK_CELL = 12
/**
 * Abdunklung, damit Partikel und Schrift lesbar bleiben: das Satellitenbild
 * trägt helle Wolken (tags weiß, nachts bläulich), das Tagbild ist hell, das
 * Nachtbild schon dunkel.
 */
const DIM_SAT = 0.4
const DIM_DAY = 0.42
const DIM_NIGHT = 0.12

function prepare(canvas: HTMLCanvasElement, dpr: number): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/** Das Satellitenbild über die ganze Fläche */
export function drawSatelliteBase(
  canvas: HTMLCanvasElement,
  p: HeroProjection,
  w: number,
  h: number,
  dpr: number,
  rect: GeoRect,
  image: CanvasImageSource,
): void {
  const ctx = prepare(canvas, dpr)
  ctx.drawImage(image, ...screenRect(p, rect))
  ctx.fillStyle = `rgba(5, 7, 11, ${DIM_SAT})`
  ctx.fillRect(0, 0, w, h)
}

/**
 * Rückfall: Nacht, Tag und Dämmerung. Fehlt ein Bild, steht nur das
 * andere — fehlen beide, bleibt die Fläche leer.
 */
export function drawDayNightBase(
  canvas: HTMLCanvasElement,
  p: HeroProjection,
  w: number,
  h: number,
  dpr: number,
  rect: GeoRect,
  day: CanvasImageSource | null,
  night: CanvasImageSource | null,
  now: number,
): void {
  const ctx = prepare(canvas, dpr)
  const r = screenRect(p, rect)
  if (night) {
    ctx.drawImage(night, ...r)
    ctx.fillStyle = `rgba(5, 7, 11, ${DIM_NIGHT})`
    ctx.fillRect(0, 0, w, h)
  }
  if (!day) return
  // Dämmerungsmaske grob rechnen, beim Aufziehen glättet der Browser
  const mw = Math.ceil(w / MASK_CELL) + 1
  const mh = Math.ceil(h / MASK_CELL) + 1
  const mask = new ImageData(mw, mh)
  let any = false
  for (let j = 0; j < mh; j++)
    for (let i = 0; i < mw; i++) {
      const [lon, lat] = p.unproject(i * MASK_CELL, j * MASK_CELL)
      const a = dayFraction(solarElevationDeg(now, lat, lon))
      if (a > 0) any = true
      mask.data[4 * (j * mw + i) + 3] = Math.round(255 * a)
    }
  if (!any) return
  const mc = document.createElement('canvas')
  mc.width = mw
  mc.height = mh
  mc.getContext('2d')!.putImageData(mask, 0, 0)
  const layer = document.createElement('canvas')
  layer.width = canvas.width
  layer.height = canvas.height
  const lc = layer.getContext('2d')!
  lc.setTransform(dpr, 0, 0, dpr, 0, 0)
  lc.drawImage(day, ...r)
  lc.fillStyle = `rgba(5, 7, 11, ${DIM_DAY})`
  lc.fillRect(0, 0, w, h)
  lc.globalCompositeOperation = 'destination-in'
  lc.imageSmoothingEnabled = true
  lc.drawImage(mc, 0, 0, mw * MASK_CELL, mh * MASK_CELL)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer, 0, 0)
}

/** Braucht die Ansicht überhaupt Tag bzw. Nacht? (Rückfallbilder nur laden, wenn ja) */
export function dayNightNeeds(p: HeroProjection, w: number, h: number, now: number): { day: boolean; night: boolean } {
  let day = false
  let night = false
  for (let j = 0; j <= 8; j++)
    for (let i = 0; i <= 8; i++) {
      const [lon, lat] = p.unproject((i / 8) * w, (j / 8) * h)
      const a = dayFraction(solarElevationDeg(now, lat, lon))
      if (a > 0) day = true
      if (a < 1) night = true
    }
  return { day, night }
}
