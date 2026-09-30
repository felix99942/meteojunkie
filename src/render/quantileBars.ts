// QUANTIL-BALKEN: die Verteilung eines Ensembles je Zeitschritt als Säule.
//
// **Warum überhaupt.** Beim Niederschlag versagt die Plume-Darstellung, für
// die sie gedacht ist. Eine Temperaturplume lebt davon, dass die Member
// PARALLEL laufen und sich langsam auffächern — beim Niederschlag springen
// sie: Member 7 hat den Schauer um 14 Uhr, Member 12 um 20 Uhr, zwanzig
// andere gar nicht. Als Spaghetti ist das ein Knäuel, und das Band
// dazwischen liest sich wie ein Verlauf, den kein einziger Member hat.
//
// Gefragt ist an einem Niederschlagstermin nicht „wie läuft es", sondern
// „wie viel, und wie sicher": also die VERTEILUNG an diesem einen Termin.
// Genau die zeichnet eine Säule.
//
// **Aufbau der Säule** (von außen nach innen, jede Stufe kräftiger):
//
//     min…max     die ganze Spannweite — auch der eine nasse Ausreißer
//     p10…p90     80 % der Member
//     p25…p75     die mittlere Hälfte
//     ───────     Median
//
// Dazu, und das ist der Kern: **ein feiner Strich JE MEMBER** quer durch die
// Säule. Die Quantile sagen, wo die Grenzen liegen, aber nicht, wie es
// dazwischen aussieht — und gerade beim Niederschlag ist die Verteilung
// selten glatt. Liegen dreißig Member auf 0 mm und fünf bei 25 mm, ist das
// eine andere Aussage als eine gleichmäßige Verteilung mit demselben p10 und
// p90, und man sieht es nur an den Strichen: wo sie sich stapeln, liegt die
// Masse. Die Striche sind halbdurchlässig, überlagern sich also zu einem
// Dichteverlauf, statt bei 51 Membern zu einer Fläche zu verschmelzen.
//
// Rein rechnerisch bleibt hier alles, was ohne Canvas prüfbar ist
// (`barStepHours`, `barIndices`, `barWidth`); gezeichnet wird über
// übergebene Projektionsfunktionen, damit der Kern nichts von uPlot weiß.

import type { PlumeStats } from './plume'

/**
 * Erlaubte Abstände in STUNDEN. Wie bei den Symbolreihen des klassischen
 * Meteogramms auf runde Vielfache gerastert: ein krummer Schritt (13 h, 11 h)
 * setzte die Säulen auf wandernde Uhrzeiten, und beim Zoomen sprängen sie
 * über die Tagesgrenzen.
 */
const NICE_STEPS_H = [1, 2, 3, 6, 12, 24, 48]

/**
 * Welcher Stundenabstand passt bei dieser Pixeldichte?
 *
 * `spacingPx` ist der Abstand ZWEIER benachbarter Datenpunkte in Pixeln,
 * `baseHours` deren zeitlicher Abstand (1 h bei der Summenkurve, 6 h bei den
 * Intervallmengen). Gesucht ist das kleinste runde Vielfache, bei dem die
 * Säulen mindestens `minGapPx` auseinanderstehen — sonst wird aus der
 * Verteilung eine geschlossene Fläche.
 */
export function barStepHours(spacingPx: number, baseHours: number, minGapPx: number): number {
  for (const step of NICE_STEPS_H) {
    if (step < baseHours) continue
    if ((step / baseHours) * spacingPx >= minGapPx) return step
  }
  return NICE_STEPS_H[NICE_STEPS_H.length - 1]
}

/**
 * Indizes der Zeitschritte, die eine Säule bekommen: alle auf einem
 * Vielfachen von `stepHours` seit Epoch (also 00/06/12/18 UTC bei 6 h).
 *
 * Bewusst an der UTC-Zeit festgemacht und nicht am Datenbeginn: sonst hinge
 * das Raster daran, wann die Reihe anfängt, und zwei Panels nebeneinander
 * stünden versetzt — dieselbe Überlegung wie bei `bucketMembers`.
 */
