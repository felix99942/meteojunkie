import { describe, expect, it } from 'vitest'
import { POLE_ROWS } from '../config/globe'
import { cleanTopoTile } from './globeTopo'

const SIZE = 64

/** Kachel aus einer Höhenfunktion (Meter) in Terrarium-Kodierung. */
function tile(height: (col: number, row: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const v = height(col, row) + 32768
      const i = (row * SIZE + col) * 4
      px[i] = Math.floor(v / 256)
      px[i + 1] = Math.floor(v) % 256
      px[i + 2] = Math.floor((v % 1) * 256)
      px[i + 3] = 255
    }
  }
  return px
}

const metres = (px: Uint8ClampedArray, col: number, row: number) => {
  const i = (row * SIZE + col) * 4
  return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768
}

describe('cleanTopoTile', () => {
  it('setzt den Meeresboden auf null und lässt Land unverändert', () => {
    const px = tile((col) => (col < 32 ? -3200 : 1234.5))
    cleanTopoTile(px, SIZE, 6, 20)
    expect(metres(px, 0, 30)).toBe(0)
    expect(metres(px, 31, 30)).toBe(0)
    expect(metres(px, 32, 30)).toBe(1234.5)
  })

  it('macht nur den Polrand flach, und zwar auf die mittlere Höhe der Zeile darunter', () => {
    const north = tile((col, row) => (row === POLE_ROWS ? 1000 + col : 500 + row * col))
    const before = metres(north, 7, POLE_ROWS + 1)
    cleanTopoTile(north, SIZE, 2, 0)
    const expected = 1000 + (SIZE - 1) / 2
    expect(metres(north, 0, 0)).toBeCloseTo(expected, 1)
    expect(metres(north, SIZE - 1, POLE_ROWS - 1)).toBeCloseTo(expected, 1)
    expect(metres(north, 7, POLE_ROWS + 1)).toBe(before)

    const south = tile((col, row) => (row === SIZE - POLE_ROWS - 1 ? 3000 : 2000 + col))
    cleanTopoTile(south, SIZE, 2, 3)
    expect(metres(south, 9, SIZE - 1)).toBe(3000)
    expect(metres(south, 9, SIZE - POLE_ROWS)).toBe(3000)
    expect(metres(south, 9, 5)).toBe(2009)
  })

  it('lässt Kacheln abseits der Pole oben und unten stehen', () => {
    const px = tile((col) => 800 + col)
    cleanTopoTile(px, SIZE, 2, 1)
    expect(metres(px, 5, 0)).toBe(805)
    expect(metres(px, 5, SIZE - 1)).toBe(805)
  })
})
