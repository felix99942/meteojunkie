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
// **DIE VORHERSAGE IST BEWUSST DRAUSSEN** (auf Wunsch entfernt). Der Dienst
// liefert sie mit: die Produkte WN und RV tragen am Ende ihrer Zeitdimension
// 2 Stunden Verlagerungsrechnung (DWD RADVOR — ähnliche Strukturen zweier
// Komposite wiedererkennen, Verlagerungsvektorfeld bestimmen, das Echofeld in
// 5-Minuten-Schritten fortschreiben; keine Entstehung, kein Zerfall, keine
// NWV-Physik). `forecastMs` sagt, wie viel davon am Ende steht, und
// `analysisTime()` schneidet es ab — GEZEIGT WIRD NUR GEMESSENES.
//
// Wer sie je zurückholt, braucht dann auch wieder das Festhalten der
// Abdeckung: verschoben wird das GANZE Feld, einschliesslich der „keine
// Daten"-Kennung, die Radarkreise der Abdeckungsgrenze wandern also mit dem
// Wind mit. Gemessen (2026-09-16, 1200-px-Bild, +120 min): 50.342 Pixel, die
// in der Analyse maskiert sind, zeigen im Vorhersagebild Inhalt, der aus dem
// Inneren über unbeobachtetes Gebiet geschoben wurde; der Schwerpunkt der
// Maske verschiebt sich um 60 px nach Westen. Der Code dafür ist mit der
// Vorhersage entfallen, die Messung bleibt hier stehen.
//
// **AKTUALITÄT: 5 Minuten Takt, rund 3 Minuten Verzug** — gemessen
// (2026-09-16, Minutenproben): das Bild für 22:30 UTC stand zwischen 22:32:26
// und 22:33:07 zur Verfügung. Näher an „jetzt" kommt man an dieser Quelle
// nicht, und feiner als 5 Minuten gibt es sie nicht. Was fehlte, war das
// automatische Nachrücken im Browser (siehe `RadarPanel`): ohne das blieb die
// Seite auf dem Stand des Seitenaufrufs stehen und sah alt aus, obwohl die
// Quelle längst weiter war.
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

