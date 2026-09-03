// Rechenkern der Verifikation: stündliche Vorhersagereihen auf Tageswerte
// reduzieren und gegen die MESSUNG stellen.
//
// Getrennt von der Komponente und mit Tests, wie atRank/atHistory/climateAsk —
// hier steckt die ganze inhaltliche Substanz des Bereichs, und ein
// Fehlerbetrag, der still um einen Tag verschoben ist, sieht auf einer Karte
// genauso plausibel aus wie ein richtiger.
//
// DER TAGESBEGRIFF IST 18–18 UTC, NICHT 00–24. Der Klimatag von GeoSphere
// (klima-v2-1d) läuft von 19 MEZ des Vortags bis 19 MEZ, also 18:00 UTC (D−1)
// bis 18:00 UTC (D) — das ist die deutsch-österreichische Konvention für
// Tagesextreme, und sie ist nirgends in der API dokumentiert. Gemessen
// (2026-09-03, 5 Stationen × 60 Tage = 298 Stationstage, tlmax/tlmin aus
// klima-v2-1d gegen die selbst gebildeten Extreme der 10-Minuten-Reihe):
//
//   Fenster    mittlerer |Fehler| tlmax   größter    tlmin   größter
//   00–24 UTC  0,35 K                     7,3 K      0,36 K  4,5 K
//   18–18 UTC  0,18 K                     0,9 K      0,06 K  0,6 K
//
// Der Rest von 0,18 K ist die 10-Minuten-Abtastung gegen ein stetiges
// Extremum, also kein Fenstereffekt mehr. Jedes andere Fenster ist deutlich
// schlechter, das Optimum ist scharf.
//
// DAS FENSTER STEHT FEST IN MEZ, es folgt NICHT der Sommerzeit — sonst läge es
// von Ende März bis Ende Oktober bei 17 UTC. Gegengeprüft an Jänner/Februar
// 2026 (3 Stationen, 150 Stationstage, also echte MEZ): dort ist ebenfalls
// 18 UTC das Optimum (tlmax 0,08 gegen 0,37 K bei 00–24 UTC). Der Versatz ist
// deshalb eine Konstante und keine Zeitzonenrechnung.
//
// WARUM DAS WICHTIG IST: an den meisten Tagen fallen beide Fenster zusammen —
// das Maximum liegt gegen 13–15 UTC und damit in beiden. Sie laufen genau dann
// auseinander, wenn nach einem heißen Tag eine Front durchgeht: der Abend des
// Vortags (18–24 UTC) ist dann wärmer als der ganze Folgetag und setzt dessen
// Klima-Tagesmaximum. Mit 00–24 UTC auf der Vorhersageseite steht dort ein
// „Fehler", den kein Modell gemacht hat — und zwar bei ALLEN Modellen
// gleichzeitig und immer im selben Vorzeichen. Beispiel Wien Hohe Warte,
// 29.08.2026: Klima-Tagesmaximum 29,5 °C (aus dem Abend des 28.),
// 00–24-UTC-Maximum 26,2 °C; die Abweichungen aller fünf Modelle sprangen
// dadurch von −0,1…+1,8 K auf −1,4…−2,6 K.
//
// DER NIEDERSCHLAGSTAG IST EIN ANDERER: 06–06 UTC, und er läuft VORWÄRTS.
// Nicht dieselbe Konstante mit anderem Vorzeichen zu erwarten war der zweite
// Fallstrick — GeoSphere führt `rr` als 24-Stunden-Summe zum Termin 06 UTC,
// der Tag D umfasst also [D 06:00 UTC, D+1 06:00 UTC): der Regen des frühen
// Morgens von D+1 zählt noch zu D (Ablesung 07 MEZ, der Vortag bekommt sie).
// Ebenso gemessen (2026-09-03, 5 Stationen × 60 Tage, `rr` aus klima-v2-1d
// gegen die Summen der 10-Minuten-Reihe, nur Tage mit Niederschlag, n = 126):
//
//   Fenster            Ø|Fehler|   größter
//   06–06 UTC vorwärts   0,03 mm    1,10 mm
//   00–24 UTC            1,14 mm   16,00 mm
//   18–18 UTC rückwärts  3,66 mm   26,60 mm
//
// An trockenen Tagen bleibt eine Differenz von ~0,9 mm stehen, die KEIN
// Fenstereffekt ist: die 10-Minuten-Reihe zählt dort Tau- und Störimpulse mit,
// die der qualitätsgeprüfte Tageswert auf 0 setzt. Deshalb ist oben nur über
// nasse Tage gemessen.
//
// Auf der Vorhersageseite wird deshalb DASSELBE Fenster gebildet (siehe
// `windowDay`), Open-Meteo wird ohnehin überall mit `timezone: 'UTC'`
// abgefragt. Ein Fenster gegen das andere zu stellen hieße, eine
// Definitionsdifferenz als Modellfehler auszuweisen. Die 06-UTC-Grenze fällt
// dabei auf ein Vielfaches von 3 h — die 3-Stunden-Blöcke, die Open-Meteo bei
// IFS/AIFS gleichmäßig auf drei Stunden verteilt (siehe CLAUDE.md), werden
// also nicht angeschnitten.

