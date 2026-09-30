// PAN-SHARPENING: Farbe aus einem groben RGB, Struktur aus einem feinen
// Breitbandkanal.
//
// Das ist das Verfahren, mit dem Wetterseiten ihr scharfes Farbbild erzeugen
// — und es ist eine RECHNUNG, kein schärferer Download. Natural Colour ist
// ein RGB aus drei SEVIRI-Kanälen (VIS0,8 · VIS0,6 · NIR1,6), alle drei mit
// 3 km; ein RGB kann nie feiner sein als sein gröbster Kanal. Die Schärfe
// kommt deshalb aus einem zweiten Bild, dem hochauflösenden sichtbaren Kanal
// (MTG/FCI HRFI VIS 0,6 µm, gemessen 788 m in Mercator).
//
// VERFAHREN ist das Verhältnisverfahren (Brovey-artig):
//
//     Ergebnis_Kanal = Farbe_Kanal × Pan / Tiefpass(Pan)
//
// `Pan / Tiefpass(Pan)` ist reine HOCHFREQUENZ — ein Faktor um 1, der dort
// über 1 liegt, wo der Pan-Kanal heller ist als seine Umgebung, und darunter,
// wo er dunkler ist. Multipliziert man die Farbe damit, bekommt sie die
// Struktur des feinen Kanals, behält aber ihre FARBVERHÄLTNISSE: Schnee
// bleibt cyan, Vegetation grün, Wolke weiß. Ein Ersetzen der Intensität
// (IHS/Brovey in Reinform) verschöbe die Farben dort, wo Pan und Farbe
// radiometrisch auseinanderlaufen — bei einem NIR-getriebenen RGB gegen einen
// sichtbaren Pan-Kanal ist das die Regel, nicht die Ausnahme.
//
// **Der Tiefpass wird nicht geschätzt, sondern gerechnet**: der Pan-Kanal
// wird auf das native Raster der FARBE heruntergerechnet und wieder
// hochgezogen. Das IST „auf Farbauflösung weichgezeichnet", exakt und ohne
// Filterparameter — und es läuft überall, im Gegensatz zu
// `CanvasRenderingContext2D.filter`, das Safari erst seit 17 kennt.
//
// Die Farbe wird bewusst KLEIN geholt (bei ihrem nativen Raster) und hier
// hochskaliert: feiner anzufordern kostet Bytes und trägt nichts, weil die
// Struktur ohnehin aus dem Pan-Kanal kommt.

/** Grenzen des Verhältnisfaktors. */
const RATIO_MIN = 0.25
const RATIO_MAX = 4

/**
 * Wie stark der Verhältnisfaktor auf die Farbe wirkt. 1 = voll.
 *
 * Bei 1 schlägt jedes Korn des Pan-Kanals voll durch, auch dort, wo es gar
 * keine Farbinformation gibt (über dunklem Wasser etwa wird aus Rauschen
 * sichtbare Struktur). 0,85 nimmt davon spürbar zurück, ohne die Schärfe zu
 * verlieren — am Alpenrand gegen die ungedämpfte Fassung verglichen.
 */
const STRENGTH = 0.85

function canvas2d(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar')
  return ctx
}

/**
 * Setzt Farbbild und Schärfungskanal zu einem Bild zusammen.
 *
 * `colour` darf kleiner sein als `pan` — es wird auf dessen Größe gezogen.
 * Das Ergebnis hat die Größe des Pan-Kanals.
 *
 * `colourMercM` und `panMercM` sind die Rasterweiten in Mercator-Metern;
 * ihr Verhältnis sagt, um wie viel der Pan-Kanal heruntergerechnet werden
 * muss, um den Tiefpass zu bilden.
 */
export async function panSharpen(
  colour: Blob,
  pan: Blob,
  colourMercM: number,
  panMercM: number,
): Promise<Blob> {
  const [colourBmp, panBmp] = await Promise.all([
    createImageBitmap(colour),
    createImageBitmap(pan),
  ])
  const w = panBmp.width
  const h = panBmp.height

  // 1) Pan in voller Auflösung.
  const panCtx = canvas2d(w, h)
  panCtx.drawImage(panBmp, 0, 0)
  const panData = panCtx.getImageData(0, 0, w, h).data

  // 2) TIEFPASS: auf das Raster der Farbe herunter und wieder hoch. Das
  //    Verhältnis der Rasterweiten ist der Faktor; mindestens 2, sonst gäbe
  //    es keine Hochfrequenz zu gewinnen und das Verfahren liefe leer.
  const factor = Math.max(2, Math.round(colourMercM / panMercM))
  const lw = Math.max(1, Math.round(w / factor))
  const lh = Math.max(1, Math.round(h / factor))
  const smallCtx = canvas2d(lw, lh)
  smallCtx.drawImage(panBmp, 0, 0, lw, lh)
  const lowCtx = canvas2d(w, h)
  lowCtx.imageSmoothingEnabled = true
  lowCtx.drawImage(smallCtx.canvas, 0, 0, w, h)
  const lowData = lowCtx.getImageData(0, 0, w, h).data

  // 3) Farbe auf die Zielgröße ziehen — hier ist Glätten richtig, die Farbe
  //    HAT keine feinere Struktur, sie soll nur keine Klötze zeigen.
  const outCtx = canvas2d(w, h)
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(colourBmp, 0, 0, w, h)
  const out = outCtx.getImageData(0, 0, w, h)
  const d = out.data

  colourBmp.close()
  panBmp.close()

  for (let i = 0; i < d.length; i += 4) {
    // Graustufenbild: der Rotkanal genügt, R=G=B.
    const low = lowData[i]
    if (low === 0) continue
    let ratio = panData[i] / low
    if (ratio < RATIO_MIN) ratio = RATIO_MIN
    else if (ratio > RATIO_MAX) ratio = RATIO_MAX
    const g = 1 + (ratio - 1) * STRENGTH
    const r0 = d[i] * g
    const g0 = d[i + 1] * g
    const b0 = d[i + 2] * g
    d[i] = r0 > 255 ? 255 : r0
    d[i + 1] = g0 > 255 ? 255 : g0
    d[i + 2] = b0 > 255 ? 255 : b0
  }
  outCtx.putImageData(out, 0, 0)

  // JPEG wie überall in diesem Bereich: das Ergebnis ist deckend, und ein
  // PNG wäre ein Vielfaches an Bytes für jedes Bild der Schleife.
  return await new Promise<Blob>((resolve, reject) => {
    outCtx.canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild nicht kodierbar'))),
      'image/jpeg',
      0.9,
    )
  })
}
