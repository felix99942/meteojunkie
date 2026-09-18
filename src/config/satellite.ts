// Satellitenbilder (EUMETSAT) — Registry, Fläche und Zeitdimension.
//
// QUELLE ist **EUMETView**, der öffentliche WMS von EUMETSAT
// (`view.eumetsat.int/geoserver/wms`). Derselbe Trick wie beim Radar: der
// Dienst liefert FERTIG EINGEFÄRBTE Bilder, schickt
// `Access-Control-Allow-Origin: *` und braucht keinen Key — die Seite kann ihn
// direkt aus dem Browser abrufen, ohne Proxy und ohne Open-Meteo-Budget.
// Gemessen (2026-09-19): `<Fees>none</Fees>`, `<AccessConstraints>none</AccessConstraints>`.
//
// ZWEI SATELLITEN, zwei Takte — live geprüft (2026-09-19, alle Layer der
// Registry lieferten HTTP 200 mit Bild):
//   MTG / FCI   `mtg_fd:*`    alle 10 Minuten, Archiv ab 23.09.2024
//   MSG / SEVIRI `msg_fes:*`  alle 15 Minuten, Archiv ab 01.09.2020
// Der Takt kommt trotzdem NICHT aus dieser Tabelle, sondern aus dem
// GetCapabilities des Layers (`stepMs` ist nur der Rückfall) — siehe unten.
//
// **DIE ZEITFALLE IST HIER EINE ANDERE ALS BEIM DWD**, und sie ist die
// gefährlichere: die Zeitdimension trägt `nearestValue="1"`, der Dienst
// antwortet auf einen Zeitpunkt, den es noch nicht gibt, also NICHT mit einer
// ServiceException, sondern still mit dem NÄCHSTGELEGENEN Bild. Gemessen
// (2026-09-18, 22:39 UTC): die Anfragen für 22:20 und 22:30 kamen
// byte-identisch zurück (gleiche MD5), erst 22:35 — neben dem 10-Minuten-
// Raster — warf eine Exception. Ein doppeltes Bild in der Schleife sieht aus
// wie Wetter, das steht. Deshalb kommen die Zeitschritte ausschließlich aus
// der Dimension des Layers; deren Ende hängt dem tatsächlich Verfügbaren
// eher hinterher (22:10 gemeldet, 22:30 schon da), was die sichere Richtung
// ist.
//
// AKTUALITÄT: das 22:30-Bild war um 22:39 abrufbar, also unter 10 Minuten
// Verzug — vergleichbar mit dem Radar (3 min), aber im 10-Minuten-Takt.
//
// GRÖSSE: JPEG, nicht PNG. Gemessen bei 1400 px Breite über der Fläche unten:
// Geocolour als JPEG 266 KB, als PNG8 1,18 MB — Faktor 4,4 bei einem
// Fotomotiv, für das PNG das falsche Format ist. `format_options=quality:70`
// ändert nichts (byte-identisch zu 85), nicht erneut versuchen. Bei
// `SATELLITE_IMAGE_WIDTH` = 1100 sind es je nach Produkt und Bewölkung
// 70–210 KB (über den echten Abrufpfad gemessen: Geocolour 206, IR 90,
// Airmass 101, Konvektion 72) — eine 2-Stunden-Schleife also 0,7 bis 2,7 MB.
//
// TAGESPRODUKTE nur dort, wo sie etwas können, was kein Tag-und-Nacht-Produkt
// kann. `rgb_truecolour`, `rgb_snow` und `rgb_cloudtype` sind draußen: sie
// zeigen tagsüber nichts, was Geocolour nicht auch zeigt (das selbst auf
// Infrarot umschaltet und am Tag wie True Colour aussieht), und nachts liefern
// sie ein schwarzes bzw. leeres Bild. Die AUSNAHME ist der hochaufgelöste
// sichtbare Kanal — siehe `dayOnly` unten: er ist das schärfste, was dieser
// Dienst hergibt, und dafür sind schwarze Nachtbilder ein fairer Preis.
//
// **HOCHAUFGELÖST SICHTBAR: `vis06_hrfi`, nicht HRV.** MSGs HRV-Kanal (1 km)
// ist bei EUMETView NICHT veröffentlicht — von SEVIRI gibt es nur `vis006`,
// den 3-km-Standardkanal. Der Nachfolger ist da: MTG/FCI liefert VIS 0,6 µm
// als HRFI (High Resolution Fast Imagery) mit 500 m am Subsatellitenpunkt.
// Über Mitteleuropa wird daraus durch den schrägen Blick real rund 1 km —
// deshalb fordert dieses Produkt sein Bild mit 1600 px an (≈1,0 km/px) statt
// mit den 1100 der übrigen: bei 1100 px würde die Auflösung, für die man das
// Produkt nimmt, im Zielraster wieder weggeworfen. Mehr bringt nichts mehr,
// kostet aber: gemessen 1100 → 200 KB, 1600 → 372 KB, 2200 → 628 KB,
// 3000 → 1,0 MB. Im direkten Vergleich mit Geocolour am selben Zeitpunkt sind
// Alpentäler, einzelne Cumuluszellen und Cirrenstreifen sichtbar schärfer.

