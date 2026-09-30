// Wolken über echten Boden legen — der „sat24-Blick".
//
// AUSGANGSLAGE: die beiden Graustufen-Kanäle von MTG (sichtbar 0,6 µm und
// Infrarot 10,5 µm) sind DECKENDE Bilder. Wo keine Wolke ist, zeigen sie den
// Boden so, wie der Kanal ihn misst — beim sichtbaren Kanal ein dunkles,
// kontrastarmes Grau, beim Infrarot eine Temperaturfläche. Beides ist
// physikalisch richtig und als Anblick nutzlos: man erkennt nicht, WO die
// Wolke steht.
//
// LÖSUNG ist dieselbe wie bei jedem Wetterdienst, der so ein Bild zeigt: die
// Helligkeit wird zur DECKKRAFT. Hell (Wolke) bleibt stehen, dunkel
// (wolkenfrei) wird durchsichtig, darunter liegt ein echtes, wolkenfreies
// Satellitenbild des Bodens (NASA Blue Marble, `config/ground.ts`).
//
// **WARUM DAS EINE KURVE BRAUCHT UND KEINEN SCHWELLWERT**: mit einer harten
// Grenze bekäme jede Wolkenkante eine Treppe, und dünner Zirrus — der die
// Sonne dämpft, aber den Boden durchscheinen lässt — wäre entweder ganz da
// oder ganz weg. Die Rampe zwischen `min` und `max` bildet genau das ab, was
// der Kanal misst: teilweise bedeckt = teilweise deckend.
//
// **WARUM DER SICHTBARE KANAL MIT DEM SONNENSTAND SKALIERT WIRD**: er misst
// reflektiertes Sonnenlicht, seine Helligkeit hängt also am Einfallswinkel.
// Dieselbe Wolke ist mittags doppelt so hell wie zwei Stunden vor Sonnen-
// untergang; mit festen Schwellen löste sich die Bewölkung im Tagesverlauf
// langsam auf. Gemessen (2026-09-21, 11 UTC, Sonnenhöhe ~40°, Detailfläche):
// wolkenfreier Boden liegt bei 37–70, Wolke ab ~90, dicke Wolke über 130 —
// geteilt durch sin(40°) = 0,64 ergibt das die Schwellen unten, die für JEDE
// Tageszeit gelten. Nach unten gedeckelt (`MIN_SUN_FACTOR`), sonst zöge die
// Rampe bei tiefstehender Sonne gegen null und das ganze Bild würde Wolke.
//
// **DAS INFRAROT SKALIERT NICHT** — es misst Wärmestrahlung, Tag und Nacht
// gleich. Dafür hat es eine andere Schwäche, und die ist bekannt: WARME tiefe
// Wolken (Hochnebel, Stratus) sind im Infrarot kaum heller als der Boden und
// werden hier blass. Wer sie sucht, nimmt den sichtbaren Kanal oder
// Geocolour. Umgekehrt kann im Winter sehr kalter Boden wie Wolke aussehen.
// Beides ist dem Verfahren eigen und keine Fehlfunktion.
//
// **GEOCOLOUR UND DIE MSG-RGBs BLEIBEN UNANGETASTET**: Geocolour bringt
// seinen eigenen Boden mit und sieht am Tag ohnehin wie echte Farben aus; die
// RGBs sind Deutungsbilder, in denen jede Farbe etwas bedeutet — ihnen die
// Deckkraft zu nehmen, zerstörte die Aussage.

import type { CloudMaskSpec, SatelliteProduct } from '../config/satellite'
import { productArea, productMerc } from '../config/satellite'
import { GROUND_BOUNDS, GROUND_URL } from '../config/ground'
import { mercBox, type MercBox } from '../config/wmsTime'
import { solarElevationDeg } from '../lib/solar'

/**
 * **UNTERHALB DIESER SONNENHÖHE WIRD NICHT ZUSAMMENGESETZT**, und das ist
 * gemessen (2026-09-21, fünf Zeitpunkte über den Tag, Detailfläche, jeweils
 * Perzentile des Grauwerts gegen die Sonnenhöhe):
 *
 *   Sonne   sin     Boden (p20)   Wolke (p90)   p20/sin   p90/sin
 *    40,0°  0,641        65           134          101       209
 *    24,9°  0,421        42           109          100       259
 *    21,0°  0,359        37            74          103       206
 *     7,0°  0,122        25            64          204       523
 *     2,6°  0,045         4            21           90       472
 *
 * Zwischen 21° und 40° ist die Normierung mit dem Sinus fast exakt (p20/sin
 * bleibt bei 100–103) — genau dafür ist sie da. Darunter bricht sie in BEIDE
 * Richtungen: bei 7° lägen die mitgezogenen Schwellen unter dem Boden und die
 * ganze Fläche würde zur Wolke, bei 2,6° darüber und die ganze Fläche würde
 * wolkenfrei. Beides ist schlimmer als das rohe Bild, das bei diesem
 * Sonnenstand ohnehin fast schwarz ist (p98 = 27). Also: darunter das
 * Messbild unverändert zeigen.
 */
export const MIN_SUN_DEG = 10

/** Sinus dieser Grenze — die Schwellen sinken nie tiefer. */
export const MIN_SUN_FACTOR = Math.sin((MIN_SUN_DEG * Math.PI) / 180)

/** Ausschnitt eines Untergrundbildes in dessen eigenen Bildpixeln. */
export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * Welcher Teil des Untergrundbildes unter das Satellitenbild gehört.
 *
 * Beide liegen in EPSG:3857 und werden LINEAR aufgespannt — die Rechnung ist
 * deshalb ein reiner Dreisatz über die Mercator-Kanten, ohne Projektion.
 * Wichtig ist nur die Richtung der y-Achse: Mercator zählt nach NORDEN,
 * Bildzeilen zählen nach UNTEN.
 */
