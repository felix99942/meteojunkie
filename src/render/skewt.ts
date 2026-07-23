// Skew-T-log-P-Diagramm: Koordinatensystem + thermodynamischer Hintergrund.
// Getrennt von der React-Komponente (SkewTPanel), damit die Geometrie offline
// prüfbar ist. Zeichnet auf einen 2D-Canvas-Context.
//
// Koordinaten: y logarithmisch im Druck (pMax unten, pMin oben); x linear in T,
// aber „skewed" — Isothermen kippen mit der Höhe nach rechts (klassische 45°
// im Pixelraum, skew = 1 px/px). Datenkurven (T/Td) nutzen denselben Transform.

import { dryAdiabatTemp, moistAdiabatTemp, tempFromSaturationMixingRatio } from '../lib/thermo'
import type { ParcelResult } from '../lib/sounding'

export interface SkewTGeometry {
  /** Plotfläche in Pixeln (ohne Achsenränder). */
  left: number
  top: number
  width: number
  height: number
  /** Druckbereich (hPa): pMax unten, pMin oben. */
  pMin: number
  pMax: number
  /** Temperaturbereich (°C) am unteren Rand. */
  tMin: number
  tMax: number
  /** Skew in Pixel pro Pixel Höhe (1 = 45°). */
  skew: number
}

export function makeGeometry(
  left: number,
  top: number,
  width: number,
  height: number,
): SkewTGeometry {
  return { left, top, width, height, pMin: 100, pMax: 1050, tMin: -40, tMax: 45, skew: 1 }
}

/** Druck (hPa) → y-Pixel. pMax → unten (top+height), pMin → oben (top). */
export function yFromP(g: SkewTGeometry, p: number): number {
  const f = (Math.log(p) - Math.log(g.pMin)) / (Math.log(g.pMax) - Math.log(g.pMin))
  return g.top + f * g.height
}

/** y-Pixel → Druck (hPa) — Umkehrung, für Hover/Achsen. */
export function pFromY(g: SkewTGeometry, y: number): number {
  const f = (y - g.top) / g.height
  return Math.exp(f * (Math.log(g.pMax) - Math.log(g.pMin)) + Math.log(g.pMin))
}

/** Temperatur (°C) bei Druck p → x-Pixel (skewed). */
export function xFromTP(g: SkewTGeometry, tC: number, p: number): number {
  const yb = g.top + g.height // unterer Rand
  const y = yFromP(g, p)
  const baseX = g.left + ((tC - g.tMin) / (g.tMax - g.tMin)) * g.width
  return baseX + g.skew * (yb - y)
}

