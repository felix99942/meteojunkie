// Windströmung der Startseite: Partikel im 10-m-Wind des aktuellen IFS-Laufs
// über Europa, gezeichnet auf zwei Canvas (unten Küsten/Grenzen, oben die
// Spuren). Eigenständig, OHNE MapLibre: die Startseite soll sofort stehen und
// nicht erst einen Kartenstil, Kacheln und WebGL hochfahren.
//
// Projektion Mercator über `HERO_BOUNDS`, so skaliert, dass der Ausschnitt die
// Fläche FÜLLT (wie `object-fit: cover`) — bei schmalem Fenster fällt Atlantik
// bzw. Russland weg, Mitteleuropa bleibt in der Mitte.
//
// Bewegt wird über die ZEIT, nicht je Bild (dieselbe Lehre wie bei den
// Windpartikeln der Modellkarten: auf 120-Hz-Schirmen liefe es sonst doppelt so
// schnell). Das Tempo ist nicht maßstäblich, wohl aber Richtung und Verhältnis.

export type HeroSampler = (lat: number, lon: number) => [number, number] | null

/** Ausschnitt [W, S, O, N] */
export const HERO_BOUNDS: [number, number, number, number] = [-28, 33, 42, 66]

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90

export interface HeroProjection {
  project: (lon: number, lat: number) => [number, number]
  unproject: (x: number, y: number) => [number, number]
}

/** Mercator-Projektion, die `bounds` die Fläche w×h ausfüllen lässt (Mitte bleibt Mitte). */
export function heroProjection(w: number, h: number, bounds = HERO_BOUNDS): HeroProjection {
  const [W, S, E, N] = bounds
  const x0 = (W * Math.PI) / 180
  const x1 = (E * Math.PI) / 180
  const y0 = mercY(S)
  const y1 = mercY(N)
  const k = Math.max(w / (x1 - x0), h / (y1 - y0))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return {
    project: (lon, lat) => [w / 2 + ((lon * Math.PI) / 180 - cx) * k, h / 2 - (mercY(lat) - cy) * k],
    unproject: (x, y) => [(((x - w / 2) / k + cx) * 180) / Math.PI, invMercY(cy - (y - h / 2) / k)],
  }
}

/**
 * Ersatzfeld, falls kein Modelllauf zu holen ist: Westwind mit einem Tief
 * über der Nordsee — damit die Startseite nie leer dasteht. Wird als solches
 * NICHT beschriftet (die Bildunterschrift nennt dann keinen Lauf).
 */
export const FALLBACK_WIND: HeroSampler = (lat, lon) => {
  const dx = (lon - 2) * Math.cos((56 * Math.PI) / 180)
  const dy = lat - 56
  const r2 = dx * dx + dy * dy + 4
  const swirl = 260 / r2
  return [7 + -dy * swirl * 0.4, dx * swirl * 0.4]
}

/** Farbe nach Tempo (m/s): ruhig bläulich-weiß, kräftig warmweiß, Sturm bernstein. */
function speedColor(ms: number): string {
  if (ms < 4) return 'rgba(150, 190, 235, 0.45)'
  if (ms < 8) return 'rgba(205, 225, 245, 0.7)'
  if (ms < 13) return 'rgba(245, 245, 240, 0.85)'
  if (ms < 18) return 'rgba(255, 214, 130, 0.9)'
  return 'rgba(255, 150, 90, 0.95)'
}

/** Pixel je Sekunde bei 1 m/s (bei 1000 px Breite; skaliert mit der Fläche). */
const PX_PER_MS = 5.5
const FADE = 0.93
const LIFE_S: [number, number] = [2.5, 7]

export class HeroWind {
  private readonly lines: HTMLCanvasElement
  private readonly wind: HTMLCanvasElement
  private readonly lctx: CanvasRenderingContext2D
  private readonly wctx: CanvasRenderingContext2D
  private sampler: HeroSampler = FALLBACK_WIND
  private geo: number[][][] = []
  private proj: HeroProjection | null = null
  private w = 0
  private h = 0
  private dpr = 1
  /** je Partikel x, y, Alter, Lebensdauer (CSS-Pixel bzw. Sekunden) */
  private parts = new Float32Array(0)
  private raf = 0
  private last = 0
  private readonly reduced: boolean
  private readonly ro: ResizeObserver

