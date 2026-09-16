// Frageerkennung fürs Klima-Suchfenster: „was war das tagesmaximum im juli
// seit messbeginn in salzburg?" → { Gebiet, Parameter, Zeitraum, Extremum }.
//
// Gebiet ist entweder EINE Station oder GANZ ÖSTERREICH („höchste je gemessene
// temperatur in österreich"). Beide Fälle laufen durch denselben
// Auswertungspfad: die nationalen Rekorde (`_national.json`) haben dieselbe
// Form wie die Stationsrekorde, nur trägt dort jeder Extremwert die Station,
// die ihn hält.
//
// BEWUSST ohne Sprachmodell. Die Antwort steckt in den bereits vorhandenen
// Assets (public/at/records, public/at/normals-*), und ein Modell, das aus
// eigenem Wissen antwortet, erfindet bei genau solchen Fragen selbstbewusst
// Zahlen. Was hier gebraucht wird, ist keine Sprachkompetenz, sondern Wissen
// über DIESE Registry: welcher Parametername welchen Code meint und welche
// Station gemeint ist, wenn acht „Salzburg" heißen.
//
// Reiner Rechenkern mit Tests (wie atRank/atHistory) — die Erkennung ist eine
// Kette von Heuristiken, und jede einzelne fällt still um, wenn niemand
// hinsieht. Das Ergebnis wird in der UI als ÄNDERBARE Auswahl gezeigt: ein
// Fehlgriff kostet dann einen Klick statt einer falschen Zahl.

import type { AtStation } from '../api/geosphere'
import type { Season } from '../api/atValues'
import type { Extreme, MaxMin, NormalsEntry, NormalsMap, ParamRecords } from '../api/atValues'
import { monthOfYearRange, seasonRange } from '../api/atRecords'
import { getAtParameter, type AtParameterSpec } from '../config/atParameters'

/** Umlaute falten, Kleinschreibung, Satzzeichen weg — Tippfehler bleiben übrig. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Damerau-Levenshtein: zählt zusätzlich VERTAUSCHTE Nachbarn als EINEN Fehler.
 * Das ist der häufigste Tippfehler überhaupt — „salzbrug", „tagesmaxiumm" —,
 * und ohne diese Regel kostet er zwei Ersetzungen und fällt unter die Schwelle.
 */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev2: number[] = []
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
      }
    }
    prev2 = prev
    prev = cur
  }
  return prev[n]
}

/** 1 = gleich, 0 = nichts gemeinsam. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  return max === 0 ? 0 : 1 - editDistance(a, b) / max
}

const MONTHS: Record<string, number> = {
  janner: 1, januar: 1, jan: 1,
  februar: 2, feber: 2, feb: 2,
  marz: 3, maerz: 3, mar: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12,
}

const SEASONS: Record<string, Season> = {
  winter: 'DJF',
  // „Lenz" bewusst NICHT: das Wort ist archaisch und liegt einen Tippfehler
  // von der Stadt Linz entfernt — „trockenster märz in linz" wurde dadurch zu
  // einer Frühlingsfrage.
  fruhling: 'MAM', fruhjahr: 'MAM',
  sommer: 'JJA',
  herbst: 'SON',
}

/**
 * Wortformen → Parametercode. `dir` ist die Richtung, die im Wort schon
 * steckt („Tagesmaximum" ist immer ein Höchstwert); `generic` markiert
 * Wörter, die für sich noch keine Größe festlegen — „Temperatur" wird erst
 * durch ein Superlativ zu Maximum oder Minimum.
 */
const PARAM_WORDS: {
  words: string[]
  code: string
  dir?: 'max' | 'min'
  generic?: true
  /**
   * Die Frage gilt einer NACHT, nicht einem Kalendertag. Ändert nicht die
   * Größe (das ist `tlmin`), sondern die ANTWORT: eine Nacht spannt zwei
   * Daten, und welches Fenster gemeint ist, gehört dazugesagt.
   */
  night?: true
}[] = [
  { words: ['tagesmaximum', 'hochsttemperatur', 'maximaltemperatur', 'tmax', 'hitzerekord'], code: 'tlmax', dir: 'max' },
  { words: ['tagesminimum', 'tiefsttemperatur', 'minimaltemperatur', 'tmin', 'kalterekord'], code: 'tlmin', dir: 'min' },
  // Die NACHT bestimmt die GRÖSSE, nicht die Richtung: „kälteste Nacht" ist
  // das tiefste Tagesminimum, „wärmste Nacht" das HÖCHSTE (die Tropennacht) —
  // beides dieselbe Messgröße, nur andere Richtung. Deshalb ohne `dir`, die
  // kommt aus dem Superlativ. Ohne diesen Eintrag fand „kälteste Nacht in
  // Salzburg" gar kein Größenwort, fiel auf die Vorgabe `tlmax` zurück und
  // antwortete mit dem tiefsten Tages-MAXIMUM — also dem kältesten Tag statt
  // der kältesten Nacht.
  { words: ['nacht', 'nachte', 'nachts', 'nachtminimum', 'nachttemperatur'], code: 'tlmin', night: true },
  { words: ['tropennacht', 'tropennachte'], code: 'tlmin', dir: 'max', night: true },
  { words: ['frostnacht', 'frostnachte'], code: 'tlmin', dir: 'min', night: true },
  { words: ['temperatur', 'mitteltemperatur', 'warm', 'kalt', 'grad'], code: 'tl_mittel', generic: true },
  { words: ['niederschlag', 'regen', 'regenmenge', 'niederschlagsmenge', 'nass'], code: 'rr' },
  // Superlative, die die Größe schon MITNENNEN: „nassester Sommer" fragt nach
  // Niederschlag, nicht nach Temperatur. Ohne sie fiel die Frage auf den
  // Standardparameter zurück.
  { words: ['nasseste', 'nassester', 'nassestes', 'regenreichste', 'regenreichster'], code: 'rr', dir: 'max' },
  { words: ['trockenste', 'trockenster', 'trockenstes'], code: 'rr', dir: 'min' },
  { words: ['sonne', 'sonnenschein', 'sonnenscheindauer', 'sonnenstunden'], code: 'so_h' },
  { words: ['sonnigste', 'sonnigster', 'sonnigstes'], code: 'so_h', dir: 'max' },
  { words: ['trubste', 'trubeste', 'trubster'], code: 'so_h', dir: 'min' },
  { words: ['schnee', 'schneehohe', 'schneedecke'], code: 'sh' },
  { words: ['schneereichste', 'schneereichster'], code: 'sh', dir: 'max' },
  { words: ['feuchte', 'luftfeuchte', 'luftfeuchtigkeit'], code: 'rfb_mittel' },
  { words: ['sommertage', 'sommertag'], code: 'tage_sommer' },
  { words: ['hitzetage', 'hitzetag', 'tropentage'], code: 'tage_tropen' },
  { words: ['frosttage', 'frosttag'], code: 'tage_frost' },
  { words: ['eistage', 'eistag'], code: 'tage_eis' },
]