import {
  DWD_GEOSERVER,
  EUMETSAT_GEOSERVER,
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

/** Basis-URL des DWD-GeoServers (Workspace `dwd`). */
export const DWD_WMS_BASE = `${DWD_GEOSERVER}/dwd/wms`
/** Basis für den LAYER-EIGENEN virtuellen WMS desselben Workspace. */
const DWD_CAPS_BASE = `${DWD_GEOSERVER}/dwd`

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

/**
 * Niederschlagshöhe der letzten STUNDE in mm (Produkt RADOLAN-RW).
 *
 * Dieselbe 13-Farben-Rampe, die der DWD auch für RY und für die Blitzdichte
 * benutzt — nur die Schwellen unterscheiden sich. **Sie führt `#DA28C6`**, und
 * das ist der Grund, warum RW und RY die Randlinien-Nachbearbeitung NICHT
 * durchlaufen dürfen (siehe `WmsImageSource.edgeLine`).
 */
export const RW_LEGEND: RadarLegendStep[] = [
  { color: '#FCFFC1', label: '0,1' },
  { color: '#FBFF5C', label: '0,2' },
  { color: '#DFFC26', label: '0,5' },
  { color: '#A0D626', label: '1' },
  { color: '#45C379', label: '2' },
  { color: '#00D6D8', label: '5' },
  { color: '#11A1D6', label: '10' },
  { color: '#0702FC', label: '15' },
  { color: '#9232B7', label: '25' },
  { color: '#DA28C6', label: '40' },
  { color: '#E70D0C', label: '60' },
  { color: '#880E0D', label: '80' },
  { color: '#4F0E0D', label: '100' },
]

/** Niederschlagshöhe je 5 Minuten in mm (Produkt RADOLAN-RY) — gleiche Rampe, andere Schwellen. */
export const RY_LEGEND: RadarLegendStep[] = [
  { color: '#FCFFC1', label: '0,01' },
  { color: '#FBFF5C', label: '0,02' },
  { color: '#DFFC26', label: '0,05' },
  { color: '#A0D626', label: '0,1' },
  { color: '#45C379', label: '0,25' },
  { color: '#00D6D8', label: '0,5' },
  { color: '#11A1D6', label: '1' },
  { color: '#0702FC', label: '1,5' },
  { color: '#9232B7', label: '2,5' },
  { color: '#DA28C6', label: '4' },
  { color: '#E70D0C', label: '6' },
  { color: '#880E0D', label: '10' },
]

/**
 * Niederschlagssumme des laufenden HYDROLOGISCHEN JAHRES in mm (Produkt
 * RADOLAN-SY), also seit dem 1. November. Eigene Rampe mit Schwellen bis
 * 1.200 mm — eine Jahressumme hat nichts mit einer Stundensumme gemein.
 */
export const SY_LEGEND: RadarLegendStep[] = [
  { color: '#FFFFC6', label: '0,1' },
  { color: '#FFFF5A', label: '40' },
  { color: '#FFD700', label: '80' },
  { color: '#ADFF2F', label: '120' },
  { color: '#A5D721', label: '200' },
  { color: '#42C37B', label: '300' },
  { color: '#BFEFFF', label: '400' },
  { color: '#00D7DE', label: '450' },
  { color: '#10A2D6', label: '500' },
  { color: '#0000FF', label: '550' },
  { color: '#9430B5', label: '600' },
  { color: '#E720CE', label: '650' },
  { color: '#FFA500', label: '700' },
  { color: '#E70C08', label: '800' },
  { color: '#840C08', label: '900' },
  { color: '#946163', label: '1000' },
  { color: '#FFFFFF', label: '1200' },
]

/** Niederschlagssumme der letzten 4 WOCHEN in mm (Produkt RADOLAN-W4). */
export const W4_LEGEND: RadarLegendStep[] = [
  { color: '#AED1EA', label: '0,1' },
  { color: '#586AF4', label: '30' },
  { color: '#000BF3', label: '60' },
  { color: '#006F8F', label: '90' },
  { color: '#00CC33', label: '120' },
  { color: '#77FF00', label: '150' },
  { color: '#FFD600', label: '180' },
  { color: '#FF4700', label: '210' },
  { color: '#EC0616', label: '240' },
  { color: '#BD0A4F', label: '270' },
  { color: '#890F89', label: '300' },
]

/**
 * Alles, was eine WMS-Bildquelle dieses Bereichs braucht — das Radarprodukt
 * UND jedes Overlay. Bewusst EIN Typ: der Abruf (`api/dwdRadar.ts`), die
 * Nachbearbeitung und der Zeitschieber behandeln beide gleich, sie
 * unterscheiden sich nur in Layer, Stil und Legende.
 */
export interface WmsImageSource {
  /** Layername für GetMap, mit Workspace-Präfix; KOMMAGETRENNT für mehrere. */
  layer: string
  /**
   * Stilname(n), leer = Vorgabestil des Dienstes. GeoServer führt für dieselben
   * Daten mehrere Stile — bei den KONRAD-Zellen ist genau das der Unterschied
   * zwischen „deckend gefüllt" (verdeckt das Radar) und „nur Umriss".
   */
  style?: string
  /**
   * Layername OHNE Präfix für den **layer-eigenen virtuellen WMS**
   * (`/geoserver/dwd/<Layer>/wms`): dessen GetCapabilities ist 18 KB statt
   * 862 KB für den ganzen Workspace — und nur dort steht, welche Zeitschritte
   * es gerade gibt. Bei mehreren Layern der ERSTE (sie laufen im gleichen Takt).
   */
  capsLayer: string
  /** Schrittweite der Zeitdimension. */
  stepMs: number
  /**
   * Länge eines VORHERSAGE-Teils am Ende der Zeitdimension, der abgeschnitten
   * wird (WN/RV: 2 h Verlagerungsrechnung; Overlays: 0).
   */
  forecastMs: number
  /**
   * Deckkraft der „Keine Daten"-Maske im Produktstil — **oder `null`, wenn die
   * Quelle keine hat**. Rein BESCHREIBEND: sie sagt der Legende, ob und wie
   * kräftig das Grau der Abdeckungsgrenze zu zeigen ist. Gemessen an den
   * gelieferten Bildern: WN 0,5 · RV/RW/RY 0,3 (Alphawert 77 von 255) ·
   * SY/W4 gar keine.
   */
  maskOpacity: number | null
  /**
   * Zeichnet dieses Produkt die magentafarbene RANDLINIE, die weggerechnet
   * werden muss (`render/radarImage.ts`)? Nur WN und RV tun das — an den
   * RADOLAN-Bildern ist sie gemessen NICHT vorhanden (2026-09-29, kein
   * einziges magentanahes Pixel in RW/RY/W4).
   *
   * **Das ist bewusst ein EIGENES Feld und nicht mehr an `maskOpacity`
   * gekoppelt.** Die beiden fielen bisher zusammen, weil es nur zwei Produkte
   * gab; mit RADOLAN gehen sie auseinander: RW und RY HABEN die graue Maske
   * (0,3), dürfen die Regel aber auf keinen Fall durchlaufen — ihre Rampe
   * führt `#DA28C6` als echte Klassenfarbe (40–60 mm/h), und genau diese
   * Farbe kommt der Mischlinie der Regel bis auf 3 Einheiten nahe (die
   * Warnung stand schon für die Blitzdichte da, die dieselbe Rampe benutzt).
   * Umgekehrt trägt SY mit `#E720CE` (650–700 mm) eine weitere, und hat gar
   * keine Maske. Wer ein Produkt ergänzt, setzt das Feld nur, wenn er die
   * Linie im Bild wirklich gesehen hat.
   */
  edgeLine?: true
  /**
   * Breite des angeforderten Bildes. Vorgabe ist `RADAR_IMAGE_WIDTH`; die
   * SYMBOL-Overlays brauchen mehr, weil ihre Kreise und Pfeile in Pixeln des
   * angeforderten Bildes gezeichnet werden und beim Hochskalieren sonst
   * unscharf und zu groß auf der Karte stehen.
   */
  imageWidth?: number
  /**
   * GetMap-Endpunkt, falls die Quelle NICHT vom DWD kommt. Vorgabe ist
   * `DWD_WMS_BASE`; der MTG-Blitz-Layer liegt bei EUMETSAT (derselbe Dienst,
   * den der Satellitenbereich benutzt).
   */
  wmsBase?: string
  /**
   * Basis für den layer-eigenen virtuellen WMS (`<capsBase>/<capsLayer>/wms`).
   * Vorgabe ist der DWD-Workspace.
   */
  capsBase?: string
  /**
   * EIGENE Fläche, statt sie aus dem GetCapabilities zu lesen.
   *
   * Nötig für Layer, deren Dienst die ganze sichtbare Halbkugel meldet
   * (MTG: ±70°, ein Bild darüber wäre für Mitteleuropa nutzlos) — und dort
   * sowieso, weil das MTG-Capabilities **gar keine EPSG:3857-BoundingBox**
   * führt (gemessen 2026-09-29: nur CRS:84 und EPSG:4326), die
   * Mercator-Ecken also ohnehin selbst gerechnet werden müssen.
   */
  area?: GeoBox
}

export interface RadarProduct extends WmsImageSource {
  id: string
  label: string
  /**
   * Layername OHNE Präfix für den **layer-eigenen virtuellen WMS**
   * (`/geoserver/dwd/<Layer>/wms`): dessen GetCapabilities ist 18 KB statt
   * 862 KB für den ganzen Workspace — und nur dort steht, welche Zeitschritte
   * es gerade gibt.
   */
  /** Einheit der Skala — Beschriftung der Legende. */
  unit: string
  /**
   * Deckkraft der Maske — `null` bei den Summenprodukten SY und W4, die
   * gemessen gar keine führen (dort fällt die Zeile „keine Radardaten" in der
   * Legende weg, sie hätte nichts zu erklären).
   */
  maskOpacity: number | null
  /** Farbstufen, 1:1 aus dem GetLegendGraphic des Layers (siehe unten). */
  legend: RadarLegendStep[]
  /** Kurzbeschreibung für den Tooltip der Produktauswahl. */
  note: string
  /**
   * Eigene Fensterlängen der Schleife, falls die Vorgabe (Minuten) nicht
   * passt. Die Summenprodukte laufen im TAGEStakt: mit „1 h" bestünde die
   * Schleife aus einem einzigen Bild, und der Zeitschieber hätte keine
   * Funktion mehr. Erster Eintrag ist die Vorgabe.
   */
  historyOptions?: { min: number; label: string }[]
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
/**
 * Fensterlängen der TAGESprodukte (SY, W4). Der Vorgabewert steht vorn und
 * ist bewusst kurz: ein W4-Bild wiegt gemessen 311 KB bei 1.200 px, 30 Tage
 * wären also über 9 MB bei einem fremden, kostenlosen Dienst. Die Zahl ist in
 * MINUTEN, wie überall in diesem Bereich.
 */
const DAILY_HISTORY = [
  { min: 7 * 24 * 60, label: '7 Tage' },
  { min: 14 * 24 * 60, label: '14 Tage' },
  { min: 30 * 24 * 60, label: '30 Tage' },
]

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
    edgeLine: true,
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
    edgeLine: true,
    legend: RV_LEGEND,
    note: 'Dasselbe Komposit als Niederschlagsrate (Produkt RV) — aus der Reflektivität über eine Z-R-Beziehung abgeleitet',
  },
  // --- RADOLAN ------------------------------------------------------------
  //
  // Die vier folgenden Produkte sind KEINE weitere Ansicht desselben Echos,
  // sondern eine andere ART Zahl: RADOLAN eicht das Radar an den
  // Niederschlagsmessern der Bodenstationen. Damit fällt der größte Fehler
  // der reinen Radarmessung weg — die Z-R-Beziehung nimmt eine
  // Tropfengrößenverteilung an, die sie nicht messen kann (siehe die
  // Begründung, warum dieser Bereich dBZ zeigt und nicht mm/h). Die Eichung
  // braucht dafür Zeit: RW erscheint erst rund eine halbe Stunde nach dem
  // Termin, ein Nowcast ist das nicht.
  //
  // **Abdeckung ist eine andere als bei WN/RV** (gemessen 2026-09-29):
  // lon 2,07–15,72 · lat 47,14–55,09, und der DWD sagt dazu ausdrücklich
  // „Daten nur innerhalb Deutschlands". Von Österreich liegt damit nichts
  // Brauchbares drin — diese Produkte sind für den deutschen Teil der Karte.
  {
    id: 'rw',
    label: 'Stundensumme, angeeicht (mm)',
    layer: 'dwd:RADOLAN-RW',
    capsLayer: 'RADOLAN-RW',
    // PT10M, nicht 5 Minuten wie WN/RV — gemessen aus der Zeitdimension.
    stepMs: 10 * 60_000,
    forecastMs: 0,
    unit: 'mm/1 h',
    maskOpacity: 0.3,
    legend: RW_LEGEND,
    note: 'RADOLAN-RW: Niederschlagshöhe der letzten Stunde, an den Stationsmessungen ANGEEICHT — die einzige Radarzahl dieses Bereichs, der man Millimeter wirklich glauben kann. 1 km, alle 10 Minuten, nur über Deutschland. Dafür rund eine halbe Stunde Verzug: die Eichung braucht die Stationswerte',
  },
  {
    id: 'ry',
    label: '5-Minuten-Summe (mm)',
    layer: 'dwd:RADOLAN-RY',
    capsLayer: 'RADOLAN-RY',
    stepMs: 5 * 60_000,
    forecastMs: 0,
    unit: 'mm/5 min',
    maskOpacity: 0.3,
    legend: RY_LEGEND,
    note: 'RADOLAN-RY: qualitätsgeprüfte Radardaten nach Abschattungskorrektur, mit verfeinerter Z-R-Beziehung in Niederschlagshöhe umgerechnet — NICHT an Stationen geeicht (das ist RW), aber korrigiert. 1 km, alle 5 Minuten, nur über Deutschland',
  },
  {
    id: 'w4',
    label: 'Summe 4 Wochen (mm)',
    layer: 'dwd:RADOLAN-W4',
    capsLayer: 'RADOLAN-W4',
    stepMs: 24 * 60 * 60_000,
    forecastMs: 0,
    unit: 'mm/4 Wochen',
    // Gemessen: kein einziges Maskenpixel im Bild — die Summenprodukte
    // zeichnen die Abdeckungsgrenze nicht.
    maskOpacity: null,
    legend: W4_LEGEND,
    note: 'RADOLAN-W4: aufsummierte angeeichte Radardaten der letzten 4 Wochen. Ein KLIMATOLOGISCHES Bild, kein Wetterbild — es beantwortet „wie nass war der letzte Monat", nicht „regnet es gerade". Ändert sich täglich, nicht minütlich',
    historyOptions: DAILY_HISTORY,
  },
  {
    id: 'sy',
    label: 'Summe hydrolog. Jahr (mm)',
    layer: 'dwd:RADOLAN-SY',
    capsLayer: 'RADOLAN-SY',
    stepMs: 24 * 60 * 60_000,
    forecastMs: 0,
    unit: 'mm seit 1.11.',
    maskOpacity: null,
    legend: SY_LEGEND,
    note: 'RADOLAN-SY: fortlaufende Niederschlagssumme des laufenden HYDROLOGISCHEN Jahres, also seit dem 1. November — die übliche Bilanzperiode der Hydrologie, weil sie den Winterniederschlag samt Schneeschmelze in EIN Jahr legt statt ihn an Silvester zu zerschneiden. Wächst monoton; die Zeitschleife zeigt, wo die Summe zuletzt zugelegt hat',
    historyOptions: DAILY_HISTORY,
  },
]