/** Wie aus 24 Stundenwerten ein Tageswert wird. */
export type DailyMode = 'max' | 'min' | 'sum'

/** YYYY-MM-DD (UTC) eines Zeitstempels. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Versatz des EXTREM-Tages (tlmax/tlmin): +6 h, das Fenster liegt also
 * [D−1 18:00 UTC, D 18:00 UTC) — 19–19 MEZ. Gemessen, siehe Kopf der Datei.
 */
export const EXTREME_DAY_OFFSET_H = 6

/**
 * Versatz des NIEDERSCHLAGS-Tages (rr): −6 h, Fenster [D 06:00 UTC,
 * D+1 06:00 UTC) — 07–07 MEZ, und damit in die andere Richtung als beim
 * Extremtag. Ebenfalls gemessen; die Vorzeichen NICHT angleichen.
 */
export const PRECIP_DAY_OFFSET_H = -6

/**
 * Zu welchem Messtag ein Zeitstempel gehört. Die Grenze ist halboffen: der
 * Zeitpunkt, der das Fenster schließt, zählt schon zum FOLGENDEN Tag — so
 * gemessen (beim Extremtag traf das halboffene Fenster die Referenzwerte
 * besser als das geschlossene, 0,18 gegen 0,21 K Restfehler).
 */
export function windowDay(ms: number, offsetH: number): string {
  return utcDay(ms + offsetH * 3600_000)
}

/** Kurzform für den Extremtag (18–18 UTC). */
export function climateDay(ms: number): string {
  return windowDay(ms, EXTREME_DAY_OFFSET_H)
}

/** Kurzform für den Niederschlagstag (06–06 UTC). */
export function precipDay(ms: number): string {
  return windowDay(ms, PRECIP_DAY_OFFSET_H)
}

/**
 * Stündliche Reihe → Tageswerte über das Fenster `offsetH`, damit beide Seiten
 * des Vergleichs denselben Zeitraum meinen. Ein Tag zählt nur, wenn er
 * `minHours` Werte trägt: ein aus vier Stunden gebildetes „Tagesmaximum" ist
 * keines, und bei einer SUMME wäre ein angeschnittener Tag noch heimtückischer
 * — er sähe einfach nach weniger Regen aus. Am Rand des abgefragten Zeitraums
 * stehen solche Bruchstücke regelmäßig; die Abfrage muss deshalb je nach
 * Fenster einen Tag früher beginnen oder einen Tag später enden (siehe
 * `VerifyPanel`).
 */
export function dailyValues(
  timeMs: number[],
  values: (number | null)[],
  mode: DailyMode,
  offsetH: number,
  minHours = 20,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < timeMs.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    const d = windowDay(timeMs[i], offsetH)
    const b = buckets.get(d)
    if (b) b.push(v)
    else buckets.set(d, [v])
  }
  const out = new Map<string, number>()
  for (const [day, vals] of buckets) {
    if (vals.length < minHours) continue
    out.set(
      day,
      mode === 'max'
        ? Math.max(...vals)
        : mode === 'min'
          ? Math.min(...vals)
          : vals.reduce((a, b) => a + b, 0),
    )
  }
  return out
}

