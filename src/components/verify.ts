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
// Auf der Vorhersageseite wird deshalb DASSELBE Fenster gebildet (siehe
// `climateDay`), Open-Meteo wird ohnehin überall mit `timezone: 'UTC'`
// abgefragt. Ein Fenster gegen das andere zu stellen hieße, eine
// Definitionsdifferenz als Modellfehler auszuweisen.

/** Wie aus 24 Stundenwerten ein Tageswert wird. */
export type DailyMode = 'max' | 'min'

/** YYYY-MM-DD (UTC) eines Zeitstempels. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Um wie viele Stunden der Klimatag dem UTC-Tag VORAUSLÄUFT: er beginnt um
 * 18:00 UTC des Vortags (19 MEZ), endet um 18:00 UTC. Siehe Kopf der Datei —
 * die Zahl ist gemessen, nicht angenommen.
 */
export const CLIMATE_DAY_OFFSET_H = 6

/**
 * Zu welchem GeoSphere-Klimatag ein Zeitstempel gehört: [D−1 18:00 UTC,
 * D 18:00 UTC). Die 18:00 selbst zählt zum FOLGENDEN Tag — so gemessen (das
 * halboffene Fenster traf die Referenzwerte besser als das andere, tlmax
 * 0,18 gegen 0,21 K mittlerer Restfehler).
 */
export function climateDay(ms: number): string {
  return utcDay(ms + CLIMATE_DAY_OFFSET_H * 3600_000)
}

/**
 * Stündliche Reihe → Tageswerte, gebildet über den KLIMATAG (18–18 UTC), damit
 * beide Seiten des Vergleichs denselben Zeitraum meinen. Ein Tag zählt nur,
 * wenn er `minHours` Werte trägt: ein aus vier Stunden gebildetes
 * „Tagesmaximum" ist keines, und am Rand des abgefragten Zeitraums stehen
 * solche Bruchstücke regelmäßig — der erste Klimatag braucht deshalb Stunden
 * aus dem VORTAG, die Abfrage muss einen Tag früher beginnen (siehe
 * `VerifyPanel`).
 */
export function dailyExtremes(
  timeMs: number[],
  values: (number | null)[],
  mode: DailyMode,
  minHours = 20,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < timeMs.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    const d = climateDay(timeMs[i])
    const b = buckets.get(d)
    if (b) b.push(v)
    else buckets.set(d, [v])
  }
  const out = new Map<string, number>()
  for (const [day, vals] of buckets) {
    if (vals.length < minHours) continue
    out.set(day, mode === 'max' ? Math.max(...vals) : Math.min(...vals))
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
