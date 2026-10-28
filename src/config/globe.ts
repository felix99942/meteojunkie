// Modellkarten: ECMWF IFS, DWD ICON-EU und ICON-D2 als Globus oder flache
// Karte (Europa, Alpen). Intern heißt der Bereich weiter „globe" — dort hat er
// angefangen, und das Datenformat ist dasselbe geblieben.
//
// Die Daten kommen NICHT von Open-Meteo — ein Gitter kostet dort ~Punktzahl
// Calls (global 1° = 65.000, Tagesbudget 10.000; ICON-D2 nativ ~900.000
// Punkte je Feld). Sie kommen direkt von ECMWF und vom DWD, geholt im Deploy
// (`scripts/ecmwf-ingest.py`, `scripts/icon-ingest.py`, gemeinsamer Kern
// `scripts/nwp_common.py`) und als Wertebilder same-origin ausgeliefert:
// verlustfreies WebP, je Pixel ein 16-Bit-Code in R (hoch) und G (tief),
// Wert = lo + (code − 1) · step, code 0 = kein Wert. Das Raster ist je Modell
// das native Gitter (`GlobeGrid`, aus dem GRIB übernommen); ECMWF ist global
// und tastet von Nord nach Süd, ICON regional und von Süd nach Nord.
//
// Hier liegen die Registry und die reinen Rechenkerne (Dekodieren, Abtasten,
// Kachelgeometrie, Laufalter) — getestet in `globe.test.ts`. Das Einfärben
// der Kacheln steht in `render/globeTiles.ts`, das Laden in `api/globeData.ts`.

import { alternateShade, bands, COLOR_SCALES, lerpRamp, TEMP_ANCHORS, type ColorScale } from './colorscales'

/**
 * `uv10` und `uv300` sind keine wählbaren Größen, sondern die Datenquellen
 * der Windpartikel (`encoding: 'uv8'`) — sie stehen deshalb nicht in
 * `GLOBE_VARIABLES`.
 */
export type GlobeVarId =
  | 't2m' | 't850' | 'msl' | 'precip' | 'wind10' | 'gust' | 'wind300' | 'gh500' | 'gh300' | 'reltop' | 'tcc' | 'clouds'
  | 'uv10' | 'uv300'
  | 'swh' | 'pp1d' | 'sst'
  | 'precipsum' | 'cape' | 'td2m' | 'rh700' | 'tcwv' | 'snow' | 'hzerocl'

/**
 * Gruppen der Auswahlliste (`<optgroup>`) — bei über zwanzig Größen ist eine
 * flache Liste eine, die man jedes Mal neu liest.
 */
export const GLOBE_GROUPS = [
  'Temperatur & Luftmasse',
  'Druck & Höhe',
  'Niederschlag & Feuchte',
  'Wind',
  'Wolken & Gewitter',
  'Meer',
] as const
export type GlobeGroup = (typeof GLOBE_GROUPS)[number]

export interface GlobeVariable {
  id: GlobeVarId
  label: string
  /** Erklärung im Tooltip der Auswahl. */
  title: string
  scale: ColorScale
  /** Nachkommastellen der Werteanzeige am Zeiger. */
  decimals: number
  /** Jede wievielte Stufe der Legende beschriftet wird. */
  legendEvery: number
  /**
   * Statt jedes n-ten Bands die WERTE beschriften, die ein Vielfaches davon
   * sind — bei Bändern, die nicht auf einer runden Zahl beginnen (Temperatur
   * ab −56 °C), stünde sonst −56, −51, −46 … in der Legende.
   */
  legendMultiple?: number
  group: GlobeGroup
  /**
   * 'rgb3': drei Größen in einem Bild (Wolkenschichten), eigene Einfärbung
   * und Legende — `scale` gilt dann nicht.
   */
  kind?: 'rgb3'
}

/**
 * Temperatur GLOBAL, in 1-K-BÄNDERN mit Ankerfarben alle 4 K (−56 … 52 °C).
 *
 * Vorher waren es 2-K-Bänder aus Ankern im 8-K-Abstand (die der Feld-Karte):
 * zwei benachbarte Bänder unterschieden sich nur um ein Viertel zweier Anker,
 * und eine normale europäische 850-hPa-Lage (−8 … +15 °C) stand fast
 * vollständig in EINEM Türkis-Grün (gemeldet, im Bild nachgestellt). Jetzt
 * wechselt der Farbton doppelt so schnell und die Bänder sind halb so
 * breit. Am Nullpunkt kippt die Farbe von Cyan nach Grün. Das kalte Ende
 * wird HELLER (Eis statt noch mehr Violett), das warme dunkler.
 * Gilt für T2m UND T850 — dieselbe Farbe heißt in beiden dieselbe
 * Temperatur.
 */
/** Abdunkeln jedes zweiten 1-K-Bands (siehe `alternateShade`). */
const TEMP_SHADE = 0.1
const TEMP_FINE_ANCHORS = [
  '#fbf8fe', // −56
  '#f0e7f8', // −52
  '#e2d2f0', // −48
  '#d1bae6', // −44
  '#bea0db', // −40
  '#a985cf', // −36
  '#936bc1', // −32
  '#7c52b1', // −28
  '#663e9f', // −24
  '#4f3fae', // −20
  '#3c54c6', // −16
  '#2e71dc', // −12
  '#2d92e7', // −8
  '#39b4de', // −4
  '#2fae80', //  0
  '#5cc35a', //  4
  '#9bd34e', //  8
  '#d2de48', // 12
  '#f5d840', // 16
  '#f7b237', // 20
  '#f38a2f', // 24
  '#e85f29', // 28
  '#d4332b', // 32
  '#a8203c', // 36
  '#7c1752', // 40
  '#5a145e', // 44
  '#3d1150', // 48
  '#2a0a38', // 52
]
const GLOBAL_TEMP: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  // 28 Anker im 4-K-Abstand von −56 bis 52 → 109 Bänder à 1 K; jedes zweite
  // leicht abgedunkelt, damit jedes Grad als Stufe zu sehen ist
  stops: bands(-56, 1, alternateShade(lerpRamp(TEMP_FINE_ANCHORS, 109), TEMP_SHADE)),
}

