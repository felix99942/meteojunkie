// Natürlicher Untergrund der Satellitenbilder: die Erde, wie sie aus dem All
// aussieht — wolkenfrei und in echten Farben.
//
// Das Bild `src/mapdata/europe-ground.jpg` erzeugt `scripts/build-ground.mjs`
// (npm `build:ground`) aus **Blue Marble: Next Generation** der NASA über
// GIBS. Es ist ein STATISCHES Asset: einmal geholt, gilt es für immer — kein
// Key, kein fremdes Rate-Limit, und MapLibres `load`-Event hängt nicht an
// Requests, die uns nicht gehören (dieselbe Entscheidung wie beim Relief und
// bei der Basemap).
//
// WOZU: es liegt UNTER den Wolken IM Satellitenbild
// (`render/cloudComposite.ts`). Die beiden Graustufen-Kanäle kommen vom
// Dienst als DECKENDE Bilder; ihre Helligkeit wird zur Deckkraft, und
// darunter steht dieses Bild. Ein Farbschema aus Höhenstufen bräche den
// Eindruck — Wald, Ackerland, Küsten und die schneebedeckten Alpen setzen
// ein Satellitenbild fort. Das Relief bleibt, wo die OROGRAFIE die Frage ist
// (Soundings, `config/relief.ts`).
//
// **NICHT MEHR als Kartenhintergrund neben dem Satellitenbild.** Das war bis
// 2026-09-30 seine zweite Aufgabe; auf Wunsch zeigt der Bereich ausserhalb
// der Satellitenfläche jetzt gar keinen Untergrund. Damit ist auch die
// Kopplung an das Relieffenster entfallen — sie bestand nur, damit die
// beiden Hintergründe austauschbar sind, und es gibt keinen zweiten
// Hintergrund mehr. Der Ausschnitt folgt seither `SATELLITE_AREA`.
//
// **UND DESHALB REICHT EIN BILD.** Früher gab es ein zweites, engeres und
// schärferes (`dach-ground.jpg`, 1600 px = 974 m/px), weil das Komposit über
// einem kleinen Ausschnitt lief und das Europa-Bild dort 4,3-fach
// hochskaliert matschig war. Seit die Satellitenbilder ganz Europa abdecken,
// liegt das Komposit bei rund 4.100 m/px — dieses Bild mit 3.347 m/px ist
// damit eher zu fein als zu grob, ein schärferes hätte nichts, woran es sich
// zeigen könnte.
//
// AUFLÖSUNG: 2432 px über den Ausschnitt sind 3.347 m/px in Mercator, am
// Boden rund 2,05 km/px bei 52° N. Gemessen 538 KB. Frühere Messreihe zum
// alten, engeren Fenster: 1280 px → 213 KB, 1536 → 296 KB, 2048 → 485 KB,
// 2560 → 747 KB.
//
// NUTZUNG: NASA-Bilder sind frei verwendbar, die Namensnennung ist erbeten
// und steht in der Quellenzeile des Bereichs (`GroundAttribution`).

import groundUrl from '../mapdata/europe-ground.jpg?url'

export const GROUND_URL = groundUrl

/**
 * Bildecken. Das Bild kommt in EPSG:3857 vom Dienst, und MapLibres
 * image-source spannt ein Bild LINEAR im Mercator-Raum auf — die Antwort IST
 * also schon das Zielraster, es braucht keine Vorverzerrung wie in
 * `render/fieldImage.ts` für lat/lon-Gitter.
 *
 * Die Werte sind die Kachelgrenzen der Zoomstufe 6, x 27…40 und y 13…26 —
 * dieselben, die `SATELLITE_AREA` benutzt; `ground.test.ts` rechnet sie aus
 * der Kachelrechnung nach, damit sie nicht gegen das Skript driften, und
 * hält sie gegen die Satellitenfläche.
 */
export const GROUND_TILES = { zoom: 6, x0: 27, x1: 40, y0: 13, y1: 26 } as const

export const GROUND_BOUNDS = {
  lonMin: -28.125,
  lonMax: 45,
  latMin: 31.952162,
  latMax: 72.395706,
} as const

/** Bildecken im Format der MapLibre image-source (NW, NE, SE, SW). */
export const GROUND_COORDINATES: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [GROUND_BOUNDS.lonMin, GROUND_BOUNDS.latMax],
  [GROUND_BOUNDS.lonMax, GROUND_BOUNDS.latMax],
  [GROUND_BOUNDS.lonMax, GROUND_BOUNDS.latMin],
  [GROUND_BOUNDS.lonMin, GROUND_BOUNDS.latMin],
]
