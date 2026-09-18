// Zeitdimension eines WMS — der gemeinsame Kern von Radar (DWD) und Satellit
// (EUMETSAT).
//
// Beide Bereiche funktionieren nach demselben Muster: ein Dienst liefert
// FERTIG EINGEFÄRBTE Bilder zu festen Zeitschritten, und die Schritte dürfen
// NICHT geraten werden — eine Zeit, die es nicht gibt, beantwortet der Dienst
// je nach Konfiguration mit einer ServiceException (DWD) oder still mit dem
// nächstgelegenen Bild (EUMETSAT, `nearestValue="1"` in der Dimension). Die
// zweite Variante ist die gefährlichere: sie sieht wie Daten aus. Deshalb
// kommen die Zeitschritte hier immer aus dem GetCapabilities des Layers.
//
// Herausgezogen aus `config/radar.ts`, damit die beiden Bereiche nicht zwei
// Fassungen derselben Parser pflegen; `config/radar.ts` re-exportiert die
// Namen weiter, seine öffentliche Form bleibt also unverändert.

export interface TimeExtent {
  /** Erster verfügbarer Zeitschritt. */
  start: number
  /** Letzter Zeitschritt der Dimension (beim Radar inkl. Vorhersageteil). */
  end: number
  stepMs: number
}

/**
 * ISO-8601-Dauer, wie sie in einer WMS-Zeitdimension steht. Nur die Formen,
 * die diese Dienste wirklich schicken (`PT5M`, `PT10M`, `PT15M`, `PT1H`,
 * `P1D`) — ein vollständiger Dauer-Parser wäre hier Beiwerk.
 */
export function parseIsoDuration(raw: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw.trim())
  if (!m) return null
  const [, d, h, min, s] = m
  const ms =
    (d ? Number(d) * 86_400_000 : 0) +
    (h ? Number(h) * 3_600_000 : 0) +
    (min ? Number(min) * 60_000 : 0) +
    (s ? Number(s) * 1000 : 0)
  return ms > 0 ? ms : null
}

/**
 * Die Zeitdimension kommt als `Anfang/Ende/Schritt` (ein einziges Intervall,
 * keine Aufzählung). Mehrere durch Komma getrennte Intervalle sind im Standard
 * erlaubt — dann gilt das LETZTE, weil uns die aktuellen Schritte interessieren.
 */
export function parseTimeExtent(raw: string): TimeExtent | null {
  const part = raw.split(',').map((s) => s.trim()).filter(Boolean).pop()
  if (!part) return null
  const [from, to, dur] = part.split('/')
  if (!from || !to || !dur) return null
  const start = Date.parse(from)
  const end = Date.parse(to)
  const stepMs = parseIsoDuration(dur)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !stepMs || end < start) return null
  return { start, end, stepMs }
}

/**
 * Inhalt des `<Dimension name="time">`-Elements aus einem GetCapabilities.
 *
 * Bewusst über reguläre Ausdrücke statt `DOMParser`: die Antwort des
 * layer-eigenen WMS ist eine feste, sehr kleine Form (ein Layer, eine
 * Dimension), und so bleibt der Parser ein reiner String→Objekt-Kern, der
 * ohne DOM in Vitest läuft.
 */
export function extractTimeDimension(xml: string): string | null {
  const m = /<Dimension[^>]*name="time"[^>]*>([\s\S]*?)<\/Dimension>/.exec(xml)
  return m ? m[1] : null
}

/**
 * Die Zeitpunkte des Zeitschiebers: `historyMs` rückwärts von `last`, in
 * Schritten der Zeitdimension. Jedes Bild ist ein eigener HTTP-Abruf — die
 * Fensterlänge ist deshalb Bandbreite, nicht Kosmetik, und steht in der
 * Bedienleiste zur Wahl.
 *
 * Aufsteigend sortiert, das letzte Element ist der neueste Stand.
 */
export function frameTimes(extent: TimeExtent, last: number, historyMs: number): number[] {
  const step = extent.stepMs
  const from = Math.max(extent.start, last - historyMs)
  const times: number[] = []
  for (let t = from; t <= last + 1; t += step) times.push(t)
  return times
}

/** Index der Zeit, die einem Zeitpunkt am nächsten liegt. */
export function nearestFrame(times: number[], t: number): number {
  if (times.length === 0) return 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - t)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

// --- Web-Mercator ----------------------------------------------------------

/** Halber Erdumfang in Metern, wie EPSG:3857 ihn ansetzt. */
const MERC_HALF = 20_037_508.34

export interface GeoBox {
  west: number
  east: number
  south: number
  north: number
}

export interface MercBox {
  minx: number
  miny: number
  maxx: number
  maxy: number
}

/**
 * lat/lon → EPSG:3857. Gebraucht, wo die Fläche NICHT vom Dienst kommt: das
 * EUMETSAT-Capabilities gibt für einen Satellitenlayer die ganze sichtbare
 * Halbkugel an (±81° Länge), nicht den Ausschnitt, den wir zeigen wollen — der
 * wird hier gesetzt und muss deshalb selbst projiziert werden.
 */
export function toMercator(lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon * MERC_HALF) / 180,
    y: (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (MERC_HALF / 180),
  }
}

export function mercBox(geo: GeoBox): MercBox {
  const sw = toMercator(geo.west, geo.south)
  const ne = toMercator(geo.east, geo.north)
  return { minx: sw.x, miny: sw.y, maxx: ne.x, maxy: ne.y }
}

/** Bildhöhe aus dem Seitenverhältnis DIESER Mercator-Fläche (nie krumm skalieren). */
export function imageHeightFor(merc: MercBox, width: number): number {
  return Math.max(1, Math.round((width * (merc.maxy - merc.miny)) / (merc.maxx - merc.minx)))
}

/** Ecken für die MapLibre-image-Source (im Uhrzeigersinn ab oben links). */
export function imageCoordinates(
  geo: GeoBox,
): [[number, number], [number, number], [number, number], [number, number]] {
  const { west, east, south, north } = geo
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]
}