/** 500-hPa-Geopotential: 480 … 600 gpdm in 4-gpdm-Bändern, kalt (Trog) → warm (Rücken). */
/**
 * Gesamtbewölkung in GRAUSTUFEN, wolkenlos HELL, bedeckt DUNKEL — dieselbe
 * Leserichtung wie im klassischen Meteogramm („SONNIG = HELL, BEDECKT =
 * DUNKEL"): die Fläche zeigt, wie der Himmel aussieht. Die vorherige Skala
 * (bedeckt weiß, wolkenlos durchsichtig) las sich umgekehrt. Das dunkle Ende
 * bleibt ÜBER der Kartenfarbe (#131418), sonst wäre „bedeckt" von „außerhalb
 * des Modellgebiets" nicht zu unterscheiden.
 */
const TCC_GREY: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(0, 10, lerpRamp(['#e4e5e7', '#2e3033'], 11)),
}

/**
 * MEER (nur ECMWF, Wellenmodell WAM). Über Land gibt es keinen Wert, dort
 * bleibt die Karte durchsichtig — Land und Meer trennen sich von selbst.
 * Wellenhöhe: ruhige See dunkelblau, ab ~2,5 m warm, Sturmsee magenta; die
 * Stufen sind unten fein (25 cm), weil dort entschieden wird, ob man baden
 * oder segeln kann.
 */
const WAVE_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12]
const WAVE_COLORS = lerpRamp(
  ['#123a6e', '#1f6fb0', '#2fa6c4', '#5cc8a8', '#b5df6a', '#f2d24b', '#f39a35', '#e0532a', '#b9265a', '#7c1a7a'],
  WAVE_STEPS.length,
)
const WAVE_HEIGHT: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: WAVE_STEPS.map((value, i) => ({ value, color: WAVE_COLORS[i] })),
}
/** Peak-Periode: kurze Windsee violett/blau, lange Dünung gelb/orange. */
const WAVE_PERIOD: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(0, 2, lerpRamp(['#2b1a4f', '#3c3f9a', '#2f7fb8', '#35b0a0', '#9fd36a', '#f2d24b', '#f08a3a'], 11)),
}
/**
 * Wassertemperatur von −2 bis 32 °C, UNGLEICH gestuft: kalt in 2 K, mittel in
 * 1 K, ab 26 °C in 0,5 K. Mit gleichmäßigen 1-K-Bändern lagen die ganzen
 * Tropen in zwei, drei Rottönen — ob das Meer vor Phuket 28 oder 30 °C hat,
 * war nicht ablesbar, und genau das fragt man beim Badeurlaub. Die Farbe
 * folgt dem RANG der Stufe, nicht dem Wert: so bekommt der warme Bereich
 * einen großen Teil der Rampe.
 */
const SEA_TEMP_STEPS = [
  ...Array.from({ length: 9 }, (_, i) => -2 + 2 * i), // −2 … 14
  ...Array.from({ length: 10 }, (_, i) => 16 + i), // 16 … 25
  ...Array.from({ length: 13 }, (_, i) => 26 + 0.5 * i), // 26 … 32
]
const SEA_TEMP_COLORS = lerpRamp(
  ['#3b2d7a', '#2f5fae', '#2d9cc0', '#3fbf9c', '#a6d65c', '#f2d24b', '#f39a35', '#e0532a', '#c22a4a', '#8e1a5e', '#5a1060'],
  SEA_TEMP_STEPS.length,
)
const SEA_TEMP: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: SEA_TEMP_STEPS.map((value, i) => ({ value, color: SEA_TEMP_COLORS[i] })),
}

/**
 * Höhenwind 300 hPa (Strahlstrom) in km/h. Unter 70 km/h DURCHSICHTIG — in
 * der Höhe ist das schwacher Wind, und eine durchgehend gefärbte Kugel
 * verdeckte genau das Band, um das es geht. Eigene kühle Rampe (hellblau →
 * violett → magenta → gelb im Kern), damit die Karte nicht mit dem 10-m-Wind
 * verwechselt wird, dessen Skala bei 130 km/h schon endet.
 */
const JET_STEPS = [70, 90, 110, 130, 150, 170, 190, 210, 240, 270, 300, 340]
const JET_COLORS = lerpRamp(
  ['#9fd3ea', '#5aa7dd', '#3b6fd0', '#5a46c0', '#8a3bb5', '#b8379e', '#d8457a', '#ea7458', '#f2a646', '#f6d84c'],
  JET_STEPS.length,
)
const JET: ColorScale = {
  kind: 'stepped',
  belowMin: 'transparent',
  stops: JET_STEPS.map((value, i) => ({ value, color: JET_COLORS[i] })),
}

const GH500: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(480, 4, lerpRamp(TEMP_ANCHORS, 31)),
}

/**
 * Relative Topografie 500/1000 hPa: 488 … 592 gpdm in 4-gpdm-Bändern auf der
 * TEMPERATURrampe — die Schichtdicke IST ein Maß für die Mitteltemperatur
 * der unteren Troposphäre (4 gpdm ≈ 2 K), kalt = blau, warm = rot. Keine
 * Schneefallgrenze im Text: ohne Niederschlag sagt die Dicke darüber nichts.
 */
const RELTOP: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  // 2-gpdm-Bänder (≈ 1 K) auf der feinen Temperaturrampe, −24 … +28 °C-Anker:
  // dieselbe Begründung wie bei `GLOBAL_TEMP` — mit 4-gpdm-Bändern auf
  // 8-K-Ankern lag eine ganze Wetterlage in zwei, drei Farben
  stops: bands(488, 2, alternateShade(lerpRamp(TEMP_FINE_ANCHORS.slice(8, 22), 53), TEMP_SHADE)),
}

