// Nachbearbeitung der DWD-Radarbilder: die magentafarbene Randlinie.
//
// Der Dienst zeichnet entlang der AUSSENGRENZE des Radargebiets eine ein Pixel
// breite Linie in **#FB00FF**, einer Farbe, die in seiner eigenen Legende
// überhaupt nicht vorkommt (dort endet die Skala bei #0000FE für ≥ 150 mm/h).
// Es sind Werte außerhalb der Farbtabelle — an der Grenze zwischen „keine
// Daten" (Rasterwert −999, live über GetFeatureInfo geprüft) und dem
// Messgebiet. NICHT ein Artefakt unserer Anfrage: die Linie steht auch bei
// 110 m/px genauso da wie bei 1,1 km/px, ist also im Produkt.
//
// Sie muss weg, weil sie GENAU FALSCH liest: kräftiges Magenta sitzt in jeder
// Radarskala am oberen Ende (Hagel, Wolkenbruch), hier markiert es aber das
// Gegenteil — den Rand des Gebiets, über das nichts bekannt ist. Umgefärbt
// wird deshalb auf die Farbe der „Keine Daten"-Maske, und nicht auf
// transparent: die Linie GEHÖRT zum unbekannten Bereich.

/** Farbe der „Keine Daten"-Maske des Produktstils (#7D7D7D bei 30 %). */
const MASK_RGB: [number, number, number] = [125, 125, 125]
const MASK_ALPHA = 77

/**
 * Färbt die Randlinie auf die Maskenfarbe um; gibt die Zahl der geänderten
 * Pixel zurück (für Diagnose, nicht für die Anzeige).
 *
 * Die Bedingung trennt sicher von der echten Skala: der höchste Rotanteil
 * einer Legendenfarbe mit hohem Blauanteil ist #CC0098 (204), die Schwelle
 * liegt bei 230 — #FF4501, #FE0000 und #E5004C haben zu wenig Blau, #6600CB
 * und #0000FE zu wenig Rot. Weichgezeichnete Ränder der Linie werden
 * mitgenommen, ihre Deckkraft aber beibehalten (auf die Maske skaliert),
 * damit die Kante nicht plötzlich hart wird.
 */
export function maskRadarEdge(data: Uint8ClampedArray): number {
  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    if (data[i] >= 230 && data[i + 1] <= 60 && data[i + 2] >= 230) {
      data[i] = MASK_RGB[0]
      data[i + 1] = MASK_RGB[1]
      data[i + 2] = MASK_RGB[2]
      data[i + 3] = a === 255 ? MASK_ALPHA : Math.round((MASK_ALPHA * a) / 255)
      changed++
    }
  }
  return changed
}
