// Typen für „Stapel aus kleinen Zeitreihen-Diagrammen" (ChartStack.tsx) —
// eigene Datei, damit ChartStack.tsx NUR die Komponente exportiert (React
// Fast Refresh bricht sonst, wenn eine Komponentendatei auch Typen/Werte
// exportiert).

/**
 * Achsenbreiten, die JEDE Zeile eines Stapels links und rechts reserviert —
 * dadurch liegen die Zeitachsen aller Zeilen deckungsgleich übereinander.
 * Hier und nicht in ChartStack.tsx, weil eine Komponentendatei für React Fast
 * Refresh nur Komponenten exportieren darf; die Zeitleiste zwischen zwei
 * Zeilen muss dieselben Werte kennen, um den Zeiger zu treffen.
 */
export const Y_AXIS_SIZE = 44
export const RIGHT_AXIS_SIZE = 34

export interface Curve {
  label: string
  color: string
  type: 'line' | 'bars'
  values: (number | null)[]
  /** Gestrichelt statt durchgezogen — z. B. Böen neben der mittleren Windgeschwindigkeit. */
  dash?: number[]
  /** Linienbreite in px (Standard 1.5) — dünner für Nebenkurven wie den Taupunkt. */
  width?: number
  /** Fläche unter der Kurve mit dieser Deckkraft (0–1), z. B. Niederschlagswahrscheinlichkeit. */
  fill?: number
  /**
   * Kurve hängt an der RECHTEN y-Achse (`ChartDef.rightAxis`) statt an der
   * linken — für eine zweite Größe mit anderer Einheit in derselben Zeile
   * (Wahrscheinlichkeit in % neben Niederschlag in mm/h), wie es die
   * Meteogramme der Wetterdienste machen.
   */
  rightAxis?: true
  /**
   * Nur bei Wind: Richtung in Grad, meteorologische Konvention (Richtung, aus
   * der der Wind KOMMT — 0 = Nord, 90 = Ost). Gesetzt → im oberen Bereich des
   * Diagramms wird ein Streifen mit WINDFIEDERN (Windbarbs) gezeichnet, die
   * Richtung und Stärke in Knoten tragen (WMO-Konvention der Wetterdienste).
   */
  direction?: (number | null)[]
}

/**
 * Alternative zu `curves` für die Bewölkung: je Zeile und Zeitschritt EIN
 * WMO-Stationskreis mit dem Bedeckungsgrad in ACHTELN (0/8 leer bis 8/8 voll)
 * — die Darstellung der Wetterdienste. Zeilen von OBEN nach UNTEN, im
 * Meteogramm Gesamt/Hoch/Mittel/Tief (die Schichten in der Reihenfolge, in
 * der sie am Himmel stehen). Die Zeilenbeschriftung übernimmt die linke
 * y-Achse, damit die Fläche selbst nur die Symbole trägt.
 */
export interface OctaRows {
  rows: {
    label: string
    /** Bedeckung in PROZENT — die Umrechnung in Achtel macht der Zeichner. */
    values: (number | null)[]
    /** Zusätzlich die Achtel-Zahl neben dem Kreis (nur für die Gesamtzeile). */
    withNumber?: true
  }[]
}

/**
 * Hervorgehobener Einzelpunkt mit Beschriftung — im klassischen Meteogramm
 * das TAGESMAXIMUM der Temperatur: ein Punkt auf der Kurve plus die Zahl
 * daneben. Die Tageshöchstwerte sind die eine Größe, die man aus einem
 * Meteogramm ablesen WILL, ohne die Kurve gegen die Achse zu peilen.
 */
export interface PointMark {
  /** Zeitpunkt in SEKUNDEN — uPlots x-Einheit, nicht die interne ms-Zeit. */
  t: number
  value: number
  label: string
  /**
   * Zeitspanne (Sekunden), zu der der Punkt gehört — beim Tagesmaximum der
   * Kalendertag von 00 bis 00 UTC. Die BESCHRIFTUNG wird in diese Spanne
   * hineingezogen: bei einem inversen Tagesgang liegt das Maximum am
   * Tagesrand (etwa um 00 UTC), die Zahl stünde sonst über der Tagesgrenze
   * und ließe sich dem falschen Tag zuordnen. Der PUNKT bleibt exakt auf
   * seinem Zeitpunkt.
   */
  spanStart?: number
  spanEnd?: number
}

/** Ein Satz gleichfarbiger Punktmarken (Tagesmaxima bzw. -minima). */
export interface MarkSet {
  points: PointMark[]
  color: string
  /**
   * Bevorzugte Lage der Beschriftung. Maxima werden über den Punkt gesetzt,
   * Minima darunter — sonst stünde die Zahl im Kurvenbogen statt außerhalb.
   * Reicht der Platz auf der bevorzugten Seite nicht, wird gespiegelt.
   */
  place?: 'above' | 'below'
}

/** Wettersymbol-Zeile (WMO-Code je Stunde) — eigene, schmale Zeile ganz oben. */
export interface Symbols {
  codes: (number | null)[]
  /** 1 = Tag, 0 = Nacht (Open-Meteo `is_day`) — steuert Sonne vs. Mond im Symbol. */
  isDay?: (number | null)[]
}

