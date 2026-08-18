// Typen für „Stapel aus kleinen Zeitreihen-Diagrammen" (ChartStack.tsx) —
// eigene Datei, damit ChartStack.tsx NUR die Komponente exportiert (React
// Fast Refresh bricht sonst, wenn eine Komponentendatei auch Typen/Werte
// exportiert).

export interface Curve {
  label: string
  color: string
  type: 'line' | 'bars'
  values: (number | null)[]
  /** Gestrichelt statt durchgezogen — z. B. „gefühlt" neben der Ist-Temperatur. */
  dash?: number[]
  /**
   * Nur bei Wind: Richtung in Grad, meteorologische Konvention (Windrichtung,
   * aus der der Wind KOMMT — 0 = Nord, 90 = Ost). Gesetzt → Pfeile werden
   * entlang der Kurve gezeichnet, gedreht auf die Richtung, in die der Wind
   * WEHT (Richtung + 180°), Größe/Deckkraft leicht nach Geschwindigkeit
   * skaliert. Ungesetzt → reine Linie/Balken wie bisher.
   */
  direction?: (number | null)[]
}

/**
 * Alternative zu `curves` für Größen, die als Grauwert-Raster statt als Linie
 * gelesen werden — bislang nur Bewölkung nach Höhenschicht (tief/mittel/hoch,
 * das klassische Meteogramm-Schema aus eingegrauten Pixeln statt einer
 * einzelnen Bewölkungslinie). Reihenfolge = Darstellung von OBEN nach UNTEN.
 */
export interface Bands {
  rows: { label: string; values: (number | null)[] }[]
  /** Einheit der Werte für die Kopfzeile (z. B. „%"). */
  unit: string
  /** Wertebereich für die Graustufen-Skalierung (Standard 0–100). */
  range?: [number, number]
}

/** Ein Diagramm des Stapels: eine gemeinsame y-Achse, 1–2 Kurven — ODER `bands`. */
export interface ChartDef {
  title: string
  unit: string
  curves: Curve[]
  /** y bei 0 verankern (Niederschlag, Sonne, Bewölkung, Wind). */
  zeroBased?: boolean
  /** Feste y-Spanne (Bewölkung/Sonne in %). */
  range?: [number, number]
  /** Gesetzt → Grauwert-Raster statt Linien/Balken, `curves` bleibt dann leer. */
  bands?: Bands
}

export const chartHasData = (c: ChartDef): boolean =>
  c.curves.some((s) => s.values.some((v) => v != null)) ||
  (c.bands?.rows.some((r) => r.values.some((v) => v != null)) ?? false)
