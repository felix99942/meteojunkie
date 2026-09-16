// Niederschlagsradar (DWD) — Registry, Zeitdimension und Farbskala.
//
// GEZEIGT WIRD DIE REFLEKTIVITÄT IN dBZ (Produkt WN), nicht die abgeleitete
// Niederschlagsrate: dBZ ist die Messgröße des Radars, mm/h erst das Ergebnis
// einer Z-R-Beziehung, die über Tropfengrößenverteilung, Hagel und
// Schmelzschicht annimmt, was sie nicht messen kann. Die mm/h-Variante (RV)
// bleibt als zweites Produkt wählbar — sie ist DASSELBE Feld, nur durch diese
// Annahme gedreht.
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
// DIE VORHERSAGE IST KEIN MODELL, sondern eine VERLAGERUNGSRECHNUNG (DWD
// RADVOR): im Radarfeld werden ähnliche Niederschlagsstrukturen zweier
// aufeinanderfolgender Komposite wiedererkannt, daraus ein flächendeckendes
// Verlagerungsvektorfeld bestimmt und das Feld in 5-Minuten-Schritten bis
// +2 h verschoben. Keine Entstehung, kein Zerfall, keine NWV-Physik — reine
// Fortschreibung des Beobachteten. Gemessen bestätigt: alle Vorhersageschritte
// tragen dieselbe `REFERENCE_TIME` wie die Analyse (GetFeatureInfo), sind also
// EIN Nowcast, der zum Analysezeitpunkt losgeschickt wurde.
//
// **Daraus folgt der Grund für `coverageStencil`**: verschoben wird das ganze
// Feld, einschliesslich der „keine Daten"-Kennung. Die Radarkreise der
// Abdeckungsgrenze WANDERN dadurch mit dem Wind — gemessen (2026-09-16,
// 1200-px-Bild): bei +120 min sind 50.533 Pixel nicht mehr maskiert, die in
// der Analyse maskiert waren, und 76.559 neu maskiert; der Schwerpunkt der
// Maske verschiebt sich um 60 px nach Westen. Dort, wo die Analyse keine Daten
// hat, kann auch die Verlagerung keine haben — was der Nowcast dort malt, ist
// aus dem Inneren herangeschobener Inhalt über einem Gebiet, das kein Radar
// sieht. Die Abdeckung wird deshalb aus dem ANALYSEBILD festgehalten und auf
// alle Vorhersagebilder gelegt. Umgekehrt bleibt die Maske, die INNERHALB der
// Abdeckung wächst, stehen: dort hat die Verlagerung wirklich nichts, woraus
// sie fortschreiben könnte, und das ist eine ehrliche Aussage.
//
// **Interpolation: KEINE — der Dienst rastert nearest neighbour.** Live
// nachgemessen (2026-09-16, 90-fach überzoomt auf ~11 m/px): entlang einer
// Zeile durch ein Echo stehen Blöcke von 101–102 Pixeln in EINER Klassenfarbe
// mit harten Kanten, also genau eine 1-km-Gitterzelle je Block, ohne einen
// einzigen Zwischenton; benachbarte Blöcke springen auch über Klassen hinweg
// (7–9,5 dBZ direkt auf 14,5–19 dBZ). Der GeoServer-Vendorparameter
// `interpolations=nearest neighbor` änderte entsprechend nichts — Byte für
// Byte dieselbe Antwort. Wir interpolieren auch selbst nicht: das Bild wird in
// Web-Mercator angefordert und liegt damit im Zielraster (siehe
// `radarImageUrl`). Die einzige Weichzeichnung ist die ~1 px Kantenglättung
// des Renderers.
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

// --- Farbskalen ------------------------------------------------------------

export interface RadarLegendStep {
  color: string
  /** UNTERE Grenze der Klasse, wie der Dienst sie beschriftet. */
  label: string
}

/**
 * Die Farbskalen sind NICHT erfunden, sondern 1:1 aus
 * `request=GetLegendGraphic&format=application/json` des jeweiligen Layers
 * (abgerufen 2026-09-16). Hier fest hinterlegt statt zur Laufzeit geholt, weil
 * sie sich nicht täglich ändern und die Legende sonst einen zweiten Abruf
 * kostet, bevor das erste Bild steht. Ändert der DWD die Stufen, ist der
 * JSON-Abruf oben die Quelle für die Aktualisierung.
 *
 * GeoServers `type="intervals"` gibt je Eintrag die OBERE Grenze an; die Farbe
 * gilt also von der vorigen Grenze bis dorthin. Beschriftet wird hier die
 * UNTERE Grenze unter dem jeweiligen Feld — so steht die Zahl am Anfang der
 * Klasse, die sie benennt. Die „Keine Daten"-Maske (#7D7D7D) ist bewusst
 * KEIN Skalenschritt: sie steht als eigene Zeile in der Legende, weil sie die
 * Abdeckungsgrenze markiert und nicht einen Messwert.
 */