export const DEFAULT_RADAR_PRODUCT = RADAR_PRODUCTS[0]

/**
 * Passen die Overlays zu diesem Produkt?
 *
 * Nur zu den NOWCAST-Kompositen. Über einer 4-Wochen-Summe ist „Blitze der
 * letzten 5 Minuten" keine Ergänzung, sondern ein Widerspruch — und technisch
 * fällt es sofort auf die Nase: die Zeitschritte eines Tagesprodukts liegen
 * nicht in der Dimension eines 5-Minuten-Layers, der Dienst antwortet je Bild
 * mit einer ServiceException (live gesehen: 30 vergebliche Abrufe beim
 * Umschalten auf W4). Entschieden am TAKT und nicht an einer Id-Liste, damit
 * ein weiteres Summenprodukt nicht wieder in dieselbe Falle läuft.
 */
export function supportsOverlays(p: RadarProduct): boolean {
  return p.stepMs <= 15 * 60_000
}

// --- Overlays --------------------------------------------------------------
//
// Alles vom SELBEN Dienst und mit derselben Mechanik wie das Radar: eigene
// Zeitdimension im 5-Minuten-Takt, CORS offen, GeoNutzV. Nur GEMESSENES bzw.
// aktuell Erkanntes — die `fcst_*`-Layer des KONRAD-Verfahrens (Prognosekegel,
// Vorhersagespuren) bleiben draußen, wie die Radarvorhersage auch.
//
// **Die Abdeckung ist je Overlay ANDERS als beim Radar**, und das ist kein
// Detail (Werte aus dem jeweiligen GetCapabilities, 2026-09-16):
//   Blitzdichte      lon 1,7–18,5 · lat 46,95–54,91  → ganz Österreich in der
//                    Länge, im Süden fehlt Kärnten (Klagenfurt 46,62 °N)
//   Gewittercluster  lon 5,0–16,0 · lat 47,0–55,30    → Wien liegt knapp draußen
//   KONRAD-Zellen    lon 4,03–16,21 · lat 46,36–55,45 → am weitesten nach
//                    Süden und Osten, deckt fast ganz Österreich
// Deshalb hat jedes Overlay seine EIGENE `RadarMeta` (Fläche und Zeitschritte
// aus seinem eigenen Capabilities) und seine eigenen Bildecken.

