// Sternenhimmel hinter dem Globus der Modellkarten — eine KACHEL, die als
// CSS-Hintergrund wiederholt wird. Ein Bild statt WebGL: MapLibre lässt die
// Fläche neben der Kugel durchsichtig, darunter liegt einfach der Hintergrund
// des Kartenfelds; das kostet beim Drehen nichts.
//
// Erzeugt, nicht geladen: kein Asset, und deterministisch (fester Startwert),
// damit der Himmel bei jedem Besuch gleich aussieht. Helligkeiten nach einem
// Potenzgesetz — sehr viele schwache, wenige helle Sterne, so wie der echte
// Himmel; gleich helle Punkte sähen aus wie Rauschen. Leichte Farbtöne von
// bläulich-weiß bis gelblich (heiße bis kühle Sterne), die hellsten mit
// weichem Schein.

/** Kleiner, schneller Zufallsgenerator mit festem Startwert (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Star {
  x: number
  y: number
  /** Radius in Kachelpixeln */
  r: number
  /** 0…1 */
  brightness: number
  color: [number, number, number]
}

/** Sternfarben von heiß (bläulich) bis kühl (gelblich-orange), gewichtet zur Mitte (weiß). */
const STAR_TINTS: [number, number, number][] = [
  [170, 195, 255],
  [205, 220, 255],
  [255, 255, 255],
  [255, 255, 255],
  [255, 244, 220],
  [255, 225, 180],
]

export function generateStars(size: number, count: number, seed = 20261005): Star[] {
  const rnd = seededRandom(seed)
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    // Potenzgesetz: rnd^5 drängt fast alle Sterne ins Schwache
    const m = rnd() ** 5
    stars.push({
      x: rnd() * size,
      y: rnd() * size,
      r: 0.35 + m * 1.6,
      brightness: 0.25 + 0.75 * Math.min(1, m * 2.2 + rnd() * 0.25),
      color: STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)],
    })
  }
  return stars
}

/**
 * Sternkachel als Data-URL. `dpr` = Gerätepixelverhältnis: die Kachel wird
 * so fein gezeichnet, wie der Schirm sie zeigt, sonst sind die Sterne auf
 * einem HiDPI-Schirm unscharfe Kleckse.
 */
export function starTileDataUrl(size = 768, count = 900, dpr = 1): string {
  const px = Math.round(size * dpr)
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(dpr, dpr)
  for (const s of generateStars(size, count)) {
    const [r, g, b] = s.color
    // an den Kachelrändern auch gegenüber zeichnen, damit die Wiederholung
    // keine abgeschnittenen Sterne zeigt (jede Lage genau einmal)
    const xs = [s.x, ...(s.x < 6 ? [s.x + size] : s.x > size - 6 ? [s.x - size] : [])]
    const ys = [s.y, ...(s.y < 6 ? [s.y + size] : s.y > size - 6 ? [s.y - size] : [])]
    for (const x of xs) {
      for (const y of ys) {
        if (s.r > 1.1) {
          // weicher Schein um die hellen Sterne
          const glow = ctx.createRadialGradient(x, y, 0, x, y, s.r * 4)
          glow.addColorStop(0, `rgba(${r},${g},${b},${0.35 * s.brightness})`)
          glow.addColorStop(1, `rgba(${r},${g},${b},0)`)
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(x, y, s.r * 4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${s.brightness})`
        ctx.beginPath()
        ctx.arc(x, y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  return canvas.toDataURL('image/png')
}
