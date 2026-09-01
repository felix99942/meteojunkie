// Rechenkern der Verifikation: stündliche Vorhersagereihen auf Tageswerte
// reduzieren und gegen die MESSUNG stellen.
//
// Getrennt von der Komponente und mit Tests, wie atRank/atHistory/climateAsk —
// hier steckt die ganze inhaltliche Substanz des Bereichs, und ein
// Fehlerbetrag, der still um einen Tag verschoben ist, sieht auf einer Karte
// genauso plausibel aus wie ein richtiger.
//
// Der Tagesbegriff ist 00–24 UTC, und das ist kein Zufall: die GeoSphere-
// Klimatage laufen ebenso (siehe api/atValues.ts), Open-Meteo wird überall im
// Projekt mit `timezone: 'UTC'` abgefragt. Damit vergleicht man denselben
// Zeitraum — mit Ortszeit auf der einen und UTC auf der anderen Seite wäre der
// „Fehler" teilweise nur eine Verschiebung.

/** Wie aus 24 Stundenwerten ein Tageswert wird. */
export type DailyMode = 'max' | 'min'

/** YYYY-MM-DD (UTC) eines Zeitstempels. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Stündliche Reihe → Tageswerte. Ein Tag zählt nur, wenn er `minHours` Werte
 * trägt: ein aus vier Stunden gebildetes „Tagesmaximum" ist keines, und am
 * Rand des abgefragten Zeitraums stehen solche Bruchstücke regelmäßig.
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
    const d = utcDay(timeMs[i])
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
