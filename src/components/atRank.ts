// Rechenkern der Rangliste (getrennt von der Komponente, damit Fast Refresh
// greift und der Kern testbar bleibt).

/**
 * Indizes der höchsten und niedrigsten Werte (jeweils bis `count`), plus die
 * Zahl der Stationen mit Wert. `top` absteigend, `bottom` aufsteigend vom
 * kleinsten Wert. Die beiden Enden überlappen NIE — bei wenigen Werten stünde
 * sonst dieselbe Station oben und unten in der Liste.
 */
export function rankExtremes(
  values: (number | null)[],
  count: number,
): { top: number[]; bottom: number[]; n: number } {
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) idx.push(i)
  }
  idx.sort((a, b) => (values[b] as number) - (values[a] as number))
  const k = Math.min(count, idx.length)
  return {
    top: idx.slice(0, k),
    bottom: idx.slice(Math.max(k, idx.length - count)).reverse(),
    n: idx.length,
  }
}
