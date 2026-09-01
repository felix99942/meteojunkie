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
const PARAM_WORDS: { words: string[]; code: string; dir?: 'max' | 'min'; generic?: true }[] = [
  { words: ['tagesmaximum', 'hochsttemperatur', 'maximaltemperatur', 'tmax', 'hitzerekord'], code: 'tlmax', dir: 'max' },
  { words: ['tagesminimum', 'tiefsttemperatur', 'minimaltemperatur', 'tmin', 'kalterekord'], code: 'tlmin', dir: 'min' },
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
        if (compound || (t.length <= 3 ? t === w : similarity(t, w) >= 0.84)) {
          param = entry.code
          dir = entry.dir ?? null
          generic = entry.generic ?? false
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
  const annual =
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
  if (q.month != null) return MONTH_NAMES[q.month - 1]
  if (q.season != null) return SEASON_NAMES[q.season]
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

  return {
    abs: both((r) => r.abs),
    ann: both((r) => r.ann),
    mon: Array.from({ length: 12 }, (_, m) => both((r) => r.mon?.[m])),
    sea: Object.fromEntries(
      (['DJF', 'MAM', 'JJA', 'SON'] as Season[]).map((sid) => [sid, both((r) => r.sea?.[sid])]),
    ) as Record<Season, MaxMin>,
  }
}

/**
 * Rekordantwort aus den Stationsassets. Getrennt vom Parsen, damit beides für
 * sich prüfbar bleibt — und weil hier keine Heuristik mehr steckt, sondern
 * nur noch ein Feldzugriff.
 */
export function answerFromRecords(q: AskQuery, rec: ParamRecords | undefined): AskAnswer | null {
  if (!rec) return null
  const e = extremeOf(rec, q)
  if (!e || e.v == null) return null
  const spec: AtParameterSpec = getAtParameter(q.param)
  const period = periodText(q)
  const richtung = q.extreme === 'max' ? 'höchster' : 'tiefster'
  // `d` steht nur beim absoluten Rekord (YYYY-MM), sonst gibt es das Jahr.
  const year = e.y ?? (e.d ? Number(e.d.slice(0, 4)) : undefined)
  return {
    value: e.v,
    unit: spec.unit,
    when: e.d ? formatYearMonth(e.d) : e.y != null ? String(e.y) : null,
    // `n`/`s` tragen nur die NATIONALEN Rekorde: dort gehört die Station zur
    // Antwort, bei einer Stationsfrage stünde sie doppelt da.
    ...(e.n ? { where: e.n } : {}),
    ...(e.s != null ? { whereId: e.s } : {}),
    what:
      q.area === 'austria'
        ? `${richtung} ${spec.label} in Österreich – ${period}`
        : q.area === 'place' && q.place
          ? `${richtung} ${spec.label} in ${q.place.label} – ${period}`
          : `${richtung} ${spec.label} – ${period}`,
    year: Number.isFinite(year) ? year : undefined,
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
