// Niederschlagsradar (DWD) — Registry, Zeitdimension und Farbskala.
//
// QUELLE ist der **WMS des Deutschen Wetterdienstes** (`maps.dwd.de`), und das
// ist der ganze Trick dieses Bereichs: der Dienst liefert FERTIG EINGEFÄRBTE
// PNGs, schickt `Access-Control-Allow-Origin: *` mit und braucht keinen Key —
// die Seite kann ihn also direkt aus dem Browser abrufen, ohne Proxy, ohne
// eigenes Rendering und ohne einen Tropfen Open-Meteo-Budget. Nutzung nach
// GeoNutzV (Namensnennung, siehe Quellenzeile im Bereich).
//
// ABDECKUNG — live gemessen (2026-09-16, RV-Produkt, Maskenfarbe ausgezählt):
// das Gitter reicht von 45,7 bis 56,2 °N und 1,5 bis 18,7 °O, die RADARDATEN
// aber nicht so weit. Das Produkt malt „Keine Daten" als halbtransparentes
// Grau (#7D7D7D, 30 %), und diese Maske beginnt je Breite bei
// 13,2 °O (47,0 °N) … 14,4 °O (49,0 °N). Heißt konkret: **Deutschland,
// Schweiz, Vorarlberg, Tirol und das Land Salzburg sind drin, der ganze Osten
// Österreichs nicht** (Linz, Wien, Graz, Klagenfurt, St. Pölten, Eisenstadt,
// Villach lagen alle in der Maske). Das ist keine Anzeigefrage, sondern die
// Reichweite der deutschen Radare — deshalb wird die Maske NICHT ausgeblendet,
// sondern in der Legende erklärt.
//
// Für den fehlenden Osten Österreichs gibt es aus der GeoSphere-API keinen
// gangbaren Ersatz: das Nowcast-Gitter (`grid/forecast/nowcast-v1-15min-1km`,
// 1 km / 15 min, `rr`) ist inhaltlich genau richtig, aber nur als GeoJSON oder
// NetCDF-4 abrufbar — EIN Zeitschritt über ganz Österreich sind 188.574
// Punkte, gemessen **36 MB in 115 Sekunden** (2026-09-16). Das ist für einen
// Live-Layer im Browser tot, und NetCDF-4 ist HDF5, bräuchte also zusätzlich
// einen Binärparser. Nicht erneut als „vielleicht doch"-Weg prüfen.

/** Basis-URL des DWD-GeoServers (Workspace `dwd`). */
export const DWD_WMS_BASE = 'https://maps.dwd.de/geoserver/dwd/wms'

export interface RadarProduct {
  id: string
  label: string
  /** Layername für GetMap (mit Workspace-Präfix). */
  layer: string
  /**
   * Layername OHNE Präfix für den **layer-eigenen virtuellen WMS**
   * (`/geoserver/dwd/<Layer>/wms`): dessen GetCapabilities ist 18 KB statt
   * 862 KB für den ganzen Workspace — und nur dort steht, welche Zeitschritte
   * es gerade gibt.
   */
  capsLayer: string
  /** Schrittweite der Zeitdimension. */
  stepMs: number
  /**
   * Länge des VORHERSAGE-Teils am Ende der Zeitdimension. Beim RV-Produkt
   * +2 h; gemessen, nicht angenommen: die Zeitdimension des Analyse-Layers
   * (`Radar_wn-analysis_1x1km_ger`) endete zweimal exakt 120 min vor der des
   * RV-Layers (21:30/23:30 und 21:40/23:40 UTC).
   */
  forecastMs: number
  unit: string
  /** Kurzbeschreibung für den Tooltip der Produktauswahl. */
  note: string
}

/**
 * Bewusst EIN Produkt: RV ist das Radarkomposit MIT Nowcast (5 min, 1 km,
 * Analyse ~4 Tage rückwärts plus 2 h vorwärts) und damit das, was man unter
 * „Radar" erwartet. Weitere Kandidaten am selben Dienst, falls sie je
 * gebraucht werden — alle mit derselben Mechanik, nur andere Farbskala:
 * `dwd:RADOLAN-RW` (an Stationen ANGEEICHTE Stundensummen, 10 min, nur
 * Deutschland), `dwd:RADOLAN-RY` (qualitätsgeprüfte 5-min-Mengen),
 * `dwd:Radar_wn-analysis_1x1km_ger` (RV ohne Vorhersageteil).
 */
export const RADAR_PRODUCTS: RadarProduct[] = [
  {
    id: 'rv',
    label: 'Radar + Nowcast (RV)',
    layer: 'dwd:Radar_rv_product_1x1km_ger',
    capsLayer: 'Radar_rv_product_1x1km_ger',
    stepMs: 5 * 60_000,
    forecastMs: 120 * 60_000,
    unit: 'mm/h',
    note: 'Deutsches Radarkomposit RV: Analyse und Vorhersage, 1 km, alle 5 Minuten, Niederschlagsrate in mm/h',
  },
]

