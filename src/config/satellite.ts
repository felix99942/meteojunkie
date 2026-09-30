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
 * GANZ EUROPA — und die Fläche gibt HIER die Seite vor, nicht der Dienst.
 * Ein Satellitenlayer meldet im Capabilities die ganze sichtbare Halbkugel
 * (gemessen: lon −81,3…81,3, lat −77,4…77,4); ein Bild darüber wäre zur
 * Hälfte Weltraum.
 *
 * Die Zahlen sind das Kachelfenster der Zoomstufe 6, x 27…40 und y 13…26 —
 * dieselben, aus denen `scripts/build-ground.mjs` den Untergrund schneidet,
 * damit Bild und Untergrund im Komposit deckungsgleich liegen. Das ergibt
 * Island und das Nordkap gerade noch innen, dazu Nordafrika, die Türkei und
 * das europäische Russland; in Mercator ist der Kasten zufällig exakt
 * QUADRATISCH (8.140 × 8.140 km).
 *
 * **Der Erdrand darf nicht hinein** — bei 60° O und 75° N steht er sichtbar
 * als schwarzer Keil im Bild (nachgemessen 2026-09-29 an einem Kasten
 * −30…60 / 25…75). Die Ecke (45° O, 72,4° N) liegt bei 77° Großkreisabstand
 * vom Subsatellitenpunkt und damit innerhalb der Scheibe.
 *
 * **Das war bis 2026-09-30 ein enges Fenster über Mitteleuropa**
 * (lon 0…22, lat 41…56) mit einer noch engeren Detailfläche für die beiden
 * HRFI-Kanäle. Beides ist weg, und der Preis dafür gehört benannt: über
 * Europa lässt sich das native Raster NICHT mehr halten. HRFI ist nativ
 * 788 m; bei 4.070 m/px (s. u.) sind das Faktor 5. Beim Hineinzoomen auf die
 * Alpen ist das Bild deshalb weicher als vorher — mehr Bildinhalt gibt es
 * mit EINEM Bild über EINE feste Fläche nicht, und Kacheln je Zoomstufe sind
 * derselbe Handel, der beim Radar schon abgelehnt wurde (ein Dutzend Abrufe
 * je Zeitschritt, neue Abrufe bei jedem Verschieben).
 */
export const SATELLITE_AREA: GeoBox = {
  west: -28.125,
  east: 45,
  south: 31.952162,
  north: 72.395706,
}

/**
 * ENGERE Fläche für das GESCHÄRFTE Produkt (`hrv`).
 *
 * Sie ist kein Geschmacksausschnitt, sondern die Rechnung: 14° Länge sind
 * 1.558.473 m in Mercator, bei 2000 px also **779 m/px** — praktisch genau
 * das gemessene Raster des HRFI-Kanals (788 m), aus dem die Schärfe kommt.
 * Über der Europafläche wären dieselben 779 m/px rund 10.400 px und mehrere
 * MB je Zeitschritt; das Pan-Sharpening hätte dort auch nichts zu tun, weil
 * die Farbe bei 4.070 m/px schon nahezu nativ ist.
 *
 * Dass es diese Fläche wieder gibt, ist also KEIN Rückschritt hinter die
 * Europa-Umstellung: die fünfzehn übrigen Produkte bleiben europaweit, und
 * dieses eine kann es gar nicht sein (Begründung bei `SharpenSpec`).
 */
export const SATELLITE_DETAIL_AREA: GeoBox = { west: 4, east: 18, south: 44, north: 56 }

/**
 * Bezugspunkt für den Sonnenstand — die Frage ist, ob über dem GEBIET Licht
 * ist, und dafür genügt ein Punkt.
 *
 * **Nicht mehr die Mitte der Fläche**, seit die Fläche ganz Europa umfasst:
 * deren Mittelpunkt läge bei 8,4° O und 55° N, also in der Nordsee, und über
 * 73° Länge liegen zwischen Island und dem Kaspischen Meer fast fünf Stunden
 * Sonnenstand. Gewählt ist deshalb der Schwerpunkt dessen, was man hier
 * ansieht — Mitteleuropa. Ein sichtbarer Kanal zeigt über Europa nie überall
 * gleichzeitig etwas; der Hinweis „nur tagsüber" gilt für die Mitte.
 */
export const SATELLITE_CENTER = { lat: 48.5, lon: 11 }

/** Dieselbe Fläche in EPSG:3857 — so wird das Bild angefordert. */
export const SATELLITE_MERC: MercBox = mercBox(SATELLITE_AREA)

