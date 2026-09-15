// Aktiver Modelllauf (Init-Zeit). Für jetzt IMMER der neueste VERFÜGBARE Lauf —
// Laufauswahl kommt in Phase 3 (SPEC §13); bis dahin nur Anzeige.
//
// Läufe erscheinen im Takt updateIntervalHours, an UTC-Stunden ausgerichtet
// (alle 6 h → 00/06/12/18 UTC): das Epoch liegt auf 00:00 UTC und die Takte
// teilen 24 h, also fallen die Intervallgrenzen auf runde Laufstunden. Ein Lauf
// ist aber erst nach einer Bereitstellungsverzögerung online (Init →
// publiziert) — der 06-UTC-Lauf eines Globalmodells liegt typisch erst am
// späten Vormittag vor. „Neuester verfügbarer Lauf“ = jüngster Lauf-Zyklus,
// dessen Init-Zeit + Verzögerung bereits vergangen ist.
//
// WICHTIG: Wir fetchen NICHT gezielt einen Lauf (die Forecast-API liefert den
// jeweils neuesten Seamless-Lauf automatisch) — die angezeigte Laufstunde ist
// also eine SCHÄTZUNG. Die Verzögerungen sind Näherungen (wie forecastHours/
// coverage in models.ts) und laut SPEC §6 live zu prüfen. Sie leben hier
// zentral statt in jeder Registry-Zeile, weil sie beim Bau der Laufauswahl
// ohnehin gemeinsam nachgeschärft werden.

/**
 * Alles, was die Laufrechnung braucht — absichtlich KEIN `ModelInfo`: die
 * Ensemble-Registry (`config/ensemble.ts`) führt eigene Modelle mit demselben
 * Takt, und die sollen ihren Lauf genauso ausweisen können.
 */
export interface RunnableModel {
  id: string
  updateIntervalHours: number
}

const HOUR_MS = 3_600_000

/** Typische Verzögerung Init → verfügbar in Stunden; Fallback DEFAULT_LAG_H. */
const AVAILABILITY_LAG_H: Record<string, number> = {
  best_match: 1,
  icon_seamless: 3,
  icon_d2: 3,
  icon_eu: 4,
  icon_global: 5,
  ecmwf_ifs025: 7,
  // AIFS teilt Takt und Bereitstellung mit dem IFS (gleicher Betreiber,
  // gleiche 0,25°-Ausgabe) — bis die Laufauswahl kommt, derselbe Wert.
  ecmwf_aifs025_single: 7,
  gfs_seamless: 4,
  gfs_global: 4,
  meteofrance_arpege_europe: 4,
  meteofrance_arome_france: 3,
  geosphere_arome_austria: 3,
  // Live beobachtet (2026-09-14, 21 UTC): CH1 lieferte den 18-UTC-Lauf, CH2
  // noch den 12-UTC-Lauf — CH2 also mehr als 3 h, der Wert ist geschätzt.
  meteoswiss_icon_ch1: 3,
  meteoswiss_icon_ch2: 5,
  // Live gemessen (2026-07-31, 18:30 UTC): geliefert wurde noch der 00-UTC-Lauf,
  // der 06-UTC-Lauf war nach 12,5 h also nicht online. Mit 7 h Verzögerung hätte
  // die Horizontrechnung 5 h Vorhersage behauptet, die es nicht gab.
  ukmo_global_deterministic_10km: 13,
  ukmo_uk_deterministic_2km: 5,
}
const DEFAULT_LAG_H = 4

export interface ModelRun {
  /** Init-Zeit des Laufs, Epoch-ms UTC. */
  initTime: number
  /** Init-Stunde in UTC (0…23). */
  initHourUtc: number
}

/** Neuester zum Zeitpunkt `now` (Epoch-ms) voraussichtlich verfügbarer Lauf. */
export function latestRun(model: RunnableModel, now: number): ModelRun {
  const intervalMs = model.updateIntervalHours * HOUR_MS
  const lagMs = (AVAILABILITY_LAG_H[model.id] ?? DEFAULT_LAG_H) * HOUR_MS
  const initTime = Math.floor((now - lagMs) / intervalMs) * intervalMs
  return { initTime, initHourUtc: new Date(initTime).getUTCHours() }
}

/** Kompakte Laufstunde: "06 UTC", "00 UTC". */
export function formatRun(run: ModelRun): string {
  return `${String(run.initHourUtc).padStart(2, '0')} UTC`
}

/**
 * Laufstunde MIT Tagesbezug: „heute 06 UTC", „gestern 18 UTC", sonst
 * „13.09. 12 UTC".
 *
 * Die kompakte Form (`formatRun`) ist in einer Legende richtig, als einzige
 * Angabe in einer Werkzeugleiste aber zweideutig: um 01 UTC ist „18 UTC" der
 * Lauf von GESTERN, und genau dann ist die Frage „wie alt ist das" akut. Der
 * Tagesbezug wird gegen `now` gerechnet, beide in UTC — die Zeitachse der
 * Seite läuft ohnehin in UTC.
 */
export function formatRunLong(run: ModelRun, now: number): string {
  const hour = `${String(run.initHourUtc).padStart(2, '0')} UTC`
  const dayMs = 86_400_000
  const dayOf = (t: number) => Math.floor(t / dayMs)
  const diff = dayOf(now) - dayOf(run.initTime)
  if (diff === 0) return `heute ${hour}`
  if (diff === 1) return `gestern ${hour}`
  const d = new Date(run.initTime)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}. ${hour}`
}

/**
 * Erklärung für den Tooltip jeder Laufanzeige — EINE Stelle, weil die
 * Einschränkung überall dieselbe ist und wichtig: die API liefert von sich aus
 * den neuesten Seamless-Lauf und nennt seine Init-Zeit NICHT (ein `run=`- bzw.
 * `model_run=`-Parameter wird abgelehnt oder still ignoriert, siehe SPEC §6).
 * Die Stunde hier ist also aus Takt und typischer Bereitstellungsverzögerung
 * GESCHÄTZT, nicht gemeldet.
 */
export const RUN_TITLE =
  'Immer der neueste verfügbare Lauf. Die Init-Zeit meldet die API nicht — ' +
  'sie ist aus Lauftakt und typischer Bereitstellungsverzögerung geschätzt.'
