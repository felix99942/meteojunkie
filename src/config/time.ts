// Gemeinsames Zeitraster für Scrubber, Meteogramme und API-Requests.
// Alles in Epoch-Millisekunden, UTC. Das Raster wird einmal beim Laden der
// Seite fixiert (Start = heute 00:00 UTC), damit Panels und Scrubber über die
// gesamte Session dasselbe Achsenraster teilen.

export const FORECAST_DAYS = 7
/** Kartenfelder holen weniger Tage als Meteogramme — Rate-Limit-Budget (Gewichtung ~ Locations × Zeitraum). */
export const MAP_FORECAST_DAYS = 3
export const STEP_MS = 3_600_000 // 1 h

function startOfTodayUtc(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** [start, end] inklusive — letzter Zeitschritt ist 23:00 UTC des letzten Tages. */
export const TIME_RANGE = (() => {
  const start = startOfTodayUtc()
  return { start, end: start + (FORECAST_DAYS * 24 - 1) * STEP_MS }
})()

/** Alle Zeitschritte des Forecast-Horizonts als Epoch-ms. */
export function timeGridMs(): number[] {
  return Array.from(
    { length: FORECAST_DAYS * 24 },
    (_, i) => TIME_RANGE.start + i * STEP_MS,
  )
}

export function floorToStep(t: number): number {
  return Math.floor(t / STEP_MS) * STEP_MS
}

export function clampToRange(t: number): number {
  return Math.min(TIME_RANGE.end, Math.max(TIME_RANGE.start, t))
}

/** Index eines Zeitpunkts im Raster (geclampt). */
export function timeToIndex(t: number): number {
  const i = Math.round((clampToRange(t) - TIME_RANGE.start) / STEP_MS)
  return Math.min(FORECAST_DAYS * 24 - 1, Math.max(0, i))
}

const fmtCursor = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatCursorTime(t: number): string {
  return `${fmtCursor.format(new Date(t))} UTC`
}