/**
 * VORGABE-Breite: die der MSG-Produkte. 1800 px über die Europafläche sind
 * **4.522 m/px** in Mercator — praktisch genau das native Raster der
 * SEVIRI-Kanäle (3 km am Boden ≙ ~4.400 m in Mercator bei 47° N). Mehr Pixel
 * brächten dort nichts als Bytes; gemessen 353 KB je Bild (Luftmassen-RGB),
 * beim Wasserdampfkanal 136 KB.
 *
 * Die MTG-Produkte bringen ihre Breite selbst mit (`imageWidth`), weil sie
 * feiner sind — und die beiden Ausnahmen darunter ebenfalls.
 */
export const SATELLITE_IMAGE_WIDTH = 1800

/**
 * Breite der MTG-Produkte: **4.070 m/px**, gemessen 439–463 KB je Bild.
 *
 * Nicht mehr: 2432 px (3.347 m/px, 619 KB) wären das Raster des
 * Untergrundbildes und damit die schönste Zahl — aber EUMETView beantwortet
 * Anfragen dieser Größe spürbar unzuverlässiger (bei der Messung am
 * 2026-09-29 kamen HTTP 500 und 504, die bei 2000 px nicht auftraten), und
 * bei zwölf vorgeladenen Bildern sind 619 KB gegen 463 KB der Unterschied
 * zwischen 7,4 und 5,6 MB beim Öffnen.
 */
export const SATELLITE_MTG_WIDTH = 2000

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

/**
 * PAN-SHARPENING: Farbe aus einem groben RGB, Struktur aus einem feinen
 * Breitbandkanal. Das Verfahren, mit dem Wetterseiten wie sat24 ihr scharfes
 * Farbbild erzeugen — es ist RECHNUNG, kein schärferer Download.
 *
 * **Warum es überhaupt nötig ist**: Natural Colour ist ein RGB aus drei
 * SEVIRI-Kanälen (VIS0,8 · VIS0,6 · NIR1,6), und alle drei haben 3 km. Ein
 * RGB kann nie feiner sein als sein gröbster Kanal — im Bildvergleich über
 * den Alpen (133 m/px angefordert) zerfällt `rgb_naturalenhncd` sichtbar in
 * 3-km-Klötze, während `vis06_hrfi` im selben Ausschnitt einzelne Grate und
 * Täler auflöst.
 *
 * **Warum HRFI als Schärfungskanal und nicht `rgb_eview`**: gemessen
 * (2026-09-30, dasselbe Fenster, beide Varianten gerechnet) bringt das
 * bereits HRV-geschärfte MSG-Produkt mit ~1,5 km kaum etwas gegenüber der
 * 3-km-Farbe; HRFI mit 0,8 km bringt Inntal, Seen und Wolkenkanten.
 *
 * **Der Preis ist ein zweiter Abruf je Bild** — und eine Zeitpaarung: die
 * Farbe kommt von MSG im 15-Minuten-Takt, die Schärfe von MTG im
 * 10-Minuten-Takt. Die Zeitachse folgt der FARBE, zum Pan-Kanal wird der
 * nächstgelegene Termin genommen; der Versatz beträgt höchstens 5 Minuten,
 * also rund 3 km Wolkenzug — in der Größenordnung der Farbauflösung selbst.
 */
export interface SharpenSpec {
  /** Workspace des Schärfungskanals. */
  workspace: string
  /** Layername des Schärfungskanals, OHNE Workspace. */
  name: string
  /** Sein Takt — bestimmt, welcher Termin zur Farbe gepaart wird. */
  stepMs: number
  /**
   * Breite, mit der die FARBE geholt wird. Bewusst klein: sie ist mit 3 km
   * nativ, und feiner anzufordern kostet nur Bytes (dieselbe Regel, die der
   * Raster-Test für alle Produkte durchsetzt). Hochskaliert wird sie beim
   * Zusammensetzen — das Pan-Sharpening braucht sie ohnehin nur als Farbe.
   */
  colourWidth: number
  /**
   * Natives Raster der FARBE in Mercator-Metern. Daraus wird gerechnet, wie
   * stark der Pan-Kanal weichgezeichnet werden muss, um die Tiefpasshälfte
   * zu bilden — nicht geraten, sondern aus der Quelle.
   */
  colourMercM: number
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
   * Abweichende Fläche. Zurzeit hat KEIN Produkt eine — alle zeigen ganz
   * Europa (`SATELLITE_AREA`). Das Feld bleibt, weil die Mechanik daran
   * hängt (`productArea`, `productMerc`, `productImageSize`) und ein
   * Produkt mit eigenem Ausschnitt jederzeit wieder möglich sein soll.
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
  /**
   * Gesetzt → das Bild dieses Produkts wird aus ZWEI Layern gerechnet: der
   * eigene (`workspace`/`name`) liefert die Farbe, dieser die Struktur.
   */
  sharpen?: SharpenSpec
  /** Kurzbeschreibung für Tooltip und Quellenzeile. */
  note: string
}