/**
 * Niederschlagssumme seit Laufbeginn (mm): dieselbe Leserichtung wie die
 * Rate (blau → grün → gelb → rot → violett), aber Stufen für Summen über
 * Tage. Unter 1 mm durchsichtig — sonst färbte jeder Nieselhauch der
 * letzten zwei Wochen die ganze Kugel.
 */
const PRECIP_SUM_STEPS = [1, 2, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500]
const PRECIP_SUM_COLORS = lerpRamp(
  ['#4f97dd', '#2f6fc0', '#2fa36a', '#8fcf4a', '#f2d24b', '#f39a35', '#e0532a', '#b9265a', '#7c1a7a', '#c9a3e6'],
  PRECIP_SUM_STEPS.length,
)
const PRECIP_SUM: ColorScale = {
  kind: 'stepped',
  stops: PRECIP_SUM_STEPS.map((value, i) => ({ value, color: PRECIP_SUM_COLORS[i] })),
}

/**
 * CAPE (J/kg): die Skala der Feld-Karte endet bei 3000, in den Tropen und
 * im Mittleren Westen stehen 4000–6000 — dort oben zwei Stufen mehr. Unter
 * 100 J/kg durchsichtig: das ist keine Labilität, über die man spricht.
 */
const CAPE: ColorScale = {
  kind: 'stepped',
  stops: [...COLOR_SCALES.cape.stops, { value: 4000, color: '#ffc8e2' }, { value: 5000, color: '#fff0f7' }],
}

/**
 * Relative Feuchte 700 hPa in der Manier der Höhenwetterkarten: erst ab
 * 50 % eingefärbt, ab 70 % kräftig — die feuchten Bänder sind Fronten und
 * Aufgleitbewölkung, die trockenen (durchsichtig) Absinkzonen hinter dem Trog.
 */
const RH700_COLORS = ['#2b4a3a', '#2f6b4a', '#2f8f57', '#3fb36a', '#7fd37f', '#c4ecb0']
const RH700: ColorScale = {
  kind: 'stepped',
  stops: [50, 60, 70, 80, 90, 95].map((value, i) => ({ value, color: RH700_COLORS[i] })),
}

/** Niederschlagbares Wasser (mm): trocken ocker → feucht blau → tropisch violett, 5-mm-Bänder. */
const TCWV: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(
    0,
    5,
    lerpRamp(['#5a4326', '#a07a3c', '#d6c27a', '#8fcf8a', '#3fb3a3', '#2f86c6', '#3a52b5', '#6a3aa8', '#a63aa0'], 15),
  ),
}

/** Schneehöhe (cm): unter 1 cm durchsichtig, dann weiß-bläulich bis tiefblau — Atlas-Manier. */
const SNOW_STEPS = [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500]
const SNOW_COLORS = lerpRamp(['#eef4fb', '#c6dcf2', '#93bde6', '#5e98d6', '#3a6fc0', '#3a4aa0', '#5a2f8a'], SNOW_STEPS.length)
const SNOW: ColorScale = {
  kind: 'stepped',
  stops: SNOW_STEPS.map((value, i) => ({ value, color: SNOW_COLORS[i] })),
}

/** Nullgradgrenze (m über NN): 0 … 5000 in 250-m-Bändern, tief = kalt (blau), hoch = warm (rot). */
const HZEROCL: ColorScale = {
  kind: 'stepped',
  belowMin: 'clamp',
  stops: bands(0, 250, lerpRamp(TEMP_ANCHORS.slice(1), 21)),
}

