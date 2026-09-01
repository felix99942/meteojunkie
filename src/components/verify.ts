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
 * Welche Vorlaufzeiten ein Modell überhaupt tragen kann.
 *
 * WELCHER LAUF steckt hinter `previous_dayN`? Live ermittelt (2026-09-01),
 * weil es die Auswertung bestimmt: es ist der Lauf von **00 UTC des Tages
 * N Tage vor dem Zieltag** — der Vorlauf wächst also über den Zieltag hinweg
 * von 24·N Stunden (00 UTC) auf 24·N + 23 (23 UTC). Es ist NICHT der
 * jeweils frischeste Lauf vor dem Zieltag.
 *
 * Der Beweis steckt in den Horizonten: bei KONSTANTEM Vorlauf 48 h müsste
 * AROME Austria (60 h) `previous_day2` liefern — die Spalte ist aber
 * vollständig leer. Mit 24·N + Tagesstunde bräuchte sie bis zu 71 h, und
 * dieselbe Rechnung trifft alle gemessenen Fälle exakt: ICON-D2 (48 h) nur
 * N=1 (braucht 47 h), ICON-EU (120 h) bis N=4 (119 h, N=5 bräuchte 143),
 * IFS (360 h) alle sieben. Eine Reihe wird offenbar nur ausgeliefert, wenn
 * der GANZE Zieltag abgedeckt ist — Teilspalten gibt es nicht.
 *
 * Daraus folgt die Bedingung: `forecastHours ≥ n·24 + 24`.
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