export type OverlayLegend =
  /** Kreuze nach Alter (Blitze) — die Farbe IST die Information. */
  | { kind: 'crosses'; items: { color: string; label: string }[]; caption: string }
  /** Symbolklassen (Zellen, Cluster, KONRAD): Punkt bzw. Umriss je Stufe. */
  | { kind: 'dots'; items: { color: string; label: string }[]; caption: string }
  | { kind: 'rings'; items: { color: string; label: string }[]; caption: string }

/**
 * Altersstufen der Blitz-Kreuze, je 5 Minuten, jüngste zuerst. Gezeichnet wird
 * von ALT nach NEU, das jüngste Kreuz liegt also oben.
 *
 * Gelb → Orange → Rot → Violett ist die übliche Leserichtung solcher
 * Darstellungen (frisch = heiß). **Die Stufen sind durch das Produkt auf
 * 15 Minuten gerundet**: jedes Bild fasst die Blitze der letzten 15 Minuten
 * zusammen, eine Zelle kann also in drei aufeinanderfolgenden Bildern stehen.
 * Feiner geht es mit dieser Quelle nicht — und Einzelblitze mit Zeitstempel
 * gibt der DWD gar nicht heraus.
 */
export const LIGHTNING_AGES: { color: string; label: string }[] = [
  { color: '#FFF44F', label: '0–5' },
  { color: '#FFA726', label: '5–10' },
  { color: '#EF5350', label: '10–15' },
  { color: '#AB47BC', label: '15–20' },
]

