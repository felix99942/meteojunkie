// Tests des Sonnenstands. Geprüft wird gegen GEOMETRISCHE Identitäten und
// bekannte Extremfälle, nicht gegen selbst erzeugte Zahlen — eine Näherung,
// die man nur gegen die eigene Ausgabe prüft, bestätigt sich selbst.

import { describe, expect, it } from 'vitest'
import { DAYLIGHT_MIN_ELEVATION, hasDaylight, solarElevationDeg } from './solar'

/** Neigung der Erdachse. */
const TILT = 23.44
const WIEN = { lat: 48.21, lon: 16.37 }

/** Höchster Sonnenstand des Tages (Minutenraster) an einem Ort. */
function noonElevation(dayUtc: number, lat: number, lon: number): number {
  let max = -90
  for (let m = 0; m < 1440; m++) max = Math.max(max, solarElevationDeg(dayUtc + m * 60_000, lat, lon))
  return max
}

describe('solarElevationDeg', () => {
  // Mittagshöhe = 90° − Breite ± Neigung. Das ist Geometrie, keine Messung.
  it('trifft die Mittagshöhe zur Sommersonnenwende', () => {
    const h = noonElevation(Date.UTC(2026, 5, 21), WIEN.lat, WIEN.lon)
    expect(h).toBeCloseTo(90 - WIEN.lat + TILT, 0)
  })

  it('trifft die Mittagshöhe zur Wintersonnenwende', () => {
    const h = noonElevation(Date.UTC(2026, 11, 21), WIEN.lat, WIEN.lon)
    expect(h).toBeCloseTo(90 - WIEN.lat - TILT, 0)
  })

  it('stellt die Sonne zur Tagundnachtgleiche über den Äquator', () => {
    const h = noonElevation(Date.UTC(2026, 2, 20), 0, 0)
    expect(h).toBeGreaterThan(88)
  })

  // Polartag und Polarnacht: der härteste Test für das Vorzeichen.
  it('kennt die Mitternachtssonne', () => {
    const day = Date.UTC(2026, 5, 21)
    for (let h = 0; h < 24; h++) {
      expect(solarElevationDeg(day + h * 3_600_000, 78.22, 15.65), `${h} UTC`).toBeGreaterThan(0)
    }
  })

  it('kennt die Polarnacht', () => {
    const day = Date.UTC(2026, 11, 21)
    for (let h = 0; h < 24; h++) {
      expect(solarElevationDeg(day + h * 3_600_000, 78.22, 15.65), `${h} UTC`).toBeLessThan(0)
    }
  })

  // Sonnenhöhe hängt an der Ortszeit: weiter östlich ist der Mittag früher.
  it('lässt die Sonne im Osten früher kulminieren', () => {
    const t = Date.UTC(2026, 8, 19, 10, 0)
    expect(solarElevationDeg(t, 48, 20)).toBeGreaterThan(solarElevationDeg(t, 48, 0))
  })

  it('geht in Wien im September am Morgen auf und am Abend unter', () => {
    const day = Date.UTC(2026, 8, 19)
    // 03 UTC (05 Uhr Ortszeit) ist es noch dunkel, 09 UTC hell, 20 UTC dunkel.
    expect(solarElevationDeg(day + 3 * 3_600_000, WIEN.lat, WIEN.lon)).toBeLessThan(0)
    expect(solarElevationDeg(day + 9 * 3_600_000, WIEN.lat, WIEN.lon)).toBeGreaterThan(0)
    expect(solarElevationDeg(day + 20 * 3_600_000, WIEN.lat, WIEN.lon)).toBeLessThan(0)
  })
})

describe('hasDaylight', () => {
  // Die Schwelle ist NICHT der Horizont: ein Satellitenbild im sichtbaren
  // Kanal ist bei tiefstehender Sonne praktisch schwarz. Nachgestellt am
  // 18.09.2026 über der Mitte der Fläche — um 17:00 UTC stand die Sonne dort
  // knapp 3° hoch, und das Bild dazu war unbrauchbar dunkel.
  it('verlangt mehr als den blossen Horizont', () => {
    expect(DAYLIGHT_MIN_ELEVATION).toBeGreaterThan(0)
    const lowSun = Date.UTC(2026, 8, 18, 17, 0)
    const el = solarElevationDeg(lowSun, 48.5, 11)
    expect(el).toBeGreaterThan(0)
    expect(el).toBeLessThan(DAYLIGHT_MIN_ELEVATION)
    expect(hasDaylight(lowSun, 48.5, 11)).toBe(false)
  })

  it('erkennt Mittag als Tageslicht und Mitternacht als Nacht', () => {
    expect(hasDaylight(Date.UTC(2026, 8, 18, 11, 0), 48.5, 11)).toBe(true)
    expect(hasDaylight(Date.UTC(2026, 8, 18, 23, 0), 48.5, 11)).toBe(false)
  })
})