export function barIndices(times: number[], stepHours: number): number[] {
  const stepMs = stepHours * 3_600_000
  const out: number[] = []
  for (let i = 0; i < times.length; i++) if (times[i] % stepMs === 0) out.push(i)
  return out
}

/**
 * Breite einer Säule in Pixeln. Etwa zwei Drittel des verfügbaren Rasters,
 * damit zwischen zwei Säulen Luft bleibt; nach unten auf 3 px begrenzt (eine
 * 1-px-Säule trägt keine Striche mehr), nach oben auf 22 px (breiter sieht
 * sie nach einem Balkendiagramm aus, das eine MENGE zeigt — hier steht sie
 * für eine Verteilung).
 */
export function barWidth(spacingPx: number, stepHours: number, baseHours: number): number {
  const slot = (stepHours / baseHours) * spacingPx
  return Math.max(3, Math.min(22, Math.round(slot * 0.62)))
}

export interface QuantileBarColors {
  /** min…max */
  outer: string
  /** p10…p90 */
  mid: string
  /** p25…p75 */
  inner: string
  /** Ein Strich je Member */
  tick: string
  median: string
}

/**
 * Säulen zeichnen. `x`/`y` projizieren Datenindex bzw. Wert auf Pixel; die
 * Funktion kennt weder uPlot noch die Achsen.
 */
export function drawQuantileBars(
  ctx: CanvasRenderingContext2D,
  opts: {
    indices: number[]
    x: (t: number) => number
    y: (v: number) => number
    stats: PlumeStats
    members: (number | null)[][]
    width: number
    /** Striche je Member zeichnen (sonst nur die Quantilstufen). */
    ticks: boolean
    colors: QuantileBarColors
    /** Zeichenfläche — Säulen außerhalb werden übersprungen. */
    clip: { left: number; top: number; width: number; height: number }
  },
): void {
  const { stats, members, width: w, colors, clip } = opts
  const half = w / 2
  ctx.save()
  ctx.beginPath()
  ctx.rect(clip.left, clip.top, clip.width, clip.height)
  ctx.clip()
  // Strichmuster einer zuvor gezeichneten Serie wirkt im Canvas-Kontext fort
  // (siehe die Zeichner in render/wxsymbols.ts) — erst zurücksetzen.
  ctx.setLineDash([])

  for (const t of opts.indices) {
    if (stats.count[t] === 0) continue
    const cx = opts.x(t)
    if (cx < clip.left - w || cx > clip.left + clip.width + w) continue
    const left = Math.round(cx - half)
    const bw = Math.max(1, Math.round(w))

    // Stufen von außen nach innen; jede liegt über der vorigen, die Fläche
    // wird also zur Mitte hin dichter, ohne dass Alpha-Werte gerechnet werden.
    const band = (a: number | null, b: number | null, fill: string) => {
      if (a == null || b == null) return
      const y1 = opts.y(b)
      const y2 = opts.y(a)
      const top = Math.min(y1, y2)
      const h = Math.max(1, Math.abs(y2 - y1))
      ctx.fillStyle = fill
      ctx.fillRect(left, top, bw, h)
    }
    band(stats.min[t], stats.max[t], colors.outer)
    band(stats.p10[t], stats.p90[t], colors.mid)
    band(stats.p25[t], stats.p75[t], colors.inner)

    // EIN STRICH JE MEMBER. Sie überlagern sich absichtlich: wo viele Member
    // liegen, wird die Fläche dichter — das ist die Verteilung, die die
    // Quantilgrenzen allein nicht zeigen.
    if (opts.ticks) {
      ctx.fillStyle = colors.tick
      const tx = left + 1
      const tw = Math.max(1, bw - 2)
      for (const m of members) {
        const v = m[t]
        if (v == null || !Number.isFinite(v)) continue
        ctx.fillRect(tx, Math.round(opts.y(v)), tw, 1)
      }
    }

    const med = stats.median[t]
    if (med != null) {
      ctx.fillStyle = colors.median
      ctx.fillRect(left - 1, Math.round(opts.y(med)) - 1, bw + 2, 2)
    }
  }
  ctx.restore()
}