/**
 * Armlänge eines Blitz-Kreuzes bei `RADAR_IMAGE_WIDTH`: Grundmaß plus Zuschlag
 * je Stufe der Blitzrate. **Die Größe trägt die Rate, die Farbe das Alter** —
 * ohne die Staffelung stand über einem großen Gewittercluster ein
 * gleichförmiges Kreuzgitter, in dem die elektrisch aktiven Kerne nicht mehr
 * herausstachen (nachgestellt an der Böenlinie vom 16.09.2026, 15 UTC).
 * Die Maße sind an genau dieser Lage nachgestellt und nicht geschätzt: bei
 * 1.200 px Bildbreite liegen die 10-km-Zellen rund 9,6 px auseinander, ein
 * Kreuz darf also höchstens ~6 px breit werden, sonst entsteht ein
 * geschlossenes Gitter, das das Radarecho zudeckt. Mit 1,6 + 0,35 je Stufe
 * bleiben die beobachteten Stufen 4–10 bei 3,0 bis 5,1 px Armlänge.
 */
export const LIGHTNING_ARM = 1.6
export const LIGHTNING_ARM_PER_LEVEL = 0.35

/**
 * Farbstufen der Blitzdichte, 1:1 aus `GetLegendGraphic&format=application/json`
 * des Layers (2026-09-16), von schwach nach stark: 0,1 · 0,2 · 0,5 · 1 · 2 · 5 ·
 * 10 · 15 · 25 · 40 · 60 · 80 · >100 Blitze pro Minute und 100 km².
 *
 * Gezeigt wird die Skala NICHT (die Karte trägt Kreuze, keine Dichtefläche) —
 * gebraucht wird sie, um aus der Pixelfarbe die STUFE zurückzulesen, denn die
 * Rate steckt im Bild und nirgends sonst.
 */
export const LIGHTNING_DENSITY_COLORS = [
  '#FCFFC1',
  '#FBFF5C',
  '#DFFC26',
  '#A0D626',
  '#45C379',
  '#00D6D8',
  '#11A1D6',
  '#0702FC',
  '#9232B7',
  '#DA28C6',
  '#E70D0C',
  '#880E0D',
  '#4F0E0D',
]

/**
 * Farbrampe der MTG-BLITZFLÄCHE (`li_afa`), am Legendenbild abgetastet
 * (2026-09-29) — ColorBrewer YlOrRd in sieben Stufen.
 *
 * **Nicht aus dem Stil gelesen, weil der keine hergibt**: der SLD des Layers
 * trägt nur einen nackten `RasterSymbolizer` ohne ColorMap (nachgeladen über
 * `request=GetStyles`), die Farben stecken in der Farbtabelle des Rasters.
 * Anders als bei den DWD-Skalen gibt es hier also KEINE ablesbaren
 * Klassengrenzen — die Stufe ist eine relative Intensität und wird in der
 * Legende auch nur so benannt. Gebraucht wird die Rampe, um aus der
 * Pixelfarbe die Stufe zurückzulesen und damit die Ringgröße zu staffeln.
 */
export const FLASH_AREA_COLORS = [
  '#FFF2AE',
  '#FEDF84',
  '#FEB24C',
  '#FD7D37',
  '#F64227',
  '#CD0B21',
  '#8B0026',
]

/**
 * Fläche, über die der MTG-Blitz-Layer angefordert wird.
 *
 * Bewusst DIESELBE Box wie das DWD-Radargitter (lon 1,5–18,7 · lat
 * 45,7–56,2, gemessen aus dessen Capabilities): so decken beide Overlays
 * denselben Boden ab, und der Vergleich „wo sieht die eine Quelle etwas, die
 * andere nicht" ist unmittelbar. Der Dienst selbst meldet die ganze sichtbare
 * Halbkugel (±70°) — ein Bild darüber wäre für Mitteleuropa nutzlos.
 */
export const FLASH_AREA_BOX: GeoBox = { west: 1.5, east: 18.7, south: 45.7, north: 56.2 }

/**
 * Pixelblock, mit dem die Zellen aus dem grob angeforderten Dichtebild
 * zusammengefasst werden (siehe `render/lightning.ts`): eine 10-km-Zelle deckt
 * bei ~4,7 km/px je nach Breite 3 bis 4 Pixel ab.
 */
