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
// GRÖSSE: JPEG, nicht PNG. Gemessen bei 1400 px Breite über der Vollfläche:
// Geocolour als JPEG 266 KB, als PNG8 1,18 MB — Faktor 4,4 bei einem
// Fotomotiv, für das PNG das falsche Format ist. `format_options=quality:70`
// ändert nichts (byte-identisch zu 85), nicht erneut versuchen.
//
// **DAS ANGEFORDERTE RASTER MUSS ZUM NATIVEN RASTER DES PRODUKTS PASSEN — und
// tat es lange nicht.** Gemessen (2026-09-21, stark überzoomt über den Alpen
// bei 126 m/px, Blockstruktur über die Autokorrelation des Spaltengradienten
// — dasselbe Verfahren, mit dem beim Radar die Nearest-Neighbour-Rasterung
// nachgewiesen wurde):
//
//   vis06_hrfi      788 × 1178 m (Mercator)  ≈ 0,54 × 0,80 km am Boden, 47 °N
//   ir105_hrfi     1113 × 1670 m             ≈ 0,76 × 1,14 km
//   rgb_geocolour  1577 × 2337 m             ≈ 1,08 × 1,59 km
//   rgb_airmass    keine Periodik < 24 px    ≈ 3 km (MSG/SEVIRI, nativ grob)
//
// EUMETView liefert HRFI also WIRKLICH mit 500 m. Der frühere Abruf — ALLE
// Produkte über die 22° breite Vollfläche mit 1600 bzw. 1100 px — war damit
// 1,3× bis 2,0× gröber als die Quelle, und zwar genau dort, wo man das
// Produkt wegen seiner Schärfe nimmt. Gegenprobe über denselben Ausschnitt,
// alles auf ein gemeinsames Zielraster gebracht, mittlerer
// Nachbarschaftsgradient als Maß für überlebende Struktur:
//
//   nativ angefordert          1,163   (= 100 %)
//   Detailfläche  2000 px      0,727   (63 %)   ← jetzt
//   Vollfläche    3200 px      0,717   (62 %)   bei 1,8× der Bytes
//   Vollfläche    1600 px      0,523   (45 %)   ← vorher
//   Vollfläche    1100 px      0,415   (36 %)
//
// Die frühere Notiz „mehr Pixel bringen nichts mehr, kosten aber Bytes"
// stützte sich auf die DATEIGRÖSSEN und ist damit widerlegt — nicht erneut
// aus der Byte-Kurve auf den Bildinhalt schließen.
//
// **ZWEI FLÄCHEN, und das ist der Handel**: die Vollfläche nativ anzufordern
// hieße 3200 px und 990 KB je Bild (bei `PREFETCH_RECENT` = 12 also 12 MB
// beim Öffnen). Die beiden HRFI-Produkte bekommen deshalb eine ENGERE Fläche
// (`SATELLITE_DETAIL_AREA`), auf der sie mit weniger Pixeln nativ sind; alles
// Übrige bleibt auf der Vollfläche. Kosten je Bild, über den echten Abrufpfad
// gemessen (Tagbild, 11 UTC):
//
//   vis06_hrfi     Detailfläche 2000 px   546 KB   ( 779 m/px, nativ)
//   ir105_hrfi     Detailfläche 1400 px   188 KB   (1113 m/px, nativ)
//   rgb_geocolour  Vollfläche   1600 px   302 KB   (1531 m/px, nativ)
//   MSG-RGBs       Vollfläche   1100 px  ~138 KB   (2226 m/px, 2× über Bedarf)
//
// **Der zweite Teil der Unschärfe liegt NICHT hier, sondern an der Anzeige.**
// Ein festes Bild über eine feste Fläche wird von der Karte gestreckt, sobald
// der Kartenbereich in GERÄTEpixeln breiter ist als der gezeigte Ausschnitt
// des Bildes — bei `devicePixelRatio` 2 also schon in der Voreinstellung.
// Rechnung: das Bild spannt seine Fläche über `width` Pixel, ab
// z = log2(width / (Längengrad-Anteil × 512)) ist jeder weitere Zoom reine
// Vergrößerung; für vis06 sind das jetzt z ≈ 6,6 statt vorher 5,7. Weiter
// käme man nur mit KACHELN je Zoomstufe — die kosten je Zeitschritt ein
// Dutzend Abrufe statt einem, und jedes Verschieben der Karte löste neue aus.
// Bewusst nicht gemacht, siehe `satelliteImageUrl`.

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

