// Rechenkern des Föhn-Bereichs (FoehnPanel) — rein, ohne DOM/uPlot, damit
// testbar (foehn.test.ts). Registry und Schwellen: config/foehn.ts.
//
// Konvention wie im Rest der App: Reihen liegen auf dem gemeinsamen
// Stundenraster, null = Lücke. Kriterien sind 1 (erfüllt), 0 (nicht erfüllt)
// oder null (Modell liefert die Größe nicht) — „nicht erfüllt" und „nicht
// verfügbar" sind verschiedene Aussagen und dürfen nicht zusammenfallen.

import { potentialTemperature } from '../lib/thermo'
import {
  CREST_SECTORS,
  FOEHN_LIMITS,
  type FoehnDirection,
  type Sector,
} from '../config/foehn'

export type Series = (number | null)[]

/** Reihe per Zeitstempel auf das Raster legen (kein Index-Abgleich). */
export function alignSeries(
  gridMs: number[],
  times: number[] | undefined,
  values: Series | undefined,
): Series {
  if (!times || !values) return gridMs.map(() => null)
  const byTime = new Map<number, number | null>()
  for (let i = 0; i < times.length; i++) byTime.set(times[i], values[i] ?? null)
  return gridMs.map((t) => byTime.get(t) ?? null)
}

/**
 * Zeitpunkt, hinter dem KEINE der Reihen mehr einen Wert hat — also der Rand
 * des Modell- bzw. Ensemblehorizonts dieser Kachel.
 *
 * Die Zeitachse des Föhn-Bereichs reicht immer bis zum LÄNGSTEN Horizont der
 * gewählten Modelle (siehe FoehnPanel); eine Kachel mit einem kürzeren Modell
 * hat dahinter also eine leere Fläche, in der Gitter und Bezugslinien
 * weiterlaufen, als gäbe es dort Daten. Damit dieser Bereich ausgegraut werden
 * kann, braucht die Kachel seinen Anfang.
 *
 * `null`, wenn die Reihen bis zum Ende reichen oder gar keine Werte haben —
 * in beiden Fällen gibt es nichts abzugrenzen (eine komplett leere Kachel
 * zeigt ihren eigenen `empty`-Text, nicht eine Fläche über die volle Breite).
 * Innere Lücken zählen NICHT: gesucht ist das ENDE der Daten, und ein
 * einzelner fehlender Zeitschritt in der Mitte ist kein Horizont.
 */
export function horizonEdge(gridMs: number[], series: Series[]): number | null {
  let last = -1
  for (const s of series) {
    for (let i = s.length - 1; i > last; i--) {
      if (s[i] != null) {
        last = i
        break
      }
    }
  }
  if (last < 0 || last >= gridMs.length - 1) return null
  return gridMs[last + 1]
}

/** a − b je Zeitschritt; eine Lücke auf einer Seite ergibt eine Lücke. */
export function difference(a: Series, b: Series): Series {
  return a.map((v, i) => {
    const w = b[i]
    return v == null || w == null ? null : v - w
  })
}

/**
 * ΔP je Member. Member n ist an beiden Punkten DERSELBE Lauf, deshalb ist die
 * Differenz je Member eine echte Realisierung — anders als die Differenz
 * zweier Mediane, die in keinem Member so vorkommen muss.
 */
export function memberDifferences(south: Series[], north: Series[]): Series[] {
  const n = Math.min(south.length, north.length)
  const out: Series[] = []
  for (let m = 0; m < n; m++) out.push(difference(south[m], north[m]))
  return out
}

/** ΔP in Föhnrichtung: positiv heißt „Gradient treibt Föhn in diese Richtung". */
export function directed(dp: number, direction: FoehnDirection): number {
  return direction === 'south' ? dp : -dp
}

/**
 * Anteil der Member (in %) mit ΔP über der Schwelle in Föhnrichtung. Null,
 * wenn weniger als die Hälfte der Member einen Wert hat — am Horizont
 * einzelner Member wäre der Anteil sonst aus einer Handvoll gerechnet.
 */
export function exceedanceProbability(
  members: Series[],
  threshold: number,
  direction: FoehnDirection,
): Series {
  const nt = members.reduce((n, m) => Math.max(n, m.length), 0)
  const minValid = Math.max(1, Math.ceil(members.length / 2))
  const out: Series = []
  for (let t = 0; t < nt; t++) {
    let valid = 0
    let hit = 0
    for (const m of members) {
      const v = m[t]
      if (v == null) continue
      valid++
      if (directed(v, direction) >= threshold) hit++
    }
    out.push(valid >= minValid ? (100 * hit) / valid : null)
  }
  return out
}

