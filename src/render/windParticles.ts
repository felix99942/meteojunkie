// Windpartikel über den Modellkarten — die Strömung als Bewegung, wie man sie
// von Windy oder earth.nullschool kennt.
//
// VERFAHREN (nullschool-Art, im BILDSCHIRMRAUM): nach jeder Kamerabewegung
// wird einmal ein Geschwindigkeitsraster über die sichtbare Fläche gerechnet
// — je `CELL` Pixel ein Punkt: Bildpunkt → Länge/Breite (`unproject`), dort
// u/v aus dem Modellfeld, und über die örtliche Ableitung der Projektion
// (`project` an zwei Nachbarpunkten) in eine Bewegung in PIXELN übersetzt.
// Die Partikel laufen danach nur noch im Bild, ohne je wieder zu projizieren.
// Damit ist die Projektion egal: auf der Kugel krümmen sich die Bahnen
// richtig, und am Kugelrand stauchen sie sich, wie es die Perspektive
// verlangt. Ein WebGL-Layer in MapLibre müsste beides für Globus UND
// Mercator selbst können — für eine Animation, die nur die Richtung zeigt,
// ist das der falsche Aufwand.
//
// Während die Karte sich bewegt, ruht die Animation (Raster gilt nur für
// einen Kamerastand); nach dem Loslassen geht es sofort weiter.
//
// TEMPO ist NICHT maßstäblich: maßstäblich stünden die Partikel auf dem
// Globus still und rasten über den Alpen. Stattdessen legt 10 m/s je SEKUNDE
// eine feste Pixelzahl zurück (`pxPerSecondAt10`), auf der ganzen Kugel ein
// Drittel dessen beim Hineinzoomen. Maßstäblich sind also RICHTUNG und
// VERHÄLTNIS der Tempi, nicht die absolute Geschwindigkeit.
//
// Gerechnet wird über die ZEIT, nicht je Bild: die erste Fassung bewegte je
// requestAnimationFrame, und das läuft auf einem 120- oder 144-Hz-Schirm
// doppelt so oft wie auf 60 Hz — dort „fetzte" es (Rückmeldung), während es
// im Test mit 60 Hz ruhig aussah. Bewegung, Lebensdauer und Verblassen hängen
// deshalb an der vergangenen Zeit.

import type maplibregl from 'maplibre-gl'

/** Wind an einem Punkt: [u nach Osten, v nach Norden] in m/s, oder null. */
export type WindSampler = (lat: number, lon: number) => [number, number] | null

/** Rasterweite des Geschwindigkeitsfelds im Bild (CSS-Pixel). */
const CELL = 8
/**
 * So viele Pixel je SEKUNDE legt ein Partikel bei 10 m/s zurück: 22 auf der
 * ganzen Kugel (Zoom ≤ 2), linear steigend bis 66 ab Zoom 6.
 */
export function pxPerSecondAt10(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 2) / 4))
  return 22 + 44 * t
}
/** Partikel je CSS-Pixel² — bei 1500×760 rund 1.900. */
const DENSITY = 1 / 600
const MAX_PARTICLES = 5000
/** Lebensdauer in Sekunden (zufällig dazwischen), danach neu gesetzt. */
const AGE_MIN = 1.5
const AGE_MAX = 3.5
/** Deckkraft, die eine Spur je 1/60 s behält — bei anderer Bildrate umgerechnet. */
const FADE = 0.975
/** Längster Zeitschritt (s): nach einem Hänger springen die Partikel nicht. */
const MAX_DT = 0.05
/** Tempostufen (m/s) — darüber kräftiger und breiter. */
export const SPEED_STEPS = [2, 5, 9, 14, 20]
const STEP_ALPHA = [0.45, 0.6, 0.72, 0.84, 0.93, 1]
const STEP_WIDTH = [1.1, 1.25, 1.4, 1.55, 1.75, 2]

/** Tempostufe zu einer Geschwindigkeit (m/s). */
export function speedStep(speed: number): number {
  let i = 0
  while (i < SPEED_STEPS.length && speed >= SPEED_STEPS[i]) i++
  return i
}

/** Zahl der Partikel für eine Fläche in CSS-Pixeln. */
export function particleCount(w: number, h: number): number {
  return Math.max(200, Math.min(MAX_PARTICLES, Math.round(w * h * DENSITY)))
}

