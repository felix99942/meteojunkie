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

import type { ModelInfo } from './models'

const HOUR_MS = 3_600_000

/** Typische Verzögerung Init → verfügbar in Stunden; Fallback DEFAULT_LAG_H. */
const AVAILABILITY_LAG_H: Record<string, number> = {
  best_match: 1,
  icon_seamless: 3,
  icon_d2: 3,
  icon_eu: 4,
  icon_global: 5,
  ecmwf_ifs025: 7,
  gfs_seamless: 4,
  gfs_global: 4,
  meteofrance_arpege_europe: 4,
  meteofrance_arome_france: 3,
  geosphere_arome_austria: 3,
  ukmo_global_deterministic_10km: 7,
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
export function latestRun(model: ModelInfo, now: number): ModelRun {
  const intervalMs = model.updateIntervalHours * HOUR_MS
  const lagMs = (AVAILABILITY_LAG_H[model.id] ?? DEFAULT_LAG_H) * HOUR_MS
  const initTime = Math.floor((now - lagMs) / intervalMs) * intervalMs
  return { initTime, initHourUtc: new Date(initTime).getUTCHours() }
}

/** Kompakte Laufstunde: "06 UTC", "00 UTC". */
export function formatRun(run: ModelRun): string {
  return `${String(run.initHourUtc).padStart(2, '0')} UTC`
}