/** Richtung (Grad, Herkunft) im Sektor — `from` > `to` läuft über Nord. */
export function inSector(deg: number, sector: Sector): boolean {
  const d = ((deg % 360) + 360) % 360
  return sector.from <= sector.to
    ? d >= sector.from && d <= sector.to
    : d >= sector.from || d <= sector.to
}

/** θ an der Talstation (2 m, Bodendruck) minus θ auf 700 hPa am Kamm, in K. */
export function thetaDifference(t2m: Series, surfacePressure: Series, t700: Series): Series {
  return t2m.map((t, i) => {
    const p = surfacePressure[i]
    const tu = t700[i]
    if (t == null || p == null || tu == null) return null
    return potentialTemperature(t, p) - potentialTemperature(tu, 700)
  })
}

export interface CriteriaInput {
  /** ΔP Süd − Nord (hPa). */
  dp: Series
  /** Wind auf 700 hPa am Kamm (km/h, Richtung in Grad). */
  crestSpeed: Series
  crestDir: Series
  /** Relative Feuchte an der Lee-Talstation (%). */
  leeRh: Series
  /** θ Tal − θ 700 hPa (K). */
  dTheta: Series
}

export interface Criteria {
  pressure: Series
  crest: Series
  dry: Series
  mixed: Series
  /** Anteil erfüllter Kriterien (0–1) — immer von VIER, n. v. zählt nicht als erfüllt. */
  score: Series
  /** Klartext je Stunde für die Werteanzeige („3/4 · 1 n. v."). */
  scoreText: (string | null)[]
  /**
   * Föhnsignal je Stunde: Gradient über der Schwelle UND Kammwind nicht
   * dagegen (fehlt der Kammwind im Modell, entscheidet der Gradient allein).
   * Grundlage der Phasen im Überblick.
   */
  signal: Series
}

const flag = (ok: boolean): number => (ok ? 1 : 0)

export function foehnCriteria(
  input: CriteriaInput,
  direction: FoehnDirection,
  threshold: number,
  limits = FOEHN_LIMITS,
): Criteria {
  const sector = CREST_SECTORS[direction]
  const n = input.dp.length
  const pressure: Series = []
  const crest: Series = []
  const dry: Series = []
  const mixed: Series = []
  const score: Series = []
  const scoreText: (string | null)[] = []
  const signal: Series = []
  for (let i = 0; i < n; i++) {
    const dp = input.dp[i]
    const sp = input.crestSpeed[i]
    const dir = input.crestDir[i]
    const rh = input.leeRh[i]
    const dt = input.dTheta[i]
    const p = dp == null ? null : flag(directed(dp, direction) >= threshold)
    const c =
      sp == null || dir == null ? null : flag(sp >= limits.crestMinSpeedKmh && inSector(dir, sector))
    const d = rh == null ? null : flag(rh <= limits.leeMaxRh)
    const m = dt == null ? null : flag(dt >= limits.minThetaDiff)
    pressure.push(p)
    crest.push(c)
    dry.push(d)
    mixed.push(m)
    const parts = [p, c, d, m]
    const na = parts.filter((v) => v == null).length
    if (na === parts.length) {
      score.push(null)
      scoreText.push(null)
    } else {
      const met = parts.filter((v) => v === 1).length
      score.push(met / parts.length)
      scoreText.push(`${met}/${parts.length}${na > 0 ? ` · ${na} n. v.` : ''}`)
    }
    signal.push(p == null ? null : flag(p === 1 && c !== 0))
  }
  return { pressure, crest, dry, mixed, score, scoreText, signal }
}

export interface FoehnPhase {
  /** Erste und letzte Stunde mit Signal (ms). */
  start: number
  end: number
  /** Stärkster ΔP in Föhnrichtung innerhalb der Phase (hPa, positiv). */
  peak: number
}

/**
 * Zusammenhängende Stunden mit Föhnsignal. Kürzere Folgen als `minHours`
 * fallen weg — ein einzelnes Überschreiten der Schwelle ist Flackern um den
 * Grenzwert, keine Föhnphase.
 */
export function foehnPhases(
  gridMs: number[],
  signal: Series,
  dp: Series,
  direction: FoehnDirection,
  minHours = 3,
): FoehnPhase[] {
  const out: FoehnPhase[] = []
  let start = -1
  const close = (endIdx: number) => {
    if (start < 0) return
    if (endIdx - start + 1 >= minHours) {
      let peak = Number.NEGATIVE_INFINITY
      for (let j = start; j <= endIdx; j++) {
        const v = dp[j]
        if (v != null) peak = Math.max(peak, directed(v, direction))
      }
      out.push({ start: gridMs[start], end: gridMs[endIdx], peak })
    }
    start = -1
  }
  for (let i = 0; i < gridMs.length; i++) {
    if (signal[i] === 1) {
      if (start < 0) start = i
    } else {
      close(i - 1)
    }
  }
  close(gridMs.length - 1)
  return out
}