/** Fehlermaße einer Vorhersage gegen die Messung. */
export interface Scores {
  /** Zahl der Tage, die in BEIDEN Reihen einen Wert haben. */
  n: number
  /** Mittlerer Fehler (Vorhersage − Messung): das Vorzeichen ist die Aussage. */
  bias: number
  /** Mittlerer absoluter Fehler — die Größe des typischen Fehlgriffs. */
  mae: number
  /** Wurzel des mittleren quadratischen Fehlers; gewichtet Ausreißer stärker. */
  rmse: number
  /** Größter Einzelfehler samt Tag — die Frage „wann lag es richtig daneben". */
  worst: { day: string; error: number } | null
}

/**
 * Vorhersage gegen Messung. Verglichen werden NUR Tage, die beide Reihen
 * führen — sonst mittelt man über einen anderen Zeitraum als die Nachbarspalte
 * und die Modelle wären nicht mehr vergleichbar.
 */
export function score(
  forecast: Map<string, number>,
  observed: Map<string, number>,
): Scores {
  let n = 0
  let sum = 0
  let sumAbs = 0
  let sumSq = 0
  let worst: { day: string; error: number } | null = null
  for (const [day, obs] of observed) {
    const fc = forecast.get(day)
    if (fc == null) continue
    const e = fc - obs
    n++
    sum += e
    sumAbs += Math.abs(e)
    sumSq += e * e
    if (!worst || Math.abs(e) > Math.abs(worst.error)) worst = { day, error: e }
  }
  if (n === 0) return { n: 0, bias: Number.NaN, mae: Number.NaN, rmse: Number.NaN, worst: null }
  return { n, bias: sum / n, mae: sumAbs / n, rmse: Math.sqrt(sumSq / n), worst }
}

/**
 * VERGLEICHSVORHERSAGE „Persistenz": der Wert von gestern gilt für heute.
 *
 * Ein Fehlermaß allein beantwortet die Frage nicht, die man eigentlich hat.
 * „MAE 1,5 K" ist in einer stabilen Hochdrucklage eine schwache Leistung und
 * in einer Woche mit drei Frontdurchgängen eine gute — die Zahl sagt nicht,
 * WIE SCHWER die Aufgabe war. Ein Skill Score misst deshalb gegen eine
 * triviale Referenz, und Persistenz ist die ehrlichste verfügbare: sie kostet
 * keine zusätzlichen Daten (die Messreihe liegt ohnehin vor) und ist an jeder
 * Station definiert, anders als eine Klimatologie, die es nur für die ~200
 * Stationen mit vollem Normal gäbe.
 *
 * GRENZE, und sie gehört in die Beschriftung: Persistenz ist nur bei KURZEM
 * Vorlauf ein ernsthafter Gegner. Bei +7 Tagen schlägt sie jedes Modell mühelos
 * — ein hoher Wert heißt dort „besser als Raten", nicht „gut".
 */
export function persistenceForecast(observed: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [day, v] of observed) {
    const next = utcDay(Date.parse(`${day}T00:00:00Z`) + 86400_000)
    out.set(next, v)
  }
  return out
}

/** Skill Score gegen eine Referenzvorhersage, plus die Zahl der Tage. */
export interface Skill {
  /** 1 − MSE(Vorhersage)/MSE(Referenz): 1 = perfekt, 0 = wie die Referenz, < 0 = schlechter. */
  ss: number
  /** Tage, die ALLE DREI Reihen führen — Vorhersage, Messung, Referenz. */
  n: number
}

