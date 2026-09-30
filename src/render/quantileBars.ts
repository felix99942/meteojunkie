// QUANTIL-BALKEN: die Verteilung eines Ensembles je Zeitschritt, in der am
// Markt üblichen Form (ECMWF-/Wetterzentrale-Manier).
//
// **Warum überhaupt.** Beim Niederschlag versagt die Plume-Darstellung, für
// die sie gedacht ist. Eine Temperaturplume lebt davon, dass die Member
// PARALLEL laufen und sich langsam auffächern — beim Niederschlag springen
// sie: Member 7 hat den Schauer um 14 Uhr, Member 12 um 20 Uhr, zwanzig
// andere gar nicht. Als Spaghetti ist das ein Knäuel, und ein Band
// dazwischen liest sich wie ein Verlauf, den kein einziger Member hat.
// Gefragt ist an einem Niederschlagstermin nicht „wie läuft es", sondern
// „wie viel, und wie sicher" — also die VERTEILUNG an diesem einen Termin.
//
// **Aufbau eines Balkens:**
//
//        ───       Maximum        Strich auf dem Aufsatz
//         │
//        ▐▌        P90…P95        schmalerer, blasserer Aufsatz
//      ┌────┐      P90
//      │████│                     Hauptbalken: 80 % der Member
//      │════│      Median         knallige Marke
//      │----│      Mittel
//      └────┘      P10
//        ▐▌        P05…P10
//         │
//        ───       Minimum
//
// **Zwei Vorstufen sind gescheitert und stehen hier, damit niemand
// zurückrudert.** Die erste zeichnete drei gefüllte Quantilstufen bis zum
// MAXIMUM: ein einzelner nasser Ausreißer zog den Balken auf das Dreifache,
// und die 80 %, um die es geht, quetschten sich unten in ein paar Pixel. Die
// zweite ersetzte die Fläche durch eine Geigenform samt einem Strich je
// Member — rechnerisch ehrlich, in der Praxis aber unruhig und ohne
// Mehrwert gegenüber den Quantilen, die man ohnehin abliest. Die 51
// Einzelläufe stehen deshalb NICHT mehr im Balken; wer sie sehen will,
// schaltet die Säulen ab und bekommt die Spaghetti.
//
// Geblieben ist aus beiden Versuchen die Lehre: **Fläche ist
// Aufmerksamkeit.** Deshalb wird nach außen hin schmaler und blasser —
// Hauptbalken, Aufsatz, Strich —, statt überall gleich viel Farbe zu
// setzen.
//
// Rein rechnerisch bleibt hier alles, was ohne Canvas prüfbar ist
// (`barStepHours`, `barIndices`, `barWidth`); gezeichnet wird über
// übergebene Projektionsfunktionen, der Kern weiß nichts von uPlot.

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

/** Eine Bezugsreihe, die als Marke IN der Säule steht (Hauptlauf, Kontrolllauf). */
export interface BarMark {
  values: (number | null)[]
  color: string
}

export interface QuantileBarColors {
  /** Hauptbalken P10–P90. */
  body: string
  /** Aufsätze P5–P10 und P90–P95. */
  tail: string
  /** Umriss der Balken. */
  outline: string
  /** Verbindung und Striche an Minimum und Maximum. */
  extreme: string
  median: string
  mean: string
}