/**
 * Termin des Schärfungskanals zu einem Farbtermin: der NÄCHSTGELEGENE auf
 * seinem eigenen Raster. Bei 15 Minuten Farbe und 10 Minuten Schärfe sind
 * das höchstens 5 Minuten Versatz (:00→:00, :15→:20, :30→:30, :45→:40).
 */
export function sharpenPanTime(time: number, spec: SharpenSpec): number {
  const lo = Math.floor(time / spec.stepMs) * spec.stepMs
  const hi = lo + spec.stepMs
  // BEI GLEICHSTAND DAS FRÜHERE BILD, und das ist kein Detail: am
  // aktuellen Rand ist der spätere Termin oft noch gar nicht da (der Dienst
  // hinkt einige Minuten nach), und ein fehlender Schärfungskanal wirft auf
  // die grobe Farbe zurück. `Math.round` rundet bei .5 nach oben und würde
  // genau dort danebengreifen: 15 → 20 statt 10, 45 → 50 statt 40.
  return time - lo <= hi - time ? lo : hi
}

/** Layername des Schärfungskanals, mit Workspace. */
export function sharpenLayer(spec: SharpenSpec): string {
  return `${spec.workspace}:${spec.name}`
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
 * Der Katalog. Geordnet nach MISSION und darin nach Nutzung, denn die
 * Reihenfolge ist die Aussage: Geocolour ist die Vorgabe, weil es die
 * einzige Darstellung ist, die rund um die Uhr aussieht wie das, was man
 * erwartet — tagsüber nahezu True Colour, nachts auf Infrarot umgeschaltet.
 * Dann die beiden hochaufgelösten Kanäle, dann die Deutungs-RGBs.
 *
 * **Alles hier ist live durchgemessen** (2026-09-29, je Produkt ein Bild um
 * 12 UTC und eines um 20 UTC über die Standardfläche): ob es Tag und Nacht
 * trägt, wie groß es ist und ob überhaupt Inhalt kommt. Die Tabelle steht in
 * CLAUDE.md; hier steht je Produkt nur das Ergebnis.
 *
 * **Drei Produkte waren schon einmal draußen und sind auf Wunsch wieder da**
 * (Echtfarben, Schnee, Wolkentyp). Die frühere Begründung — „zeigen tagsüber
 * nichts, was Geocolour nicht auch zeigt" — stimmt für Echtfarben, aber nicht
 * für Schnee und Wolkentyp: auf einem True-Colour-artigen Bild sind
 * Schneedecke und Wolke beide weiß, und genau das trennen diese RGBs. Die
 * Auswahl folgt jetzt der Breite des Dienstes statt dem Minimum.
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
    imageWidth: SATELLITE_MTG_WIDTH,
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
    // Über Europa NICHT MEHR NATIV: 4.070 m/px gegen ein gemessenes Raster
    // von 788 m, also Faktor 5. Das ist der Preis der Europafläche und steht
    // ausdrücklich bei `SATELLITE_AREA`. Gemessen 439 KB je Tagbild.
    imageWidth: SATELLITE_MTG_WIDTH,
    // Gemessen bei 40° Sonnenhöhe: Boden 37–70, Wolke ab ~90, dicht über 130.
    // Geteilt durch sin(40°) = 0,64 ergibt das diese sonnenunabhängigen Werte.
    cloudMask: { min: 124, max: 218, solarScaled: true },
    dayOnly: true,
    note: 'MTG/FCI HRFI VIS 0,6 µm: der schärfste Kanal des Dienstes (500 m am Subsatellitenpunkt, über Mitteleuropa ~1 km) — Nachfolger des MSG-HRV, das es hier ebenfalls gibt (Produkt „HRV-RGB Europa", gemessen gröber). Über der Europafläche wird er mit 4,1 km/px angefordert und ist damit nicht mehr pixelnativ. Misst reflektiertes Sonnenlicht, ist nachts also schwarz. 10 Minuten.',
  },
  {
    id: 'ir105',
    label: 'Infrarot 10,5 µm',
    workspace: 'mtg_fd',
    name: 'ir105_hrfi',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    // Gemessenes Raster 1.113 m; über Europa wird es mit 4.070 m/px
    // angefordert, also Faktor 3,7 gröber. Gemessen 359 KB je Bild — dass
    // dieser Kanal früher mit weniger Pixeln auskam als der sichtbare, spielt
    // keine Rolle mehr: beide liegen jetzt weit unter ihrem Raster, und eine
    // eigene Breite spart nur noch Bytes, keine Unschärfe.
    imageWidth: SATELLITE_MTG_WIDTH,
    // Fest, denn Wärmestrahlung hängt nicht am Sonnenstand. Gemessen:
    // Boden 24–90, Wolke ab ~90, hohe Wolke über 140.
    cloudMask: { min: 78, max: 140 },
    note: 'MTG/FCI Infrarotkanal 10,5 µm: Strahlungstemperatur der Wolkenoberseite — je kälter (heller), desto höher die Wolke. 10 Minuten.',
  },
  {
    id: 'fog',
    label: 'Nebel / Tiefe Wolken',
    workspace: 'mtg_fd',
    name: 'rgb_fog',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    note: 'MTG Fog/Low-Cloud-RGB (Nacht-Mikrophysik): hebt Hochnebel und Stratus hervor — genau die Lücke des reinen Infrarots, in dem WARME tiefe Wolken kaum heller sind als der Boden. Trägt Tag und Nacht, im Winterhalbjahr das nützlichste Produkt der Liste. 10 Minuten.',
  },
  {
    id: 'dust',
    label: 'Staub-RGB',
    workspace: 'mtg_fd',
    name: 'rgb_dust',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    note: 'MTG Dust-RGB: Saharastaub (magenta) über den Alpen, dazu tiefe Wolken und Temperaturkontraste. Aus Infrarot-Differenzen gebildet, trägt also Tag und Nacht. 10 Minuten.',
  },
  {
    id: 'cloudphase',
    label: 'Wolkenphase',
    workspace: 'mtg_fd',
    name: 'rgb_cloudphase',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    dayOnly: true,
    note: 'MTG Cloud-Phase-RGB: trennt EIS von Wasser in der Wolkenoberseite — bei Konvektion die Frage, ob ein Turm schon vereist ist, und für die Vereisungsgefahr in der Luftfahrt. Braucht Sonnenlicht, also nur tagsüber. 10 Minuten.',
  },
  {
    id: 'cloudtype',
    label: 'Wolkentyp',
    workspace: 'mtg_fd',
    name: 'rgb_cloudtype',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    dayOnly: true,
    note: 'MTG Cloud-Type-RGB: Wolkenstockwerke und -arten in getrennten Farben, wo ein Echtfarbenbild nur Weiß zeigt. Nur tagsüber. 10 Minuten.',
  },
  {
    id: 'snow',
    label: 'Schnee',
    workspace: 'mtg_fd',
    name: 'rgb_snow',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    dayOnly: true,
    note: 'MTG Snow-RGB: trennt SCHNEEDECKE (rot) von Wolke (weiß/hellblau) — auf einem Echtfarbenbild ist beides weiß, und im Winter ist das die Frage. Nur tagsüber. 10 Minuten.',
  },
  {
    id: 'truecolour',
    label: 'Echtfarben',
    workspace: 'mtg_fd',
    name: 'rgb_truecolour',
    mission: 'MTG',
    stepMs: 10 * 60_000,
    format: 'image/jpeg',
    imageWidth: SATELLITE_MTG_WIDTH,
    dayOnly: true,
    note: 'MTG True-Colour-RGB: die Erde, wie das Auge sie sähe. Tagsüber weitgehend dasselbe Bild wie Geocolour, das aber zusätzlich nachts trägt — dieses Produkt ist der unbearbeitete Blick. Nur tagsüber. 10 Minuten.',
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
  {
    id: 'wv062',
    label: 'Wasserdampf 6,2 µm',
    workspace: 'msg_fes',
    name: 'wv062',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    // **KEINE `cloudMask`**, obwohl es ein Graustufenkanal ist — und das ist
    // kein Versehen: 6,2 µm sieht die obere Troposphäre und erreicht den
    // Boden gar nicht. Es gibt hier keinen „wolkenfreien Untergrund", den
    // man darunter durchscheinen lassen könnte; das ganze Bild IST die
    // Information (hell = feucht/hoch, dunkel = trockene absinkende Luft).
    note: 'MSG Wasserdampfkanal 6,2 µm: die Feuchte der oberen Troposphäre — der klassische Kanal für die Höhenströmung. Dunkle Streifen sind trockene Absinkzonen und markieren Strahlstrom und Trogachsen, lange bevor sich am Boden etwas zeigt. Sieht die Erdoberfläche NICHT und trägt deshalb Tag und Nacht gleich. 15 Minuten.',
  },
  {
    id: 'ash',
    label: 'Vulkanasche-RGB',
    workspace: 'msg_fes',
    name: 'rgb_ash',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    note: 'MSG Ash-RGB: Vulkanasche und SO₂-Wolken. Für Mitteleuropa selten gebraucht, dann aber das einzige Produkt, das es kann (Eyjafjallajökull 2010). Aus Infrarot-Differenzen, also Tag und Nacht. 15 Minuten.',
  },
  {
    id: 'naturalenh',
    label: 'Natural Colour (verstärkt)',
    workspace: 'msg_fes',
    name: 'rgb_naturalenhncd',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    dayOnly: true,
    note: 'MSG Natural-Colour-RGB (verstärkt): das am häufigsten benutzte Tages-RGB Europas — Schnee und Eiswolken cyan, Wasserwolken weiß, Vegetation grün. Dieselbe Trennung wie das MTG-Schnee-RGB, in der Darstellung, die man aus Lehrbüchern kennt. Nur tagsüber, 3 km — die Schärfung sitzt beim HRV-RGB, wo sie etwas bringt. 15 Minuten.',
  },
  {
    id: 'hrv',
    label: 'HRV-RGB geschärft (Mitteleuropa)',
    workspace: 'msg_fes',
    name: 'rgb_eview',
    mission: 'MSG',
    stepMs: 15 * 60_000,
    format: 'image/jpeg',
    // Die EINZIGE Fläche, die nicht ganz Europa ist — und sie kann es nicht
    // sein (Begründung bei `SATELLITE_DETAIL_AREA` und `SharpenSpec`).
    area: SATELLITE_DETAIL_AREA,
    // 779 m/px über diese Fläche = das Raster des Schärfungskanals.
    imageWidth: 2000,
    dayOnly: true,
    sharpen: {
      workspace: 'mtg_fd',
      name: 'vis06_hrfi',
      stepMs: 10 * 60_000,
      // 14° bei 1000 px sind 1.558 m/px — genau das gemessene Raster des
      // HRV-RGB. Feiner anzufordern wäre reine Bytes (gemessen 120 KB).
      colourWidth: 1000,
      colourMercM: 1558,
    },
    // Der Eintrag korrigiert eine ALTE Fehlannahme: das MSG-HRV IST bei
    // EUMETView veröffentlicht, nämlich hier. Es ist mit gemessenen 1.558 m
    // der feinste FARB-Layer des Dienstes — gröber als der MTG-HRFI-Kanal
    // (788 m), aber dreimal feiner als jedes 3-km-RGB. Genau deshalb ist es
    // das Produkt, bei dem sich die Schärfung lohnt: Faktor 2 statt Faktor 5
    // wie beim Natural Colour, dafür auf einem Bild, das schon Struktur hat.
    note: 'MSG HRV-RGB („European View") in der Schärfe des HRFI-Kanals: die FARBE kommt vom HRV-RGB (1,6 km, der feinste Farb-Layer des Dienstes), die STRUKTUR vom MTG-Kanal VIS 0,6 µm (0,8 km) — dasselbe Pan-Sharpening, mit dem Wetterseiten ihr scharfes Farbbild erzeugen. Deshalb nur über Mitteleuropa: über ganz Europa wäre dieselbe Schärfe ein Bild von 10.000 px. Nur tagsüber; Farbe und Schärfe liegen bis zu 5 Minuten auseinander.',
  },
]

/**
 * Produkte nach Mission gruppiert — für die Auswahl. Bei fünfzehn Einträgen
 * ist eine flache Liste eine Liste, die man jedes Mal neu liest; nach
 * Satellit geordnet steht oben, was 10-minütig und aktuell ist, darunter das,
 * was es nur von MSG gibt.
 */
export const SATELLITE_GROUPS: { mission: SatelliteMission; label: string; items: SatelliteProduct[] }[] = [
  {
    mission: 'MTG',
    label: 'Meteosat Third Generation · FCI · 10 min',
    items: SATELLITE_PRODUCTS.filter((p) => p.mission === 'MTG'),
  },
  {
    mission: 'MSG',
    label: 'Meteosat Second Generation · SEVIRI · 15 min',
    items: SATELLITE_PRODUCTS.filter((p) => p.mission === 'MSG'),
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
  opts: { time: number; width: number; height: number; layer?: string },
): string {
  const { minx, miny, maxx, maxy } = productMerc(p)
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: opts.layer ?? satelliteLayer(p),
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
