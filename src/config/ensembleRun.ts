// Start des jüngsten Ensemble-Laufs — die Plume beginnt dort (seit 2026-11-10,
// auf Wunsch).
//
// WARUM: Open-Meteo füllt die Stunden VOR dem jüngsten Laufstart mit den
// Vorhersagen älterer Läufe auf. „Member 7" ist aber in jedem Lauf eine andere
// Bahn, die Nummer nur ein Platz. An der Naht verband die Linie zwei Läufe,
// die nichts miteinander zu tun haben: das Bündel schnürte sich zusammen (der
// neue Lauf startet mit kleiner Streuung) und die Linien kreuzten sich quer.
// Gemessen 2026-11-10, Innsbruck, ICON-EU-EPS T2m: Streuung 0,85 K um 11 UTC,
// 0,47 K um 12 UTC (Laufstart), Rangkorrelation der Member von Stunde zu
// Stunde 0,57 statt ~0,9–1.
//
// WOHER DER LAUFSTART: aus Open-Meteos Metadaten
// (`/data/<datensatz>/static/meta.json`, `last_run_initialisation_time`, CORS
// offen) — aber NUR, wenn sie frisch sind: die DWD-Datensätze standen am
// 2026-11-10 noch auf dem 06.10. (dwd_icon_eu_eps, dwd_icon_d2_eps,
// dwd_icon_eps), während die Daten selbst aktuell waren. Sonst eine Schätzung
// aus Laufrhythmus und Bereitstellungszeit. Die Zeiten sind bewusst etwas
// KÜRZER als gemessen: zu früh geschätzt bliebe der Knoten stehen, zu spät
// geschätzt fehlen nur die ersten Stunden des neuen Laufs.
//
// Aus den Daten selbst lässt sich die Naht NICHT verlässlich finden (geprüft):
// bei Wind, Niederschlag und den Konvektionsensembles springt die Reihenfolge
// der Member auch mitten im Lauf von Stunde zu Stunde.

const HOUR_MS = 3_600_000

interface RunSource {
  /** Datensatz für `meta.json`, falls Open-Meteo ihn aktuell führt. */
  meta?: string
  /** Stunden zwischen Laufstart und Bereitstellung (etwas unter gemessen). */
  lagHours: number
}

// Gemessen 2026-11-10 aus `last_run_availability_time − last_run_initialisation_time`:
// IFS-ENS 9,1 h (06 UTC), AIFS 8,5, GEFS 5,7, ICON-CH2 3,0, ICON-CH1 2,0,
// ICON-EU-EPS 3,2 und ICON-D2-EPS 2,4 (beide aus dem veralteten Oktober-Stand)
const RUN_SOURCES: Record<string, RunSource> = {
  ecmwf_ifs025: { meta: 'ecmwf_ifs025_ensemble', lagHours: 7 },
  ecmwf_aifs025: { meta: 'ecmwf_aifs025_ensemble', lagHours: 7 },
  gfs_seamless: { meta: 'ncep_gefs025', lagHours: 5 },
  icon_d2_eps: { meta: 'dwd_icon_d2_eps', lagHours: 2 },
  icon_eu: { meta: 'dwd_icon_eu_eps', lagHours: 3 },
  // Beginnt mit ICON-EU-EPS — dessen Laufstart gilt
  icon_seamless: { meta: 'dwd_icon_eu_eps', lagHours: 3 },
  meteoswiss_icon_ch2_ensemble: { meta: 'meteoswiss_icon_ch2_ensemble', lagHours: 2.75 },
  meteoswiss_icon_ch1_ensemble: { meta: 'meteoswiss_icon_ch1_ensemble', lagHours: 1.75 },
}

/** Metadaten älter als das gelten als veraltet (zwei Tage — kein Lauf ist so lange unterwegs). */
const META_MAX_AGE_MS = 48 * HOUR_MS

export function runMetaDataset(modelId: string): string | null {
  return RUN_SOURCES[modelId]?.meta ?? null
}

/** Geschätzter jüngster Laufstart: letzter Termin im Rhythmus, der schon bereitstehen dürfte. */
export function estimateRunInit(modelId: string, intervalHours: number, now: number): number {
  const lag = (RUN_SOURCES[modelId]?.lagHours ?? 3) * HOUR_MS
  const step = intervalHours * HOUR_MS
  return Math.floor((now - lag) / step) * step
}

/**
 * Laufstart für die Plume: die Metadaten, wenn frisch und nicht in der
 * Zukunft, sonst die Schätzung.
 */
export function pickRunInit(metaInitMs: number | null, estimateMs: number, now: number): number {
  if (metaInitMs != null && Number.isFinite(metaInitMs) && metaInitMs <= now && now - metaInitMs <= META_MAX_AGE_MS) {
    return metaInitMs
  }
  return estimateMs
}

/** Index des ersten Zeitpunkts ab dem Laufstart (0, wenn die Reihe ohnehin später beginnt). */
export function runStartIndex(times: number[], runInit: number): number {
  const i = times.findIndex((t) => t >= runInit)
  return i < 0 ? 0 : i
}
