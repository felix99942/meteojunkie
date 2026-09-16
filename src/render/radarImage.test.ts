// Die magentafarbene Randlinie der DWD-Radarbilder (siehe radarImage.ts). Zwei
// Dinge müssen stimmen, und das zweite ist das heikle: die Linie muss
// verschwinden, und die ECHTE Skala darf es NICHT — die dBZ-Skala führt
// #FF33FF für 75–85 dBZ, eine Klassenfarbe, die jeder groben
// „magenta"-Regel zum Opfer fällt.

import { describe, expect, it } from 'vitest'
import { maskRadarEdge } from './radarImage'
import { RV_LEGEND, WN_LEGEND } from '../config/radar'

/** Baut Pixeldaten aus (r,g,b,a). */
function img(...px: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat())
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

describe('maskRadarEdge', () => {
  it('färbt die Randlinie auf die Maskenfarbe um', () => {
    const d = img([251, 0, 255, 255])
    expect(maskRadarEdge(d, 0.5)).toBe(1)
    expect([...d]).toEqual([125, 125, 125, 128])
  })

  it('nimmt die Deckkraft des Produkts (WN 0,5 · RV 0,3)', () => {
    const wn = img([251, 0, 255, 255])
    maskRadarEdge(wn, 0.5)
    expect(wn[3]).toBe(128)
    const rv = img([251, 0, 255, 255])
    maskRadarEdge(rv, 0.3)
    expect(rv[3]).toBe(77)
  })

  it('erwischt auch die weichgezeichneten Ränder der Linie', () => {
    // Mischungen von Maskengrau und #FB00FF, wie sie im Bild wirklich stehen
    const d = img([152, 97, 154, 255], [141, 111, 141, 255], [255, 0, 255, 8])
    expect(maskRadarEdge(d, 0.5)).toBe(3)
  })

  it('lässt JEDE Farbe BEIDER Skalen unberührt', () => {
    for (const step of [...WN_LEGEND, ...RV_LEGEND]) {
      const [r, g, b] = rgb(step.color)
      const d = img([r, g, b, 255])
      expect(maskRadarEdge(d, 0.5), `${step.color} (${step.label})`).toBe(0)
    }
  })

  it('lässt insbesondere 75–85 dBZ (#FF33FF) stehen', () => {
    const d = img([255, 51, 255, 255])
    expect(maskRadarEdge(d, 0.5)).toBe(0)
    expect([...d]).toEqual([255, 51, 255, 255])
  })

  it('fasst vollständig transparente Pixel nicht an', () => {
    const d = img([255, 0, 255, 0])
    expect(maskRadarEdge(d, 0.5)).toBe(0)
    expect([...d]).toEqual([255, 0, 255, 0])
  })
})