export const LIGHTNING_BLOCK_PX = 4

/**
 * Overlays, die NICHT als Bild auf die Karte gehen, sondern zu ZELLEN
 * eingekocht und selbst gezeichnet werden.
 *
 * Der Grund steht ausführlich in `render/lightning.ts`: eine eingefärbte
 * Blitzfläche sieht aus wie ein zweites Radarecho und legt sich als Schleier
 * über genau das Echo, das man lesen will. Beide Blitzquellen haben dieses
 * Problem — die DWD-Dichte läuft über Gelb/Grün/Türkis, die MTG-Blitzfläche
 * über YlOrRd (`#FFF2AE → #8B0026`, am Legendenbild abgetastet; eine
 * maschinenlesbare Klassenliste gibt es nicht, der SLD des Layers trägt
 * gemessen KEINE ColorMap). Gezeichnet wird deshalb punktförmig, mit der
 * FARBE als Alter — eine Information, die keine der beiden Skalen hergibt.
 */
export interface CellSymbols {
  /** Farbklassen des Quellbildes; daraus wird die Stufe zurückgelesen. */
  palette: string[]
  /**
   * Pixelblock, der zu EINER Zelle zusammengefasst wird — das Bild wird grob
   * angefordert, eine Produktzelle deckt darin trotzdem mehrere Pixel ab.
   */
  blockPx: number
  /**
   * KREUZ oder RING. Zwei Symbole, weil zwei Quellen dasselbe Gebiet
   * überlappen: über Deutschland liegen DWD-Kreuz und MTG-Ring übereinander
   * (zwei Quellen, die sich einig sind), östlich und südlich davon steht der
   * Ring allein — mit zweimal Kreuzen sähe die Überlappung wie ein Fehler aus.
   */
  symbol: 'crosses' | 'rings'
  /** Grundmaß in Pixeln bei `RADAR_IMAGE_WIDTH`. */
  base: number
  /** Zuschlag je Stufe — die GRÖSSE trägt die Intensität. */
  perLevel: number
}

export interface RadarOverlay extends WmsImageSource {
  id: string
  /** Kurzer Name für das Häkchen in der Leiste. */
  label: string
  legend: OverlayLegend
  /** Deckkraft des Bildes auf der Karte. */
  opacity: number
  /** Beim Öffnen des Bereichs schon an? */
  defaultOn: boolean
  note: string
  /** Gesetzt → selbst gezeichnete Symbole statt des rohen Bildes. */
  cells?: CellSymbols
  /**
   * Gesetzt, wenn die Quelle NICHT vom DWD kommt — dann gilt für sie auch
   * nicht die GeoNutzV, und die Quellenzeile muss sie getrennt nennen.
   * Attribution ist Lizenzbedingung, keine Höflichkeit (siehe
   * `Attribution.tsx`), und ein pauschales „Nutzung nach GeoNutzV" über einem
   * EUMETSAT-Layer wäre schlicht die falsche Angabe.
   */
  credit?: { name: string; href: string }
}

/**
 * Farbstufen der Gewitterintensität, 1:1 aus den GetLegendGraphic-Regeln des
 * NowCastMIX-Layers (Punktsymbole, gefiltert über das Intensitätskennzeichen
 * `II`): 31 leicht · 33–38 Gewitter · 40–46 schwer · 48/95 extrem.
 *
 * **Der Layer `Gewitterzellen` ist auf Wunsch WIEDER RAUS** — er zeigte
 * dieselben Punktsymbole in derselben Skala wie die Cluster, nur je
 * Einzelzelle, und trug neben Radarecho, Blitzkreuzen und den
 * KONRAD-Umrissen nichts bei, was nicht schon dastand. Wieder einschalten
 * wäre ein Registry-Eintrag (`layer: 'dwd:Gewitterzellen'`, `capsLayer`
 * ebenso, Fläche lon 3,76–15,47 · lat 47,20–54,82 — Wien liegt draußen).
 */
const STORM_CLASSES = [
  { color: '#FFEB3B', label: 'leicht' },
  { color: '#FB8C00', label: 'Gewitter' },
  { color: '#E53935', label: 'schwer' },
  { color: '#880E4F', label: 'extrem' },
]