export const MASK_COLOR = '#7D7D7D'

/** Reflektivität in dBZ (Produkt WN) — 7 dBZ bis ≥ 85 dBZ. */
export const WN_LEGEND: RadarLegendStep[] = [
  { color: '#99FFFF', label: '7' },
  { color: '#33FFFF', label: '9,5' },
  { color: '#00CACA', label: '12' },
  { color: '#009934', label: '14,5' },
  { color: '#4DBF1A', label: '19' },
  { color: '#99CC00', label: '23,5' },
  { color: '#CCE600', label: '28' },
  { color: '#FFFF00', label: '32,5' },
  { color: '#FFC400', label: '37' },
  { color: '#FF8900', label: '41,5' },
  { color: '#FF0000', label: '46' },
  { color: '#B40000', label: '50,5' },
  { color: '#4848FF', label: '55' },
  { color: '#0000CA', label: '60' },
  { color: '#990099', label: '65' },
  { color: '#FF33FF', label: '75' },
  { color: '#000000', label: '85' },
]

/** Niederschlagsrate in mm/h (Produkt RV). */
export const RV_LEGEND: RadarLegendStep[] = [
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
  /** Einheit der Skala — Beschriftung der Legende. */
  unit: string
  /**
   * Deckkraft der „Keine Daten"-Maske im Produktstil (WN 0,5 · RV 0,3). Wird
   * gebraucht, weil die Nachbearbeitung Pixel auf die Maske umfärbt und dabei
   * nicht raten darf, wie kräftig sie hier ist.
   */
  maskOpacity: number
  /** Farbstufen, 1:1 aus dem GetLegendGraphic des Layers (siehe unten). */
  legend: RadarLegendStep[]
  /** Kurzbeschreibung für den Tooltip der Produktauswahl. */
  note: string
}

/**
 * ZWEI Produkte, dasselbe Radarkomposit in zwei Größen — und die Reihenfolge
 * ist die Aussage: **WN (Reflektivität in dBZ) ist die Vorgabe.** Das ist, was
 * das Radar misst. RV (mm/h) entsteht daraus über eine Z-R-Beziehung, die
 * annimmt, was sie nicht messen kann (Tropfengrößenverteilung, Hagel,
 * Schmelzschicht) — eine nützliche Ableitung, aber eine Annahme mehr zwischen
 * Messung und Bild. Beide führen Analyse UND 2-h-Verlagerung, 1 km, 5 min, und
 * beide haben dieselbe Zeitdimension-Mechanik.
 *
 * Weitere Kandidaten am selben Dienst, falls sie je gebraucht werden — gleiche
 * Mechanik, nur andere Skala: `dwd:RADOLAN-RW` (an Stationen ANGEEICHTE
 * Stundensummen, 10 min, nur Deutschland), `dwd:RADOLAN-RY`
 * (qualitätsgeprüfte 5-min-Mengen), `dwd:Radar_wn-analysis_1x1km_ger`
 * (WN ohne Vorhersageteil — dessen Zeitdimension endet genau 120 min früher
 * und war die Gegenprobe für `analysisTime`).
 */
export const RADAR_PRODUCTS: RadarProduct[] = [
  {
    id: 'wn',
    label: 'Reflektivität (dBZ)',
    layer: 'dwd:Radar_wn-product_1x1km_ger',
    capsLayer: 'Radar_wn-product_1x1km_ger',
    stepMs: 5 * 60_000,
    forecastMs: 120 * 60_000,
    unit: 'dBZ',
    maskOpacity: 0.5,
    legend: WN_LEGEND,
    note: 'Deutsches Radarkomposit WN: Reflektivität in dBZ — die Messgröße des Radars. Analyse und 2-h-Verlagerung, 1 km, alle 5 Minuten',
  },
  {
    id: 'rv',
    label: 'Niederschlagsrate (mm/h)',
    layer: 'dwd:Radar_rv_product_1x1km_ger',
    capsLayer: 'Radar_rv_product_1x1km_ger',
    stepMs: 5 * 60_000,
    forecastMs: 120 * 60_000,
    unit: 'mm/h',
    maskOpacity: 0.3,
    legend: RV_LEGEND,
    note: 'Dasselbe Komposit als Niederschlagsrate (Produkt RV) — aus der Reflektivität über eine Z-R-Beziehung abgeleitet',
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