/** Breite der Aufsätze P5–P10 / P90–P95, als Anteil der Balkenbreite. */
const TAIL_FRACTION = 0.5

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
    width: number
    /** Zusätzliche Marken im Balken, in Zeichenreihenfolge. */
    marks?: BarMark[]
    colors: QuantileBarColors
    /** Zeichenfläche — Säulen außerhalb werden übersprungen. */
    clip: { left: number; top: number; width: number; height: number }
    /** Geräte-Pixelverhältnis: Strichstärken sollen auf HiDPI gleich AUSSEHEN. */
    dpr?: number
  },
): void {
  const { stats, width: w, colors, clip } = opts
  const dpr = opts.dpr ?? 1
  ctx.save()
  ctx.beginPath()
  ctx.rect(clip.left, clip.top, clip.width, clip.height)
  ctx.clip()
  // Strichmuster einer zuvor gezeichneten Serie wirkt im Canvas-Kontext fort
  // (siehe die Zeichner in render/wxsymbols.ts) — erst zurücksetzen.
  ctx.setLineDash([])

  /** Rechteck zwischen zwei Werten, mittig auf `mid`. */
  const span = (a: number | null, b: number | null, mid: number, bw: number, fill: string) => {
    if (a == null || b == null) return { top: 0, h: 0 }
    const y1 = opts.y(a)
    const y2 = opts.y(b)
    const top = Math.round(Math.min(y1, y2))
    const h = Math.max(1, Math.round(Math.abs(y2 - y1)))
    ctx.fillStyle = fill
    ctx.fillRect(Math.round(mid - bw / 2), top, Math.round(bw), h)
    return { top, h }
  }

  /**
   * Marke quer durch den Balken: dunkel unterlegt und beidseitig
   * überstehend, damit sie auf der blauen Fläche UND neben ihr steht. Ohne
   * die Unterlegung verschwindet gerade die wichtigste Marke — der Median —
   * in der Füllung, und genau dort liegt er meistens.
   */
  const mark = (v: number | null | undefined, color: string, mid: number, bw: number) => {
    if (v == null || !Number.isFinite(v)) return
    const my = Math.round(opts.y(v))
    const hw = bw / 2 + 3 * dpr
    ctx.fillStyle = 'rgba(8,9,11,0.9)'
    ctx.fillRect(mid - hw, my - 2.5 * dpr, hw * 2, 5 * dpr)
    ctx.fillStyle = color
    ctx.fillRect(mid - hw, my - 1.5 * dpr, hw * 2, 3 * dpr)
  }

  for (const t of opts.indices) {
    if (stats.count[t] === 0) continue
    const cx = opts.x(t)
    if (cx < clip.left - w || cx > clip.left + clip.width + w) continue
    const mid = Math.round(cx)
    const bw = Math.max(2, Math.round(w))
    const tailW = Math.max(2, Math.round(bw * TAIL_FRACTION))

    // 1) AUFSÄTZE P5–P10 und P90–P95 — schmaler und blasser als der
    //    Hauptbalken. Sie sind die Stufe zwischen „üblicher Bereich" und
    //    „Ausreißer"; ohne sie springt das Bild von P90 direkt auf das
    //    Maximum, und jede Spitze sieht gleich unwahrscheinlich aus.
    span(stats.p90[t], stats.p95[t], mid, tailW, colors.tail)
    span(stats.p5[t], stats.p10[t], mid, tailW, colors.tail)

    // 2) HAUPTBALKEN P10–P90: der Bereich, in dem 80 % der Member liegen.
    const box = span(stats.p10[t], stats.p90[t], mid, bw, colors.body)
    ctx.strokeStyle = colors.outline
    ctx.lineWidth = dpr
    ctx.strokeRect(
      Math.round(mid - bw / 2) + 0.5 * dpr,
      box.top + 0.5 * dpr,
      bw - dpr,
      Math.max(1, box.h - dpr),
    )

    // 3) MINIMUM und MAXIMUM als Striche auf den Aufsätzen, mit dünner
    //    Verbindung dorthin — der äußerste Lauf gehört ins Bild, aber nicht
    //    als Fläche: sonst wiegt ein einzelner nasser Member so schwer wie
    //    die Mehrheit.
    ctx.fillStyle = colors.extreme
    const tick = (from: number | null, to: number | null) => {
      if (from == null || to == null) return
      const yf = Math.round(opts.y(from))
      const yt = Math.round(opts.y(to))
      if (Math.abs(yt - yf) >= 1) {
        ctx.fillRect(mid - Math.round(dpr / 2), Math.min(yf, yt), Math.max(1, Math.round(dpr)), Math.abs(yt - yf))
      }
      ctx.fillRect(Math.round(mid - tailW / 2), yt, tailW, Math.max(1, Math.round(dpr)))
    }
    tick(stats.p95[t], stats.max[t])
    tick(stats.p5[t], stats.min[t])

    // 4) BEZUGSMARKEN zuoberst: Mittel, Median, dann was der Aufrufer
    //    mitgibt (Hauptlauf, Kontrolllauf). Der Median liegt über dem
    //    Mittel — er ist die Zahl, die man zuerst sucht.
    mark(stats.mean[t], colors.mean, mid, bw)
    mark(stats.median[t], colors.median, mid, bw)
    for (const m of opts.marks ?? []) mark(m.values[t], m.color, mid, bw)
  }
  ctx.restore()
}
