// Rechenkern der Rangliste (getrennt von der Komponente, damit Fast Refresh
// greift und der Kern testbar bleibt).
//
// Der Rang wird IMMER über alle Stationen mit Wert gebildet — Suchfilter und
// Sortierung der Tabelle ändern nur, was angezeigt wird, nie die Rangzahl.
// Sonst würde „Rang 3" je nach Suchbegriff etwas anderes bedeuten.

/** Eine Station in der Reihung: Index in der Ursprungsliste, Wert, Rang (1 = höchster). */
export interface RankEntry {
  idx: number
  value: number
  rank: number
}

/** Alle Stationen mit gültigem Wert, absteigend gereiht und mit Rang versehen. */
export function rankAll(values: (number | null)[]): RankEntry[] {
  const entries: { idx: number; value: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) entries.push({ idx: i, value: v })
  }
  entries.sort((a, b) => b.value - a.value)
  return entries.map((e, i) => ({ ...e, rank: i + 1 }))
}

/**
 * Die beiden Enden der Reihung: `top` absteigend (höchster zuerst), `bottom`
 * aufsteigend (niedrigster zuerst). Die Enden überlappen NIE — bei wenigen
 * Werten stünde sonst dieselbe Station oben und unten in der Liste.
 */
export function extremes(
  ranked: RankEntry[],
  count: number,
): { top: RankEntry[]; bottom: RankEntry[] } {
  const k = Math.min(count, ranked.length)
  return {
    top: ranked.slice(0, k),
    bottom: ranked.slice(Math.max(k, ranked.length - count)).reverse(),
  }
}

export interface RankSummary {
  n: number
  min: number
  max: number
  mean: number
  median: number
}

/** Kennzahlen der Auswahl — Kontext zur Frage „ist der Spitzenwert ein Ausreißer?". */
export function summarize(ranked: RankEntry[]): RankSummary | null {
  const n = ranked.length
  if (n === 0) return null
  const sum = ranked.reduce((a, e) => a + e.value, 0)
  // ranked ist absteigend sortiert → Median direkt aus der Mitte.
  const mid = n >> 1
  const median = n % 2 === 1 ? ranked[mid].value : (ranked[mid - 1].value + ranked[mid].value) / 2
  return { n, min: ranked[n - 1].value, max: ranked[0].value, mean: sum / n, median }
}
