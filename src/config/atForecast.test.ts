// Wann ist die MOS-Vorhersage alt? Die Frage klingt nebensächlich, war aber
// wochenlang unbeantwortbar: die Laufangabe stand als reine Uhrzeit im Bild,
// ein sechs Wochen alter Lauf sah aus wie der von heute.

import { describe, expect, it } from 'vitest'
import { forecastFreshness, STALE_RUN_HOURS } from './atForecast'

const H = 3_600_000
const NOW = Date.UTC(2026, 8, 30, 12)

describe('forecastFreshness', () => {
  it('nennt einen frischen Lauf frisch', () => {
    expect(forecastFreshness(NOW - 2 * H, NOW + 70 * H, NOW)).toBe('fresh')
  })

  /**
   * VERBRAUCHT schlägt ALT: liegt der letzte Termin in der Vergangenheit,
   * ist die Vorhersage keine mehr — dann ist es gleichgültig, wie alt der
   * Lauf ist, und der schärfere Hinweis gehört ins Bild.
   */
  it('erkennt einen verbrauchten Stand', () => {
    expect(forecastFreshness(NOW - 40 * 24 * H, NOW - H, NOW)).toBe('expired')
    // … auch bei taufrischem Lauf, falls die Termine nicht stimmen
    expect(forecastFreshness(NOW, NOW - H, NOW)).toBe('expired')
  })

  // Zwölf Stunden sind bei ~4 Läufen/Tag zwei verpasste Zyklen — kein
  // Zufallsschwanken, sondern ein ausgefallener Ingest.
  it('meldet einen alten Lauf, der noch in die Zukunft reicht', () => {
    expect(forecastFreshness(NOW - (STALE_RUN_HOURS + 1) * H, NOW + 24 * H, NOW)).toBe('old')
    expect(forecastFreshness(NOW - (STALE_RUN_HOURS - 1) * H, NOW + 24 * H, NOW)).toBe('fresh')
  })

  // Fehlt eine der beiden Zeiten (kaputte Meta), wird NICHT gewarnt: ein
  // Fehlalarm bei jedem Ladefehler entwertet den Hinweis.
  it('hält sich bei unbekannten Zeiten heraus', () => {
    expect(forecastFreshness(Number.NaN, Number.NaN, NOW)).toBe('fresh')
  })
})
