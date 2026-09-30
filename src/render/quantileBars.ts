// QUANTIL-SÄULEN: die Verteilung eines Ensembles je Zeitschritt als Säule —
// Kastengrafik mit Dichtefüllung, Memberstrichen und Bezugsmarken.
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
//
// **Aufbau einer Säule** (Kastengrafik-Konvention):
//
//        ╷        Maximum          Kappe am Ende des Fühlers
//        │                         Fühler („whisker")
//     ┌─────┐     P90              hier endet der KASTEN
//     │░▒█▒░│                      Dichte der Member, blau
//     ├─────┤     Median           knallige Marke
//     │▒█▒░░│
//     └─────┘     P10
//        │
//        ╵        Minimum
//
// **Der Kasten endet bei P90, nicht beim Maximum**, und das ist der
// Unterschied zwischen einer lesbaren und einer unlesbaren Säule: beim
// Niederschlag zieht EIN nasser Ausreißer die Säule auf das Dreifache, und
// die 80 % der Member, um die es geht, quetschen sich unten in ein paar
// Pixel. Der Ausreißer gehört trotzdem ins Bild — er steht als Fühler mit
// Kappe darüber, wie in jeder Kastengrafik.
//
// **Die Füllung zeigt die DICHTE, nicht nur die Quantilstufen.** Wo viele
// Member liegen, ist das Blau kräftiger. Dreißig Member auf 1 mm und fünf
// bei 25 mm ist eine andere Aussage als eine gleichmäßige Verteilung mit
// demselben P10 und P90 — an drei Stufen sieht man das nicht, an der Dichte
// schon. Dazu bleibt JEDER Member als feiner Strich einzeln stehen: die
// Dichte sagt „hier ist die Masse", die Striche sagen „aus so vielen
// Einzelläufen besteht sie".
//
// **Drei Bezugsmarken liegen darüber** — Median, Hauptlauf, Kontrolllauf —,
// kräftig und jede in ihrer Farbe, jede mit dunkler Unterlegung, damit sie
// auf der blauen Fläche stehen bleiben. Ohne sie beantwortet die Säule „wie
// ist die Verteilung", aber nicht „wo liegt der Lauf, den ich sonst lese".
//
// Rein rechnerisch bleibt hier alles, was ohne Canvas prüfbar ist
// (`barStepHours`, `barIndices`, `barWidth`, `densityBins`); gezeichnet wird
// über übergebene Projektionsfunktionen, der Kern weiß nichts von uPlot.

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
 * damit zwischen zwei Säulen Luft bleibt; nach unten auf 5 px begrenzt
 * (schmaler tragen die Memberstriche nichts mehr), nach oben auf 24 px
 * (breiter sieht sie nach einem Balkendiagramm aus, das eine MENGE zeigt —
 * hier steht sie für eine Verteilung).
 */
export function barWidth(spacingPx: number, stepHours: number, baseHours: number): number {
  const slot = (stepHours / baseHours) * spacingPx
  return Math.max(5, Math.min(24, Math.round(slot * 0.62)))
}

/**
 * Wie viele Member liegen in welchem Höhenabschnitt des Kastens?
 *
 * `ys` sind die Bildschirm-y der Member, `top`/`height` der Kasten. Ein Wert
 * außerhalb zählt zum Randabschnitt — er ist nicht weg, er liegt nur im
 * Fühlerbereich, und seine Masse gehört an den Rand der Dichte.
 *
 * Reine Zählung — was geglättet werden soll, glättet `smoothBins`, und zwar
 * über die NACHBARABSCHNITTE, nicht über einen geschätzten Kern: bei 11–51
 * Membern wäre jede Kerndichte eine Annahme, die Säule soll aber zeigen, was
 * da ist.
 */