export const GLOBE_VARIABLES: GlobeVariable[] = [
  {
    id: 't2m',
    group: 'Temperatur & Luftmasse',
    label: 'Temperatur 2 m',
    title: 'Lufttemperatur in 2 m Höhe (°C)',
    scale: GLOBAL_TEMP,
    decimals: 1,
    legendEvery: 5,
    legendMultiple: 10,
  },
  {
    id: 't850',
    group: 'Temperatur & Luftmasse',
    label: 'Temperatur 850 hPa',
    title:
      'Temperatur auf 850 hPa (~1500 m) — die Luftmasse ohne die bodennahe Grenzschicht. Über Hochland (Tibet, Anden, Antarktis) liegt die Fläche UNTER dem Gelände und ist vom Modell extrapoliert.',
    scale: GLOBAL_TEMP,
    decimals: 1,
    legendEvery: 5,
    legendMultiple: 10,
  },
  {
    id: 'gh500',
    group: 'Druck & Höhe',
    label: 'Geopotential 500 hPa',
    title: 'Höhe der 500-hPa-Fläche in geopotentiellen Dekametern — Tröge (niedrig) und Rücken (hoch) der Höhenströmung',
    scale: GH500,
    decimals: 1,
    legendEvery: 5,
  },
  {
    id: 'reltop',
    group: 'Temperatur & Luftmasse',
    label: 'Relative Topografie 500/1000 hPa',
    title:
      'Schichtdicke zwischen 1000 und 500 hPa in gpdm — proportional zur Mitteltemperatur der unteren Troposphäre (1 gpdm ≈ 0,5 K): zeigt Kalt- und Warmluftmassen ohne die bodennahe Grenzschicht. Über Hochland liegt 1000 hPa unter dem Gelände und ist vom Modell extrapoliert.',
    scale: RELTOP,
    decimals: 1,
    legendEvery: 4,
  },
  {
    id: 'msl',
    group: 'Druck & Höhe',
    label: 'Luftdruck (MSL)',
    title: 'Auf Meereshöhe reduzierter Luftdruck (hPa)',
    scale: COLOR_SCALES.pressure_msl,
    decimals: 1,
    legendEvery: 1,
  },
  {
    id: 'precip',
    group: 'Niederschlag & Feuchte',
    label: 'Niederschlag',
    title:
      'Mittlere Niederschlagsrate im Intervall seit dem vorigen Zeitschritt (mm/h). ICON-D2: 1 Stunde; ICON-EU: 1 Stunde, ab +78 h 3 Stunden; IFS: 3 Stunden, ab +144 h 6 Stunden — das jeweilige Intervall steht in der Legende. Bei +0 h gibt es kein Intervall.',
    scale: COLOR_SCALES.precipitation,
    decimals: 1,
    legendEvery: 3,
  },
  {
    id: 'wind10',
    group: 'Wind',
    label: 'Wind 10 m',
    title: 'Mittlere Windgeschwindigkeit in 10 m Höhe zum Termin (km/h)',
    scale: COLOR_SCALES.wind_speed_10m,
    decimals: 0,
    legendEvery: 1,
  },
  {
    id: 'gust',
    group: 'Wind',
    label: 'Böen 10 m',
    title:
      'Spitzenböe in 10 m (km/h): der höchste 3-Sekunden-Mittelwert des Winds (WMO-Definition) im Intervall vor dem Termin. ICON-EU/-D2: immer die letzte Stunde. IFS: bis +90 h die letzte Stunde, bis +144 h die letzten 3 Stunden, danach 6 Stunden — das jeweilige Intervall steht in der Legende. Ein längeres Intervall fängt mehr Spitzen ein, die Werte fallen dort tendenziell höher aus.',
    scale: COLOR_SCALES.wind_gusts_10m,
    decimals: 0,
    legendEvery: 1,
  },
  {
    id: 'wind300',
    group: 'Wind',
    label: 'Höhenwind + Geopotential 300 hPa',
    title:
      'Windgeschwindigkeit auf 300 hPa (~9 km) in km/h — der Strahlstrom (Jetstream), darüber das Geopotential derselben Fläche als Linien (statt 500 hPa). Unter 70 km/h nicht eingefärbt. Die Windpartikel zeigen hier die Höhenströmung, nicht den Bodenwind.',
    scale: JET,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'tcc',
    group: 'Wolken & Gewitter',
    label: 'Bewölkung gesamt',
    title: 'Gesamtbedeckung (%) — hell = wolkenlos, dunkel = bedeckt',
    scale: TCC_GREY,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'clouds',
    group: 'Wolken & Gewitter',
    label: 'Wolkenschichten (nur ICON)',
    title:
      'Bedeckung je Höhe in Achteln als drei halbtransparente Flächen: hoch = grün, mittel = rot, tief = blau — je mehr Achtel, desto heller und kräftiger. Übereinander gestapelt wie von oben gesehen (tief unten, hoch oben). ECMWF Open Data führt keine Schichten.',
    scale: TCC_GREY,
    decimals: 0,
    legendEvery: 1,
    kind: 'rgb3',
  },
  {
    id: 'td2m',
    group: 'Temperatur & Luftmasse',
    label: 'Taupunkt 2 m',
    title: 'Taupunkt in 2 m (°C) — die Feuchte der Luft als Temperatur: ab ~16 °C schwül, Grundzutat für Gewitter',
    scale: COLOR_SCALES.dew_point_2m,
    decimals: 1,
    legendEvery: 4,
  },
  {
    id: 'hzerocl',
    group: 'Temperatur & Luftmasse',
    label: 'Nullgradgrenze (nur ICON)',
    title:
      'Höhe der 0-°C-Fläche in Metern über NN. Keine Schneefallgrenze — die liegt bei Niederschlag meist einige hundert Meter tiefer. ECMWF Open Data führt die Größe nicht.',
    scale: HZEROCL,
    decimals: 0,
    legendEvery: 4,
  },
  {
    id: 'precipsum',
    group: 'Niederschlag & Feuchte',
    label: 'Niederschlag Summe',
    title: 'Aufsummierter Niederschlag seit Laufbeginn bis zum gewählten Termin (mm) — Regen und Schnee als Wasser; unter 1 mm als 0 gespeichert und nicht eingefärbt',
    scale: PRECIP_SUM,
    decimals: 1,
    legendEvery: 2,
  },
  {
    id: 'snow',
    group: 'Niederschlag & Feuchte',
    label: 'Schneehöhe',
    title:
      'Gesamtschneehöhe am Boden (cm). IFS: aus Wasseräquivalent und Schneedichte gerechnet — über Gletschern und Inlandeis führt das Modell eine Rechengröße, keine messbare Schneedecke.',
    scale: SNOW,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'rh700',
    group: 'Niederschlag & Feuchte',
    label: 'Relative Feuchte 700 hPa',
    title:
      'Relative Feuchte auf 700 hPa (~3 km), erst ab 50 % eingefärbt: feuchte Bänder zeigen Fronten und Aufgleitbewölkung, durchsichtige Flächen trockene Absinkluft',
    scale: RH700,
    decimals: 0,
    legendEvery: 1,
  },
  {
    id: 'tcwv',
    group: 'Niederschlag & Feuchte',
    label: 'Niederschlagbares Wasser',
    title:
      'Wasserdampf der ganzen Luftsäule (mm, = kg/m²) — so viel Wasser käme herunter, kondensierte alles. Zeigt feuchte Luftströme („atmosphärische Flüsse"); über ~40 mm ist Starkregen möglich.',
    scale: TCWV,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'cape',
    group: 'Wolken & Gewitter',
    label: 'CAPE',
    title:
      'Konvektiv verfügbare potentielle Energie (J/kg) — Labilität, kein Gewitter: ohne Auslösung bleibt es ruhig. IFS rechnet das labilste Paket (MU-CAPE), ICON ein Mischschichtpaket (ML-CAPE); IFS-Werte liegen deshalb höher. Unter 100 J/kg nicht eingefärbt, unter 50 J/kg als 0 gespeichert.',
    scale: CAPE,
    decimals: 0,
    legendEvery: 2,
  },
  {
    id: 'swh',
    group: 'Meer',
    label: 'Wellenhöhe (nur IFS)',
    title:
      'Signifikante Wellenhöhe (m) aus dem ECMWF-Wellenmodell — das Mittel des höchsten Drittels der Wellen, Windsee und Dünung zusammen. Einzelne Wellen werden bis etwa doppelt so hoch.',
    scale: WAVE_HEIGHT,
    decimals: 1,
    legendEvery: 2,
  },
  {
    id: 'pp1d',
    group: 'Meer',
    label: 'Wellenperiode (nur IFS)',
    title:
      'Peak-Periode (s): Abstand der energiereichsten Wellen. Unter ~8 s kurze, steile Windsee, über ~12 s lange Dünung aus fernen Sturmgebieten.',
    scale: WAVE_PERIOD,
    decimals: 1,
    legendEvery: 1,
  },
  {
    id: 'sst',
    group: 'Meer',
    label: 'Wassertemperatur (nur IFS)',
    title:
      'Temperatur der Meeresoberfläche (°C) — die Hauttemperatur des Modells über dem Meer, also die oberste Schicht, nicht die Temperatur in Badetiefe. Über Meereis kein Wert.',
    scale: SEA_TEMP,
    decimals: 1,
    legendEvery: 3,
  },
]