import {
  extractTimeDimension,
  frameTimes,
  imageCoordinates,
  imageHeightFor,
  mercBox,
  parseTimeExtent,
  type GeoBox,
  type MercBox,
  type TimeExtent,
} from './wmsTime'

/** Basis-URL des EUMETView-GeoServers (alle Workspaces). */
export const EUMETSAT_WMS_BASE = 'https://view.eumetsat.int/geoserver/wms'

/**
 * Die Fläche gibt HIER die Seite vor, nicht der Dienst — das ist der
 * Unterschied zum Radar. Ein Satellitenlayer meldet im Capabilities die ganze
 * sichtbare Halbkugel (gemessen: lon −81,3…81,3, lat −77,4…77,4); ein Bild
 * darüber wäre für Mitteleuropa nutzlos. Gewählt ist ein Fenster, das D-A-CH
 * mit Anlauf umfasst (Nordsee bis Po-Ebene, Rhône bis Weichsel), damit man die
 * Systeme HEREINZIEHEN sieht statt sie am Bildrand zu entdecken.
 */
export const SATELLITE_AREA: GeoBox = { west: 0, east: 22, south: 41, north: 56 }

/** Dieselbe Fläche in EPSG:3857 — so wird das Bild angefordert. */
export const SATELLITE_MERC: MercBox = mercBox(SATELLITE_AREA)

/**
 * Breite des angeforderten Bildes. 1100 px über die ~1.630 km der Fläche sind
 * bei 48 °N rund 1,5 km je Pixel — feiner als MTG/FCI im Standardkanal
 * (2 km) und feiner als MSG (3 km am Subsatellitenpunkt, über Mitteleuropa
 * deutlich gröber). Mehr Pixel kosten nur Bytes: gemessen 900 px → 119 KB,
 * 1100 → 160–210 KB, 1400 → 266 KB je Bild.
 */
export const SATELLITE_IMAGE_WIDTH = 1100

export type SatelliteMission = 'MTG' | 'MSG'

export interface SatelliteProduct {
  id: string
  label: string
  /** Workspace des GeoServers — zugleich der Satellit. */
  workspace: string
  /** Layername OHNE Workspace. */
  name: string
  mission: SatelliteMission
  /** Nur Rückfall, wenn die Dimension keinen Schritt nennt. */
  stepMs: number
  /** Bildformat der Anfrage. JPEG für alles, was Tag und Nacht Inhalt hat. */
  format: string
  /**
   * Abweichende Anforderungsbreite. Nur der hochaufgelöste sichtbare Kanal
   * braucht sie: mit der Vorgabe (1100 px ≈ 1,5 km/px) läge sein Vorteil unter
   * dem Zielraster. Alle anderen Produkte sind bei 2 km oder gröber nativ.
   */
  imageWidth?: number
  /**
   * Misst reflektiertes Sonnenlicht — nachts also schwarz. Das steht so in der
   * Legende: ein schwarzes Bild sieht sonst nach einem Fehler aus, und es ist
   * keiner. Gemessen: nachts 36 KB JPEG (fast nur Schwarz), tagsüber 372 KB.
   */
  dayOnly?: true
  /** Kurzbeschreibung für Tooltip und Quellenzeile. */
  note: string
}

/** Breite, die DIESES Produkt anfordert. */
export function productImageWidth(p: SatelliteProduct): number {
  return p.imageWidth ?? SATELLITE_IMAGE_WIDTH
}

/** Layername mit Workspace, wie GetMap ihn erwartet. */
export function satelliteLayer(p: SatelliteProduct): string {
  return `${p.workspace}:${p.name}`
}

/**
 * FÜNF Produkte, und die Reihenfolge ist die Aussage: Geocolour ist die
 * Vorgabe, weil es die einzige Darstellung ist, die rund um die Uhr aussieht
 * wie das, was man erwartet — tagsüber nahezu True Colour, nachts auf
 * Infrarot umgeschaltet. Dann der hochaufgelöste sichtbare Kanal, der am Tag
 * das schärfste Bild liefert (und nachts schwarz ist), dann das reine IR
 * (dieselbe Größe ohne Interpretation), zuletzt die beiden klassischen
 * Analyse-RGBs von MSG, für die es auf MTG bisher kein Gegenstück am Dienst
 * gibt.
 */
