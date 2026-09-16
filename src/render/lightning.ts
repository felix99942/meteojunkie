// Blitze als KREUZE, gefärbt nach dem Alter.
//
// **Der DWD veröffentlicht keine Einzelblitze.** Was es gibt, ist die
// NowCastMIX-Blitzdichte: ein Raster in „Blitze pro Minute und 100 km²", und
// genau das ist auch seine Kornung — live nachgemessen (2026-09-16, 50 m/px
// überzoomt) hält eine Farbfläche über 10,4 km an, die Zellen sind also
// 10 km × 10 km. Ein Kreuz steht deshalb für EINE ZELLE MIT BLITZEN, nicht für
// einen einzelnen Einschlag; das muss in der Legende stehen, sonst liest man
// eine Genauigkeit hinein, die die Quelle nicht hat.
//
// Warum überhaupt Kreuze: als eingefärbte Fläche sieht die Dichte aus wie ein
// zweites Radarecho (ihre Skala läuft ebenfalls über Gelb, Grün und Türkis)
// und legt sich als Schleier über genau das Echo, das man lesen will. Kreuze
// sind punktförmig, verdecken nichts und tragen über die FARBE eine zweite
// Information, die eine Dichteskala nicht hergibt: wie alt die Aktivität ist.
//
// Die Altersstufe ist durch das Produkt auf 15 Minuten gerundet — jedes Bild
// fasst die Blitze der letzten 15 Minuten zusammen, ein Einschlag kann also
// bis zu drei aufeinanderfolgende Bilder besetzen. Gezeichnet wird von ALT
// nach NEU, das jüngste Kreuz liegt oben; eine Zelle, in der es weiter blitzt,
// erscheint damit in der frischesten Farbe.

/** Eine Zelle mit Blitzen, in Bildkoordinaten 0…1 (projektionsfrei). */
export interface LightningCell {
  x: number
  y: number
  /**
   * Stufe der Blitzrate, 0 = schwächste Klasse des Produkts. Aus der
   * PIXELFARBE zurückgelesen: die Rate steckt im Bild und nirgends sonst, und
   * ohne sie stünde über einem großen Cluster ein gleichförmiges Kreuzgitter.
   */
  level: number
}

/** Maskenfarbe („keine Daten") des Produktstils — nie ein Blitz. */
const MASK_GREY = 126
const MASK_TOL = 10

/**
 * Zellen mit Blitzen aus einem Dichtebild.
 *
 * `block` fasst benachbarte Pixel zusammen: angefordert wird das Bild grob
 * (siehe `imageWidth` des Overlays, ~4,7 km/px), eine 10-km-Zelle deckt darin
 * je nach Breite 3 bis 4 Pixel ab. Ohne das Zusammenfassen bekäme dieselbe
 * Zelle ein Dutzend Kreuze übereinander.
 */
export function extractLightningCells(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  block: number,
  palette: number[][],
): LightningCell[] {
  const b = Math.max(1, Math.round(block))
  const cells: LightningCell[] = []
  for (let by = 0; by < height; by += b) {
    for (let bx = 0; bx < width; bx += b) {
      let level = -1
      for (let y = by; y < Math.min(by + b, height); y++) {
        for (let x = bx; x < Math.min(bx + b, width); x++) {
          const i = (y * width + x) * 4
          if (data[i + 3] === 0) continue
          const r = data[i]
          const g = data[i + 1]
          const bl = data[i + 2]
          // Die Maske ist grau und bedeutet „keine Daten" — kein Blitz.
          if (
            Math.abs(r - MASK_GREY) <= MASK_TOL &&
            Math.abs(g - MASK_GREY) <= MASK_TOL &&
            Math.abs(bl - MASK_GREY) <= MASK_TOL
          ) {
            continue
          }
          // Die STÄRKSTE Klasse im Block gewinnt: ein Block deckt ungefähr
          // eine 10-km-Zelle ab, liegt aber nicht deckungsgleich auf ihr.
          level = Math.max(level, nearestLevel(r, g, bl, palette))
        }
      }
      if (level < 0) continue
      const cx = Math.min(bx + b / 2, width)
      const cy = Math.min(by + b / 2, height)
      cells.push({ x: cx / width, y: cy / height, level })
    }
  }
  return cells
}

/** Nächste Palettenfarbe (quadratischer RGB-Abstand) — deren Index IST die Stufe. */
function nearestLevel(r: number, g: number, b: number, palette: number[][]): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i]
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** '#RRGGBB' → [r,g,b] für `extractLightningCells`. */
export function toPalette(colors: string[]): number[][] {
  return colors.map((c) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ])
}

/**
 * Zeichnet die Kreuze einer Altersstufe.
 *
 * Jedes Kreuz bekommt zuerst eine dunkle, breitere Linie und darüber die
 * Farbe: über einem gelben oder weißen Starkregenkern wäre ein dünnes gelbes
 * Kreuz sonst unsichtbar — dieselbe Halo-Logik wie bei den Stadt-Labels der
 * Karte.
 */
export function drawLightningCrosses(
  ctx: CanvasRenderingContext2D,
  cells: LightningCell[],
  size: { width: number; height: number },
  color: string,
  arm: { base: number; perLevel: number },
): void {
  if (cells.length === 0) return
  ctx.save()
  ctx.lineCap = 'round'
  // Erst alle dunklen Halos, dann alle farbigen Kreuze: sonst radiert das Halo
  // des nächsten Kreuzes die Farbe des vorigen an.
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.75)' : color
    for (const c of cells) {
      const a = arm.base + c.level * arm.perLevel
      ctx.lineWidth = pass === 0 ? Math.max(2.4, a * 0.75) : Math.max(1.3, a * 0.45)
      const x = c.x * size.width
      const y = c.y * size.height
      ctx.beginPath()
      ctx.moveTo(x - a, y)
      ctx.lineTo(x + a, y)
      ctx.moveTo(x, y - a)
      ctx.lineTo(x, y + a)
      ctx.stroke()
    }
  }
  ctx.restore()
}