/**
 * Größen, bei denen Isobaren, 500-hPa-Linien und Windpartikel beim Wechsel
 * AUSgehen (auf Wunsch): Temperatur-, Niederschlags- und Feuchtefelder sowie
 * CAPE liest man als Fläche, die Liniennetze und die Bewegung darüber lenken
 * nur ab. Wieder einschalten bleibt möglich. Die Relative Topografie bleibt
 * ausgenommen — sie liest man klassisch MIT den 500-hPa-Linien.
 */
export function overlaysOffFor(v: GlobeVariable): boolean {
  if (v.id === 'reltop') return false
  return v.group === 'Temperatur & Luftmasse' || v.group === 'Niederschlag & Feuchte' || v.id === 'cape'
}

/** Vorgabe ist die Relative Topografie (auf Wunsch) — mit Isobaren und 500-hPa-Linien darüber. */
export const DEFAULT_GLOBE_VARIABLE: GlobeVarId = 'reltop'

// --- Modelle und Ansichten -------------------------------------------------

export type GlobeModelId = 'ecmwf-ifs' | 'ecmwf-hres' | 'ecmwf-hres-asia' | 'icon-eu' | 'icon-d2'

export interface GlobeModel {
  id: GlobeModelId
  label: string
  resolution: string
  /** Wer die Daten liefert — steht in der Quellenzeile (Lizenzbedingung). */
  provider: 'ECMWF' | 'DWD'
  /**
   * Ab diesem Alter des Laufs warnt die Leiste. Normalalter = Takt +
   * Bereitstellung + Abstand des Deploy-Crons (3 h), gemessen 2026-10-05:
   * IFS 12 + 7,5 + 3 ≈ 22,5 h · ICON-EU 6 + 3,7 + 3 ≈ 13 h · ICON-D2
   * 3 + 1,3 + 3 ≈ 7,5 h. Darüber ist mindestens ein Lauf ausgefallen.
   */
  staleHours: number
  /**
   * Höchste Zoomstufe, auf der Kacheln NEU abgetastet werden — darüber nur
   * gestreckt. Grob dort, wo ein Kachelpixel die Gitterweite unterschreitet:
   * 25 km → 6, 7 km → 7, 2,2 km → 8.
   */
  maxzoom: number
  title: string
}

const ALL_GLOBE_MODELS: GlobeModel[] = [
  {
    id: 'ecmwf-ifs',
    label: 'ECMWF IFS',
    resolution: '25 km',
    provider: 'ECMWF',
    staleHours: 30,
    maxzoom: 6,
    title: 'ECMWF IFS 0,25° — weltweit, bis +15 Tage (Läufe 00/12 UTC)',
  },
  {
    // Dasselbe Modell mit 0,1° statt 0,25°, aber nur EUROPA (Fläche von
    // ICON-EU) und nur bis +144 h — global wären es ~1,7 GB je Lauf, und
    // jenseits von sechs Tagen trägt die feinere Auflösung nichts mehr
    // (scripts/ecmwf-ingest.py --res 0p1). Erscheint ~2 h nach 0,25°.
    id: 'ecmwf-hres',
    label: 'ECMWF IFS Europa',
    resolution: '9 km',
    provider: 'ECMWF',
    staleHours: 32,
    maxzoom: 7,
    title: 'ECMWF IFS 0,1° (natives Modell ~9 km) — Europa, bis +144 h (Läufe 00/12 UTC)',
  },
  {
    // Derselbe Abruf wie `ecmwf-hres`, nur ein zweiter Ausschnitt: die
    // Himawari-Fläche (84–125° O / 5° S–28° N) für die Thailand-Ansicht —
    // kostet keinen Download, nur ~25 MB je Lauf.
    id: 'ecmwf-hres-asia',
    label: 'ECMWF IFS Asien',
    resolution: '9 km',
    provider: 'ECMWF',
    staleHours: 32,
    maxzoom: 7,
    title: 'ECMWF IFS 0,1° (natives Modell ~9 km) — Südostasien, bis +144 h (Läufe 00/12 UTC)',
  },
  {
    id: 'icon-eu',
    label: 'ICON-EU',
    resolution: '7 km',
    provider: 'DWD',
    staleHours: 15,
    maxzoom: 7,
    title: 'DWD ICON-EU 0,0625° — Europa, bis +120 h (Läufe 00/06/12/18 UTC)',
  },
  {
    id: 'icon-d2',
    label: 'ICON-D2',
    resolution: '2,2 km',
    provider: 'DWD',
    staleHours: 9,
    maxzoom: 8,
    title: 'DWD ICON-D2 0,02° — Deutschland, Alpen, Österreich, bis +48 h (Läufe alle 3 h)',
  },
]