/**
 * Skill Score über den mittleren quadratischen Fehler:
 * `1 − MSE(Vorhersage) / MSE(Referenz)`.
 *
 * Gewertet werden nur Tage, die Vorhersage, Messung UND Referenz führen —
 * sonst verglichen sich die beiden MSE über verschiedene Zeiträume, und der
 * Quotient wäre bedeutungslos. Das kostet gegenüber der Fehlerzeile einen Tag
 * am Anfang (die Persistenz braucht den Vortag).
 *
 * MSE und nicht MAE, weil der Skill Score über den quadratischen Fehler die
 * übliche Definition ist (Murphy 1988) und Ausreißer dort so gewichtet werden,
 * wie es die Referenz auch abbekommt.
 */
export function skillScore(
  forecast: Map<string, number>,
  observed: Map<string, number>,
  reference: Map<string, number>,
): Skill {
  let n = 0
  let sqFc = 0
  let sqRef = 0
  for (const [day, obs] of observed) {
    const fc = forecast.get(day)
    const ref = reference.get(day)
    if (fc == null || ref == null) continue
    n++
    sqFc += (fc - obs) ** 2
    sqRef += (ref - obs) ** 2
  }
  // Referenz fehlerfrei (kommt bei Niederschlag vor: zwei trockene Tage
  // hintereinander) → der Quotient wäre 0/0. Dann ist der Score nicht
  // definiert, und eine 0 hinzuschreiben wäre eine Aussage, die niemand
  // gemessen hat.
  if (n === 0 || sqRef === 0) return { ss: Number.NaN, n }
  return { ss: 1 - sqFc / sqRef, n }
}

/**
 * Vierfeldertafel für ein Schwellenereignis („mindestens 1 mm Regen").
 *
 * WARUM ES DAS BEIM NIEDERSCHLAG BRAUCHT: der mittlere Fehler in mm ist dort
 * fast wertlos. Gemessen an fünf österreichischen Stationen über 60 Tage sind
 * 174 von 300 Tagen trocken — ein Modell, das NIE Regen vorhersagt, bekommt
 * damit einen glänzenden MAE und hat nichts geleistet. Dazu kommt die doppelte
 * Bestrafung: ein Schauer, der zwölf Stunden zu früh oder zwanzig Kilometer
 * daneben fällt, zählt einmal als verpasst und einmal als Fehlalarm, obwohl
 * das Modell die Lage im Kern getroffen hat. Die Frage, die man an eine
 * Niederschlagsvorhersage wirklich stellt, ist kategorisch: „hat es Regen
 * angesagt, und kam welcher?"
 */
export interface Contingency {
  /** Vorhergesagt UND eingetreten. */
  hits: number
  /** Eingetreten, aber nicht vorhergesagt. */
  misses: number
  /** Vorhergesagt, aber nicht eingetreten. */
  falseAlarms: number
  /** Weder noch — der häufigste Fall, und der aussageloseste. */
  correctNegatives: number
  /** Alle gewerteten Tage. */
  n: number
}

/** Vierfeldertafel für das Ereignis „Wert ≥ `threshold`". */
export function contingency(
  forecast: Map<string, number>,
  observed: Map<string, number>,
  threshold: number,
): Contingency {
  const c: Contingency = { hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0, n: 0 }
  for (const [day, obs] of observed) {
    const fc = forecast.get(day)
    if (fc == null) continue
    c.n++
    const f = fc >= threshold
    const o = obs >= threshold
    if (f && o) c.hits++
    else if (o) c.misses++
    else if (f) c.falseAlarms++
    else c.correctNegatives++
  }
  return c
}

/** Beobachtete Ereignisse — die Zahl, an der die Belastbarkeit hängt. */
export function events(c: Contingency): number {
  return c.hits + c.misses
}

/**
 * Trefferquote (POD): welcher Anteil der eingetretenen Ereignisse war
 * vorhergesagt. 1 ist perfekt — aber allein wertlos, weil „immer Regen"
 * ebenfalls 1 ergibt. Nur zusammen mit dem Fehlalarmanteil zu lesen.
 */
export function pod(c: Contingency): number {
  const e = events(c)
  return e === 0 ? Number.NaN : c.hits / e
}