export const RADAR_OVERLAYS: RadarOverlay[] = [
  {
    id: 'blitze',
    label: 'Blitze',
    layer: 'dwd:Blitzdichte',
    capsLayer: 'Blitzdichte',
    stepMs: 5 * 60_000,
    forecastMs: 0,
    maskOpacity: null,
    // GROB angefordert, und das mit Absicht: gezeichnet werden Kreuze je
    // 10-km-Zelle (siehe `render/lightning.ts`), ein feineres Bild trägt
    // keine zusätzliche Information und kostet nur Bytes. 400 px über die
    // 1.864 km der Produktfläche sind ~4,7 km je Pixel.
    imageWidth: 400,
    opacity: 1,
    defaultOn: true,
    cells: {
      palette: LIGHTNING_DENSITY_COLORS,
      blockPx: LIGHTNING_BLOCK_PX,
      symbol: 'crosses',
      base: LIGHTNING_ARM,
      perLevel: LIGHTNING_ARM_PER_LEVEL,
    },
    legend: {
      kind: 'crosses',
      caption: 'Blitze, Minuten zurück',
      items: LIGHTNING_AGES,
    },
    note: 'NowCastMIX-Blitzdichte als Kreuze: FARBE = Alter, GRÖSSE = Blitzrate. Der DWD veröffentlicht keine Einzelblitze — ein Kreuz steht für eine 10-km-Zelle mit Blitzen, und die Altersstufe ist produktbedingt auf 15 Minuten gerundet (jedes Bild fasst die Blitze der letzten 15 Minuten zusammen)',
  },
  {
    id: 'cluster',
    imageWidth: 1600,
    label: 'Cluster',
    layer: 'dwd:Gewittercluster',
    capsLayer: 'Gewittercluster',
    stepMs: 5 * 60_000,
    forecastMs: 0,
    maskOpacity: null,
    opacity: 1,
    defaultOn: false,
    legend: { kind: 'dots', caption: 'Zellverbände', items: STORM_CLASSES },
    note: 'NowCastMIX-Gewittercluster: Zentroide und Spuren erkannter Zellverbände samt Verlagerung',
  },
  {
    id: 'konrad',
    imageWidth: 1600,
    // ZWEI Layer in EINEM Bild (kommagetrennt, mit passender Stilliste): die
    // Zellumrisse und die bisherigen Spuren gehören zusammen und kosten so
    // einen Abruf statt zwei.
    label: 'KONRAD',
    layer: 'dwd:K3D_EVAL_current_cells,dwd:K3D_EVAL_cur_track_lines',
    // NICHT der Vorgabestil: der füllt die Zellen DECKEND (fill-opacity 1) und
    // verdeckt damit genau das Radarecho, um das es geht.
    style: 'k3d_eval_current_cells_unfilled_polygons_colored_border,',
    capsLayer: 'K3D_EVAL_current_cells',
    stepMs: 5 * 60_000,
    forecastMs: 0,
    maskOpacity: null,
    opacity: 1,
    defaultOn: false,
    legend: {
      kind: 'rings',
      caption: 'KONRAD3D-Zellen (Umriss + bisherige Spur)',
      items: [
        { color: '#25A700', label: '0' },
        { color: '#FDE333', label: '1' },
        { color: '#F1393B', label: '2' },
        { color: '#FE32D4', label: '3' },
      ],
    },
    note: 'KONRAD3D: Umrisse der aktuell erkannten Gewitterzellen (Farbe = Schwerestufe 0–3) samt ihrer bisherigen Zugspuren. Prognosekegel und Vorhersagespuren des Verfahrens sind bewusst nicht dabei.',
  },
  // Der EINZIGE Eintrag, der nicht vom DWD kommt — und er ist wegen der
  // ABDECKUNG da. Die DWD-Blitzdichte endet im Süden bei 46,95 °N (Kärnten
  // fehlt), das Radarecho im Osten bei 13,2–14,4 °O (Linz, Wien, Graz,
  // Klagenfurt fehlen). MTG sieht von 0° aus die ganze Scheibe, also auch
  // genau diese Ecken. Live geprüft (2026-09-29): CORS `*`, keyless, PNG8
  // transparent, ~5 KB über diese Fläche, 5-Minuten-Takt, Archiv ab
  // 30.05.2025.
  {
    id: 'mtgli',
    label: 'MTG-Blitze',
    layer: 'mtg_fd:li_afa',
    capsLayer: 'li_afa',
    wmsBase: `${EUMETSAT_GEOSERVER}/wms`,
    capsBase: `${EUMETSAT_GEOSERVER}/mtg_fd`,
    area: FLASH_AREA_BOX,
    stepMs: 5 * 60_000,
    forecastMs: 0,
    maskOpacity: null,
    // Grob wie die DWD-Dichte: gezeichnet werden Ringe je Zelle, und der
    // Lightning Imager löst über Mitteleuropa ohnehin nur ~10 km auf (500 m
    // gilt am Subsatellitenpunkt, hier steht er schräg).
    imageWidth: 400,
    opacity: 1,
    defaultOn: false,
    cells: {
      palette: FLASH_AREA_COLORS,
      blockPx: LIGHTNING_BLOCK_PX,
      symbol: 'rings',
      base: 2.2,
      perLevel: 0.5,
    },
    legend: {
      kind: 'rings',
      caption: 'MTG-Blitze, Minuten zurück',
      items: LIGHTNING_AGES,
    },
    credit: { name: 'EUMETSAT', href: 'https://www.eumetsat.int/' },
    note: 'MTG Lightning Imager, Accumulated Flash Area: OPTISCH aus dem All gesehene Blitzfläche, 5-Minuten-Takt. Ringfarbe = Alter wie bei den DWD-Kreuzen, Ringgröße = Intensitätsstufe. Deckt im Gegensatz zur DWD-Blitzdichte ganz Österreich ab. Eine optische Messung liefert weder Polarität noch Stromstärke und unterscheidet Wolken- nicht von Erdblitzen — dafür bräuchte es ein bodengebundenes VLF/LF-Netz, das es offen nicht gibt.',
  },
]