// Südostasien steht seit 2026-10-28 auch in der veröffentlichten Seite (auf
// Wunsch, mit IFS 0,1° Asien) — nur die Thailand-Orte der Schnellwahl hängen
// weiter an `THAILAND_ENABLED`.
export const GLOBE_MODELS: GlobeModel[] = ALL_GLOBE_MODELS

export const DEFAULT_GLOBE_MODEL: GlobeModelId = 'ecmwf-ifs'

export function getGlobeModel(id: string): GlobeModel {
  return GLOBE_MODELS.find((m) => m.id === id) ?? GLOBE_MODELS[0]
}

// --- Isolinien ---------------------------------------------------------------

export type ContourId = 'msl' | 'gh500' | 'gh300'

export interface ContourDef {
  id: ContourId
  label: string
  title: string
  /** Linienabstand in der Einheit der Größe (auf der ganzen Kugel verdoppelt). */
  interval: number
  /**
   * Glättung vor dem Linienzeichnen in Gitterzellen (Kastenfilter ±r), je
   * Modell. Reduzierter BODENDRUCK ist über Gebirge verrauscht, und das umso
   * mehr, je feiner das Gitter: ICON-D2 zog mit ±4 Zellen (~18 km)
   * geschlossene 1025er-Kringel um jedes Alpental, mit ±8 noch große Schleifen
   * (beides im Browser gesehen); ±12 sind ~50 km — die Skala, auf der eine
   * Isobare eine Wetterlage beschreibt. Das 500-hPa-Feld ist von sich aus
   * glatt; ±1 nimmt beim IFS nur winzige Inseln, die bilinear als kantige
   * Kästchen erschienen. Die Farbfläche bleibt in jedem Fall ungeglättet.
   */
  smooth: Record<GlobeModelId, number>
}

/**
 * Abstände nach der Praxis der Wetterdienste: Isobaren alle 5 hPa (DWD-
 * Bodenanalyse), 500 hPa alle 4 gpdm.
 */
export const CONTOURS: ContourDef[] = [
  {
    id: 'msl',
    label: 'Isobaren',
    title: 'Bodendruck (MSL) alle 5 hPa, beschriftet — geglättet, damit Gebirgsrauschen keine Kringel zieht',
    interval: 5,
    smooth: { 'ecmwf-ifs': 1, 'ecmwf-hres': 2, 'ecmwf-hres-asia': 2, 'icon-eu': 3, 'icon-d2': 12 },
  },
  {
    id: 'gh500',
    label: '500 hPa',
    title: 'Geopotential 500 hPa alle 4 gpdm, beschriftet',
    interval: 4,
    smooth: { 'ecmwf-ifs': 1, 'ecmwf-hres': 1, 'ecmwf-hres-asia': 1, 'icon-eu': 1, 'icon-d2': 3 },
  },
  {
    id: 'gh300',
    label: '300 hPa',
    title: 'Geopotential 300 hPa alle 8 gpdm, beschriftet — die Fläche des Höhenwinds',
    // Das 300-hPa-Feld ist steiler als das 500er (Tröge reichen über ~120
    // gpdm statt ~80); mit 4 gpdm stünden die Linien im Jet zu dicht
    interval: 8,
    smooth: { 'ecmwf-ifs': 1, 'ecmwf-hres': 1, 'ecmwf-hres-asia': 1, 'icon-eu': 1, 'icon-d2': 3 },
  },
]

/**
 * Welche Isolinien zur Größe gehören: über dem Höhenwind das Geopotential
 * DERSELBEN Fläche (300 hPa) statt 500 hPa — Wind und Linien beschreiben dann
 * dieselbe Höhe, der Wind weht entlang der Linien. Sonst Isobaren und 500 hPa.
 */
export function contoursFor(varId: GlobeVarId): ContourDef[] {
  const upper: ContourId = varId === 'wind300' ? 'gh300' : 'gh500'
  return CONTOURS.filter((c) => c.id === 'msl' || c.id === upper)
}

export type GlobeViewId = 'globe' | 'europe' | 'alps' | 'thailand'

export interface GlobeView {
  id: GlobeViewId
  label: string
  projection: 'globe' | 'mercator'
  /** [[W, S], [O, N]] für die flachen Ansichten */
  bounds?: [[number, number], [number, number]]
}

const ALL_GLOBE_VIEWS: GlobeView[] = [
  { id: 'globe', label: 'Globus', projection: 'globe' },
  // Europa: das ICON-EU-Gebiet ohne Nordafrika und Ural-Rand — die synoptische Übersicht
  { id: 'europe', label: 'Europa', projection: 'mercator', bounds: [[-25, 34], [42, 71]] },
  // Alpen: der Raum, in dem ICON-D2 seine 2,2 km ausspielt
  { id: 'alps', label: 'Alpen', projection: 'mercator', bounds: [[4.5, 44.3], [17.8, 49.8]] },
  // Thailand (Tropendienst): Andamanensee UND Golf von Thailand — die beiden
  // Küsten haben ihre Regenzeit zu verschiedenen Monsunphasen. Nur das IFS
  // deckt es ab (ICON-EU/-D2 sind europäisch).
  { id: 'thailand', label: 'Thailand', projection: 'mercator', bounds: [[96.3, 5.2], [106.2, 20.6]] },
]
export const GLOBE_VIEWS: GlobeView[] = ALL_GLOBE_VIEWS

export function getGlobeVariable(id: string): GlobeVariable {
  return GLOBE_VARIABLES.find((v) => v.id === id) ?? GLOBE_VARIABLES[0]
}

// --- meta.json -------------------------------------------------------------

export interface GlobeGrid {
  ni: number
  nj: number
  lon0: number
  lat0: number
  dlon: number
  /** negativ: Zeile 0 ist der Nordrand (ECMWF), positiv: der Südrand (ICON) */
  dlat: number
  /**
   * Schließt sich die Länge (Spalte ni−1 grenzt an Spalte 0)? Nur dann wird
   * über die Datumsgrenze gewickelt; ein regionales Gitter endet an seinem
   * Rand, außerhalb gibt es keinen Wert.
   */
  global: boolean
}

