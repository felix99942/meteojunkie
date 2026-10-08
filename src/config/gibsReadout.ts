// Wert am Mauszeiger aus einem EINGEFÄRBTEN GIBS-Bild — Wolkenobergrenzen-
// temperatur im Himawari-Infrarot.
//
// GIBS liefert keine Messwerte, nur Farben. NASA veröffentlicht aber zu jedem
// Layer die FARBTABELLE (Farbe → Temperaturspanne, 237 Einträge von −92 bis
// +57 °C, `colormaps/v1.3/<Name>.xml`, CORS offen). Rückwärts gelesen ergibt
// das die Temperatur — mit zwei Fallen, beide gemessen (2026-10-08, ein
// Termin über Südostasien, 40.000 Pixel):
//
// 1. AUS DEM ANGEZEIGTEN JPEG GEHT ES NICHT. Die Gewittergipfel liegen im
//    farbigen Teil der Tabelle, wo nah beieinanderliegende Farben weit
//    auseinanderliegende Temperaturen bedeuten; JPEG verschmiert genau dort,
//    und der Fehler erreichte p90 = 84 K an Gipfeln unter −30 °C. Gelesen wird
//    deshalb die verlustfreie PNG-KACHEL in GIBS' eigenem Raster (WMTS-Stufe
//    des Layers), ~50 KB, je Termin und Kachel einmal.
// 2. AUCH DIE KACHEL TRIFFT NICHT JEDE TABELLENFARBE. GIBS rechnet sie aus der
//    Quelle um und mischt dabei Nachbarfarben: von den farbigen Pixeln trafen
//    nur 49 % einen Eintrag exakt, die Graustufen liegen oft eine Stufe
//    daneben (107 statt 108). Die Tabelle ist aber ein nach Temperatur
//    geordneter FARBVERLAUF — projiziert man die Farbe auf diesen Verlauf
//    statt auf den nächsten Einzeleintrag, liegen 89 % der farbigen Pixel
//    innerhalb von 10 RGB-Einheiten am Verlauf (Grau: alle innerhalb 1,7).
//    Was weiter weg liegt, ist eine Mischung zweier NICHT benachbarter
//    Abschnitte (typisch am scharfen Wolkenrand) — dort gibt es KEINE Zahl:
//    eine falsche Temperatur wäre schlimmer als keine.

export interface ColorStop {
  rgb: [number, number, number]
  /** Mitte der Spanne (°C) */
  value: number
}

/** Farbtabelle aus der GIBS-XML (nur die Einträge mit Wertspanne, ohne „No Data"). */
export function parseGibsColormap(xml: string): ColorStop[] {
  const out: ColorStop[] = []
  const re = /<ColorMapEntry rgb="(\d+),(\d+),(\d+)"[^>]*?\svalue="[([]([-\d.]+),([-\d.]+)[)\]]"/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    out.push({ rgb: [Number(m[1]), Number(m[2]), Number(m[3])], value: (Number(m[4]) + Number(m[5])) / 2 })
  }
  return out
}

/** Höchster Abstand (RGB-Einheiten) zum Farbverlauf, bis zu dem es noch eine Zahl gibt. */
export const MAX_COLOR_DISTANCE = 10
/** Zwei Deutungen, die näher als das beieinanderliegen, sind dieselbe. */
const SAME_VALUE_K = 4

/**
 * ALLE Werte, die zu einer Farbe passen — und das sind manchmal zwei: die
 * Tabelle benutzt GRAU ZWEIMAL, einmal für warme Flächen (+13 … +57 °C) und
 * einmal als schmales Band für sehr kalte Gipfel (−80 … −70 °C, Weiß über
 * Grau nach Schwarz). Gemessen: das Grau (105, 105, 105) ist +16,7 °C ODER
 * −74,7 °C; die erste Fassung nahm stur den ersten Treffer und zeigte über
 * dem wolkenfreien Golf von Bengalen −75 °C. Je Strecke des Farbverlaufs der
 * projizierte Wert, sofern die Farbe nah genug liegt; Deutungen innerhalb
 * von `SAME_VALUE_K` zählen einmal (die nächstliegende gewinnt).
 */
