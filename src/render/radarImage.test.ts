// Nachbearbeitung der DWD-Radarbilder (siehe radarImage.ts). Zwei Dinge
// müssen stimmen, und das zweite ist das heikle: die Randlinie muss
// verschwinden, und die ECHTE Skala darf es NICHT — die dBZ-Skala führt
// #FF33FF für 75–85 dBZ, eine Klassenfarbe, die jeder groben
// „magenta"-Regel zum Opfer fällt.

import { describe, expect, it } from 'vitest'
import { applyCoverageStencil, coverageStencil, maskRadarEdge } from './radarImage'
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

describe('Abdeckung festhalten', () => {
  // Analyse: Pixel 0 ist Maske, Pixel 1 freier Himmel, Pixel 2 ein Echo.
  const analysis = img([125, 125, 125, 128], [0, 0, 0, 0], [0, 153, 52, 255])

  it('merkt sich genau die Maskenpixel der Analyse', () => {
    expect([...coverageStencil(analysis)]).toEqual([1, 0, 0])
  })

  it('überschreibt im Vorhersagebild, was über unbeobachtetes Gebiet geschoben wurde', () => {
    const stencil = coverageStencil(analysis)
    // Die Verlagerung hat die Maske weggezogen und dort ein Echo hingeschoben.
    const forecast = img([0, 153, 52, 255], [0, 0, 0, 0], [77, 191, 26, 255])
    expect(applyCoverageStencil(forecast, stencil, 0.5)).toBe(1)
    expect([...forecast.slice(0, 4)]).toEqual([125, 125, 125, 128])
    // Innerhalb der Abdeckung bleibt alles, wie der Dienst es liefert.
    expect([...forecast.slice(8, 12)]).toEqual([77, 191, 26, 255])
  })

  it('lässt Maske, die INNERHALB der Abdeckung wächst, stehen', () => {
    // Das ist die ehrliche Aussage „hier hat die Verlagerung nichts" und darf
    // NICHT weggerechnet werden.
    const stencil = coverageStencil(analysis)
    const forecast = img([125, 125, 125, 128], [125, 125, 125, 128], [0, 0, 0, 0])
    expect(applyCoverageStencil(forecast, stencil, 0.5)).toBe(0)
    expect([...forecast.slice(4, 8)]).toEqual([125, 125, 125, 128])
  })

  it('zählt die umgefärbte Randlinie zur Abdeckung', () => {
    // Sonst bliebe an der Grenze eine ein Pixel schmale Rinne im Stencil, in
    // der in den Vorhersagebildern wieder verschobener Inhalt durchscheint.
    const frame = img([251, 0, 255, 255], [0, 0, 0, 0])
    maskRadarEdge(frame, 0.5)
    expect([...coverageStencil(frame)]).toEqual([1, 0])
  })
})