export interface GlobeVarMeta {
  lo: number
  step: number
  unit: string
  /** Vorhandene Schritte in Stunden ab Init (Niederschlag und Böe ohne +0). */
  steps: number[]
  /**
   * Nur Niederschlag und Böe: Länge des Intervalls VOR dem Termin, für das
   * der Wert gilt (h), parallel zu `steps`. Aus dem GRIB übernommen, nicht
   * angenommen — gemessen wechselt es: der Niederschlag gilt bis zum vorigen
   * Schritt (1, 3 oder 6 h), die Böe bei ICON IMMER der letzten Stunde, bei
   * IFS bis +90 h der letzten Stunde, dann 3 bzw. 6 h.
   */
  intervals?: number[]
  /**
   * 'rgb3' = Wolkenschichten, drei Kanäle in % statt eines Codes;
   * 'uv8' = Windkomponenten, R = u, G = v, je (code − 128) · step m/s, 0 = kein Wert
   *   (`uv10` 0,5 m/s, `uv300` 1 m/s — der Strahlstrom reicht über 63,5 m/s)
   */
  encoding?: 'rgb3' | 'uv8'
}

/** Intervall (h) des Werts zum Schritt, oder undefined für Termingrößen. */
export function intervalHours(vm: GlobeVarMeta | undefined, step: number): number | undefined {
  if (!vm?.intervals) return undefined
  const i = vm.steps.indexOf(step)
  return i < 0 ? undefined : vm.intervals[i]
}

/**
 * Abstand zum vorigen Schritt (h), wenn das Intervall des Werts KÜRZER ist —
 * dann ist die Größe nur eine STICHPROBE, die Stunden dazwischen fehlen.
 * Gemessen trifft das die Böe zweimal: IFS bis +90 h (Schritte alle 3 h, die
 * Böe `10fg` gilt nur der letzten Stunde; stündliche Schritte und eine
 * 3-h-Böe gibt es in Open Data dort nicht, geprüft 2026-10-27) und ICON-EU
 * ab +78 h (Dateien alle 3 h, `vmax_10m` weiter nur die letzte Stunde).
 * Sonst undefined.
 */
export function sampledGapHours(vm: GlobeVarMeta | undefined, step: number): number | undefined {
  const hours = intervalHours(vm, step)
  if (hours == null || !vm) return undefined
  const i = vm.steps.indexOf(step)
  if (i <= 0) return undefined
  const gap = step - vm.steps[i - 1]
  return hours < gap ? gap : undefined
}

export interface GlobeMeta {
  model: GlobeModelId
  runId: string
  /** Init-Zeit, ISO UTC */
  run: string
  generated: string
  grid: GlobeGrid
  variables: Partial<Record<GlobeVarId, GlobeVarMeta>>
}

/** Ein dekodiertes Feld: Codes statt Werte (halber Speicher, 2 MB je Feld). */
export interface GlobeField {
  grid: GlobeGrid
  lo: number
  step: number
  codes: Uint16Array
  /** Nur Wolkenschichten: je Zelle [mittel, hoch, tief] in %, 255 = kein Wert. */
  rgb?: Uint8Array
  /** Nur Windkomponenten: je Zelle [u, v] als Code, (code − 128) · step m/s, 0 = kein Wert. */
  uv?: Uint8Array
}

/** RGBA-Pixel eines Windbilds → je Zelle [u, v] als 8-Bit-Code (R = u, G = v). */
export function decodeUv8(rgba: ArrayLike<number>, count: number): Uint8Array {
  const out = new Uint8Array(count * 2)
  for (let i = 0; i < count; i++) {
    out[2 * i] = rgba[4 * i]
    out[2 * i + 1] = rgba[4 * i + 1]
  }
  return out
}

/**
 * Windpartikel: welches Komponentenfeld zur gewählten Größe gehört, und mit
 * welchem Bezugstempo (m/s) es läuft. Über dem Höhenwind zeigen sie die
 * Höhenströmung — mit dem Bezug 10 m/s rasten die Partikel im Strahlstrom
 * (80 m/s) achtmal so schnell wie am Boden; mit 40 m/s laufen sie in beiden
 * Fällen in einem ähnlichen, lesbaren Tempo.
 */
export function particleSource(varId: GlobeVarId, meta: GlobeMeta | null): { var: GlobeVarId; refSpeed: number } {
  if (varId === 'wind300' && meta?.variables.uv300) return { var: 'uv300', refSpeed: 40 }
  return { var: 'uv10', refSpeed: 10 }
}

/**
 * Wind (u nach Osten, v nach Norden, m/s) an (lat, lon), bilinear, oder null
 * außerhalb des Gitters bzw. sobald ein Nachbar keinen Wert hat — dieselbe
 * Regel wie `sampleField`.
 */
export function sampleWind(f: GlobeField, lat: number, lon: number): [number, number] | null {
  const uv = f.uv
  if (!uv) return null
  const { ni, nj } = f.grid
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return null
  const ix0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
  const ix1 = ix0 + 1 === ni ? 0 : ix0 + 1
  const iy0 = Math.min(nj - 2, Math.floor(gy))
  const fx = gx - ix0
  const fy = gy - iy0
  const i00 = 2 * (iy0 * ni + ix0)
  const i01 = 2 * (iy0 * ni + ix1)
  const i10 = 2 * ((iy0 + 1) * ni + ix0)
  const i11 = 2 * ((iy0 + 1) * ni + ix1)
  if (uv[i00] === 0 || uv[i01] === 0 || uv[i10] === 0 || uv[i11] === 0) return null
  const w00 = (1 - fx) * (1 - fy)
  const w01 = fx * (1 - fy)
  const w10 = (1 - fx) * fy
  const w11 = fx * fy
  const u = uv[i00] * w00 + uv[i01] * w01 + uv[i10] * w10 + uv[i11] * w11
  const v = uv[i00 + 1] * w00 + uv[i01 + 1] * w01 + uv[i10 + 1] * w10 + uv[i11 + 1] * w11
  return [(u - 128) * f.step, (v - 128) * f.step]
}