/** Ein Polylinienzug (p → T) im Skew-T zeichnen; nur Punkte innerhalb des Druckbereichs. */
function strokeProfile(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  tempAt: (p: number) => number,
  pStart: number,
  pEnd: number,
  pStep: number,
): void {
  ctx.beginPath()
  let first = true
  const dir = pEnd < pStart ? -1 : 1
  for (let p = pStart; dir < 0 ? p >= pEnd : p <= pEnd; p += dir * pStep) {
    const x = xFromTP(g, tempAt(p), p)
    const y = yFromP(g, p)
    if (first) {
      ctx.moveTo(x, y)
      first = false
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

export interface SkewTTheme {
  isobar: string
  isotherm: string
  isothermZero: string
  dryAdiabat: string
  moistAdiabat: string
  mixingRatio: string
  axis: string
  label: string
}

export const DEFAULT_SKEWT_THEME: SkewTTheme = {
  isobar: '#3a3b40',
  isotherm: '#4a4a46',
  isothermZero: '#6a6a64',
  dryAdiabat: '#5a4a2e',
  moistAdiabat: '#2e5a42',
  mixingRatio: '#4a3a2e',
  axis: '#585c66',
  label: '#898781',
}

/**
 * Standard-Windbarbe an (x, y). speedKt in Knoten, dirFrom = meteorologische
 * Richtung (woher der Wind weht). Halbe Barbe 5 kt, ganze 10 kt, Wimpel 50 kt;
 * Windstille (< 2.5 kt) als kleiner Kreis. Schaft zeigt in die Herkunftsrichtung.
 */
export function drawWindBarb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  speedKt: number,
  dirFrom: number,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.2
  if (speedKt < 2.5) {
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.restore()
    return
  }
  const L = 30 // Schaftlänge px
  const ang = (dirFrom * Math.PI) / 180
  const ux = Math.sin(ang) // Einheitsvektor zur Herkunft (Nord oben)
  const uy = -Math.cos(ang)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + ux * L, y + uy * L)
  ctx.stroke()
  const bx = uy // senkrecht zum Schaft (Barbenseite)
  const by = -ux
  const BARB = 11
  let rem = Math.round(speedKt / 5) * 5
  let pos = L
  const step = 6
  while (rem >= 50) {
    const ax = x + ux * pos
    const ay = y + uy * pos
    const cx = x + ux * (pos - step * 1.6)
    const cy = y + uy * (pos - step * 1.6)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + bx * BARB, ay + by * BARB)
    ctx.lineTo(cx, cy)
    ctx.closePath()
    ctx.fill()
    pos -= step * 1.6
    rem -= 50
  }
  while (rem >= 10) {
    const ax = x + ux * pos
    const ay = y + uy * pos
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + bx * BARB, ay + by * BARB)
    ctx.stroke()
    pos -= step
    rem -= 10
  }
  if (rem >= 5) {
    if (pos === L) pos -= step // einzelne Halbbarbe nicht ganz an die Spitze
    const ax = x + ux * pos
    const ay = y + uy * pos
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + bx * BARB * 0.5, ay + by * BARB * 0.5)
    ctx.stroke()
  }
  ctx.restore()
}

// Farben für die CAPE/CIN-Flächen (nach Nutzerwunsch: CAPE rot, CIN blau)
const CAPE_FILL = 'rgba(214, 58, 43, 0.30)'
const CIN_FILL = 'rgba(74, 147, 232, 0.30)'
const PARCEL_LINE = 'rgba(232, 228, 220, 0.9)'

