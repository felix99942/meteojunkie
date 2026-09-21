// Natürlicher Untergrund der Bildkarten: die Erde, wie sie aus dem All
// aussieht — wolkenfrei und in echten Farben.
//
// Das Bild `src/mapdata/europe-ground.jpg` erzeugt `scripts/build-ground.mjs`
// (npm `build:ground`) aus **Blue Marble: Next Generation** der NASA über
// GIBS. Es ist ein STATISCHES Asset: einmal geholt, gilt es für immer — kein
// Key, kein fremdes Rate-Limit, und MapLibres `load`-Event hängt nicht an
// Requests, die uns nicht gehören (dieselbe Entscheidung wie beim Relief und
// bei der Basemap).
//
// WARUM HIER EIN ECHTES SATELLITENBILD UND NICHT DAS HÖHENRELIEF: im
// Satellitenbereich liegt daneben ein echtes Satellitenbild. Ein
// Farbschema aus Höhenstufen bricht diesen Eindruck — Wald, Ackerland,
// Küstenlinien und die schneebedeckten Alpen setzen das Bild dagegen
// fort. Das Relief bleibt, wo es hingehört: in der Ortswahl-Karte der
// Soundings, wo die OROGRAFIE die Frage ist (`config/relief.ts`).
//
// AUSSCHNITT ist exakt das Fenster des Reliefs, damit beide Hintergründe
// deckungsgleich und gegeneinander austauschbar sind (Test).
//
// AUFLÖSUNG: 2048 px über den Ausschnitt sind 3363 m/px in Mercator, am Boden
// rund 2,1 km/px bei 51° N — gröber als die Quelle (500 m) und gröber als die
// Karte im Detailzoom. Das ist Absicht: die Fläche ist HINTERGRUND und wird
// grösstenteils vom Satellitenbild verdeckt. Gemessen kostet sie so 485 KB;
// 2560 px wären 747 KB, 1536 px nur 296 KB (Zahlen im Skript).
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
 * Die Werte sind die Kachelgrenzen der Zoomstufe 6, x 29…40 und y 14…26 —
 * dieselben wie beim Relief; `ground.test.ts` rechnet sie aus der
 * Kachelrechnung nach, damit sie nicht gegen das Skript driften.
 */
export const GROUND_TILES = { zoom: 6, x0: 29, x1: 40, y0: 14, y1: 26 } as const

export const GROUND_BOUNDS = {
  lonMin: -16.875,
  lonMax: 45,
  latMin: 31.952162,
  latMax: 70.612614,
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
