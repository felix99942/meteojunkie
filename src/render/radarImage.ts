// Nachbearbeitung der DWD-Radarbilder: die magentafarbene Randlinie.
// Der Dienst zeichnet entlang der
// Außengrenze des Radargebiets eine ein Pixel breite Linie in **#FB00FF**,
// einer Farbe, die in keiner seiner Legenden vorkommt (Werte außerhalb der
// Farbtabelle) — an der Grenze zwischen „keine Daten" (Rasterwert −999, über
// GetFeatureInfo geprüft) und dem Messgebiet. NICHT ein Artefakt unserer
// Anfrage: die Linie steht bei 110 m/px genauso da wie bei 1,1 km/px. Sie
// liest sich GENAU FALSCH — kräftiges Magenta sitzt in jeder Radarskala am
// oberen Ende (Hagel, Wolkenbruch), hier markiert es das Gegenteil: den Rand
// des Gebiets, über das nichts bekannt ist. Umgefärbt wird auf die Farbe der
// „Keine Daten"-Maske, nicht auf transparent: die Linie GEHÖRT zum unbekannten
// Bereich.
//
/** Farbe der „Keine Daten"-Maske beider Produktstile (#7D7D7D). */
const MASK_RGB: [number, number, number] = [125, 125, 125]
/** Out-of-colormap-Farbe der Randlinie (#FB00FF). */
const EDGE_RGB: [number, number, number] = [251, 0, 255]
/** Zulässiger Abstand zur erwarteten Mischfarbe, je Kanal. */
const EDGE_TOLERANCE = 12

function maskAlphaOf(opacity: number): number {
  return Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
}

/**
 * Ist das Pixel Teil der Randlinie? Geprüft wird nicht „irgendwie magenta",
 * sondern ob die Farbe auf der MISCHLINIE zwischen Maskengrau und #FB00FF
 * liegt — die weichgezeichneten Ränder der Linie tun das, die Skalenfarben
 * nicht.
 *
 * Das ist der Unterschied, an dem eine gröbere Regel scheitert: die
 * dBZ-Skala führt **#FF33FF für 75–85 dBZ**, also eine echte Klassenfarbe, die
 * jedem „r hoch, g niedrig, b hoch"-Test in die Falle geht. Auf der Mischlinie
 * liegt sie nicht (bei ihrem Grünwert wären r ≈ 200 zu erwarten, nicht 255),
 * und genau daran werden beide auseinandergehalten.
 */
function isEdgePixel(r: number, g: number, b: number): boolean {
  if (g >= MASK_RGB[1]) return false // kein Anteil der Linie
  const t = (MASK_RGB[1] - g) / MASK_RGB[1]
  if (t > 1.02) return false
  const expR = MASK_RGB[0] + (EDGE_RGB[0] - MASK_RGB[0]) * t
  const expB = MASK_RGB[2] + (EDGE_RGB[2] - MASK_RGB[2]) * t
  return Math.abs(r - expR) <= EDGE_TOLERANCE && Math.abs(b - expB) <= EDGE_TOLERANCE
}

function paintMask(data: Uint8ClampedArray, i: number, alpha: number): void {
  data[i] = MASK_RGB[0]
  data[i + 1] = MASK_RGB[1]
  data[i + 2] = MASK_RGB[2]
  data[i + 3] = alpha
}

/**
 * Färbt die Randlinie auf die Maskenfarbe um; gibt die Zahl der geänderten
 * Pixel zurück (für Diagnose, nicht für die Anzeige). `maskOpacity` kommt aus
 * dem Produkt (WN 0,5 · RV 0,3) — die Deckkraft weichgezeichneter Ränder
 * bleibt anteilig erhalten, damit die Kante nicht plötzlich hart wird.
 */
export function maskRadarEdge(data: Uint8ClampedArray, maskOpacity: number): number {
  const full = maskAlphaOf(maskOpacity)
  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    if (!isEdgePixel(data[i], data[i + 1], data[i + 2])) continue
    paintMask(data, i, a === 255 ? full : Math.round((full * a) / 255))
    changed++
  }
  return changed
}