export const SATELLITE_PRODUCTS: SatelliteProduct[] = [
  {
    id: 'geocolour',
    label: 'Geocolour (Tag/Nacht)',
    workspace: 'mtg_fd',
    name: 'rgb_geocolour',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    note: 'MTG/FCI Geocolour: tagsüber nahezu echte Farben, nachts Infrarot — die einzige Darstellung, die über den ganzen Tag trägt. 10 Minuten.',
  },
  {
    id: 'vis06',
    label: 'Sichtbar 0,6 µm (hochaufgelöst)',
    workspace: 'mtg_fd',
    name: 'vis06_hrfi',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    // ≈1,0 km/px — die reale Auflösung dieses Kanals über Mitteleuropa.
    imageWidth: 1600,
    dayOnly: true,
    note: 'MTG/FCI HRFI VIS 0,6 µm: der schärfste Kanal des Dienstes (500 m am Subsatellitenpunkt, über Mitteleuropa ~1 km) — Nachfolger des MSG-HRV, das hier nicht veröffentlicht ist. Misst reflektiertes Sonnenlicht, ist nachts also schwarz. 10 Minuten.',
  },
  {
    id: 'ir105',
    label: 'Infrarot 10,5 µm',
    workspace: 'mtg_fd',
    name: 'ir105_hrfi',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    note: 'MTG/FCI Infrarotkanal 10,5 µm: Strahlungstemperatur der Wolkenoberseite — je kälter (heller), desto höher die Wolke. 10 Minuten.',
  },
  {
    id: 'airmass',
    label: 'Luftmassen-RGB',
    workspace: 'msg_fes',
    name: 'rgb_airmass',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    note: 'MSG Airmass-RGB: Luftmassen und Strahlströme. Rot/Orange zeigt trockene, potenziell warme Stratosphärenluft (PV-Anomalie) hinter Fronten. 15 Minuten.',
  },
  {
    id: 'convection',
    label: 'Konvektions-RGB',
    workspace: 'msg_fes',
    name: 'rgb_convection',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    note: 'MSG Convection-RGB: hebt junge, kräftige Gewitterzellen hervor (gelb = kleine Eisteilchen und hohe Kerne). 15 Minuten.',
  },
]

export const DEFAULT_SATELLITE_PRODUCT = SATELLITE_PRODUCTS[0]

export function getSatelliteProduct(id: string): SatelliteProduct {
  return SATELLITE_PRODUCTS.find((p) => p.id === id) ?? DEFAULT_SATELLITE_PRODUCT
}

// --- Zeitdimension und URLs ------------------------------------------------

/**
 * GetCapabilities des LAYER-EIGENEN virtuellen WMS
 * (`/geoserver/<workspace>/<layer>/wms`) — 6,5 KB statt 282 KB für den ganzen
 * Dienst, derselbe Trick wie beim Radar. Nur dort steht, welche Zeitschritte
 * es gerade gibt.
 */
export function satelliteCapabilitiesUrl(p: SatelliteProduct): string {
  return (
    `https://view.eumetsat.int/geoserver/${p.workspace}/${p.name}/wms` +
    '?service=WMS&version=1.3.0&request=GetCapabilities'
  )
}

/**
 * Zeitdimension des Layers. Anders als beim Radar wird KEINE Fläche gelesen:
 * die gibt `SATELLITE_AREA` vor (Begründung dort).
 */
export function parseSatelliteCapabilities(
  xml: string,
  p: SatelliteProduct,
): TimeExtent | null {
  const dim = extractTimeDimension(xml)
  if (!dim) return null
  const extent = parseTimeExtent(dim)
  if (!extent) return null
  return extent.stepMs > 0 ? extent : { ...extent, stepMs: p.stepMs }
}

/**
 * Zeitpunkte der Schleife: `historyMs` rückwärts vom Ende der Dimension.
 *
 * Es gibt hier KEINEN Vorhersageteil abzuschneiden (der Dienst liefert nur
 * Messungen), das Ende der Dimension ist also der neueste Stand.
 */
export function satelliteTimes(extent: TimeExtent, historyMs: number): number[] {
  return frameTimes(extent, extent.end, historyMs)
}

/**
 * Ein Bild je Zeitschritt über die feste Fläche, in EPSG:3857.
 *
 * Mercator, weil MapLibre eine image-Source LINEAR im Mercator-Raum aufspannt:
 * so stimmt die Zuordnung exakt, ohne die Vorverzerrung, die
 * `render/fieldImage.ts` für lat/lon-Gitter braucht. Ein Vollflächenbild statt
 * Kacheln, weil ein Zeitschritt dann EINEN Abruf kostet, die Folge sich
 * vorladen lässt und ein Verschieben der Karte keinen neuen Abruf auslöst.
 */
export function satelliteImageUrl(
  p: SatelliteProduct,
  opts: { time: number; width: number; height: number },
): string {
  const { minx, miny, maxx, maxy } = SATELLITE_MERC
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: satelliteLayer(p),
    styles: '',
    format: p.format,
    crs: 'EPSG:3857',
    bbox: `${Math.round(minx)},${Math.round(miny)},${Math.round(maxx)},${Math.round(maxy)}`,
    width: String(opts.width),
    height: String(opts.height),
    time: new Date(opts.time).toISOString().replace('.000', ''),
  })
  return `${EUMETSAT_WMS_BASE}?${q.toString()}`
}

export function satelliteImageHeight(width = SATELLITE_IMAGE_WIDTH): number {
  return imageHeightFor(SATELLITE_MERC, width)
}

export function satelliteImageCoordinates(): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return imageCoordinates(SATELLITE_AREA)
}