/**
 * ENGERE Fläche für die beiden hochaufgelösten MTG-Kanäle (`vis06_hrfi`,
 * `ir105_hrfi`). Sie ist kein Geschmacksausschnitt, sondern die Rechnung aus
 * dem Kopf der Datei: 14° Länge sind 1.558.473 m in Mercator, bei 2000 px also
 * 779 m/px — praktisch genau das native Raster von HRFI (788 m). Auf der
 * Vollfläche bräuchte dasselbe Raster 3200 px und das Doppelte an Bytes.
 *
 * Der Preis ist der Rand: Krakau, Ostrau und Lille fallen heraus (3 von 134
 * Einträgen der Pseudo-Domain `imagery` in `config/cities.ts`, gemessen) — die
 * Stadtmarken stehen dort dann über dem bloßen Kartenhintergrund. BEIDE
 * Sprungziele der Werkzeugleiste (D-A-CH, Alpen) liegen vollständig innerhalb,
 * ein Test hält das fest: ein Sprungziel außerhalb des Bildes wäre der Fehler,
 * den man dieser Trennung sonst nicht ansieht.
 */
export const SATELLITE_DETAIL_AREA: GeoBox = { west: 4, east: 18, south: 44, north: 56 }

/**
 * Mitte der VOLLfläche — Bezugspunkt für den Sonnenstand. Bewusst nicht je
 * Produkt: die Detailfläche hat denselben Mittelmeridian und liegt nur 1,5°
 * weiter nördlich, und die Frage ist ohnehin nur, ob über dem GEBIET Licht
 * ist. Ob ein sichtbarer Kanal
 * etwas zeigen kann, hängt am Licht über dem GEBIET; ein Punkt genügt dafür,
 * die Fläche ist rund 1.600 km breit und der Unterschied von Rand zu Rand
 * beträgt gut eine Stunde.
 */
export const SATELLITE_CENTER = {
  lat: (SATELLITE_AREA.south + SATELLITE_AREA.north) / 2,
  lon: (SATELLITE_AREA.west + SATELLITE_AREA.east) / 2,
}

/** Dieselbe Fläche in EPSG:3857 — so wird das Bild angefordert. */
export const SATELLITE_MERC: MercBox = mercBox(SATELLITE_AREA)

/**
 * VORGABE-Breite — sie gilt seit der Flächentrennung nur noch für die beiden
 * MSG-RGBs. Die sind nativ 3 km; 1100 px über die Vollfläche sind 2226 m/px in
 * Mercator und damit rund doppelt so fein wie die Quelle. Mehr Pixel bringen
 * DORT wirklich nichts — anders als bei den MTG-Produkten, die ihre Breite
 * selbst mitbringen (`imageWidth`).
 */
export const SATELLITE_IMAGE_WIDTH = 1100

export type SatelliteMission = 'MTG' | 'MSG'

/**
 * Helligkeit → Deckkraft für die Graustufen-Kanäle: unterhalb von `min` ist
 * das Bild durchsichtig (darunter steht der echte Boden), oberhalb von `max`
 * deckend, dazwischen eine Rampe. Werte in Grauwerten 0…255.
 *
 * `solarScaled` gilt für den SICHTBAREN Kanal: er misst reflektiertes
 * Sonnenlicht, seine Schwellen wandern deshalb mit dem Sonnenstand — die
 * Zahlen stehen dann für senkrechten Einfall. Warum das nötig ist und wie die
 * Werte gemessen wurden, steht in `render/cloudComposite.ts`.
 */
export interface CloudMaskSpec {
  min: number
  max: number
  solarScaled?: true
}

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
   * Abweichende Anforderungsbreite. Sie gehört UNTRENNBAR zu `area`: beide
   * zusammen ergeben die m/px, und die sollen zum nativen Raster des Produkts
   * passen (Tabelle im Kopf der Datei). Deshalb gibt es sie nur zusammen über
   * `productImageSize()`.
   */
  imageWidth?: number
  /**
   * Abweichende Fläche. Nur die beiden HRFI-Kanäle haben eine: auf der
   * engeren Fläche sind sie mit 1400 bzw. 2000 px nativ, auf der Vollfläche
   * bräuchten sie 2500 bzw. 3200 px für dasselbe Raster.
   */
  area?: GeoBox
  /**
   * Macht aus dem deckenden Graustufenbild WOLKEN ÜBER ECHTEM BODEN. Nur für
   * die beiden Graustufen-Kanäle: Geocolour bringt seinen Boden selbst mit,
   * und den Deutungs-RGBs die Deckkraft zu nehmen zerstörte ihre Aussage.
   */
  cloudMask?: CloudMaskSpec
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

