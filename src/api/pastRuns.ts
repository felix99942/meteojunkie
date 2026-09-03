// Reiner Kern der Verifikations-Abrufe: Typ, Cache-Schlüssel und Zuschnitt.
//
// Getrennt von `openmeteo.ts`, wie `verify.ts` von `VerifyPanel.tsx` — dort
// hängt der Fetch-Layer an `window` (Mock-Modus liest die Query), und diese
// Funktionen sollen ohne Browser testbar sein. Der Zuschnitt ist genau die
// Stelle, an der ein Fehler still bliebe: eine gegen die Zeitachse verrutschte
// Lead-Reihe sähe plausibel aus und wäre um Stunden verschoben.

export interface PastRunSeries {
  /** Höhe, auf die die API gerechnet hat (m) — gehört in die Beschriftung. */
  elevation: number | null
  /** Zeitachse in Epoch-ms (UTC), stündlich. */
  timeMs: number[]
  /** Bester verfügbarer Wert je Zeitpunkt — die jüngste Vorhersage. */
  best: (number | null)[]
  /** Vorlauf in Tagen → Werte, die damals für denselben Zeitpunkt galten. */
  byLead: Map<number, (number | null)[]>
}

/**
 * Basis-Schlüssel ohne Zeitraum: alles, was die Reihe sonst bestimmt. Der
 * Zeitraum bleibt bewusst draußen, damit ein bereits geholter GRÖSSERER
 * Zeitraum für einen kleineren wiederverwendet werden kann.
 */
export function runsBaseKey(
  lat: number,
  lon: number,
  model: string,
  variable: string,
  leads: number[],
  elevation?: number | null,
): string {
  const elev = elevation != null && Number.isFinite(elevation) ? Math.round(elevation) : 'auto'
  return `verify|${lat.toFixed(4)}|${lon.toFixed(4)}|${model}|${variable}|${leads.join('.')}|${elev}`
}

/**
 * Reihe auf einen Zeitraum zuschneiden. Die Datumsgrenzen sind ganze UTC-Tage:
 * `start` 00:00 bis `end` 23:59 — genau das, was ein Request mit diesen
 * `start_date`/`end_date` geliefert hätte.
 *
 * ALLE Reihen werden über DIESELBEN Indizes geschnitten, nicht jede für sich —
 * sonst könnte eine Lead-Reihe gegen die Zeitachse verrutschen.
 */
export function sliceRuns(series: PastRunSeries, start: string, end: string): PastRunSeries {
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`) + 86400_000
  const keep: number[] = []
  for (let i = 0; i < series.timeMs.length; i++) {
    const t = series.timeMs[i]
    if (t >= from && t < to) keep.push(i)
  }
  const pick = (arr: (number | null)[]) => keep.map((i) => arr[i] ?? null)
  const byLead = new Map<number, (number | null)[]>()
  for (const [n, vals] of series.byLead) byLead.set(n, pick(vals))
  return {
    elevation: series.elevation,
    timeMs: keep.map((i) => series.timeMs[i]),
    best: pick(series.best),
    byLead,
  }
}