export const DEFAULT_RADAR_PRODUCT = RADAR_PRODUCTS[0]

// --- Zeitdimension ---------------------------------------------------------

export interface TimeExtent {
  /** Erster verfügbarer Zeitschritt. */
  start: number
  /** Letzter verfügbarer Zeitschritt — beim RV-Produkt das Ende der Vorhersage. */
  end: number
  stepMs: number
}

/**
 * ISO-8601-Dauer, wie sie in der WMS-Zeitdimension steht. Nur die Formen, die
 * dieser Dienst wirklich schickt (`PT5M`, `PT10M`, `PT1H`, `P1D`) — ein
 * vollständiger Dauer-Parser wäre hier Beiwerk.
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

export interface RadarMeta {
  extent: TimeExtent
  /**
   * Fläche des Produkts als lat/lon-Ecken — das sind die Koordinaten der
   * MapLibre-image-Source.
   */
  geo: GeoBox
  /**
   * DIESELBE Fläche in EPSG:3857, so wie der Dienst sie selbst angibt. Das
   * Bild wird in Web-Mercator angefordert, weil MapLibre eine image-Source
   * linear im Mercator-Raum aufspannt: Mercator anfordern heißt, dass die
   * Zuordnung exakt stimmt, ohne Vorverzerrung wie in `render/fieldImage.ts`.
   */
  merc: MercBox
}

/**
 * Zeitdimension und Fläche aus dem GetCapabilities des layer-eigenen WMS.
 *
 * Bewusst über reguläre Ausdrücke statt `DOMParser`: die Antwort ist eine
 * feste, sehr kleine Form (ein Layer, eine Dimension), und so bleibt der
 * Parser ein reiner String→Objekt-Kern, der ohne DOM in Vitest läuft.
 */
export function parseRadarCapabilities(xml: string): RadarMeta | null {
  const dim = /<Dimension[^>]*name="time"[^>]*>([\s\S]*?)<\/Dimension>/.exec(xml)
  const extent = dim ? parseTimeExtent(dim[1]) : null
  if (!extent) return null

  const num = (tag: string): number | null => {
    const m = new RegExp(`<${tag}>\\s*([-\\d.eE+]+)\\s*</${tag}>`).exec(xml)
    return m ? Number(m[1]) : null
  }
  const west = num('westBoundLongitude')
  const east = num('eastBoundLongitude')
  const south = num('southBoundLatitude')
  const north = num('northBoundLatitude')
  if (west == null || east == null || south == null || north == null) return null

  const bb = /<BoundingBox[^>]*CRS="EPSG:3857"[^>]*\/>/.exec(xml)
  if (!bb) return null
  const attr = (name: string): number | null => {
    const m = new RegExp(`${name}="([-\\d.eE+]+)"`).exec(bb[0])
    return m ? Number(m[1]) : null
  }
  const minx = attr('minx')
  const miny = attr('miny')
  const maxx = attr('maxx')
  const maxy = attr('maxy')
  if (minx == null || miny == null || maxx == null || maxy == null) return null

  return { extent, geo: { west, east, south, north }, merc: { minx, miny, maxx, maxy } }
}

// --- Bildfolge -------------------------------------------------------------

export interface RadarFrame {
  time: number
  /** true = Nowcast (liegt hinter dem letzten Analysezeitpunkt). */
  forecast: boolean
}

/** Letzter ANALYSEzeitpunkt = Ende der Dimension minus Vorhersagelänge. */
export function analysisTime(meta: RadarMeta, product: RadarProduct): number {
  return meta.extent.end - product.forecastMs
}

/**
 * Die Bildfolge des Zeitschiebers: `historyMs` rückwärts vom letzten
 * Analysebild, dann (wenn gewünscht) der Nowcast bis zum Ende der Dimension.
 * Jedes Bild ist ein eigener HTTP-Abruf — die Fensterlänge ist deshalb
 * Bandbreite, nicht Kosmetik, und steht in der Bedienleiste zur Wahl.
 */
export function radarFrames(
  meta: RadarMeta,
  product: RadarProduct,
  historyMs: number,
  withForecast: boolean,
): RadarFrame[] {
  const step = meta.extent.stepMs || product.stepMs
  const analysis = analysisTime(meta, product)
  const from = Math.max(meta.extent.start, analysis - historyMs)
  const to = withForecast ? meta.extent.end : analysis
  const frames: RadarFrame[] = []
  for (let t = from; t <= to + 1; t += step) frames.push({ time: t, forecast: t > analysis })
  return frames
}