/** Bewegung (Pixel je Frame) aus Wind und örtlicher Projektionsableitung. */
export function screenVelocity(
  u: number,
  v: number,
  /** Pixel je Meter nach Osten bzw. nach Norden, jeweils als Bildvektor */
  east: [number, number],
  north: [number, number],
  /** Bildpixel je Frame für 1 m/s Wind */
  k: number,
): [number, number] {
  return [(east[0] * u + north[0] * v) * k, (east[1] * u + north[1] * v) * k]
}

const M_PER_DEG = 111_320
/** Abstand für die Ableitung der Projektion (Grad). */
const D = 0.01

export class WindParticles {
  private readonly map: maplibregl.Map
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private sampler: WindSampler | null = null
  private cols = 0
  private rows = 0
  /** je Zelle vx, vy (px/s), Tempo (m/s); NaN = kein Wind/außerhalb */
  private field = new Float32Array(0)
  private spawn = new Int32Array(0)
  /** je Partikel x, y, Alter, Lebensdauer */
  private parts = new Float32Array(0)
  private raf = 0
  private w = 0
  private h = 0

  constructor(map: maplibregl.Map) {
    this.map = map
    const c = document.createElement('canvas')
    c.className = 'wind-particles'
    // Direkt über der Kartenzeichenfläche, also UNTER den Markern (Städte) und
    // den Bedienelementen
    map.getCanvas().after(c)
    this.canvas = c
    this.ctx = c.getContext('2d')!
    map.on('movestart', this.pause)
    map.on('moveend', this.rebuild)
    map.on('resize', this.rebuild)
  }

  /** Neues Windfeld (oder null = aus). Die Partikel bleiben, wo sie sind. */
  setSampler(s: WindSampler | null): void {
    this.sampler = s
    this.rebuild()
  }

  destroy(): void {
    this.stop()
    this.map.off('movestart', this.pause)
    this.map.off('moveend', this.rebuild)
    this.map.off('resize', this.rebuild)
    this.canvas.remove()
  }

  private stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private clear(): void {
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private pause = (): void => {
    this.stop()
    this.clear()
  }

  private rebuild = (): void => {
    this.stop()
    const { clientWidth: w, clientHeight: h } = this.map.getContainer()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (w !== this.w || h !== this.h || this.canvas.width !== Math.round(w * dpr)) {
      this.w = w
      this.h = h
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this.canvas.style.width = `${w}px`
      this.canvas.style.height = `${h}px`
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.clear()
    if (!this.sampler || w === 0 || h === 0) return
    const t0 = performance.now()
    this.buildField()
    console.debug(`[wind] Raster ${this.cols}×${this.rows} in ${Math.round(performance.now() - t0)} ms`)
    if (this.spawn.length === 0) return
    const n = particleCount(w, h)
    if (this.parts.length !== n * 4) {
      this.parts = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) this.respawn(i, true)
    }
    this.last = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  private buildField(): void {
    const map = this.map
    const sampler = this.sampler!
    const cols = Math.ceil(this.w / CELL) + 1
    const rows = Math.ceil(this.h / CELL) + 1
    const field = new Float32Array(cols * rows * 3).fill(NaN)
    const spawn: number[] = []
    // Maßstab einmal je Kamerastand: Pixel je Meter in der Bildmitte
    const c = map.unproject([this.w / 2, this.h / 2])
    const pc = map.project(c)
    const pcn = map.project([c.lng, c.lat + D])
    const pxPerM = Math.hypot(pcn.x - pc.x, pcn.y - pc.y) / (D * M_PER_DEG)
    const k = pxPerM > 0 ? pxPerSecondAt10(map.getZoom()) / (10 * pxPerM) : 0
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL
        const y = j * CELL
        const ll = map.unproject([x, y])
        const p = map.project(ll)
        // Neben der Kugel liefert `unproject` einen Randpunkt, dessen
        // Rückprojektion woanders landet — dort gibt es keinen Wind
        if (Math.abs(p.x - x) > 1 || Math.abs(p.y - y) > 1) continue
        const wind = sampler(ll.lat, ll.lng)
        if (!wind) continue
        const lat = Math.max(-89, Math.min(89, ll.lat))
        const pe = map.project([ll.lng + D, lat])
        const pn = map.project([ll.lng, lat + D])
        const mLon = D * M_PER_DEG * Math.cos((lat * Math.PI) / 180)
        const mLat = D * M_PER_DEG
        const [vx, vy] = screenVelocity(
          wind[0],
          wind[1],
          [(pe.x - p.x) / mLon, (pe.y - p.y) / mLon],
          [(pn.x - p.x) / mLat, (pn.y - p.y) / mLat],
          k,
        )
        const o = 3 * (j * cols + i)
        field[o] = vx
        field[o + 1] = vy
        field[o + 2] = Math.hypot(wind[0], wind[1])
        spawn.push(j * cols + i)
      }
    }
    this.cols = cols
    this.rows = rows
    this.field = field
    this.spawn = Int32Array.from(spawn)
  }