/** Fläche zwischen zwei T-Kurven (aT, bT) über den Indexbereich füllen. */
function fillBetween(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  fineP: number[],
  aT: number[],
  bT: number[],
  iStart: number,
  iEnd: number,
  fill: string,
): void {
  if (iEnd <= iStart) return
  ctx.beginPath()
  for (let i = iStart; i <= iEnd; i++) {
    const x = xFromTP(g, aT[i], fineP[i])
    const y = yFromP(g, fineP[i])
    if (i === iStart) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = iEnd; i >= iStart; i--) {
    ctx.lineTo(xFromTP(g, bT[i], fineP[i]), yFromP(g, fineP[i]))
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function levelMarker(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  p: number,
  label: string,
): void {
  const y = yFromP(g, p)
  ctx.beginPath()
  ctx.moveTo(g.left, y)
  ctx.lineTo(g.left + 16, y)
  ctx.stroke()
  ctx.fillText(label, g.left + 19, y)
}

/**
 * Gehobenes Paket ins Skew-T zeichnen: CAPE (rot) und CIN (blau) schattiert,
 * Parzellenweg gepunktet, LCL/LFC/EL markiert. Für EIN Bezugsmodell.
 */
export function drawParcel(ctx: CanvasRenderingContext2D, g: SkewTGeometry, r: ParcelResult): void {
  const lfcIdx = r.lfcP != null ? r.fineP.indexOf(r.lfcP) : -1
  const elIdx = r.elP != null ? r.fineP.indexOf(r.elP) : -1

  ctx.save()
  ctx.beginPath()
  ctx.rect(g.left, g.top, g.width, g.height)
  ctx.clip()

  // CIN unterhalb LFC (Paket kälter), CAPE zwischen LFC und EL (Paket wärmer)
  if (lfcIdx > 0) fillBetween(ctx, g, r.fineP, r.parcelT, r.envT, 0, lfcIdx, CIN_FILL)
  if (lfcIdx >= 0 && elIdx > lfcIdx) fillBetween(ctx, g, r.fineP, r.parcelT, r.envT, lfcIdx, elIdx, CAPE_FILL)

  // Parzellenweg (gepunktet)
  ctx.strokeStyle = PARCEL_LINE
  ctx.lineWidth = 1.5
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  for (let i = 0; i < r.fineP.length; i++) {
    const x = xFromTP(g, r.parcelT[i], r.fineP[i])
    const y = yFromP(g, r.fineP[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // Marker (außerhalb des Clips, am linken Rand)
  ctx.save()
  ctx.strokeStyle = PARCEL_LINE
  ctx.fillStyle = '#c8c9cc'
  ctx.lineWidth = 1
  ctx.font = '9px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (r.lclP != null) levelMarker(ctx, g, r.lclP, 'LCL')
  if (r.lfcP != null) levelMarker(ctx, g, r.lfcP, 'LFC')
  if (r.elP != null) levelMarker(ctx, g, r.elP, 'EL')
  ctx.restore()
}

// --- Hodograf --------------------------------------------------------------

export interface HodoPoint {
  /** Höhe über Grund (m). */
  zAgl: number
  u: number // kt (Ost)
  v: number // kt (Nord)
}

// Höhengefärbte Segmente (Standard-Hodograf): 0–1 / 1–3 / 3–6 / 6–9 / >9 km
const HODO_LAYERS: { max: number; color: string; label: string }[] = [
  { max: 1000, color: '#e0524f', label: '0–1' },
  { max: 3000, color: '#f0a53a', label: '1–3' },
  { max: 6000, color: '#5cc36a', label: '3–6' },
  { max: 9000, color: '#4a93e8', label: '6–9' },
  { max: Infinity, color: '#9a7fe0', label: '9+' },
]

function hodoColor(zAgl: number): string {
  for (const l of HODO_LAYERS) if (zAgl <= l.max) return l.color
  return HODO_LAYERS[HODO_LAYERS.length - 1].color
}

/**
 * Hodograf in einen (w×h)-Canvas zeichnen: Geschwindigkeitsringe (kt),
 * u/v-Achsen, Windvektor-Kurve höhengefärbt (Boden → Höhe). points nach zAgl
 * aufsteigend.
 */
export function drawHodograph(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: HodoPoint[],
): void {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) / 2 - 16
  if (R < 20 || points.length < 2) return

  const maxSpd = Math.max(20, ...points.map((p) => Math.hypot(p.u, p.v)))
  const ringStep = maxSpd <= 40 ? 10 : maxSpd <= 90 ? 20 : 40
  const maxRing = Math.ceil(maxSpd / ringStep) * ringStep
  const scale = R / maxRing
  const X = (u: number) => cx + u * scale
  const Y = (v: number) => cy - v * scale // Nord oben

  ctx.save()
  ctx.font = '9px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Ringe + Beschriftung
  ctx.strokeStyle = '#3a3b40'
  ctx.fillStyle = '#898781'
  for (let s = ringStep; s <= maxRing; s += ringStep) {
    ctx.beginPath()
    ctx.arc(cx, cy, s * scale, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.fillText(String(s), cx + s * scale, cy - 6)
  }

  // Achsenkreuz + Himmelsrichtungen
  ctx.strokeStyle = '#4a4a46'
  ctx.beginPath()
  ctx.moveTo(cx - R, cy)
  ctx.lineTo(cx + R, cy)
  ctx.moveTo(cx, cy - R)
  ctx.lineTo(cx, cy + R)
  ctx.stroke()
  ctx.fillStyle = '#898781'
  ctx.fillText('N', cx, cy - R - 8)
  ctx.fillText('S', cx, cy + R + 8)
  ctx.fillText('O', cx + R + 8, cy)
  ctx.fillText('W', cx - R - 8, cy)

  // Windvektor-Kurve, höhengefärbt
  ctx.lineWidth = 2
  for (let i = 1; i < points.length; i++) {
    ctx.strokeStyle = hodoColor(points[i].zAgl)
    ctx.beginPath()
    ctx.moveTo(X(points[i - 1].u), Y(points[i - 1].v))
    ctx.lineTo(X(points[i].u), Y(points[i].v))
    ctx.stroke()
  }
  // Bodenpunkt markieren
  ctx.fillStyle = '#f2f2ef'
  ctx.beginPath()
  ctx.arc(X(points[0].u), Y(points[0].v), 3, 0, 2 * Math.PI)
  ctx.fill()

  // Höhen-Legende
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let ly = 4
  for (const l of HODO_LAYERS) {
    ctx.fillStyle = l.color
    ctx.fillRect(4, ly + 2, 8, 3)
    ctx.fillStyle = '#898781'
    ctx.fillText(`${l.label} km`, 15, ly)
    ly += 12
  }
  ctx.restore()
}

const ISOBARS = [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100]
const MIXING_RATIOS = [0.4, 1, 2, 4, 7, 10, 16, 24, 32]

/** Thermodynamischen Hintergrund zeichnen (Isobaren, Isothermen, Adiabaten, Mischungsverhältnis). */
export function drawSkewTBackground(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  theme: SkewTTheme = DEFAULT_SKEWT_THEME,
): void {
  const yb = g.top + g.height
  ctx.save()
  ctx.font = '10px system-ui, sans-serif'
  ctx.lineWidth = 1

  // Clip auf die Plotfläche (skewed Linien laufen sonst über den Rand)
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.left, g.top, g.width, g.height)
  ctx.clip()

  // Trockenadiabaten (gekrümmt): θ von -30 bis +200 °C alle 10 °C
  ctx.strokeStyle = theme.dryAdiabat
  for (let thetaC = -30; thetaC <= 200; thetaC += 10) {
    const thetaK = thetaC + 273.15
    strokeProfile(ctx, g, (p) => dryAdiabatTemp(thetaK, p), g.pMax, g.pMin, 25)
  }

  // Feuchtadiabaten (gekrümmt, gestrichelt): Start-T am Boden -20…+36 °C
  ctx.strokeStyle = theme.moistAdiabat
  ctx.setLineDash([3, 3])
  for (let tStart = -20; tStart <= 36; tStart += 4) {
    // ab pMax integrieren; Cache je Segment über die Startbedingung
    let tPrev = tStart
    let pPrev = g.pMax
    ctx.beginPath()
    ctx.moveTo(xFromTP(g, tStart, g.pMax), yFromP(g, g.pMax))
    for (let p = g.pMax - 25; p >= g.pMin; p -= 25) {
      const t = moistAdiabatTemp(tPrev, pPrev, p)
      ctx.lineTo(xFromTP(g, t, p), yFromP(g, p))
      tPrev = t
      pPrev = p
    }
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Mischungsverhältnis-Linien (gestrichelt, nur untere Troposphäre bis 600 hPa)
  ctx.strokeStyle = theme.mixingRatio
  ctx.setLineDash([1, 3])
  for (const w of MIXING_RATIOS) {
    strokeProfile(ctx, g, (p) => tempFromSaturationMixingRatio(w, p), g.pMax, 600, 25)
  }
  ctx.setLineDash([])

  // Isothermen (schräge Geraden) alle 10 °C
  for (let t = -100; t <= 50; t += 10) {
    ctx.strokeStyle = t === 0 ? theme.isothermZero : theme.isotherm
    ctx.beginPath()
    ctx.moveTo(xFromTP(g, t, g.pMax), yb)
    ctx.lineTo(xFromTP(g, t, g.pMin), g.top)
    ctx.stroke()
  }

  ctx.restore() // Clip aufheben

  // Isobaren (horizontal) + Drucklabel links
  ctx.strokeStyle = theme.isobar
  ctx.fillStyle = theme.label
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const p of ISOBARS) {
    const y = yFromP(g, p)
    ctx.beginPath()
    ctx.moveTo(g.left, y)
    ctx.lineTo(g.left + g.width, y)
    ctx.stroke()
    ctx.fillText(String(p), g.left - 4, y)
  }

  // Temperaturlabel am unteren Rand
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = g.tMin; t <= g.tMax; t += 10) {
    const x = xFromTP(g, t, g.pMax)
    if (x >= g.left && x <= g.left + g.width) ctx.fillText(`${t}`, x, yb + 3)
  }

  // Rahmen
  ctx.strokeStyle = theme.axis
  ctx.strokeRect(g.left, g.top, g.width, g.height)
  ctx.restore()
}