export function densityBins(ys: number[], top: number, height: number, bins: number): number[] {
  const out = new Array(Math.max(1, bins)).fill(0)
  if (height <= 0) {
    out[0] = ys.length
    return out
  }
  for (const y of ys) {
    let b = Math.floor(((y - top) / height) * out.length)
    if (b < 0) b = 0
    if (b >= out.length) b = out.length - 1
    out[b]++
  }
  return out
}

/**
 * Dreier-Mittel über die Nachbarabschnitte.
 *
 * Ohne das flackert die Füllung: bei 51 Membern auf 60 Abschnitte hat fast
 * jeder null, einen oder zwei Treffer, und die Deckkraft springt von
 * Abschnitt zu Abschnitt — das sieht nach Rauschen aus und nicht nach einer
 * Verteilung. Der Rand zählt sich selbst doppelt, damit oben und unten kein
 * künstlicher Einbruch entsteht.
 */
export function smoothBins(counts: number[]): number[] {
  const n = counts.length
  if (n < 3) return [...counts]
  return counts.map((_, i) => {
    const a = counts[i - 1] ?? counts[i]
    const b = counts[i]
    const c = counts[i + 1] ?? counts[i]
    return (a + b + c) / 3
  })
}

/** Eine Bezugsreihe, die als Marke IN der Säule steht (Hauptlauf, Kontrolllauf). */
export interface BarMark {
  values: (number | null)[]
  color: string
}

export interface QuantileBarColors {
  /** Grundton der Dichtefüllung als „r,g,b" — die Deckkraft rechnet der Zeichner. */
  densityRgb: string
  /** Umriss des Kastens. */
  outline: string
  /** Fühler und Kappen. */
  whisker: string
  /** Ein Strich je Member. */
  tick: string
  median: string
}

