// Breitenrechnung des ziehbaren Trenners zwischen Ortswahl-Karte und Skew-T
// (`components/ProfileSplit.tsx`).
//
// Eigene Datei, weil es reine Funktionen sind: eine Komponentendatei darf für
// React Fast Refresh nur Komponenten exportieren (dieselbe Trennung wie
// `config/chartDef.ts` ↔ `ChartStack.tsx`), und prüfen lässt sich die Regel
// nur als reine Funktion.

/** Untergrenze der Karte: darunter passt der Alpenbogen nicht mehr hinein. */
export const MIN_MAP_WIDTH = 260
/** Untergrenze des Diagramms: ein Skew-T schmaler als das ist nicht lesbar. */
export const MIN_CHART_WIDTH = 380

/**
 * Gezogene Breite auf das Mögliche begrenzen.
 *
 * Reicht der Platz für beide Mindestbreiten nicht, gewinnt das DIAGRAMM — die
 * Karte ist das Werkzeug zur Auswahl, das Profil der Inhalt; eine Karte, die
 * das Diagramm unlesbar macht, hat ihre Aufgabe verfehlt. Auf einem sehr
 * schmalen Fenster schrumpft die Karte deshalb unter ihre eigene
 * Mindestbreite, statt das Diagramm zu erdrücken (gestapelt wird erst per
 * Media Query darunter).
 */
export function clampMapWidth(width: number, total: number): number {
  const max = total - MIN_CHART_WIDTH
  if (max <= MIN_MAP_WIDTH) return Math.max(0, Math.min(width, max))
  return Math.min(Math.max(width, MIN_MAP_WIDTH), max)
}

/**
 * Startbreite, solange nichts gezogen wurde: gut ein Drittel, nach oben und
 * unten gedeckelt — auf einem breiten Schirm soll die Karte nicht die halbe
 * Fläche nehmen, auf einem schmalen das Diagramm nicht erdrücken.
 */
export function defaultMapWidth(total: number): number {
  return clampMapWidth(Math.min(820, Math.max(420, total * 0.38)), total)
}
