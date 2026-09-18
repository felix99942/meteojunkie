// Tests des Städteverzeichnisses. Es ist eine handgepflegte Liste, also genau
// die Sorte Datei, in der ein Zahlendreher niemandem auffällt — in der Karte
// sähe eine falsche Koordinate wie ein Versatz der Projektion aus, nicht wie
// ein Tippfehler. Geprüft wird deshalb die LAGE, nicht die Schreibweise.

import { describe, expect, it } from 'vitest'
import { CITIES } from './cities'

const imagery = CITIES.filter((c) => c.domains.includes('imagery'))

/**
 * Das Fenster, das die Bildkarten zeigen (Satellitenausschnitt; die
 * Radarfläche liegt darin). Bewusst als Literal und nicht aus
 * `config/satellite.ts` importiert: ein Test, der gegen dieselbe Konstante
 * prüft, die er absichern soll, sichert nichts ab — hier steht die Erwartung.
 */
const VIEW_BOX = { lonMin: 0, lonMax: 22, latMin: 41, latMax: 56 }

/** Grobe Umrisse der Länder, in denen die Bildkarten-Städte liegen. */
const COUNTRY_BOX = { lonMin: 2, lonMax: 21, latMin: 44, latMax: 56.5 }

describe('Bildkarten-Städte (Pseudo-Domain imagery)', () => {
  it('sind genug für eine Orientierung über D-A-CH', () => {
    expect(imagery.length).toBeGreaterThan(80)
  })

  it('liegen alle im gezeigten Fenster', () => {
    for (const c of imagery) {
      expect(
        c.lon >= VIEW_BOX.lonMin &&
          c.lon <= VIEW_BOX.lonMax &&
          c.lat >= VIEW_BOX.latMin &&
          c.lat <= VIEW_BOX.latMax,
        `${c.name} (${c.lat}/${c.lon}) liegt außerhalb des Kartenfensters`,
      ).toBe(true)
    }
  })

  // Fängt genau den Fehler, der beim Geocoden zweimal auftrat: ein
  // gleichnamiger Ort im falschen Land (Milano/Venezia in Mittelitalien statt
  // in der Lombardei bzw. Venetien).
  it('liegen im Umriss der beteiligten Länder', () => {
    for (const c of imagery) {
      expect(c.lon, c.name).toBeGreaterThanOrEqual(COUNTRY_BOX.lonMin)
      expect(c.lon, c.name).toBeLessThanOrEqual(COUNTRY_BOX.lonMax)
      expect(c.lat, c.name).toBeGreaterThanOrEqual(COUNTRY_BOX.latMin)
      expect(c.lat, c.name).toBeLessThanOrEqual(COUNTRY_BOX.latMax)
    }
  })

  it('haben eindeutige Namen und keine doppelten Koordinaten', () => {
    const names = imagery.map((c) => c.name)
    expect(new Set(names).size, 'doppelter Name').toBe(names.length)
    const coords = imagery.map((c) => `${c.lat}|${c.lon}`)
    expect(new Set(coords).size, 'zwei Städte auf demselben Punkt').toBe(coords.length)
  })

  // Die Zoomleiter in Radar und Satellit blendet nach Priorität ein (1 zuerst,
  // 5 zuletzt). Ist eine Stufe leer, springt die Karte beim Zoomen von
  // „wenige" auf „alle" — der Effekt, den die Leiter gerade vermeiden soll.
  it('besetzen jede Stufe der Zoomleiter', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      expect(
        imagery.filter((c) => c.priority === p).length,
        `Stufe ${p} ist leer`,
      ).toBeGreaterThan(0)
    }
  })

  // Umgekehrt: die obersten Stufen dürfen nicht überladen sein, sonst steht in
  // der Übersicht wieder ein Labelteppich.
  it('halten die Übersichtsstufen schlank', () => {
    expect(imagery.filter((c) => c.priority <= 2).length).toBeLessThan(20)
  })
})

describe('Alle Städte', () => {
  it('tragen plausible Koordinaten', () => {
    for (const c of CITIES) {
      expect(Number.isFinite(c.lat) && Math.abs(c.lat) <= 90, c.name).toBe(true)
      expect(Number.isFinite(c.lon) && Math.abs(c.lon) <= 180, c.name).toBe(true)
    }
  })

  it('gehören mindestens einer Domain an', () => {
    for (const c of CITIES) expect(c.domains.length, c.name).toBeGreaterThan(0)
  })
})