/** Fläche, die DIESES Produkt zeigt. */
export function productArea(p: SatelliteProduct): GeoBox {
  return p.area ?? SATELLITE_AREA
}

// Die Projektion einer Fläche ist eine reine Rechnung über vier Zahlen, wird
// aber in jeder Renderrunde gebraucht — gecacht über die Fläche SELBST, nicht
// über die Produkt-Id: zwei Produkte teilen sich eine Fläche und sollen sich
// auch ihre Projektion teilen.
const mercCache = new WeakMap<GeoBox, MercBox>()

/** Diese Fläche in EPSG:3857 — so wird das Bild angefordert. */
export function productMerc(p: SatelliteProduct): MercBox {
  const area = productArea(p)
  let merc = mercCache.get(area)
  if (!merc) {
    merc = mercBox(area)
    mercCache.set(area, merc)
  }
  return merc
}

/**
 * Breite UND Höhe in EINEM Griff. Getrennt wäre es eine Einladung zum Fehler:
 * eine Breite mit der Höhe einer ANDEREN Fläche kombiniert liefert ein Bild
 * mit falschem Seitenverhältnis, das der Dienst klaglos rendert und die Karte
 * klaglos über die richtigen Ecken spannt — man sieht es erst daran, dass die
 * Küstenlinie nicht mehr passt.
 */
export function productImageSize(p: SatelliteProduct): { width: number; height: number } {
  const width = productImageWidth(p)
  return { width, height: imageHeightFor(productMerc(p), width) }
}

/**
 * Zoomstufe, AB DER die Karte das Bild vergrössert statt es zu verkleinern —
 * und damit die Grenze, ab der geglättet oder gestuft dargestellt werden soll.
 *
 * Warum das eine eigene Rechnung ist: das Bild ist EINES über eine feste
 * Fläche, seine Pixeldichte auf dem Schirm hängt also allein am Zoom. Es
 * spannt `width` Pixel über `east−west` Grad; die Welt hat bei Zoom z
 * 512·2^z Pixel, gleichgesetzt ergibt das die Stufe, auf der ein Bildpixel
 * genau ein Kartenpixel ist. Darüber wird vergrössert — und dort ist NEAREST
 * richtig: es zeigt die Messpixel, wie sie sind (dasselbe, was der Dienst
 * selbst täte, wenn man ihn feiner anfragt — gemessen, er rastert nearest
 * neighbour). Darunter wird verkleinert, und dort ist LINEAR richtig, sonst
 * flimmert beim Verschieben jede zweite Zeile weg.
 *
 * `pixelRatio` gehört dazu: auf einem Gerät mit `devicePixelRatio` 2 beginnt
 * die Vergrösserung eine ganze Zoomstufe früher, als die Kartenzoomstufe
 * (in CSS-Pixeln gezählt) vermuten lässt.
 */
export function magnificationZoom(p: SatelliteProduct, pixelRatio = 1): number {
  const area = productArea(p)
  const { width } = productImageSize(p)
  const worldPx = (width * 360) / (area.east - area.west)
  return Math.log2(worldPx / 512) - Math.log2(Math.max(1, pixelRatio))
}

/**
 * Zoomstufe, ab der das Bild GESTUFT statt geglättet dargestellt wird — eine
 * ganze Stufe UNTER der 1:1-Grenze, und das ist gemessen, nicht gerundet.
 *
 * Die naheliegende Wahl wäre `magnificationZoom` selbst. Sie ist falsch: schon
 * bei knapper VERkleinerung (die Alpen-Ansicht liegt bei z ≈ 6,5 gegen eine
 * 1:1-Grenze von 6,65) mittelt die bilineare Filterung jeden Ausgabepixel aus
 * vier Quellpixeln, weil die beiden Raster nicht aufeinander liegen — im
 * direkten Vergleich am selben Zeitpunkt verschwimmen dort einzelne
 * Quellwolken zu einer Fläche, die gestufte Darstellung zeigt sie einzeln.
 * Aliasing bekommt man umgekehrt erst, wenn deutlich mehr als ein Quellpixel
 * auf einen Bildschirmpixel fällt. Eine Zoomstufe = Faktor 2 ist die Grenze,
 * an der beides gerade nicht stört: darunter (Übersicht) geglättet, darüber
 * (Detail) gestuft.
 */
