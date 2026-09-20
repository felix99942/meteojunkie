// Qualitatives Höhenrelief für die Ortswahl-Karte (Soundings).
//
// Das Bild `src/mapdata/europe-relief.png` erzeugt `scripts/build-relief.mjs`
// (npm `build:relief`) aus den offenen Terrain-Kacheln von AWS Open Data
// (Mapzen/Tilezen „terrarium"). Es ist ein STATISCHES Asset: einmal gebaut,
// gilt es für immer — deshalb liegt es im Repo neben den Basemap-Bündeln und
// wird nicht zur Laufzeit geholt.
//
// WAS MEER IST, ENTSCHEIDET NICHT DIE HÖHE ALLEIN: der Ingest legt eine
// Landmaske aus denselben Natural-Earth-Polygonen (1:50m) darüber, aus denen
// die Karte ihre Küstenlinie zeichnet. Ohne sie standen die Niederlande und
// die deutsche Marschküste als Wasser da — sie liegen grossflächig unter
// null, und die Karte sah aus, als wäre das halbe Land abgesoffen. Eine
// tiefere Höhenschwelle hätte das nur verschoben (Wattenmeer und Bodden
// liegen ebenfalls knapp unter null). Die Maske hebt deshalb nur AN und
// löscht nie — ein Punkt ausserhalb der Polygone bleibt nach seiner Höhe
// eingestuft, sonst verlöre man kleine Inseln, die in 1:50m fehlen.
//
// ATLAS-MANIER, UND DAS IST DER PUNKT: abgestufte Höhenschichten, aus denen
// man die Landschaft erkennt (Alpen, Karpaten, Skandinavien, Pyrenäen), aber
// KEINE Werte abliest. Für ein Sounding ist die Orografie die eigentliche
// Orientierung — Luv oder Lee, Talboden oder Kamm. Was das Profil aber
// wirklich bestimmt, ist die MODELLtopografie, und die ist eine andere:
// Open-Meteo rechnet am Sonnblick mit 2962 statt 3109 m (siehe den
// Höhenbefund der Verifikation in CLAUDE.md). Das Relief ordnet also ein, es
// beweist nichts — deshalb qualitativ, und deshalb steht am gewählten Punkt
// die Modellhöhe daneben.
//
// AUFLÖSUNG: Zoomstufe 6 ≈ 1,53 km/px bei 51° N, 321 KB. Gemessen
// (2026-09-20) kostet Stufe 7 mit 0,75 km/px das 3,4-Fache (1128 KB) — für
// ein Relief, das bewusst keine Werte trägt, ist das der Preis nicht wert.
// Beim tiefen Hineinzoomen wird es weich, was hier sogar richtig ist: die
// Modelle lösen 7–25 km auf, ein gestochen scharfes Relief verspräche eine
// Ortsgenauigkeit, die in den Daten nicht steckt.

import reliefUrl from '../mapdata/europe-relief.png?url'

export const RELIEF_URL = reliefUrl

/**
 * Bildecken. Das Kachelfeld liegt in Web-Mercator, und MapLibres image-source
 * spannt ein Bild LINEAR im Mercator-Raum auf — die Zuordnung stimmt damit
 * exakt, ohne die Vorverzerrung, die `render/fieldImage.ts` für lat/lon-Gitter
 * braucht (dieselbe Überlegung wie beim Radarbild in EPSG:3857).
 *
 * Die Werte sind die Kachelgrenzen von Zoomstufe 6, x 29…40 und y 14…26;
 * `relief.test.ts` rechnet sie aus der Kachelrechnung nach, damit sie nicht
 * gegen das Skript driften.
 */
export const RELIEF_TILES = { zoom: 6, x0: 29, x1: 40, y0: 14, y1: 26 } as const

export const RELIEF_BOUNDS = {
  lonMin: -16.875,
  lonMax: 45,
  latMin: 31.952162,
  latMax: 70.612614,
} as const

/** Bildecken im Format der MapLibre image-source (NW, NE, SE, SW). */
export const RELIEF_COORDINATES: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [RELIEF_BOUNDS.lonMin, RELIEF_BOUNDS.latMax],
  [RELIEF_BOUNDS.lonMax, RELIEF_BOUNDS.latMax],
  [RELIEF_BOUNDS.lonMax, RELIEF_BOUNDS.latMin],
  [RELIEF_BOUNDS.lonMin, RELIEF_BOUNDS.latMin],
]

/**
 * Legende — dieselben Stufen und Farben wie in `scripts/build-relief.mjs`.
 * Doppelt geführt, weil das Ingest-Skript reines Node ohne TS-Import ist
 * (dieselbe bewusste Duplizierung wie die Formel der gefühlten Temperatur im
 * MOSMIX-Ingest); ein Test hält die Farben gegen die erzeugte Palette.
 */
export interface ReliefStep {
  label: string
  color: string
}

export const RELIEF_STEPS: ReliefStep[] = [
  { label: '0–200', color: '#1e2a24' },
  { label: '200–500', color: '#2a3327' },
  { label: '500–1000', color: '#3b3c2c' },
  { label: '1000–1500', color: '#4d4430' },
  { label: '1500–2000', color: '#5d4a34' },
  { label: '2000–2500', color: '#6d5540' },
  { label: '2500–3000', color: '#7d6552' },
  { label: '> 3000', color: '#918070' },
]