/** RGBA-Pixel eines Schichtenbilds → je Zelle drei Bedeckungen (R mittel, G hoch, B tief). */
export function decodeRgb3(rgba: ArrayLike<number>, count: number): Uint8Array {
  const out = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    out[3 * i] = rgba[4 * i]
    out[3 * i + 1] = rgba[4 * i + 1]
    out[3 * i + 2] = rgba[4 * i + 2]
  }
  return out
}

/** Wolkenschichten am Punkt (nächster Gitterpunkt — die Werte sind 5-%-Stufen), oder null. */
export function sampleRgb3(f: GlobeField, lat: number, lon: number): { high: number; mid: number; low: number } | null {
  if (!f.rgb) return null
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return null
  const i = Math.round(gy) * f.grid.ni + (Math.round(gx) % f.grid.ni)
  const mid = f.rgb[3 * i]
  if (mid === 255) return null
  return { mid, high: f.rgb[3 * i + 1], low: f.rgb[3 * i + 2] }
}

/** RGBA-Pixel eines Wertebilds → 16-Bit-Codes (R hoch, G tief). */
export function decodeCodes(rgba: ArrayLike<number>, count: number): Uint16Array {
  const out = new Uint16Array(count)
  for (let i = 0; i < count; i++) out[i] = (rgba[4 * i] << 8) | rgba[4 * i + 1]
  return out
}

/**
 * Gitterspalte (in Zellen, gebrochen) zur Länge, oder null außerhalb eines
 * regionalen Gitters. Global wird über die Datumsgrenze gewickelt (Spalte
 * ni−1 grenzt an Spalte 0 — 179,75° O an 180° W). Länge und Breite sind
 * getrennt, weil die Kacheln Zeilen und Spalten je einmal vorberechnen.
 */
export function gridX(g: GlobeGrid, lon: number): number | null {
  let gx = (lon - g.lon0) / g.dlon
  if (g.global) return ((gx % g.ni) + g.ni) % g.ni
  // regional: Länge auf den Bereich des Gitters falten (−180…180 gegen 0…360)
  if (gx < 0) gx += 360 / g.dlon
  if (gx > g.ni - 1) gx -= 360 / g.dlon
  return gx < 0 || gx > g.ni - 1 ? null : gx
}

/** Gitterzeile zur Breite; global an den Polen geklemmt, regional null außerhalb. */
export function gridY(g: GlobeGrid, lat: number): number | null {
  const gy = (lat - g.lat0) / g.dlat
  if (g.global) return Math.min(g.nj - 1, Math.max(0, gy))
  return gy < 0 || gy > g.nj - 1 ? null : gy
}

/**
 * Bilinearer Wert an (lat, lon). NaN außerhalb eines regionalen Gitters und
 * sobald einer der vier Nachbarn keinen Wert hat: ein halber Mittelwert wäre
 * eine erfundene Zahl.
 */
export function sampleField(f: GlobeField, lat: number, lon: number): number {
  const { ni, nj } = f.grid
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return NaN
  const ix0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
  const ix1 = ix0 + 1 === ni ? 0 : ix0 + 1
  const iy0 = Math.min(nj - 2, Math.floor(gy))
  const fx = gx - ix0
  const fy = gy - iy0
  const c = f.codes
  const r0 = iy0 * ni
  const r1 = r0 + ni
  const c00 = c[r0 + ix0]
  const c01 = c[r0 + ix1]
  const c10 = c[r1 + ix0]
  const c11 = c[r1 + ix1]
  if (c00 === 0 || c01 === 0 || c10 === 0 || c11 === 0) return NaN
  const code = (c00 * (1 - fx) + c01 * fx) * (1 - fy) + (c10 * (1 - fx) + c11 * fx) * fy
  return f.lo + (code - 1) * f.step
}

// --- Kachelgeometrie (Web-Mercator, XYZ) -----------------------------------

/** Länge der Pixelmitte `px` in Kachel x der Stufe z. */
export function tilePixelLon(z: number, x: number, px: number, size: number): number {
  return ((x * size + px + 0.5) / (size * 2 ** z)) * 360 - 180
}

/** Breite der Pixelmitte `py` in Kachel y der Stufe z (inverse Mercator). */
export function tilePixelLat(z: number, y: number, py: number, size: number): number {
  const m = Math.PI * (1 - (2 * (y * size + py + 0.5)) / (size * 2 ** z))
  return (Math.atan(Math.sinh(m)) * 180) / Math.PI
}

// --- Zeit und Laufalter ----------------------------------------------------

const HOUR = 3_600_000

export function runMs(meta: GlobeMeta): number {
  return Date.parse(meta.run)
}

export function validMs(meta: GlobeMeta, step: number): number {
  return runMs(meta) + step * HOUR
}

/** Index des Schritts, dessen Gültigkeitszeit `targetMs` am nächsten liegt. */
export function nearestStepIndex(steps: number[], run: number, targetMs: number): number {
  let best = 0
  let bestD = Infinity
  steps.forEach((s, i) => {
    const d = Math.abs(run + s * HOUR - targetMs)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

export type GlobeFreshness = 'ok' | 'old' | 'spent'

/**
 * 'spent' schlägt 'old': liegt der letzte Termin in der Vergangenheit, ist es
 * keine Vorhersage mehr. Die Schwelle hängt am Modell (`staleHours`) — die
 * 12 h der MOS-Vorhersage wären bei IFS ein Dauerfehlalarm, bei ICON-D2 zu spät.
 */
export function globeFreshness(run: number, lastValid: number, now: number, staleHours: number): GlobeFreshness {
  if (Number.isFinite(lastValid) && lastValid < now) return 'spent'
  if (Number.isFinite(run) && now - run > staleHours * HOUR) return 'old'
  return 'ok'
}
