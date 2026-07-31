// Rechenkern der Ensemble-Plume: aus den Mitgliedsreihen die Verteilungsbänder.
// Rein, ohne DOM/uPlot — damit testbar (npm test).
//
// Konvention: `members[m][t]` = Wert von Mitglied m zum Zeitschritt t; null =
// Lücke. Je Zeitschritt werden NUR die vorhandenen Mitglieder ausgewertet —
// ein fehlendes Mitglied darf den Median nicht nach unten ziehen.

/** Perzentil einer AUFSTEIGEND sortierten Liste, linear interpoliert. */
export function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export interface PlumeStats {
  /** Je Zeitschritt: Anzahl Mitglieder mit Wert. */
  count: number[]
  min: (number | null)[]
  p10: (number | null)[]
  p25: (number | null)[]
  median: (number | null)[]
  p75: (number | null)[]
  p90: (number | null)[]
  max: (number | null)[]
}

/** Verteilungsbänder über alle Mitglieder, Zeitschritt für Zeitschritt. */
export function plumeStats(members: (number | null)[][]): PlumeStats {
  const nt = members.reduce((n, m) => Math.max(n, m.length), 0)
  const out: PlumeStats = {
    count: new Array(nt).fill(0),
    min: new Array(nt).fill(null),
    p10: new Array(nt).fill(null),
    p25: new Array(nt).fill(null),
    median: new Array(nt).fill(null),
    p75: new Array(nt).fill(null),
    p90: new Array(nt).fill(null),
    max: new Array(nt).fill(null),
  }
  const buf: number[] = []
  for (let t = 0; t < nt; t++) {
    buf.length = 0
    for (const m of members) {
      const v = m[t]
      if (v != null && Number.isFinite(v)) buf.push(v)
    }
    out.count[t] = buf.length
    if (buf.length === 0) continue
    buf.sort((a, b) => a - b)
    out.min[t] = buf[0]
    out.max[t] = buf[buf.length - 1]
    out.p10[t] = percentileOf(buf, 0.1)
    out.p25[t] = percentileOf(buf, 0.25)
    out.median[t] = percentileOf(buf, 0.5)
    out.p75[t] = percentileOf(buf, 0.75)
    out.p90[t] = percentileOf(buf, 0.9)
  }
  return out
}

/**
 * Stundenwerte je Mitglied zur Summenkurve aufaddieren (Niederschlag,
 * Schneefall). Lücken zählen als 0, brechen die Summe also nicht ab — die
 * Kurve bleibt monoton, was für eine Summendarstellung die einzige lesbare
 * Variante ist.
 */
export function accumulateMembers(members: (number | null)[][]): (number | null)[][] {
  return members.map((m) => {
    let sum = 0
    return m.map((v) => {
      if (v != null && Number.isFinite(v)) sum += v
      return sum
    })
  })
}

/** Kennzahlen an EINEM Zeitschritt — für die Ablesezeile am Cursor. */
export interface PlumeReadout {
  count: number
  min: number
  p10: number
  median: number
  p90: number
  max: number
  /** Spannweite p10…p90 als Maß für die Unsicherheit. */
  spread: number
}

export function readoutAt(stats: PlumeStats, t: number): PlumeReadout | null {
  if (t < 0 || t >= stats.count.length || stats.count[t] === 0) return null
  const p10 = stats.p10[t] as number
  const p90 = stats.p90[t] as number
  return {
    count: stats.count[t],
    min: stats.min[t] as number,
    p10,
    median: stats.median[t] as number,
    p90,
    max: stats.max[t] as number,
    spread: p90 - p10,
  }
}