/**
 * Wie der gesuchte Extremwert im Antworttext heißt — je Parameter und
 * Richtung, HANDGESCHRIEBEN.
 *
 * Vorher stand dort `richtung + spec.label` mit einem immer maskulinen
 * „höchster"/„tiefster", und `spec.label` ist ein BEZEICHNER für Dropdowns,
 * kein Satzteil. Heraus kam „tiefster Temperatur Maximum": falsches Genus,
 * falsche Flexion, und zusammengeklebt aus zwei Substantiven. Deutsche
 * Grammatik lässt sich aus einem Registry-Label nicht ableiten — jede Größe
 * hat ihr eigenes Genus („die Schneehöhe", „das Tagesminimum", „der
 * Niederschlag") und ihren eigenen passenden Superlativ („längste"
 * Sonnenscheindauer, nicht „höchste"; „meiste" Frosttage, nicht „höchste").
 *
 * Ein Test hält die Tabelle vollständig gegen alle Codes, die das Parsen
 * überhaupt erzeugen kann.
 */
const SUPERLATIVE: Record<string, { max: string; min: string }> = {
  tlmax: { max: 'höchstes Tagesmaximum', min: 'tiefstes Tagesmaximum' },
  tlmin: { max: 'höchstes Tagesminimum', min: 'tiefstes Tagesminimum' },
  tl_mittel: { max: 'höchste Mitteltemperatur', min: 'tiefste Mitteltemperatur' },
  rr: { max: 'höchste Niederschlagssumme', min: 'geringste Niederschlagssumme' },
  so_h: { max: 'längste Sonnenscheindauer', min: 'kürzeste Sonnenscheindauer' },
  sh: { max: 'größte Schneehöhe', min: 'geringste Schneehöhe' },
  rfb_mittel: { max: 'höchste relative Feuchte', min: 'tiefste relative Feuchte' },
  tage_sommer: { max: 'meiste Sommertage', min: 'wenigste Sommertage' },
  tage_tropen: { max: 'meiste Hitzetage', min: 'wenigste Hitzetage' },
  tage_frost: { max: 'meiste Frosttage', min: 'wenigste Frosttage' },
  tage_eis: { max: 'meiste Eistage', min: 'wenigste Eistage' },
  tage_rr_1: { max: 'meiste Niederschlagstage', min: 'wenigste Niederschlagstage' },
}

/**
 * Antworttext für den gesuchten Extremwert. Fällt auf eine grammatisch
 * neutrale Form zurück, falls je ein Parameter ohne Eintrag durchkommt —
 * „Tiefstwert von …" ist mit jedem Label richtig, nur weniger schön.
 */
export function superlativeText(
  code: string,
  extreme: 'max' | 'min',
  label: string,
  nightly = false,
): string {
  // Fragt die Frage nach einer NACHT, dann heißt die Antwort so — „tiefstes
  // Tagesminimum" ist dieselbe Zahl, aber nicht dieselbe Auskunft.
  if (nightly && code === 'tlmin') return extreme === 'max' ? 'wärmste Nacht' : 'kälteste Nacht'
  const p = SUPERLATIVE[code]
  if (p) return p[extreme]
  return `${extreme === 'max' ? 'Höchstwert' : 'Tiefstwert'} von ${label}`
}

/**
 * Eine Nacht als Spanne über ZWEI Daten: „Nacht vom 11. auf den 12. Jänner
 * 1940".
 *
 * `day` ist der KLIMATAG des Werts (YYYY-MM-DD). GeoSphere bildet die
 * Tagesextreme von 19 MEZ des Vortags bis 19 MEZ, also 18–18 UTC (in
 * `verify.ts` gemessen) — die Nacht in diesem Fenster ist damit die von
 * `day − 1` auf `day`. Genau deshalb existiert diese Konvention: über den
 * Kalendertag gerechnet schnitte die Tagesgrenze mitten durch den Tiefpunkt,
 * und eine Nacht hätte zwei Minima. Dieselbe Überlegung steckt im klassischen
 * Meteogramm hinter der synoptischen Nacht 18–06 UTC (`ExtremeWindow`).
 *
 * Über Monats- und Jahresgrenzen wird beidseitig voll ausgeschrieben, sonst
 * stünde „Nacht vom 31. auf den 1. Jänner" da — und das wäre der 31. Jänner.
 */