  /** Partikel i an eine zufällige Stelle mit Wind setzen. */
  private respawn(i: number, fresh = false): void {
    const cell = this.spawn[(Math.random() * this.spawn.length) | 0]
    const p = this.parts
    p[4 * i] = ((cell % this.cols) + Math.random() - 0.5) * CELL
    p[4 * i + 1] = (((cell / this.cols) | 0) + Math.random() - 0.5) * CELL
    const life = AGE_MIN + Math.random() * (AGE_MAX - AGE_MIN)
    // Beim ersten Setzen verteilt, sonst stürben alle gleichzeitig
    p[4 * i + 2] = fresh ? Math.random() * life : 0
    p[4 * i + 3] = life
  }

  /** Bilinear aus dem Raster: [vx, vy, Tempo] oder null. */
  private velocity(x: number, y: number, out: Float32Array): boolean {
    const gx = x / CELL
    const gy = y / CELL
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gy)
    if (i0 < 0 || j0 < 0 || i0 >= this.cols - 1 || j0 >= this.rows - 1) return false
    const fx = gx - i0
    const fy = gy - j0
    const f = this.field
    const a = 3 * (j0 * this.cols + i0)
    const b = a + 3
    const c = a + 3 * this.cols
    const d = c + 3
    if (Number.isNaN(f[a]) || Number.isNaN(f[b]) || Number.isNaN(f[c]) || Number.isNaN(f[d])) return false
    for (let q = 0; q < 3; q++) {
      out[q] = (f[a + q] * (1 - fx) + f[b + q] * fx) * (1 - fy) + (f[c + q] * (1 - fx) + f[d + q] * fx) * fy
    }
    return true
  }

  private readonly v = new Float32Array(3)
  /** Zeitstempel des vorigen Bilds (ms), 0 = noch keins */
  private last = 0

  private frame = (now: number): void => {
    const ctx = this.ctx
    const dt = this.last ? Math.min(MAX_DT, (now - this.last) / 1000) : 1 / 60
    this.last = now
    // Spuren verblassen lassen: die vorhandenen Pixel behalten nur einen Teil
    // ihrer Deckkraft — durchsichtig, die Karte darunter bleibt unberührt
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = `rgba(0,0,0,${FADE ** (dt * 60)})`
    ctx.fillRect(0, 0, this.w, this.h)
    ctx.globalCompositeOperation = 'source-over'

    const paths = STEP_ALPHA.map(() => new Path2D())
    const p = this.parts
    const n = p.length / 4
    const v = this.v
    for (let i = 0; i < n; i++) {
      const o = 4 * i
      if (p[o + 2] >= p[o + 3] || !this.velocity(p[o], p[o + 1], v)) {
        this.respawn(i)
        continue
      }
      const x = p[o]
      const y = p[o + 1]
      const nx = x + v[0] * dt
      const ny = y + v[1] * dt
      const path = paths[speedStep(v[2])]
      path.moveTo(x, y)
      path.lineTo(nx, ny)
      p[o] = nx
      p[o + 1] = ny
      p[o + 2] += dt
    }
    ctx.lineCap = 'round'
    ctx.setLineDash([])
    for (let s = 0; s < paths.length; s++) {
      ctx.strokeStyle = `rgba(255,255,255,${STEP_ALPHA[s]})`
      ctx.lineWidth = STEP_WIDTH[s]
      ctx.stroke(paths[s])
    }
    this.raf = requestAnimationFrame(this.frame)
  }
}
