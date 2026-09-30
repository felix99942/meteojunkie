// Tests des Untergrund-Bildes. Geprüft wird das, was still schiefgehen kann:
// die Ecken. Ein Bild, das um ein halbes Grad verschoben aufgespannt wird,
// sieht wie eine Karte aus — nur liegt die Küste dann neben der Küstenlinie.

import { describe, expect, it } from 'vitest'
import { GROUND_BOUNDS, GROUND_COORDINATES, GROUND_TILES } from './ground'
import { RELIEF_BOUNDS } from './relief'
import { SATELLITE_AREA } from './satellite'

const xToLon = (x: number, n: number) => (x / n) * 360 - 180
const yToLat = (y: number, n: number) => {
  const t = Math.PI - (2 * Math.PI * y) / n
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)))
}

describe('Untergrund', () => {
  // Die Ecken stehen als Zahlen in der Registry, erzeugt werden sie aber vom
  // Ingest aus dem Kachelfenster. Diese Rechnung ist die Brücke: driftet das
  // Skript, fällt es hier auf und nicht erst an einer verschobenen Küste.
  it('leitet die Ecken aus dem Kachelfenster ab', () => {
    const n = 2 ** GROUND_TILES.zoom
    expect(GROUND_BOUNDS.lonMin).toBeCloseTo(xToLon(GROUND_TILES.x0, n), 6)
    expect(GROUND_BOUNDS.lonMax).toBeCloseTo(xToLon(GROUND_TILES.x1, n), 6)
    expect(GROUND_BOUNDS.latMax).toBeCloseTo(yToLat(GROUND_TILES.y0, n), 6)
    expect(GROUND_BOUNDS.latMin).toBeCloseTo(yToLat(GROUND_TILES.y1, n), 6)
  })

  /**
   * NICHT mehr deckungsgleich mit dem Relief — und das ist der Test, der das
   * festhält, statt die alte Gleichheit stillschweigend zu löschen.
   *
   * Sie bestand, solange beide KARTENHINTERGRÜNDE waren und gegeneinander
   * austauschbar sein sollten. Der Untergrund ist seit 2026-09-30 kein
   * Hintergrund mehr, sondern eine Zutat des Wolken-Komposits, und folgt
   * deshalb der Satellitenfläche. Das Relief bleibt beim alten Fenster; es
   * gehört zur Ortswahl der Soundings und hat mit dem Satelliten nichts zu
   * tun.
   */
  it('folgt der Satellitenfläche, nicht mehr dem Relief', () => {
    expect(GROUND_BOUNDS.lonMin).toBeCloseTo(SATELLITE_AREA.west, 6)
    expect(GROUND_BOUNDS.lonMax).toBeCloseTo(SATELLITE_AREA.east, 6)
    expect(GROUND_BOUNDS.latMin).toBeCloseTo(SATELLITE_AREA.south, 6)
    expect(GROUND_BOUNDS.latMax).toBeCloseTo(SATELLITE_AREA.north, 6)
    // Das Relief ist enger; wäre es plötzlich gleich, hätte jemand eines von
    // beiden versehentlich mitgezogen.
    expect(RELIEF_BOUNDS.lonMin).toBeGreaterThan(GROUND_BOUNDS.lonMin)
  })

  // Reihenfolge der Ecken für die image-source: NW, NE, SE, SW. Vertauscht
  // man zwei, steht das Bild gespiegelt oder auf dem Kopf.
  it('gibt die Ecken im Uhrzeigersinn ab oben links', () => {
    const [nw, ne, se, sw] = GROUND_COORDINATES
    expect(nw).toEqual([GROUND_BOUNDS.lonMin, GROUND_BOUNDS.latMax])
    expect(ne).toEqual([GROUND_BOUNDS.lonMax, GROUND_BOUNDS.latMax])
    expect(se).toEqual([GROUND_BOUNDS.lonMax, GROUND_BOUNDS.latMin])
    expect(sw).toEqual([GROUND_BOUNDS.lonMin, GROUND_BOUNDS.latMin])
  })

  // Das Bild liegt UNTER den Wolken und muss deshalb GENAU die Fläche des
  // Satellitenbildes haben — einen Grad daneben, und der Boden wäre gegen die
  // Wolken verschoben, ohne dass es nach einem Fehler aussieht. Das prüft der
  // Test darüber; hier bleibt, was sonst noch hineinpassen muss.
  it('umfasst auch die Radarfläche', () => {
    const [w, e, s2, n] = [1.5, 18.7, 45.7, 56.2]
    expect(w).toBeGreaterThanOrEqual(GROUND_BOUNDS.lonMin)
    expect(e).toBeLessThanOrEqual(GROUND_BOUNDS.lonMax)
    expect(s2).toBeGreaterThanOrEqual(GROUND_BOUNDS.latMin)
    expect(n).toBeLessThanOrEqual(GROUND_BOUNDS.latMax)
  })

  // In Mercator zufällig exakt quadratisch — eine Eigenschaft, an der man
  // sofort sieht, ob jemand das Kachelfenster verschoben hat.
  it('ist in Mercator quadratisch', () => {
    const mx = (lon: number) => (lon * 20037508.342789244) / 180
    const my = (lat: number) =>
      Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137
    const w = mx(GROUND_BOUNDS.lonMax) - mx(GROUND_BOUNDS.lonMin)
    const h = my(GROUND_BOUNDS.latMax) - my(GROUND_BOUNDS.latMin)
    expect(h / w).toBeCloseTo(1, 2)
  })
})
