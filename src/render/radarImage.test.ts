// Die magentafarbene Randlinie der DWD-Radarbilder (siehe radarImage.ts):
// sie darf verschwinden, die ECHTE Skala darf es nicht — Magenta am oberen
// Ende einer Niederschlagsskala ist ein Wolkenbruch, und der muss stehen
// bleiben.

import { describe, expect, it } from 'vitest'
import { maskRadarEdge } from './radarImage'

/** Baut ein Bild aus Farben (r,g,b,a). */
function img(...px: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat())
}

describe('maskRadarEdge', () => {
  it('färbt die Randlinie auf die Maskenfarbe um', () => {
    const d = img([251, 0, 255, 255])
    expect(maskRadarEdge(d)).toBe(1)
    expect([...d]).toEqual([125, 125, 125, 77])
  })

  it('lässt jede Farbe der echten Skala unberührt', () => {
    // Die drei, die am nächsten an der Bedingung liegen: 75–100 mm/h,
    // 100–150 mm/h und ≥ 150 mm/h.
    const d = img([204, 0, 152, 255], [102, 0, 203, 255], [0, 0, 254, 255], [254, 0, 0, 255])
    expect(maskRadarEdge(d)).toBe(0)
    expect([...d]).toEqual([204, 0, 152, 255, 102, 0, 203, 255, 0, 0, 254, 255, 254, 0, 0, 255])
  })

  it('behält die Deckkraft weichgezeichneter Ränder bei', () => {
    const d = img([255, 0, 255, 8])
    expect(maskRadarEdge(d)).toBe(1)
    expect([...d]).toEqual([125, 125, 125, 2])
  })

  it('fasst vollständig transparente Pixel nicht an', () => {
    const d = img([255, 0, 255, 0])
    expect(maskRadarEdge(d)).toBe(0)
    expect([...d]).toEqual([255, 0, 255, 0])
  })

  it('lässt die Maske selbst und leere Flächen, wie sie sind', () => {
    const d = img([125, 125, 125, 77], [51, 255, 255, 255])
    expect(maskRadarEdge(d)).toBe(0)
  })
})