/** Höhe eines Dichteabschnitts in Pixeln — feiner sieht man bei 51 Membern nicht. */
const BIN_PX = 5
/** Deckkraft der Dichtefüllung: leer … dichtester Abschnitt. */
const DENSITY_MIN = 0.07
const DENSITY_MAX = 0.78

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
    /** Striche je Member zeichnen (sonst nur Dichte und Quantile). */
    ticks: boolean
    /** Zusätzliche Marken in der Säule, in Zeichenreihenfolge. */
    marks?: BarMark[]
    colors: QuantileBarColors
    /** Zeichenfläche — Säulen außerhalb werden übersprungen. */
    clip: { left: number; top: number; width: number; height: number }
    /** Geräte-Pixelverhältnis: Strichstärken sollen auf HiDPI gleich AUSSEHEN. */
    dpr?: number
  },
): void {
  const { stats, members, width: w, colors, clip } = opts
  const dpr = opts.dpr ?? 1
  const half = w / 2
  ctx.save()
  ctx.beginPath()
  ctx.rect(clip.left, clip.top, clip.width, clip.height)
  ctx.clip()
  // Strichmuster einer zuvor gezeichneten Serie wirkt im Canvas-Kontext fort
  // (siehe die Zeichner in render/wxsymbols.ts) — erst zurücksetzen.
  ctx.setLineDash([])

  /**
   * Marke quer durch die Säule: dunkel unterlegt und beidseitig überstehend,
   * damit sie auf der blauen Fläche UND neben ihr steht. Ohne die
   * Unterlegung verschwindet gerade die wichtigste Marke — der Median — im
   * dichtesten Teil der Füllung, und genau dort liegt er meistens.
   */
  const mark = (v: number | null | undefined, color: string, left: number, bw: number) => {
    if (v == null || !Number.isFinite(v)) return
    const my = Math.round(opts.y(v))
    const over = 3 * dpr
    ctx.fillStyle = 'rgba(8,9,11,0.9)'
    ctx.fillRect(left - over, my - 2.5 * dpr, bw + 2 * over, 5 * dpr)
    ctx.fillStyle = color
    ctx.fillRect(left - over, my - 1.5 * dpr, bw + 2 * over, 3 * dpr)
  }

  for (const t of opts.indices) {
    if (stats.count[t] === 0) continue
    const cx = opts.x(t)
    if (cx < clip.left - w || cx > clip.left + clip.width + w) continue
    const left = Math.round(cx - half)
    const bw = Math.max(1, Math.round(w))
    const p10 = stats.p10[t]
    const p90 = stats.p90[t]
    const lo = stats.min[t]
    const hi = stats.max[t]
    if (p10 == null || p90 == null || lo == null || hi == null) continue

    const yTop = opts.y(p90)
    const yBot = opts.y(p10)
    const boxTop = Math.round(Math.min(yTop, yBot))
    const boxH = Math.max(1, Math.round(Math.abs(yBot - yTop)))

    // 1) DICHTE im Kasten. Abschnittsweise gefüllt: je mehr Member in einem
    //    Abschnitt liegen, desto kräftiger das Blau.
    const ys: number[] = []
    for (const m of members) {
      const v = m[t]
      if (v != null && Number.isFinite(v)) ys.push(opts.y(v))
    }
    const bins = Math.max(1, Math.round(boxH / (BIN_PX * dpr)))
    const counts = smoothBins(densityBins(ys, boxTop, boxH, bins))
    const peak = Math.max(1, ...counts)
    const binH = boxH / counts.length
    for (let i = 0; i < counts.length; i++) {
      const a = DENSITY_MIN + (DENSITY_MAX - DENSITY_MIN) * (counts[i] / peak)
      ctx.fillStyle = `rgba(${colors.densityRgb},${a.toFixed(3)})`
      ctx.fillRect(left, boxTop + i * binH, bw, Math.ceil(binH) + 1)
    }

    // 2) FÜHLER zu Minimum und Maximum, mit Kappe — der Kasten endet bei P90,
    //    der Ausreißer gehört trotzdem ins Bild.
    ctx.strokeStyle = colors.whisker
    ctx.lineWidth = dpr
    const mid = Math.round(left + bw / 2) + 0.5 * dpr
    const capW = Math.max(3 * dpr, Math.round(bw * 0.55))
    const whisker = (from: number, to: number) => {
      const yf = Math.round(opts.y(from))
      const yt = Math.round(opts.y(to))
      if (Math.abs(yt - yf) < 1) return
      ctx.beginPath()
      ctx.moveTo(mid, yf)
      ctx.lineTo(mid, yt)
      ctx.moveTo(mid - capW / 2, yt + 0.5 * dpr)
      ctx.lineTo(mid + capW / 2, yt + 0.5 * dpr)
      ctx.stroke()
    }
    whisker(p90, hi)
    whisker(p10, lo)

    // 3) UMRISS des Kastens — die Kante trennt „80 % der Member" vom
    //    Fühlerbereich; ohne sie verläuft die Dichte ins Nichts.
    ctx.strokeStyle = colors.outline
    ctx.lineWidth = dpr
    ctx.strokeRect(left + 0.5 * dpr, boxTop + 0.5 * dpr, bw - dpr, boxH - dpr)

    // 4) JEDER MEMBER als feiner Strich. Im Kasten über die volle Breite, im
    //    Fühlerbereich schmaler — dort ist er ein Ausreißer und soll nicht
    //    wie ein zweiter Kasten aussehen.
    if (opts.ticks) {
      ctx.fillStyle = colors.tick
      for (const yv of ys) {
        const inBox = yv >= boxTop - 1 && yv <= boxTop + boxH + 1
        const tw = inBox ? Math.max(1, bw - 2 * dpr) : Math.max(2 * dpr, Math.round(bw * 0.5))
        ctx.fillRect(Math.round(mid - tw / 2), Math.round(yv), tw, Math.max(1, Math.round(dpr)))
      }
    }

    // 5) BEZUGSMARKEN zuoberst: Median, dann was der Aufrufer mitgibt
    //    (Hauptlauf, Kontrolllauf).
    mark(stats.median[t], colors.median, left, bw)
    for (const m of opts.marks ?? []) mark(m.values[t], m.color, left, bw)
  }
  ctx.restore()
}