export function groundSourceRect(
  ground: MercBox,
  target: MercBox,
  imgW: number,
  imgH: number,
): SourceRect {
  const gw = ground.maxx - ground.minx
  const gh = ground.maxy - ground.miny
  return {
    sx: ((target.minx - ground.minx) / gw) * imgW,
    sy: ((ground.maxy - target.maxy) / gh) * imgH,
    sw: ((target.maxx - target.minx) / gw) * imgW,
    sh: ((target.maxy - target.miny) / gh) * imgH,
  }
}

/**
 * Die Schwellen DIESES Bildes. Beim sichtbaren Kanal wandern sie mit dem
 * Sonnenstand (Begründung oben), beim Infrarot stehen sie fest.
 */
export function maskRange(
  mask: CloudMaskSpec,
  solarElevation: number,
): { min: number; max: number } {
  if (!mask.solarScaled) return { min: mask.min, max: mask.max }
  const f = Math.max(MIN_SUN_FACTOR, Math.sin((solarElevation * Math.PI) / 180))
  return { min: mask.min * f, max: mask.max * f }
}

/**
 * Nachschlagetabelle Helligkeit → Deckkraft. Als Tabelle, weil die Schleife
 * darunter über mehrere Millionen Pixel läuft und dort jede Rechnung zählt.
 */
export function cloudAlphaLut(min: number, max: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const span = Math.max(1, max - min)
  for (let v = 0; v < 256; v++) lut[v] = ((v - min) / span) * 255
  return lut
}

// --- Canvas-Teil -----------------------------------------------------------

let groundPromise: Promise<ImageBitmap> | null = null

/** Das Untergrundbild, einmal je Sitzung geladen und dekodiert. */
function loadGround(): Promise<ImageBitmap> {
  groundPromise ??= fetch(GROUND_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Untergrund: HTTP ${r.status}`)
      return r.blob()
    })
    .then((b) => createImageBitmap(b))
    .catch((err: unknown) => {
      // Nicht merken: ein Aussetzer soll den Bereich nicht für die ganze
      // Sitzung auf den Rückfall festnageln.
      groundPromise = null
      throw err
    })
  return groundPromise
}

// Zwei Leinwände, einmal angelegt und wiederverwendet: bei 2000×2686 sind das
// je rund 21 MB, und eine neue je Bild wäre Arbeit für den Speicherbereiniger
// im Sekundentakt.
let outCanvas: HTMLCanvasElement | null = null
let cloudCanvas: HTMLCanvasElement | null = null

function sized(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const canvas = c ?? document.createElement('canvas')
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  return canvas
}

/**
 * Ein Bild des Dienstes in das Komposit „Wolken über Boden" verwandeln.
 *
 * Läuft EINMAL je geladenem Bild, nicht bei jedem Anzeigen — die Schleife
 * spielt danach fertige Bilder ab. Heraus kommt wieder ein JPEG: das Komposit
 * ist deckend (der Boden steckt drin), Alpha wird also nicht gebraucht, und
 * PNG wäre hier das Vielfache an Bytes (dieselbe Rechnung wie beim Abruf).
 */
export async function compositeClouds(
  product: SatelliteProduct,
  mask: CloudMaskSpec,
  time: number,
  blob: Blob,
): Promise<Blob> {
  const area = productArea(product)
  const elevation = solarElevationDeg(
    time,
    (area.south + area.north) / 2,
    (area.west + area.east) / 2,
  )
  // BEI TIEFER SONNE NICHT ZUSAMMENSETZEN (Messung an `MIN_SUN_DEG`), und
  // nachts erst recht nicht: dort liefert der Kanal ein schwarzes Bild, die
  // Deckkraft wäre überall null — heraus käme der blanke Untergrund, also eine
  // Karte, die wolkenlos aussieht, obwohl nichts gemessen wurde. Das rohe Bild
  // ist die ehrliche Anzeige; der Bereich sagt daneben, warum
  // (`.satellite-night`).
  if (mask.solarScaled && elevation < MIN_SUN_DEG) return blob

  const [ground, frame] = await Promise.all([loadGround(), createImageBitmap(blob)])
  const w = frame.width
  const h = frame.height

  const out = sized(outCanvas, w, h)
  outCanvas = out
  const octx = out.getContext('2d')
  const cloud = sized(cloudCanvas, w, h)
  cloudCanvas = cloud
  const cctx = cloud.getContext('2d', { willReadFrequently: true })
  if (!octx || !cctx) throw new Error('kein 2D-Kontext')

  // 1. Boden, auf das Raster des Satellitenbildes gezogen.
  const rect = groundSourceRect(
    mercBox({
      west: GROUND_BOUNDS.lonMin,
      east: GROUND_BOUNDS.lonMax,
      south: GROUND_BOUNDS.latMin,
      north: GROUND_BOUNDS.latMax,
    }),
    productMerc(product),
    ground.width,
    ground.height,
  )
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(ground, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h)

  // 2. Wolkenschicht: Farbe bleibt der Messwert, die Helligkeit wird zur
  //    Deckkraft. Die Kanäle sind grau, R genügt also als Helligkeit.
  const { min, max } = maskRange(mask, elevation)
  const lut = cloudAlphaLut(min, max)
  cctx.clearRect(0, 0, w, h)
  cctx.drawImage(frame, 0, 0)
  const img = cctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) d[i + 3] = lut[d[i]]
  cctx.putImageData(img, 0, 0)
  octx.drawImage(cloud, 0, 0)

  frame.close()
  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Komposit liess sich nicht kodieren'))),
      'image/jpeg',
      0.85,
    )
  })
}