/** Index des Bildes, das der Zeit am nächsten liegt (für Sprünge auf „jetzt"). */
export function nearestFrame(frames: RadarFrame[], t: number): number {
  if (frames.length === 0) return 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < frames.length; i++) {
    const d = Math.abs(frames[i].time - t)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

// --- URLs ------------------------------------------------------------------

export function radarCapabilitiesUrl(product: RadarProduct): string {
  return (
    `https://maps.dwd.de/geoserver/dwd/${product.capsLayer}/wms` +
    '?service=WMS&version=1.3.0&request=GetCapabilities'
  )
}

/**
 * Ein Bild je Zeitschritt über die GANZE Produktfläche, in EPSG:3857.
 *
 * Warum ein Vollflächenbild und keine Kacheln: so kostet ein Zeitschritt
 * EINEN Abruf statt eines Dutzends, die Bilder lassen sich vorladen und die
 * Schleife läuft danach ruckfrei — und ein Verschieben der Karte löst KEINEN
 * neuen Abruf aus. Preis ist die feste Auflösung (siehe `RADAR_IMAGE_WIDTH`).
 *
 * Eine Zeit, die nicht auf dem 5-Minuten-Raster liegt, antwortet mit einer
 * ServiceException statt mit einem Bild (geprüft) — die Zeiten müssen also aus
 * der Dimension kommen und dürfen nicht geraten werden.
 */
export function radarImageUrl(
  product: RadarProduct,
  meta: RadarMeta,
  opts: { time: number; width: number; height: number },
): string {
  const { minx, miny, maxx, maxy } = meta.merc
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: product.layer,
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: `${minx},${miny},${maxx},${maxy}`,
    width: String(opts.width),
    height: String(opts.height),
    time: new Date(opts.time).toISOString().replace('.000', ''),
  })
  return `${DWD_WMS_BASE}?${q.toString()}`
}

/**
 * Breite des angeforderten Bildes. 1200 px über 1.920 km Mercator-Breite sind
 * bei 48 °N rund 1,1 km je Pixel — also etwa die 1-km-Auflösung des Produkts;
 * mehr Pixel kosten nur Bytes (gemessen 1000 px → 63 KB, 1400 px → 111 KB,
 * 1800 px → 166 KB je Bild) und mehr Wartezeit beim Vorladen.
 */
export const RADAR_IMAGE_WIDTH = 1200

/** Bildhöhe aus dem Seitenverhältnis der Mercator-Fläche (nie krumm skalieren). */
export function radarImageHeight(meta: RadarMeta, width = RADAR_IMAGE_WIDTH): number {
  const { minx, miny, maxx, maxy } = meta.merc
  return Math.max(1, Math.round((width * (maxy - miny)) / (maxx - minx)))
}

/** Ecken für die MapLibre-image-Source (im Uhrzeigersinn ab oben links). */
export function radarImageCoordinates(
  meta: RadarMeta,
): [[number, number], [number, number], [number, number], [number, number]] {
  const { west, east, south, north } = meta.geo
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]
}

// --- Farbskala -------------------------------------------------------------

export interface RadarLegendStep {
  color: string
  /** Beschriftung, wie der Dienst sie selbst führt. */
  label: string
  /** Deckkraft, falls abweichend von 1 (nur die „Keine Daten"-Maske). */
  opacity?: number
}

/**
 * Die Farbskala des Produkts, NICHT selbst erfunden: sie stammt 1:1 aus
 * `request=GetLegendGraphic&format=application/json` desselben Layers
 * (abgerufen 2026-09-16). Hier fest hinterlegt statt zur Laufzeit geholt, weil
 * sie sich nicht täglich ändert und die Legende sonst einen zweiten Abruf
 * kostet, bevor das erste Bild steht. Ändert der DWD die Stufen, ist der
 * JSON-Abruf oben die Quelle für die Aktualisierung.
 *
 * Erster Eintrag ist die Maske: das halbtransparente Grau heißt „Keine Daten"
 * — der Bereich erklärt das in der Legende, weil es genau die Abdeckungsgrenze
 * ist (siehe Kopf dieser Datei).
 */
export const RADAR_LEGEND: RadarLegendStep[] = [
  { color: '#7D7D7D', label: 'keine Daten', opacity: 0.3 },
  { color: '#33FFFF', label: '0,1' },
  { color: '#1ACC9A', label: '0,2' },
  { color: '#019934', label: '0,4' },
  { color: '#4DB31B', label: '1' },
  { color: '#99CC01', label: '2' },
  { color: '#CCE601', label: '3' },
  { color: '#FFFF01', label: '5' },
  { color: '#FFC401', label: '7,5' },
  { color: '#FF8901', label: '10' },
  { color: '#FF4501', label: '15' },
  { color: '#FE0000', label: '30' },
  { color: '#E5004C', label: '45' },
  { color: '#CC0098', label: '75' },
  { color: '#6600CB', label: '100' },
  { color: '#0000FE', label: '150' },
]