  constructor(lines: HTMLCanvasElement, wind: HTMLCanvasElement) {
    this.lines = lines
    this.wind = wind
    this.lctx = lines.getContext('2d')!
    this.wctx = wind.getContext('2d')!
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(wind)
    this.resize()
  }

  /** Küsten und Grenzen als Linienzüge [[lon, lat], …] */
  setGeo(lines: number[][][]): void {
    this.geo = lines
    this.drawLines()
  }

  setSampler(s: HeroSampler): void {
    this.sampler = s
    this.seed()
    if (this.reduced) this.drawStatic()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
  }

  private resize(): void {
    const w = Math.max(1, this.wind.clientWidth)
    const h = Math.max(1, this.wind.clientHeight)
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    for (const c of [this.lines, this.wind]) {
      c.width = Math.round(w * this.dpr)
      c.height = Math.round(h * this.dpr)
    }
    this.proj = heroProjection(w, h)
    this.drawLines()
    this.seed()
    if (this.reduced) this.drawStatic()
    else if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private drawLines(): void {
    const ctx = this.lctx
    const p = this.proj
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.lines.width, this.lines.height)
    if (!p) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.strokeStyle = 'rgba(150, 160, 175, 0.38)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    for (const line of this.geo) {
      line.forEach(([lon, lat], i) => {
        const [x, y] = p.project(lon, lat)
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
    }
    ctx.stroke()
  }

  private spawn(i: number, randomAge: boolean): void {
    const o = 4 * i
    this.parts[o] = Math.random() * this.w
    this.parts[o + 1] = Math.random() * this.h
    const life = LIFE_S[0] + Math.random() * (LIFE_S[1] - LIFE_S[0])
    this.parts[o + 2] = randomAge ? Math.random() * life : 0
    this.parts[o + 3] = life
  }

  private seed(): void {
    // Dichte an der Fläche, gedeckelt — auf einem 4K-Schirm sonst zu teuer
    const n = Math.round(Math.min(4500, Math.max(600, (this.w * this.h) / 260)))
    this.parts = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) this.spawn(i, true)
    const ctx = this.wctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.wind.width, this.wind.height)
  }

  private velocity(x: number, y: number): [number, number, number] | null {
    const p = this.proj!
    const [lon, lat] = p.unproject(x, y)
    const uv = this.sampler(lat, lon)
    if (!uv) return null
    const scale = (PX_PER_MS * Math.max(600, this.w)) / 1000
    return [uv[0] * scale, -uv[1] * scale, Math.hypot(uv[0], uv[1])]
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016)
    this.last = now
    if (!this.proj) return
    const ctx = this.wctx
    // Spuren über die ZEIT ausblenden, nicht je Bild
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = `rgba(0, 0, 0, ${FADE ** (dt * 60)})`
    ctx.fillRect(0, 0, this.wind.width, this.wind.height)
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.lineWidth = 1.15
    ctx.lineCap = 'round'
    const n = this.parts.length / 4
    for (let i = 0; i < n; i++) {
      const o = 4 * i
      const x = this.parts[o]
      const y = this.parts[o + 1]
      this.parts[o + 2] += dt
      const v = this.velocity(x, y)
      if (!v || this.parts[o + 2] > this.parts[o + 3] || x < 0 || y < 0 || x > this.w || y > this.h) {
        this.spawn(i, false)
        continue
      }
      const nx = x + v[0] * dt
      const ny = y + v[1] * dt
      ctx.strokeStyle = speedColor(v[2])
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      this.parts[o] = nx
      this.parts[o + 1] = ny
    }
  }

  /** Bewegung reduziert: ruhende Stromlinien statt einer Animation. */
  private drawStatic(): void {
    if (!this.proj) return
    const ctx = this.wctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.wind.width, this.wind.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.lineWidth = 1
    const lines = Math.round((this.w * this.h) / 2500)
    for (let k = 0; k < lines; k++) {
      let x = Math.random() * this.w
      let y = Math.random() * this.h
      ctx.beginPath()
      ctx.moveTo(x, y)
      let speed = 0
      for (let s = 0; s < 18; s++) {
        const v = this.velocity(x, y)
        if (!v) break
        speed = v[2]
        x += v[0] * 0.08
        y += v[1] * 0.08
        ctx.lineTo(x, y)
      }
      ctx.strokeStyle = speedColor(speed)
      ctx.stroke()
    }
  }
}