/** Ein Diagramm des Stapels: eine gemeinsame y-Achse, 1–n Kurven — ODER `bands`/`symbols`. */
export interface ChartDef {
  title: string
  unit: string
  curves: Curve[]
  /** y bei 0 verankern (Niederschlag, Sonne, Bewölkung, Wind). */
  zeroBased?: boolean
  /** Feste y-Spanne (Bewölkung/Sonne in %). */
  range?: [number, number]
  /**
   * UNTERGRENZE für das obere Achsenende bei `zeroBased`-Zeilen. Die Skala ist
   * dynamisch (ein 25-mm/h-Ereignis zieht sie mit), aber ohne diesen Boden
   * kippt sie im Gegenteil: bei 0,2 mm/h Nieselregen liefe die Achse bis 0,22
   * und ein Hauch Sprühregen sähe aus wie ein Wolkenbruch. Der Boden hält
   * schwache Ereignisse optisch schwach; darüber wächst die Achse frei mit.
   */
  minTop?: number
  /**
   * Mindestspanne der y-Achse in Datenwerten — für Größen, die über Tage nur
   * wenige Einheiten schwanken (Luftdruck). Ohne sie legt uPlot bei einer
   * Spanne von 5 hPa eine Achse mit einer EINZIGEN Beschriftung an, an der
   * sich nichts ablesen lässt.
   */
  minSpan?: number
  /** Mindestabstand der y-Ticks in Pixeln (Standard 30) — kleiner = mehr Beschriftungen. */
  ySpace?: number
  /**
   * Feste Schrittweite der y-Achse in Datenwerten (Temperatur: 5 K, also
   * …, 5, 10, 15, …). Zieht die Skala zusätzlich auf Vielfache dieser
   * Schrittweite auf, damit die Ticks auch wirklich auf runden Werten liegen
   * und nicht auf 3,7 / 8,7 / 13,7. Wird es zu eng, weicht uPlot auf das
   * Doppelte bzw. Vierfache aus, statt Beschriftungen übereinander zu setzen.
   */
  yStep?: number
  /** Gesetzt → Achtel-Kreise statt Linien/Balken, `curves` bleibt dann leer. */
  octaRows?: OctaRows
  /** Gesetzt → Wettersymbol-Zeile, `curves` bleibt leer. */
  symbols?: Symbols
  /**
   * 1 = Tag, 0 = Nacht: Nachtstunden werden flächig abgedunkelt — die
   * Tag/Nacht-Schattierung ist fester Bestandteil jedes klassischen
   * Meteogramms und beantwortet „fällt das Minimum vor oder nach
   * Sonnenaufgang" ohne eine einzige Zahl.
   */
  night?: (number | null)[]
  /** Beschriftete Einzelpunkte auf der Kurve (Tagesmaxima und -minima der Temperatur). */
  marks?: MarkSet[]
  /** Kurzer Hinweis in der Kopfzeile, z. B. der Bezugszeitraum der Extremwerte. */
  note?: string
  /** Waagrechte Bezugslinie, z. B. die 0-°C-Frostgrenze. */
  refLines?: { value: number; color: string; dash?: number[] }[]
  /** Rechte y-Achse für Kurven mit `rightAxis`. */
  rightAxis?: { unit: string; range: [number, number] }
  /**
   * Anteil der Diagrammhöhe, der OBEN freigehalten wird (0–1) — für den
   * Windfiedern-Streifen. Die y-Skala wird entsprechend gestreckt, damit die
   * Kurve dort nie hineinläuft: sonst verschwindet die Spitze hinter den
   * Fiedern und sieht aus, als liefe sie aus der Skala.
   */
  topReserve?: number
  /**
   * Keine Stundenachse und kein Datumsstreifen unter dieser Zeile — die
   * Tagesgrenz-Linie bleibt. Für die Wettersymbolzeile: die Uhrzeiten stehen
   * unter jedem anderen Parameter ohnehin, hier fraßen sie nur die Höhe, die
   * die Symbole brauchen.
   */
  hideXAxis?: true
  /**
   * Kein Fadenkreuz und keine Werteanzeige in dieser Zeile — für die
   * Wettersymbolzeile: das Symbol IST dort der Wert, die Cursorlinie schnitte
   * mitten hindurch und der Klartext im Kästchen verdeckte genau das Symbol,
   * das man ansehen will. Der Cursor-Sync bleibt bestehen: über diese Zeile zu
   * fahren beschriftet die übrigen weiterhin.
   */
  hideCursor?: true
  /** Relative Zeilenhöhe im Stapel (CSS `flex-grow`), Standard 1. */
  flex?: number
}

export const chartHasData = (c: ChartDef): boolean =>
  c.curves.some((s) => s.values.some((v) => v != null)) ||
  (c.octaRows?.rows.some((r) => r.values.some((v) => v != null)) ?? false) ||
  (c.symbols?.codes.some((v) => v != null) ?? false)