/**
 * Fehlalarmanteil (FAR): welcher Anteil der ANGESAGTEN Ereignisse ausblieb.
 * 0 ist perfekt. Das Gegengewicht zur Trefferquote.
 */
export function far(c: Contingency): number {
  const p = c.hits + c.falseAlarms
  return p === 0 ? Number.NaN : c.falseAlarms / p
}

/**
 * Häufigkeitsbias: wie oft das Modell das Ereignis ansagt, geteilt durch wie
 * oft es eintritt. > 1 = zu nass, < 1 = zu trocken. Sagt NICHTS über die
 * Trefferlage — ein Modell kann die richtige Zahl Regentage vorhersagen und
 * dabei jeden einzelnen am falschen Tag.
 */
export function frequencyBias(c: Contingency): number {
  const e = events(c)
  return e === 0 ? Number.NaN : (c.hits + c.falseAlarms) / e
}

/**
 * Equitable Threat Score (Gilbert Skill Score) — die übliche Kennzahl für
 * Niederschlagsvorhersagen.
 *
 * Er misst den Anteil richtig getroffener Ereignisse, ZIEHT ABER die Treffer
 * ab, die bei gleicher Ansagehäufigkeit schon durch Zufall zustande kämen.
 * Das ist der Unterschied zum einfachen Threat Score und der Grund, warum er
 * hier steht: in einem trockenen Zeitraum trifft „selten Regen" oft genug
 * zufällig, und ohne diese Korrektur sähe das nach Können aus.
 *
 * 1 = perfekt, 0 = nicht besser als Zufall, negativ = schlechter. Die
 * Untergrenze ist −1/3.
 */
export function ets(c: Contingency): number {
  if (c.n === 0) return Number.NaN
  const e = events(c)
  const predicted = c.hits + c.falseAlarms
  if (e === 0 && predicted === 0) return Number.NaN
  const chance = (e * predicted) / c.n
  const denom = c.hits + c.misses + c.falseAlarms - chance
  return denom === 0 ? Number.NaN : (c.hits - chance) / denom
}

/**
 * Welche Vorlaufzeiten die API für ein Modell anbietet.
 *
 * WAS `previous_dayN` ist: der Stand, den die Vorhersage n·24 Stunden VOR dem
 * jeweiligen Zeitpunkt hatte — ein GLEITENDER Vorlauf, kein fester Lauf.
 * Zweimal live gemessen (2026-09-01): die Reihe springt an der Tagesgrenze
 * nicht (Stundenänderung über 00 UTC 0,69 K gegen 0,92 K sonst, wie bei der
 * durchgehenden Reihe), und der Fehler ist über den Tagesverlauf flach
 * (0,82/0,83/0,81/0,90 K je Sechs-Stunden-Block). Ein fester 00-UTC-Lauf
 * müsste beides zeigen: einen Sprung um Mitternacht und einen über den Tag
 * wachsenden Fehler.
 *
 * WELCHE n es gibt, folgt dagegen empirisch `forecastHours ≥ n·24 + 24` —
 * gemessen und ohne Ausnahme: AROME Austria (60 h) und ICON-D2 (48 h) nur
 * n=1, ICON-EU (120 h) n=1–4, IFS (360 h) und GFS (384 h) n=1–7. Immer
 * vollständig oder gar nicht, nie teilweise. Das ist eine Verfügbarkeitsregel
 * der API und lässt sich aus dem gleitenden Vorlauf allein NICHT herleiten
 * (bei 48 h Vorlauf läge AROME mit 60 h Horizont im Rahmen) — deshalb hier als
 * GEMESSENE Regel geführt, nicht als Herleitung.
 */
export function leadsFor(forecastHours: number, maxLead: number): number[] {
  const out: number[] = []
  for (let n = 1; n <= maxLead; n++) {
    if (forecastHours >= n * 24 + 24) out.push(n)
  }
  return out
}

/** Tagesliste (UTC) von `start` bis `end`, beide einschließlich. */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = Date.parse(`${end}T00:00:00Z`)
  while (d.getTime() <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
