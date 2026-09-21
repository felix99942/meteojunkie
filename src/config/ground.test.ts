// Tests des Untergrund-Bildes. Geprüft wird das, was still schiefgehen kann:
// die Ecken. Ein Bild, das um ein halbes Grad verschoben aufgespannt wird,
// sieht wie eine Karte aus — nur liegt die Küste dann neben der Küstenlinie.

import { describe, expect, it } from 'vitest'
import {
  GROUND_BOUNDS,
  GROUND_COORDINATES,
  GROUND_DETAIL_BOUNDS,
  GROUND_TILES,
} from './ground'
import { RELIEF_BOUNDS } from './relief'
import { SATELLITE_DETAIL_AREA } from './satellite'

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

  // Beide Hintergründe spannen dasselbe Fenster auf — nur so lässt sich der
  // eine gegen den anderen tauschen, ohne dass sich etwas verschiebt.
  it('deckt sich mit dem Höhenrelief', () => {
    expect(GROUND_BOUNDS).toEqual(RELIEF_BOUNDS)
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

  // Das zweite, schärfere Bild liegt UNTER den Wolken und muss deshalb GENAU
  // die Fläche des Satellitenbildes haben — einen Grad daneben, und der Boden
  // wäre gegen die Wolken verschoben, ohne dass es nach einem Fehler aussieht.
  it('deckt sich mit der Detailfläche der HRFI-Kanäle', () => {
    expect(GROUND_DETAIL_BOUNDS.lonMin).toBe(SATELLITE_DETAIL_AREA.west)
    expect(GROUND_DETAIL_BOUNDS.lonMax).toBe(SATELLITE_DETAIL_AREA.east)
    expect(GROUND_DETAIL_BOUNDS.latMin).toBe(SATELLITE_DETAIL_AREA.south)
    expect(GROUND_DETAIL_BOUNDS.latMax).toBe(SATELLITE_DETAIL_AREA.north)
  })

  // Der Ausschnitt muss die Flächen der Bildbereiche tragen — sonst endet der
  // Untergrund mitten im Bild.
  it('umfasst die Satelliten- und die Radarfläche', () => {
    for (const [w, e, s, n] of [
      [0, 22, 41, 56], // SATELLITE_AREA
      [4, 18, 44, 56], // SATELLITE_DETAIL_AREA
      [1.5, 18.7, 45.7, 56.2], // Radarfläche
    ]) {
      expect(w).toBeGreaterThanOrEqual(GROUND_BOUNDS.lonMin)
      expect(e).toBeLessThanOrEqual(GROUND_BOUNDS.lonMax)
      expect(s).toBeGreaterThanOrEqual(GROUND_BOUNDS.latMin)
      expect(n).toBeLessThanOrEqual(GROUND_BOUNDS.latMax)
    }
  })
})