// --- Zeitdimension ---------------------------------------------------------
//
// Parser, Zeitraster und Mercator-Rechnung liegen in `config/wmsTime.ts` —
// derselbe Kern trägt den Satellitenbereich (EUMETSAT). Hier stehen nur noch
// die Teile, die WIRKLICH radarspezifisch sind: der Vorhersageteil am Ende der
// Dimension und die Fläche, die dieser Dienst selbst mitliefert.
//
// Re-exportiert, damit die öffentliche Form dieses Moduls unverändert bleibt.

export {
  imageCoordinates,
  imageHeightFor,
  nearestFrame,
  parseIsoDuration,
  parseTimeExtent,
} from './wmsTime'
export type { GeoBox, MercBox, TimeExtent } from './wmsTime'

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
  const dim = extractTimeDimension(xml)
  const extent = dim ? parseTimeExtent(dim) : null
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

/**
 * Letzter ANALYSEzeitpunkt. Bei Produkten mit Vorhersageteil ist das NICHT das
 * Ende der Zeitdimension — dort stehen die 2 Stunden Verlagerungsrechnung,
 * die dieser Bereich nicht zeigt. Zweimal gegengeprüft: die Zeitdimension des
 * reinen Analyse-Layers (`Radar_wn-analysis_1x1km_ger`) endete genau
 * `forecastMs` vor der des Produkt-Layers.
 */
export function analysisTime(meta: RadarMeta, product: WmsImageSource): number {
  return meta.extent.end - product.forecastMs
}

/**
 * Die Zeitpunkte des Zeitschiebers: `historyMs` rückwärts vom letzten
 * Analysebild, in Schritten der Zeitdimension. Jedes Bild ist ein eigener
 * HTTP-Abruf — die Fensterlänge ist deshalb Bandbreite, nicht Kosmetik, und
 * steht in der Bedienleiste zur Wahl.
 *
 * Aufsteigend sortiert, das letzte Element ist der neueste Stand.
 */
export function radarTimes(
  meta: RadarMeta,
  product: WmsImageSource,
  historyMs: number,
): number[] {
  const extent = { ...meta.extent, stepMs: meta.extent.stepMs || product.stepMs }
  return frameTimes(extent, analysisTime(meta, product), historyMs)
}

// --- URLs ------------------------------------------------------------------

export function radarCapabilitiesUrl(source: WmsImageSource): string {
  return (
    `${source.capsBase ?? DWD_CAPS_BASE}/${source.capsLayer}/wms` +
    '?service=WMS&version=1.3.0&request=GetCapabilities'
  )
}

/**
 * Fläche und Zeitdimension einer Quelle zusammenführen.
 *
 * Bringt die Quelle eine eigene `area` mit, gilt die — und die
 * Mercator-Ecken werden selbst gerechnet. Das ist kein Feinschliff: das
 * MTG-Capabilities meldet die ganze sichtbare Halbkugel und führt gar keine
 * EPSG:3857-BoundingBox, aus der man sie nehmen könnte.
 */
export function metaForSource(source: WmsImageSource, extent: TimeExtent): RadarMeta {
  const geo = source.area!
  return { extent, geo, merc: mercBox(geo) }
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
  source: WmsImageSource,
  meta: RadarMeta,
  opts: { time: number; width: number; height: number },
): string {
  const { minx, miny, maxx, maxy } = meta.merc
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: source.layer,
    styles: source.style ?? '',
    // **PNG8 statt PNG24**, und das ist gemessen: dieselbe Farbanzahl (83 im
    // Radarbild, der Stil hat ohnehin unter 256 Farben), aber die halbe Größe
    // — Radar 44 statt 93 KB, ein LEERES Symbol-Overlay 1,1 statt 37,7 KB.
    // GeoServer antwortet darauf mit `image/png; mode=8bit`.
    format: 'image/png8',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: `${minx},${miny},${maxx},${maxy}`,
    width: String(opts.width),
    height: String(opts.height),
    time: new Date(opts.time).toISOString().replace('.000', ''),
  })
  return `${source.wmsBase ?? DWD_WMS_BASE}?${q.toString()}`
}

/**
 * Breite des angeforderten Bildes. 1200 px über 1.920 km Mercator-Breite sind
 * bei 48 °N rund 1,1 km je Pixel — also etwa die 1-km-Auflösung des Produkts;
 * mehr Pixel kosten nur Bytes (gemessen 1000 px → 63 KB, 1400 px → 111 KB,
 * 1800 px → 166 KB je Bild) und mehr Wartezeit beim Vorladen.
 */
export const RADAR_IMAGE_WIDTH = 1200

/** Breite, die diese Quelle anfordert. */
export function sourceImageWidth(source: WmsImageSource): number {
  return source.imageWidth ?? RADAR_IMAGE_WIDTH
}

/** Bildhöhe aus dem Seitenverhältnis DIESER Fläche (nie krumm skalieren). */
export function radarImageHeight(meta: RadarMeta, width = RADAR_IMAGE_WIDTH): number {
  return imageHeightFor(meta.merc, width)
}

/** Ecken für die MapLibre-image-Source (im Uhrzeigersinn ab oben links). */
export function radarImageCoordinates(
  meta: RadarMeta,
): [[number, number], [number, number], [number, number], [number, number]] {
  return imageCoordinates(meta.geo)
}