export function colorCandidates(r: number, g: number, b: number, stops: ColorStop[]): number[] {
  const hits: { v: number; d2: number }[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const [ar, ag, ab] = stops[i].rgb
    const [br, bg, bb] = stops[i + 1].rgb
    const dr = br - ar
    const dg = bg - ag
    const db = bb - ab
    const len2 = dr * dr + dg * dg + db * db
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((r - ar) * dr + (g - ag) * dg + (b - ab) * db) / len2))
    const qr = ar + t * dr - r
    const qg = ag + t * dg - g
    const qb = ab + t * db - b
    const d2 = qr * qr + qg * qg + qb * qb
    if (d2 <= MAX_COLOR_DISTANCE * MAX_COLOR_DISTANCE) {
      hits.push({ v: stops[i].value + (stops[i + 1].value - stops[i].value) * t, d2 })
    }
  }
  hits.sort((x, y) => x.d2 - y.d2)
  const out: number[] = []
  for (const h of hits) if (!out.some((v) => Math.abs(v - h.v) < SAME_VALUE_K)) out.push(h.v)
  return out
}

/** Eindeutiger Wert einer Farbe, sonst null (keine oder mehrere Deutungen). */
export function colorToValue(r: number, g: number, b: number, stops: ColorStop[]): number | null {
  const c = colorCandidates(r, g, b, stops)
  return c.length === 1 ? c[0] : null
}

/** Umkreis (Pixel), in dem mehrdeutige Farben über die Nachbarn entschieden werden. */
export const CONTEXT_RADIUS = 10

/**
 * Wert am Pixel einer Kachel (RGBA). Ist die Farbe mehrdeutig (Grau, s. o.),
 * entscheiden die EINDEUTIGEN Nachbarn im Umkreis: das kalte Grauband liegt
 * immer eingebettet in farbige kalte Gipfel, eine warme Graufläche in Grau
 * bzw. warmen Farben. Gewählt wird die Deutung, die dem Median der Nachbarn
 * am nächsten liegt. Ohne eindeutige Nachbarn gilt die WARME Deutung — eine
 * große zusammenhängende Graufläche ohne jede Farbe ist Boden oder tiefe
 * Wolke, das kalte Band ist dafür viel zu schmal.
 * 'none' = durchsichtig/kein Wert, null = Farbe nicht auf dem Verlauf.
 */
export function valueAtPixel(
  data: ArrayLike<number>,
  size: number,
  px: number,
  py: number,
  stops: ColorStop[],
): number | null | 'none' {
  const at = (x: number, y: number) => 4 * (y * size + x)
  const i = at(px, py)
  if (data[i + 3] === 0) return 'none'
  const cand = colorCandidates(data[i], data[i + 1], data[i + 2], stops)
  if (cand.length <= 1) return cand[0] ?? null
  const ctx: number[] = []
  for (let y = Math.max(0, py - CONTEXT_RADIUS); y <= Math.min(size - 1, py + CONTEXT_RADIUS); y++) {
    for (let x = Math.max(0, px - CONTEXT_RADIUS); x <= Math.min(size - 1, px + CONTEXT_RADIUS); x++) {
      const j = at(x, y)
      if (data[j + 3] === 0) continue
      const v = colorToValue(data[j], data[j + 1], data[j + 2], stops)
      if (v != null) ctx.push(v)
    }
  }
  if (ctx.length === 0) return Math.max(...cand)
  ctx.sort((a, b) => a - b)
  const med = ctx[ctx.length >> 1]
  return cand.reduce((best, v) => (Math.abs(v - med) < Math.abs(best - med) ? v : best))
}

/** Kachel und Pixel darin (Web-Mercator, XYZ) für einen Punkt. */
export function tilePixel(
  lat: number,
  lon: number,
  zoom: number,
  size = 256,
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** zoom
  const fx = ((lon + 180) / 360) * n
  const latR = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180
  const fy = ((1 - Math.asinh(Math.tan(latR)) / Math.PI) / 2) * n
  const x = Math.floor(fx)
  const y = Math.floor(fy)
  return {
    x: ((x % n) + n) % n,
    y: Math.max(0, Math.min(n - 1, y)),
    px: Math.min(size - 1, Math.floor((fx - x) * size)),
    py: Math.min(size - 1, Math.floor((fy - y) * size)),
  }
}