export function resamplingSwitchZoom(p: SatelliteProduct, pixelRatio = 1): number {
  return magnificationZoom(p, pixelRatio) - 1
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
    // Bleibt auf der VOLLFLÄCHE — Geocolour ist das Produkt, mit dem man die
    // Lage im Grossen ansieht, und sein natives Raster (1577 m in Mercator)
    // ist dort bei 1600 px genau getroffen (1531 m/px). 302 KB je Bild.
    imageWidth: 1600,
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
    // NATIV: 2000 px über die Detailfläche sind 779 m/px in Mercator, das
    // gemessene Raster des Kanals sind 788 m. 546 KB je Tagbild.
    area: SATELLITE_DETAIL_AREA,
    imageWidth: 2000,
    // Gemessen bei 40° Sonnenhöhe: Boden 37–70, Wolke ab ~90, dicht über 130.
    // Geteilt durch sin(40°) = 0,64 ergibt das diese sonnenunabhängigen Werte.
    cloudMask: { min: 124, max: 218, solarScaled: true },
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
    // Ebenfalls HRFI, aber gröber als der sichtbare Kanal: gemessenes Raster
    // 1113 m, 1400 px über die Detailfläche sind 1113 m/px — dasselbe Bild für
    // 188 KB. Mit den 2000 px von vis06 wäre es nur teurer, nicht schärfer.
    area: SATELLITE_DETAIL_AREA,
    imageWidth: 1400,
    // Fest, denn Wärmestrahlung hängt nicht am Sonnenstand. Gemessen:
    // Boden 24–90, Wolke ab ~90, hohe Wolke über 140.
    cloudMask: { min: 78, max: 140 },
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
  const { minx, miny, maxx, maxy } = productMerc(p)
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

/** Ecken für die MapLibre-image-Source — die Fläche DIESES Produkts. */
export function satelliteImageCoordinates(
  p: SatelliteProduct,
): [[number, number], [number, number], [number, number], [number, number]] {
  return imageCoordinates(productArea(p))
}

// --- Ladepolitik der Schleife ---------------------------------------------
//
// Reine Funktion, damit sie prüfbar ist: WELCHE Bilder zu einem Zustand
// geladen sein sollen, ist die eine Entscheidung, an der bei einer
// 24-Stunden-Leiste alles hängt — Bandbreite, Wartezeit und die Frage, ob
// beim Aufbau versehentlich der Stand von gestern geholt wird.

/**
 * Was geladen wird: die jüngsten `PREFETCH_RECENT` Bilder (der Teil, den fast
 * jeder ansieht) plus ein Fenster um den Zeiger — zwei Schritte zurück, damit
 * kurzes Zurückziehen sofort etwas zeigt, und `LOOKAHEAD` voraus, damit die
 * Schleife nicht bei jedem Bild stehenbleibt.
 */
export const PREFETCH_RECENT = 12
export const LOOKAHEAD = 8
export const LOOKBEHIND = 2

/**
 * Obergrenze der im Speicher gehaltenen Bilder. Ohne sie sammelt eine Sitzung,
 * in der jemand den ganzen Tag durchzieht, alle 145 Blobs an (~26 MB); über
 * dieser Zahl werden die ältesten wieder freigegeben, die gerade niemand
 * braucht.
 */
export const MAX_CACHED = 48

/** Zeitpunkte, die zum aktuellen Zustand geladen sein sollten. */
export function wantedTimes(times: number[], idx: number, playing: boolean): number[] {
  if (times.length === 0) return []
  const want = new Set<number>()
  for (let i = Math.max(0, times.length - PREFETCH_RECENT); i < times.length; i++) {
    want.add(times[i])
  }
  // idx < 0: der Zeiger hat sich noch nicht gesetzt (erster Aufbau). Dann nur
  // die jüngsten Bilder holen — ein Fenster um Index 0 wäre der Stand von vor
  // 24 Stunden, den in dem Moment niemand sehen will.
  if (idx < 0) return [...want]
  const from = Math.max(0, idx - LOOKBEHIND)
  const to = Math.min(times.length - 1, idx + (playing ? LOOKAHEAD : LOOKBEHIND))
  for (let i = from; i <= to; i++) want.add(times[i])
  return [...want]
}