export function formatNightSpan(day: string): string {
  const to = new Date(`${day}T12:00:00Z`)
  const from = new Date(to.getTime() - 86_400_000)
  const full = new Intl.DateTimeFormat('de-AT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const sameMonth =
    from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()
  const fromText = sameMonth ? `${from.getUTCDate()}.` : full.format(from)
  return `Nacht vom ${fromText} auf den ${full.format(to)}`
}

/**
 * Hinweis zum Zeitfenster einer Nachtfrage — und er ist je RICHTUNG
 * verschieden, was beim Nachrechnen überrascht:
 *
 * Geantwortet wird mit dem Minimum des KLIMATAGS (18–18 UTC), nicht mit dem
 * Minimum eines eigenen Nachtfensters (18–06 UTC). Ein solches Fenster ist aus
 * dem Archiv nicht ableitbar: die Rekorde stehen als Monatswerte in den
 * Assets, und für eine eigene Nachtauswertung bräuchte man die
 * 10-Minuten-Reihen — die gibt es erst ab 1992.
 *
 * Bei der WÄRMSTEN Nacht ist das unkritisch, und zwar beweisbar: gesucht ist
 * das höchste Tagesminimum. Läge dieses Minimum ausnahmsweise am Tag (etwa
 * nachmittags hinter einer Kaltfront), dann war die Nacht NOCH WÄRMER — der
 * genannte Wert ist also eine untere Schranke für die Nacht, und die Nacht war
 * in jedem Fall so warm. Die Aussage bleibt richtig.
 *
 * Bei der KÄLTESTEN Nacht liegt der Fall umgekehrt: gesucht ist das tiefste
 * Tagesminimum, und das kann in seltenen Fällen ein NACHMITTAGSwert hinter
 * einer Kaltfront sein — dann war die eigentliche Nacht wärmer als der
 * genannte Wert, und der Wert gehört gar nicht in die Nacht. Deshalb steht
 * dort ein Vorbehalt, bei der wärmsten Nacht nicht.
 */
export function nightNote(extreme: 'max' | 'min'): string {
  const base =
    'Tiefstwert des Klimatags (19–19 MEZ) — die Nacht davor liegt in diesem Fenster. '
  return extreme === 'max'
    ? base +
        'Fiel das Minimum ausnahmsweise am Tag, war die Nacht noch wärmer: der Wert ist dann ' +
        'eine untere Schranke.'
    : base +
        'In seltenen Fällen (Kaltfront am Nachmittag) fällt dieses Minimum in den Tag und ' +
        'nicht in die Nacht. Ein eigenes Nachtfenster (18–06 UTC) ist aus dem Monatsarchiv ' +
        'nicht ableitbar.'
}

/** Alle Parametercodes mit Superlativ-Phrase — für den Vollständigkeitstest. */
export const SUPERLATIVE_CODES = Object.keys(SUPERLATIVE)

/** Generisches „Temperatur" + Superlativ → Höchst- bzw. Tiefstwert. */
const GENERIC_UPGRADE: Record<string, { max: string; min: string }> = {
  tl_mittel: { max: 'tlmax', min: 'tlmin' },
}

const SUPER_MAX = ['hochste', 'hochster', 'hochstes', 'maximum', 'max', 'warmste', 'warmster',
  'heisseste', 'heissester', 'meiste', 'meisten', 'grosste', 'hochsten', 'nasseste', 'sonnigste']
const SUPER_MIN = ['tiefste', 'tiefster', 'tiefstes', 'minimum', 'min', 'kalteste', 'kaltester',
  'wenigste', 'wenigsten', 'geringste', 'trockenste', 'niedrigste']
/** Zeit-Marker, KEINE Richtung: „Rekord" sagt „seit jeher", nicht „am höchsten". */
const ALLTIME = ['messbeginn', 'jemals', 'je', 'allzeit', 'aufzeichnung', 'aufzeichnungen',
  'rekord', 'rekorde', 'immer', 'bisher']
/**
 * Marker für den JAHRESwert. Deutsche Fragen tragen ihn als Vorsilbe:
 * „Jahresniederschlag", „Jahresmitteltemperatur", „Jahressumme" — auch getrennt
 * geschrieben („höchster jahres niederschlag"), deshalb der Präfixtest auf
 * `jahres` statt einer Wortliste. Das bloße „Jahr" reicht NICHT: „im Jahr 1954"
 * meint einen Zeitpunkt, nicht die Jahressumme (es steht ohnehin in den
 * Stoppwörtern).
 */
const ANNUAL_PREFIX = 'jahres'

/**
 * Endungen deutscher Messgrößen-Komposita. Wird die Endung abgetrennt, bleibt
 * das Größenwort übrig: „regensumme" → „regen", „niederschlagssumme" →
 * „niederschlag" (Fugen-s fällt mit).
 *
 * Gebraucht, weil „höchste REGENSUMME an einem Tag in Salzburg" mit 38,6 °C
 * antwortete: kein Größenwort erkannt, also die Vorgabe `tlmax`. Die
 * Kompositum-Regel im Abgleich greift erst ab sechs Zeichen (kürzere
 * Fragmente stecken zufällig in vielen Wörtern) — „regen" hat fünf, und die
 * Ähnlichkeit zu „regenmenge" liegt bei 0,60, weit unter der Schwelle.
 *
 * Bewusst eine REGEL und keine längere Wortliste: „…summe", „…menge",
 * „…höhe", „…dauer" sind im Deutschen produktiv, jede Aufzählung wäre
 * unvollständig. Ein Mindestrest von drei Zeichen verhindert, dass aus
 * „summe" allein ein Treffer wird.
 */
const MEASURE_SUFFIXES = ['summe', 'menge', 'hohe', 'dauer', 'anzahl', 'wert', 'werte']

/** Größenwort aus einem Kompositum, oder null. */
export function measureStem(t: string): string | null {
  for (const suf of MEASURE_SUFFIXES) {
    if (t.length >= suf.length + 3 && t.endsWith(suf)) {
      const base = t.slice(0, t.length - suf.length)
      return base.endsWith('s') && base.length > 3 ? base.slice(0, -1) : base
    }
  }
  return null
}

/**
 * Marker für die TAGESebene: „an einem Tag", „Tagesniederschlag",
 * „Tagessumme". Nur `tag` und die Vorsilbe `tages` — NICHT `tage`/`tagen`,
 * sonst würde „meiste Niederschlagstage" (ein Kenntag über einen Monat) als
 * Tagesfrage gelesen.
 */
const DAILY_WORDS = ['tag', 'tages']
const DAILY_PREFIX = 'tages'
const ANNUAL_WORDS = ['jahrlich', 'jahrliche', 'jahrlicher', 'jahrliches']

/**
 * Das BLOSSE „Jahr" zählt auch — „wärmstes Jahr" ist die häufigste Form der
 * Frage. Es steht als Funktionswort auf der Stoppwortliste und fehlt deshalb
 * in `content`; geprüft wird hier auf der vollen Tokenliste. Ausgenommen ist
 * „im Jahr 1954": folgt eine Jahreszahl, benennt das Wort einen ZEITPUNKT und
 * keine Jahressumme.
 */
function mentionsYearPeriod(tokens: string[]): boolean {
  return tokens.some(
    (t, i) => (t === 'jahr' || t === 'jahres') && !/^(19|20)\d\d$/.test(tokens[i + 1] ?? ''),
  )
}

/**
 * Wörter, die die Frage auf GANZ ÖSTERREICH beziehen. „at" ist bewusst NICHT
 * dabei: zwei Zeichen treffen im unscharfen Vergleich alles.
 */
const AUSTRIA_WORDS = ['osterreich', 'osterreichs', 'osterreichweit', 'osterreichweite',
  'bundesweit', 'landesweit', 'gesamtosterreich', 'austria']

/** Frage nach dem langjährigen Mittel statt nach einem Extrem. */
const NORMAL_WORDS = ['normal', 'normalwert', 'durchschnitt', 'durchschnittlich', 'mittel',
  'ublich', 'ublicherweise', 'normalerweise', 'schnitt']

/**
 * Deutsche Funktionswörter, die NIE als Monat, Parameter oder Jahreszeit
 * gelesen werden dürfen. Der Anlass ist konkret: „seit" liegt einen Tippfehler
 * von „sept" entfernt, und „seit Messbeginn" wurde dadurch zu September.
 * Kurze Wörter sind für unscharfe Vergleiche grundsätzlich zu gefährlich.
 *
 * NICHT auf die Stationssuche angewandt: Stationsnamen enthalten selbst
 * Funktionswörter („Aigen im Ennstal", „Krems an der Donau").
 */
const STOPWORDS = new Set([
  'seit', 'mit', 'bei', 'von', 'vom', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine',
  'einem', 'einen', 'war', 'waren', 'was', 'wie', 'viel', 'wieviel', 'hoch', 'hohe',
  'im', 'in', 'am', 'an', 'auf', 'aus', 'und', 'oder', 'ist', 'sind', 'es', 'gab',
  'wurde', 'gemessen', 'station', 'ort', 'bitte', 'mir', 'sag', 'zeig', 'hat', 'hatte',
  'jahr', 'jahre', 'jahren', 'monat', 'monate', 'fiel', 'fallt', 'lag', 'liegt', 'gibt',
])

/** Kurze Tokens per PRÄFIX, lange per Ähnlichkeit — „jui" liegt zu „jun" und „jul" gleich nah. */
function lookupWord<T>(token: string, table: Record<string, T>): T | undefined {
  if (table[token] !== undefined) return table[token]
  if (token.length <= 3) {
    const hit = Object.keys(table).find((k) => k.startsWith(token))
    return hit ? table[hit] : undefined
  }
  let best: T | undefined
  // 0,80 ist die Grenze, an der EIN Fehler in einem Fünf-Zeichen-Wort noch
  // durchgeht („julli" → Juli), ein Vier-Zeichen-Wort mit einem Fehler aber
  // nicht mehr („linz" → „lenz", „seit" → „sept" liegen bei 0,75). Genau
  // solche Beinahe-Treffer kurzer Wörter waren die Fehlerquelle.
  let bestScore = 0.8
  for (const [k, v] of Object.entries(table)) {
    const sc = similarity(token, k)
    if (sc >= bestScore) {
      bestScore = sc
      best = v
    }
  }
  return best
}

function hasAny(tokens: string[], words: string[]): boolean {
  return tokens.some((t) => words.some((w) => (t.length <= 3 ? t === w : similarity(t, w) >= 0.85)))
}

export interface StationMatch {
  id: number
  name: string
  score: number
}

/**
 * Station aus der Frage bestimmen. Bewertet ZUSAMMENHÄNGENDE Wortfenster gegen
 * den ganzen Stationsnamen — „wien hohe warte" ist ein Name, kein dreimal
 * einzeln zu suchendes Wort. Ein reiner Token-Vergleich schickte „hohe" zur
 * „Hohen Wand".
 */
/**
 * Normalisierte Namen je Stationsliste zwischenspeichern: die Suche läuft bei
 * JEDEM Tastendruck über 1100 Stationen, und ohne Cache wären das ebenso viele
 * `normalize()`-Aufrufe pro Zeichen.
 */
const nameCache = new WeakMap<AtStation[], { name: string; parts: string[] }[]>()
function normalizedNames(stations: AtStation[]) {
  let c = nameCache.get(stations)
  if (!c) {
    c = stations.map((st) => {
      const name = normalize(st.name)
      return { name, parts: name.split(' ').filter((p) => p.length >= 4) }
    })
    nameCache.set(stations, c)
  }
  return c
}

export function matchStations(query: string, stations: AtStation[], limit = 6): StationMatch[] {
  const tokens = normalize(query).split(' ').filter((t) => t.length >= 3)
  if (tokens.length === 0) return []
  const windows: string[] = []
  for (let n = Math.min(4, tokens.length); n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const win = tokens.slice(i, i + n)
      // EINZELNE Funktionswörter dürfen keine Station treffen: „was WAR das …"
      // landete über den Namensanfang bei der Station „Warth". Innerhalb
      // mehrteiliger Fenster bleiben sie erlaubt, weil Stationsnamen selbst
      // welche enthalten („Krems an der Donau").
      if (n === 1 && (STOPWORDS.has(win[0]) || win[0].length < 4)) continue
      windows.push(win.join(' '))
    }
  }
  const names = normalizedNames(stations)
  const out: StationMatch[] = []
  for (let si = 0; si < stations.length; si++) {
    const st = stations[si]
    const { name, parts } = names[si]
    let score = 0
    for (const w of windows) {
      if (w.length < 3) continue
      // Ganzer Name getroffen — das stärkste Signal.
      score = Math.max(score, similarity(w, name))
      // Namensanfang getroffen („salzburg" → „Salzburg Flughafen"). Der
      // Zuschlag für den abgedeckten Anteil bleibt klein: sonst gewinnt der
      // KÜRZERE Name, und das ist kein Argument.
      if (name.startsWith(w)) score = Math.max(score, 0.88 + 0.02 * (w.length / name.length))
      // Einzelnes Namenswort getroffen, leicht abgewertet.
      for (const part of parts) score = Math.max(score, similarity(w, part) * 0.9)
    }
    // Stillgelegte Stationen deutlich abwerten — und das ist KEINE
    // Geschmacksfrage: „Salzburg" heißt exakt eine Station, die von 1874 bis
    // 1903 maß. Ihr Allzeitmaximum sind 34,8 °C von 1900; die richtige Antwort
    // auf „höchste je gemessene Temperatur in Salzburg" sind 37,7 °C. Ein
    // exakter Namenstreffer auf eine tote Reihe ist also nicht nur unschön,
    // sondern liefert eine falsche Zahl. Der Abschlag ist größer als der
    // Abstand zwischen exaktem Treffer (1,0) und Namensanfang (~0,89), damit
    // eine aktive Station gewinnt; über die Alternativenliste bleibt die alte
    // einen Klick entfernt.
    if (score >= 0.74) {
      // Bei gleich gutem Namenstreffer entscheidet die LÄNGE DER MESSREIHE:
      // „Salzburg" trifft Flughafen und Freisaal gleich gut, gemeint ist die
      // Station mit der längeren Geschichte (Flughafen führt die Reihe seit
      // 1874 fort). Ohne diese Regel entschied die Zeichenzahl des Namens.
      const startYear = st.validFrom ? Number(st.validFrom.slice(0, 4)) : 2100
      out.push({
        id: st.id,
        name: st.name,
        score: score - (st.isActive ? 0 : 0.15) - Math.max(0, startYear - 1850) * 0.00006,
      })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Ort zum besten Stationstreffer bestimmen. Entscheidend ist, WIE VIEL vom
 * Stationsnamen die Frage genannt hat: „Wien Hohe Warte" nennt ihn vollständig
 * und meint genau diese Station, „Wien" nennt nur den Ort und meint alle.
 * Gezählt werden deshalb die FÜHRENDEN Namenswörter, die in der Frage
 * vorkommen; der Rest des Namens macht die Frage stationsgenau.
 *
 * Der Vergleich läuft über den Namensanfang plus Leerzeichen, nicht über einen
 * blossen Präfix: „Wiener Neustadt" und „Wiener Neudorf" sind eigene Orte und
 * dürfen nicht unter „Wien" fallen (`'wiener neustadt'.startsWith('wien ')` ist
 * falsch, `startsWith('wien')` wäre wahr — genau daran hängt es).
 */
export function resolvePlace(
  question: string,
  best: StationMatch,
  stations: AtStation[],
): AskPlace | null {
  const tokens = normalize(question).split(' ').filter(Boolean)
  const rawParts = best.name.split(/\s+/)
  const parts = normalize(best.name).split(' ')
  const inQuestion = (p: string) =>
    tokens.some((t) => (t.length <= 3 || p.length <= 3 ? t === p : similarity(t, p) >= 0.85))
  let covered = 0
  while (covered < parts.length && inQuestion(parts[covered])) covered++
  // Der ganze Name genannt → die Frage meint diese Station.
  if (covered === 0 || covered >= parts.length) return null
  const key = parts.slice(0, covered).join(' ')
  const ids = stations
    .filter((st) => {
      const n = normalize(st.name)
      return n === key || n.startsWith(`${key} `)
    })
    .map((st) => st.id)
  if (ids.length <= 1) return null
  return { key, label: rawParts.slice(0, covered).join(' '), ids }
}

export type AskScope = 'record' | 'normal'

/**
 * Bezugsgebiet der Frage: eine einzelne Station, ein ORT (alle Stationen, die
 * seinen Namen tragen) oder das ganze Land. Der Ort ist der Normalfall einer
 * Frage in Alltagssprache: „höchste Temperatur in Wien" meint Wien, nicht eine
 * bestimmte der zwölf Wiener Stationen — und je nach Station lägen zwischen
 * den Antworten fast 5 K (Kahlenberg 37,4 °C ↔ Stammersdorf 41,0 °C).
 */
export type AskArea = 'station' | 'place' | 'austria'

/** Ein Ort als Stationsmenge: alle Stationen, deren Name mit `key` beginnt. */
export interface AskPlace {
  /** Normalisierter Namensanfang, z. B. `wien`. */
  key: string
  /** Anzeigename in Originalschreibung, z. B. „Wien". */
  label: string
  ids: number[]
}

export interface AskQuery {
  /**
   * `austria` = die Frage gilt dem ganzen Land. Sie wird gesetzt, wenn die
   * Frage Österreich NENNT — und auch dann, wenn sie GAR KEINEN Ort nennt:
   * „höchste je gemessene temperatur" ohne Ortsangabe ist eine Frage ans Land,
   * nicht eine Frage ohne Antwort. `station` bleibt dabei besetzt, falls doch
   * einer erkannt wurde, damit das Umschalten in der UI einen Klick kostet.
   */
  area: AskArea
  /** Gesetzt, sobald der Ortsname mehr als eine Station trägt. */
  place: AskPlace | null
  station: StationMatch | null
  /** Weitere plausible Stationen — „Salzburg" heißen acht. */
  alternatives: StationMatch[]
  param: string
  /**
   * TAGESebene: „höchste Regensumme an einem TAG", „höchster
   * Tagesniederschlag". Das ist eine andere EBENE, nicht eine andere Größe —
   * und sie fehlte: die Rekord-Assets stammen aus dem Monatsdatensatz, `abs`
   * ist dort der beste MONAT. „Höchster Tagesniederschlag in Salzburg"
   * antwortete deshalb mit 404 mm (nassester Juli 1954) statt mit dem
   * nassesten TAG. Beantwortet wird sie aus `ParamRecords.day`, dem
   * Tagespass des Rekord-Ingests.
   *
   * Schließt `annual` aus (ein Tag ist kein Jahr), verträgt sich aber mit
   * Monat und Saison: „nassester Tag im Juli" ist eine Tagesfrage mit
   * Monatsausschnitt und landet auf `day.mon[6]`.
   */
  daily?: true
  /**
   * Die Frage gilt einer NACHT („kälteste Nacht", „Tropennacht"). Die GRÖSSE
   * ist dieselbe wie sonst (`tlmin`, das Minimum des Klimatags) — dieses Feld
   * ändert nur, wie geantwortet wird: eine Nacht spannt ZWEI Daten, und das
   * Zeitfenster gehört benannt (siehe `nightNote` und `formatNightSpan`).
   */
  nightly?: true
  month: number | null
  season: Season | null
  /**
   * JAHRESwert statt Monatswert — nur gültig, wenn weder `month` noch `season`
   * gesetzt ist. Ohne diese Unterscheidung beantwortete „höchster
   * Jahresniederschlag" den nassesten MONAT (404 mm, Juli 1954) statt der
   * nassesten Jahressumme: die Rekord-Assets kannten überhaupt keine
   * Jahresebene. Bei Maximum-/Minimum-Größen ist beides derselbe Wert.
   */
  annual: boolean
  extreme: 'max' | 'min'
  scope: AskScope
  /** Jahreszahl in der Frage — dafür gibt es (noch) keine Antwort aus den Assets. */
  year: number | null
}

/** Frage in eine Abfrage übersetzen. Nie `null`: unklare Teile bekommen Vorgaben. */
export function parseQuestion(question: string, stations: AtStation[]): AskQuery {
  const tokens = normalize(question).split(' ').filter(Boolean)
  // Für Monat/Jahreszeit/Parameter ohne Funktionswörter arbeiten; Superlative
  // und Zeit-Marker prüfen weiter auf der vollen Liste (dort stehen sie).
  const content = tokens.filter((t) => !STOPWORDS.has(t))

  const matches = matchStations(question, stations)
  const month = content.map((t) => lookupWord(t, MONTHS)).find((v) => v != null) ?? null
  const season = content.map((t) => lookupWord(t, SEASONS)).find((v) => v != null) ?? null

  let param = 'tlmax'
  let dir: 'max' | 'min' | null = null
  let generic = false
  let nightly = false
  /** Stand überhaupt ein Größenwort in der Frage? Sonst gilt oben die Vorgabe. */
  let paramFound = false
  outer: for (const t of content) {
    for (const entry of PARAM_WORDS) {
      for (const w of entry.words) {
        // Deutsche KOMPOSITA: „jahresniederschlag" ist das normale Wort für
        // die Frage und liegt vom Eintrag „niederschlag" sechs Zeichen
        // entfernt — unscharfer Vergleich (0,67) erreicht das nie. Ein
        // enthaltenes Wort zählt deshalb als Treffer, aber erst ab sechs
        // Zeichen: kürzere Fragmente stecken zufällig in vielen Wörtern.
        const compound = w.length >= 6 && t.length > w.length && t.includes(w)
        // Zusätzlich der abgetrennte Stamm: „regensumme" → „regen".
        const stem = measureStem(t)
        const stemHit = stem != null && (stem.length <= 3 ? stem === w : similarity(stem, w) >= 0.84)
        if (compound || stemHit || (t.length <= 3 ? t === w : similarity(t, w) >= 0.84)) {
          param = entry.code
          dir = entry.dir ?? null
          generic = entry.generic ?? false
          nightly = entry.night ?? false
          paramFound = true
          break outer
        }
      }
    }
  }

  const wantsMax = hasAny(tokens, SUPER_MAX)
  const wantsMin = hasAny(tokens, SUPER_MIN)
  // Ein Superlativ macht aus dem generischen „Temperatur" erst die Größe.
  if (generic && (wantsMax || wantsMin)) {
    const up = GENERIC_UPGRADE[param]
    if (up) param = wantsMin ? up.min : up.max
  }
  // Richtung: erst was im Parameterwort steckt, dann das Superlativ.
  let extreme: 'max' | 'min' = dir ?? 'max'
  if (wantsMin) extreme = 'min'
  else if (wantsMax) extreme = 'max'
  else if (dir) extreme = dir

  const yearTok = tokens.find((t) => /^(19|20)\d\d$/.test(t))
  const year = yearTok ? Number(yearTok) : null
  const scope: AskScope = hasAny(tokens, NORMAL_WORDS) && !hasAny(tokens, ALLTIME) ? 'normal' : 'record'
  // „in österreich" schlägt jeden Stationstreffer; ohne erkannten Ort ist die
  // Frage ebenfalls eine Landesfrage.
  const best = matches[0] ?? null
  const place = best ? resolvePlace(question, best, stations) : null
  const area: AskArea =
    hasAny(content, AUSTRIA_WORDS) || matches.length === 0
      ? 'austria'
      : place
        ? 'place'
        : 'station'
  // Jahreswert nur, wenn kein engerer Zeitraum genannt ist: „nassester Juli"
  // bleibt eine Monatsfrage, auch wenn irgendwo „Jahr" fällt.
  /**
   * TAGESebene. Auf der VOLLEN Tokenliste geprüft, weil „tag" ein
   * Funktionswort ist und in den Stoppwörtern steht — dieselbe Ausnahme wie
   * beim Jahresbezug. Eine Jahreszahl danach macht daraus keinen Zeitpunkt
   * (anders als bei „im Jahr 1954"), „an einem Tag" ist immer die Ebene.
   */
  const dailyMentioned =
    tokens.some((t) => DAILY_WORDS.includes(t) || t.startsWith(DAILY_PREFIX)) ||
    content.some((t) => {
      const stem = measureStem(t)
      return stem != null && stem.startsWith(DAILY_PREFIX)
    })
  /**
   * Bei EXTREMgrößen ist die Tagesebene gegenstandslos: der Monatswert von
   * `tlmax`/`tlmin` IST schon ein Tagesextrem (höchstes Tagesmaximum des
   * Monats), `abs` also bereits die Antwort auf „heißester Tag". Ohne diese
   * Ausnahme las sich „was war das TAGESMAXIMUM im Juli seit Messbeginn" als
   * Tagesfrage und griff in den Tagesblock, wo für `tlmax` nur die
   * GEGENrichtung liegt — die Antwort wäre der kälteste Tag gewesen.
   *
   * Gebraucht wird die Ebene nur, wo der Monatswert eine SUMME oder ein
   * MITTEL ist: dort steckt der einzelne Tag gar nicht drin.
   */
  const dailyLevelApplies = (() => {
    const agg = getAtParameter(param).agg
    return agg !== 'max' && agg !== 'min'
  })()
  const daily = dailyMentioned && dailyLevelApplies

  const annual =
    !daily &&
    month == null &&
    season == null &&
    (content.some((t) => t.startsWith(ANNUAL_PREFIX)) ||
      hasAny(content, ANNUAL_WORDS) ||
      mentionsYearPeriod(tokens))

  // „Wärmstes Jahr", „kältester Winter", „wärmster Juli" — nennt die Frage
  // KEINE Größe, sondern nur einen Superlativ über einen ganzen Zeitraum, dann
  // ist das MITTEL gemeint, nicht der Extremwert eines einzelnen Tages. Das
  // wärmste Jahr Österreichs ist 2024 mit 14,3 °C Jahresmittel — nicht 2013,
  // weil damals an einem Augusttag 40,5 °C gemessen wurden. Nennt die Frage
  // dagegen ausdrücklich eine Größe („höchste TEMPERATUR im Juli",
  // „Tagesmaximum"), bleibt es dabei: dann ist der Extremwert gefragt.
  const periodGiven = annual || season != null || month != null
  if (!paramFound && periodGiven && (param === 'tlmax' || param === 'tlmin')) param = 'tl_mittel'

  return {
    area,
    place,
    station: best,
    alternatives: matches.slice(1),
    param,
    // Nur setzen, wenn es zutrifft — das Feld ist optional, damit bestehende
    // Vergleiche auf das Query-Objekt unverändert gelten.
    ...(daily ? { daily: true as const } : {}),
    ...(nightly ? { nightly: true as const } : {}),
    month,
    season,
    annual,
    extreme,
    scope,
    year,
  }
}

export interface AskAnswer {
  value: number
  unit: string
  /** „Juli 2015" bzw. „2015" — wann der Wert aufgetreten ist. */
  when: string | null
  /**
   * Jahr des Werts, maschinenlesbar — damit „In der Karte zeigen" auf den
   * REKORDZEITRAUM springt und nicht auf das laufende Jahr. Bei Normalen
   * leer: ein langjähriges Mittel hat kein Jahr.
   */
  year?: number
  /**
   * Exaktes Datum (`YYYY-MM-DD`), wenn der Rekord aus dem Tagespass stammt.
   * Dann ist `when` schon tagesgenau und die UI muss nichts nachladen.
   */
  day?: string
  /** Was der Wert IST, im Klartext. */
  what: string
  /** Monat des absoluten Rekords (die Frage nannte keinen). */
  recordMonth?: number
  /**
   * WO der Wert gemessen wurde. Nur bei Österreich-Fragen gefüllt: dort ist
   * die Station Teil der ANTWORT („41,2 °C — Bad Deutsch-Altenburg"), während
   * sie bei einer Stationsfrage schon in der Frage steht.
   */
  where?: string
  /** Stations-ID dazu — „In der Karte zeigen" springt genau dorthin. */
  whereId?: number
  /**
   * Einordnung, die zur Zahl gehört. Trägt bei österreichweiten Normalen die
   * Spanne über die Stationen samt dem Hinweis, dass ein Flächenmittel daraus
   * nicht folgt.
   */
  note?: string
}

const MONTH_NAMES = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const SEASON_NAMES: Record<Season, string> = {
  DJF: 'Winter', MAM: 'Frühling', JJA: 'Sommer', SON: 'Herbst',
}

function extremeOf(rec: ParamRecords, q: AskQuery): Extreme | null {
  const slot =
    q.month != null
      ? rec.mon?.[q.month - 1]
      : q.season != null
        ? rec.sea?.[q.season]
        : q.annual
          ? rec.ann
          : rec.abs
  if (!slot) return null
  return slot[q.extreme] ?? null
}

/** Zeitraum-Text der Antwort — er muss die Ebene benennen, sonst liest sich ein
 *  Jahresrekord wie ein Monatsrekord. */
function periodText(q: AskQuery): string {
  // Die EBENE gehört in den Text: „einzelner Tag" und „einzelner Monat" sind
  // beim Niederschlag zwei Antworten, die um eine Größenordnung auseinander
  // liegen (nassester Tag ~110 mm, nassester Monat 404 mm in Salzburg).
  if (q.month != null) return q.daily ? `einzelner Tag im ${MONTH_NAMES[q.month - 1]}` : MONTH_NAMES[q.month - 1]
  if (q.season != null) return q.daily ? `einzelner Tag im ${SEASON_NAMES[q.season]}` : SEASON_NAMES[q.season]
  if (q.daily) return 'einzelner Tag, aller Zeiten'
  return q.annual ? 'ganzes Jahr' : 'einzelner Monat, aller Zeiten'
}

/**
 * Rekorde MEHRERER Stationen zu einem Ortsrekord verschmelzen: je Ebene und
 * Richtung gewinnt der beste Wert, und die Station, die ihn hält, wandert als
 * `s`/`n` mit — dieselbe Form, die die österreichweiten Rekorde schon haben,
 * damit `answerFromRecords` unverändert weiterläuft und das WO zur Antwort
 * gehört. Genau darum geht es: „höchste Temperatur in Wien" ist keine Frage an
 * die Hohe Warte, sondern an Wien.
 */
export function mergeRecords(
  entries: { id: number; name: string; rec: ParamRecords | undefined }[],
): ParamRecords | null {
  const have = entries.filter((e) => e.rec != null) as { id: number; name: string; rec: ParamRecords }[]
  if (have.length === 0) return null

  const pick = (get: (r: ParamRecords) => MaxMin | undefined, kind: 'max' | 'min'): Extreme => {
    let bestE: Extreme | null = null
    for (const e of have) {
      const x = get(e.rec)?.[kind]
      if (!x || x.v == null || !Number.isFinite(x.v)) continue
      if (!bestE || (kind === 'max' ? x.v > bestE.v : x.v < bestE.v)) {
        bestE = { ...x, s: e.id, n: e.name }
      }
    }
    // Leere Ebene: ein Extremwert ohne Wert ist für `answerFromRecords` dasselbe
    // wie „gibt es nicht" (es prüft `e.v == null`).
    return bestE ?? ({ v: null } as unknown as Extreme)
  }
  const both = (get: (r: ParamRecords) => MaxMin | undefined): MaxMin => ({
    max: pick(get, 'max'),
    min: pick(get, 'min'),
  })

  const level = (get: (r: ParamRecords) => ParamRecords | undefined): ParamRecords => ({
    abs: both((r) => get(r)?.abs),
    ann: both((r) => get(r)?.ann),
    mon: Array.from({ length: 12 }, (_, m) => both((r) => get(r)?.mon?.[m])),
    sea: Object.fromEntries(
      (['DJF', 'MAM', 'JJA', 'SON'] as Season[]).map((sid) => [sid, both((r) => get(r)?.sea?.[sid])]),
    ) as Record<Season, MaxMin>,
  })

  return {
    ...level((r) => r),
    // Der TAGESblock muss mit verschmelzen, sonst hätte eine ORTSfrage
    // („wärmste Nacht in Salzburg" = acht Stationen) ihn nicht — und die
    // Antwort fiele auf die Erklärung zurück, obwohl die Daten je Station da
    // sind. Nur anlegen, wenn mindestens eine Station ihn führt: ein leerer
    // Block sähe für `answerFromRecords` wie „vorhanden, aber ohne Wert" aus.
    ...(have.some((e) => e.rec.day) ? { day: level((r) => r.day) } : {}),
  }
}

/**
 * Ist die gefragte RICHTUNG bei dieser Größe überhaupt ein Tagesextrem?
 *
 * Die Rekord-Assets stammen aus dem MONATSdatensatz, und der führt bei
 * Extremgrößen nur EINE Richtung als echtes Tagesextrem:
 *
 *   `tlmax` (agg 'max')  Monatswert = HÖCHSTES Tagesmaximum
 *   `tlmin` (agg 'min')  Monatswert = TIEFSTES Tagesminimum
 *
 * Das Extremum über die Monate in der GEGENrichtung ist deshalb etwas völlig
 * anderes, als die Frage meint — und das war ein echter Fehler: „wärmste Nacht
 * in Salzburg" antwortete mit 13,4 °C (August 2024). Das ist der höchste
 * Monats-TIEFSTWERT, also der August, dessen kälteste Nacht die wärmste war —
 * nicht die wärmste Nacht. Salzburg hat längst Tropennächte über 20 °C gehabt.
 * Symmetrisch dazu hätte „kältester Tag" −0,4 °C geliefert (Jänner 1940): den
 * Monat, dessen wärmster Tag am kältesten blieb.
 *
 * Diese Werte sind KEIN Datenfehler — die Karte im Zeitbezug „Allzeit" zeigt
 * sie bewusst und benennt sie über `valueCaption` korrekt als
 * Monats-Höchst-/Tiefstwerte. Nur als ANTWORT auf eine Frage nach einem Tag
 * oder einer Nacht sind sie falsch, und dann gibt es hier lieber keine Zahl.
 *
 * Bei Summen, Mitteln und Kenntagen (`rr`, `so_h`, `tl_mittel`, `tage_*`) sind
 * beide Richtungen sinnvoll: der nasseste UND der trockenste Monat sind echte
 * Monatswerte.
 *
 * Der Monatsdatensatz führt das fehlende Gegenstück auch nicht unter anderem
 * Namen — geprüft (2026-09-15, 420 Parameter): es gibt `tlmin`, `tlmax` und
 * die Mittel `tlmin_mittel`/`tlmax_mittel`, aber kein „monatlich höchstes
 * Tagesminimum". Dafür bräuchte es die TAGESreihe.
 */
export function directionDerivable(spec: AtParameterSpec, extreme: 'max' | 'min'): boolean {
  if (spec.agg === 'max') return extreme === 'max'
  if (spec.agg === 'min') return extreme === 'min'
  return true
}

/**
 * Klartext, warum es zu dieser Frage keine Zahl gibt — und was stattdessen im
 * Archiv steht. „Keine Daten" wäre hier die falsche Auskunft: die Daten sind
 * da, sie beantworten nur eine andere Frage.
 */
export function directionNote(
  spec: AtParameterSpec,
  extreme: 'max' | 'min',
  nightly = false,
): string {
  const gefragt = nightly && spec.code === 'tlmin'
    ? extreme === 'max'
      ? 'Die wärmste Nacht'
      : 'Die kälteste Nacht'
    : `Dieser Wert`
  const vorhanden =
    spec.agg === 'min'
      ? 'je Monat nur den TIEFSTEN Tagesminimalwert, nicht den höchsten'
      : 'je Monat nur den HÖCHSTEN Tagesmaximalwert, nicht den tiefsten'
  const falsch =
    spec.agg === 'min'
      ? 'der Monat, dessen kälteste Nacht die wärmste war'
      : 'der Monat, dessen wärmster Tag am kältesten blieb'
  return (
    `${gefragt} lässt sich aus dem Monatsarchiv nicht bestimmen: es führt ${vorhanden}. ` +
    `Das Extremum in der Gegenrichtung wäre ${falsch} — eine andere Aussage, und als Antwort ` +
    `auf diese Frage falsch. Dafür bräuchte es die Tagesreihe der ganzen Messreihe.`
  )
}

/**
 * Zeitraum, in dem der EXAKTE Rekordtag zu suchen ist.
 *
 * Die Rekord-Assets kennen nur Monat und Jahr („Jänner 1940") — bei `tlmax`
 * und `tlmin` IST der Monatswert aber ein Tagesextrem, der genaue Tag steckt
 * also in der Tagesreihe und lässt sich nachschlagen (`resolveExtremeDay`, ein
 * Request, für immer gecacht). Diese Funktion sagt nur, WO gesucht wird; ob
 * überhaupt gesucht werden darf, entscheidet die Whitelist `DAY_RESOLVABLE` —
 * bei Summen und Mitteln gibt es keinen Rekordtag, und `resolveExtremeDay`
 * lehnt solche Codes ohne Request ab.
 *
 * Je enger der Zeitraum, desto billiger und eindeutiger: ein genannter Monat
 * schlägt die Saison, die Saison das ganze Jahr. Beim absoluten Rekord liefert
 * das Asset den Monat mit (`recordMonth`), also wird auch dort nur ein Monat
 * durchsucht und nicht die ganze Reihe.
 *
 * `null`, wenn es keinen Zeitpunkt gibt — ein langjähriges Mittel hat kein
 * Jahr und damit keinen Tag.
 */
export function askDayRange(
  q: AskQuery,
  answer: AskAnswer,
): { start: string; end: string } | null {
  const year = answer.year
  if (year == null || !Number.isFinite(year)) return null
  const month = q.month ?? answer.recordMonth
  if (month != null) return monthOfYearRange(year, month)
  if (q.season) return seasonRange(q.season, year)
  // Jahreswert (oder absoluter Rekord ohne Monatsangabe): das ganze Jahr.
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

/**
 * Rekordantwort aus den Stationsassets. Getrennt vom Parsen, damit beides für
 * sich prüfbar bleibt — und weil hier keine Heuristik mehr steckt, sondern
 * nur noch ein Feldzugriff.
 */
export function answerFromRecords(q: AskQuery, rec: ParamRecords | undefined): AskAnswer | null {
  if (!rec) return null
  const spec: AtParameterSpec = getAtParameter(q.param)
  /**
   * Gegenrichtung einer Extremgröße: der MONATSblock hätte hier einen
   * Monats-Höchst- bzw. -Tiefstwert, und der beantwortet die Frage nicht
   * (siehe `directionDerivable`). Dafür gibt es den `day`-Block aus dem
   * Tagespass des Ingests. Fehlt er (Assets von vor dem Tagespass), gibt es
   * lieber KEINE Zahl als eine, die etwas anderes meint — die UI erklärt das
   * über `directionNote`.
   */
  // Aus dem TAGESblock kommt die Antwort in zwei Fällen: bei der
  // Gegenrichtung einer Extremgröße (dort ist der Monatswert die falsche
  // Aussage) UND bei einer ausdrücklichen Tagesfrage (dort ist der
  // Monatswert die falsche EBENE).
  const fromDay = q.daily === true || !directionDerivable(spec, q.extreme)
  const src = fromDay ? rec.day : rec
  if (!src) return null
  const e = extremeOf(src, q)
  if (!e || e.v == null) return null
  const period = periodText(q)
  const gesucht = superlativeText(q.param, q.extreme, spec.label, q.nightly)
  // `d` steht nur beim absoluten Rekord (YYYY-MM), sonst gibt es das Jahr.
  const year = e.y ?? (e.d ? Number(e.d.slice(0, 4)) : undefined)
  return {
    value: e.v,
    unit: spec.unit,
    when: e.d ? formatRecordWhen(e.d, q.nightly) : e.y != null ? String(e.y) : null,
    // Exaktes Datum, wenn das Asset es führt (Tagespass) — dann braucht die UI
    // die nachträgliche Tagesauflösung über einen Extra-Request nicht mehr.
    ...(e.d && e.d.length >= 10 ? { day: e.d } : {}),
    // `n`/`s` tragen nur die NATIONALEN Rekorde: dort gehört die Station zur
    // Antwort, bei einer Stationsfrage stünde sie doppelt da.
    ...(e.n ? { where: e.n } : {}),
    ...(e.s != null ? { whereId: e.s } : {}),
    what:
      q.area === 'austria'
        ? `${gesucht} in Österreich – ${period}`
        : q.area === 'place' && q.place
          ? `${gesucht} in ${q.place.label} – ${period}`
          : `${gesucht} – ${period}`,
    year: Number.isFinite(year) ? year : undefined,
    // Nachtfrage: WELCHES Zeitfenster geantwortet wird, gehört dazu — und der
    // Vorbehalt gilt nur für die kälteste Nacht (siehe `nightNote`).
    ...(q.nightly && q.param === 'tlmin' ? { note: nightNote(q.extreme) } : {}),
    // Beim ABSOLUTEN Rekord steckt im Datum auch der Monat — den will die
    // Karte kennen, sonst zeigt sie das richtige Jahr im falschen Monat.
    ...(q.month == null && q.season == null && e.d
      ? { recordMonth: Number(e.d.slice(5, 7)) }
      : {}),
  }
}

/** Reihenfolge der Saison-Normale in den Assets (siehe `NormalsEntry.seasonal`). */
const SEASON_ORDER: Season[] = ['DJF', 'MAM', 'JJA', 'SON']

/**
 * Antwort aus den langjährigen Mitteln („wie warm ist es im Juli normalerweise").
 * Wie bei den Rekorden ein reiner Feldzugriff — die Assets liegen ohnehin im
 * Browser, die Frage kostet keinen Request.
 */
export function answerFromNormals(
  q: AskQuery,
  entry: NormalsEntry | undefined,
  periodLabel: string,
): AskAnswer | null {
  if (!entry) return null
  const v =
    q.month != null
      ? entry.monthly?.[q.month - 1]
      : q.season != null
        ? entry.seasonal?.[SEASON_ORDER.indexOf(q.season)]
        : entry.annual
  if (v == null) return null
  const spec: AtParameterSpec = getAtParameter(q.param)
  const period =
    q.month != null ? MONTH_NAMES[q.month - 1] : q.season != null ? SEASON_NAMES[q.season] : 'Jahr'
  return {
    value: v,
    unit: spec.unit,
    when: periodLabel,
    what: `langjähriges Mittel ${spec.label} – ${period}`,
  }
}


/**
 * Langjähriges Mittel über eine STATIONSMENGE (ganz Österreich oder ein Ort) —
 * und als EINE Zahl gibt es das nicht. Ein Flächenmittel ist eine räumliche
 * Größe; die Stationen sind weder gleichmäßig verteilt noch gleich hoch
 * gelegen, ein ungewichteter Mittelwert über 300 Stationen wäre von den
 * Bergstationen dominiert und schlicht falsch. Deshalb wird hier die SPANNE
 * beantwortet: der Extremwert in der gefragten Richtung samt Station, dazu als
 * Notiz das andere Ende und die Zahl der Stationen. Das ist eine Aussage, die
 * die Daten hergeben. Beim Ort ist sie sogar die interessantere: Wien reicht im
 * Jahresmittel vom Kahlenberg bis zur Inneren Stadt.
 */
export function answerFromNormalsRange(
  q: AskQuery,
  normals: NormalsMap | null,
  assetCode: string,
  stationName: (id: number) => string,
  periodLabel: string,
  /** Auf diese Stationen einschränken (Ort); fehlt → ganz Österreich. */
  onlyIds?: number[],
): AskAnswer | null {
  if (!normals) return null
  const allow = onlyIds ? new Set(onlyIds) : null
  const spec: AtParameterSpec = getAtParameter(q.param)
  let hi: { v: number; id: number } | null = null
  let lo: { v: number; id: number } | null = null
  let n = 0
  for (const [key, byCode] of Object.entries(normals)) {
    const entry = byCode[assetCode]
    if (!entry) continue
    const v =
      q.month != null
        ? entry.monthly?.[q.month - 1]
        : q.season != null
          ? entry.seasonal?.[SEASON_ORDER.indexOf(q.season)]
          : entry.annual
    if (v == null || !Number.isFinite(v)) continue
    const id = Number(key)
    if (allow && !allow.has(id)) continue
    n++
    if (!hi || v > hi.v) hi = { v, id }
    if (!lo || v < lo.v) lo = { v, id }
  }
  if (!hi || !lo || n === 0) return null
  const pick = q.extreme === 'max' ? hi : lo
  const other = q.extreme === 'max' ? lo : hi
  const period =
    q.month != null ? MONTH_NAMES[q.month - 1] : q.season != null ? SEASON_NAMES[q.season] : 'Jahr'
  const fmt = (v: number) => v.toFixed(1).replace('.', ',')
  const where = onlyIds && q.place ? q.place.label : 'Österreich'
  return {
    value: pick.v,
    unit: spec.unit,
    when: periodLabel,
    where: stationName(pick.id),
    whereId: pick.id,
    what: `${q.extreme === 'max' ? 'höchstes' : 'tiefstes'} langjähriges Mittel in ${where} – ${period}`,
    note:
      `Spanne über ${n} Stationen mit Normal: bis ${fmt(other.v)} ${spec.unit} ` +
      `(${stationName(other.id)}). Ein Flächenmittel für ${where} lässt sich aus ` +
      `Stationswerten nicht bilden — die Stationen sind weder gleichmäßig verteilt noch ` +
      `gleich hoch gelegen.`,
  }
}

/** `2013-08` → „August 2013". */
export function formatYearMonth(d: string): string {
  const [y, m] = d.split('-').map(Number)
  return Number.isFinite(m) && m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1]} ${y}` : d
}

/**
 * Zeitpunkt eines Rekords als Text — die Assets führen ZWEI Genauigkeiten:
 * `YYYY-MM` aus dem Monatsdatensatz und `YYYY-MM-DD` aus dem Tagespass
 * (`ParamRecords.day`). Unterschieden wird an der LÄNGE, nicht an einem Flag:
 * so kann kein Aufrufer die beiden verwechseln.
 *
 * Bei einer Nachtfrage wird aus dem Tagesdatum eine Spanne über zwei Daten
 * (siehe `formatNightSpan`) — eine Nacht gehört zu zwei Kalendertagen.
 */
export function formatRecordWhen(d: string, nightly = false): string {
  if (d.length < 10) return formatYearMonth(d)
  if (nightly) return formatNightSpan(d)
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${d}T12:00:00Z`))
}
