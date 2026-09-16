// Blitzzellen aus dem Dichtebild (siehe lightning.ts). Zwei Dinge müssen
// stimmen: die MASKE darf kein Blitz werden (sie heißt „keine Daten" und
// bedeckt bei diesem Produkt den ganzen Osten Österreichs), und eine
// 10-km-Zelle darf nur EIN Kreuz ergeben.

import { describe, expect, it } from 'vitest'
import { extractLightningCells, toPalette } from './lightning'
import { LIGHTNING_DENSITY_COLORS } from '../config/radar'

const PALETTE = toPalette(LIGHTNING_DENSITY_COLORS)

/** Baut ein Bild aus einer Zeichenkarte: '.' leer, '#' Blitz, 'm' Maske. */
function image(rows: string[]): { data: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      const i = (y * width + x) * 4
      if (ch === '#') {
        // Stufe 4 der Blitzskala (#45C379 = 2,0–4,9 Blitze/min je 100 km²)
        data[i] = 69
        data[i + 1] = 195
        data[i + 2] = 121
        data[i + 3] = 255
      } else if (ch === 'x') {
        // schwächste Stufe (#FCFFC1 = 0,1)
        data[i] = 252
        data[i + 1] = 255
        data[i + 2] = 193
        data[i + 3] = 255
      } else if (ch === 'm') {
        data[i] = 126
        data[i + 1] = 126
        data[i + 2] = 126
        data[i + 3] = 77
      }
    })
  })
  return { data, width, height }
}

describe('extractLightningCells', () => {
  it('macht aus einem zusammenhängenden Block EIN Kreuz', () => {
    const { data, width, height } = image(['....', '.##.', '.##.', '....'])
    const cells = extractLightningCells(data, width, height, 4, PALETTE)
    expect(cells).toHaveLength(1)
  })

  it('trennt weit auseinanderliegende Zellen', () => {
    const { data, width, height } = image(['#...#', '.....', '.....', '.....', '#...#'])
    expect(extractLightningCells(data, width, height, 2, PALETTE)).toHaveLength(4)
  })

  it('hält die MASKE für keinen Blitz', () => {
    // Das ist der Fall, der sonst ganz Ostösterreich mit Kreuzen zupflastert.
    const { data, width, height } = image(['mmmm', 'mmmm'])
    expect(extractLightningCells(data, width, height, 2, PALETTE)).toEqual([])
  })

  it('gibt Positionen in Bildkoordinaten 0…1 zurück', () => {
    const { data, width, height } = image(['..', '.#'])
    const [cell] = extractLightningCells(data, width, height, 1, PALETTE)
    expect(cell.x).toBeCloseTo(0.75, 5)
    expect(cell.y).toBeCloseTo(0.75, 5)
  })

  it('ist bei leerem Bild leer (der Normalfall)', () => {
    const { data, width, height } = image(['....', '....'])
    expect(extractLightningCells(data, width, height, 2, PALETTE)).toEqual([])
  })
  // Die Stufe kommt aus der PIXELFARBE — ohne sie stünde über einem großen
  // Cluster ein gleichförmiges Kreuzgitter statt herausstechender Kerne.
  it('liest die Stufe der Blitzrate aus der Farbe', () => {
    const { data, width, height } = image(['x#'])
    const cells = extractLightningCells(data, width, height, 1, PALETTE)
    expect(cells.map((c) => c.level)).toEqual([0, 4])
  })

  it('nimmt im Block die STÄRKSTE Stufe', () => {
    const { data, width, height } = image(['xx', 'x#'])
    const [cell] = extractLightningCells(data, width, height, 2, PALETTE)
    expect(cell.level).toBe(4)
  })
})
