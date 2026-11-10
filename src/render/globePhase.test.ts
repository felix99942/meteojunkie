// Phasen-Summe (`colorizePhaseTile`): die Rampe wählt das GELÄNDE unter dem Pixel,
// nicht das Modell — derselbe Gitterwert wird am Hang über der Schnee-Höhe violett,
// darunter grün/blau.
import { describe, expect, it } from 'vitest'
import { colorizePhaseTile } from './globeTiles'
import { PHASE_RAIN_SCALE, PHASE_SNOW_SCALE, phaseLineM, samplePhaseLine, type GlobeField } from '../config/globe'

const SIZE = 8
// Kachel z=0: ganze Welt; ein Gitter, das sie ganz überdeckt
const grid = { ni: 4, nj: 4, lon0: -180, lat0: -85, dlon: 120, dlat: 170 / 3, global: false }
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))

function field(mm: number, lineB: number): GlobeField {
  const n = grid.ni * grid.nj
  return {
    grid,
    lo: 0,
    step: 0.1,
    codes: new Uint16Array(n).fill(Math.round(mm / 0.1) + 1),
    zline: new Uint8Array(n).fill(lineB),
  }
}

describe('phaseLineM', () => {
  it('20-m-Stufen ab −200 m (wie encode_phase)', () => {
    expect(phaseLineM(0)).toBe(-200)
    expect(phaseLineM(60)).toBe(1000)
    expect(phaseLineM(255)).toBe(4900)
  })
})

describe('colorizePhaseTile', () => {
  const f = field(12, 60) // 12 mm, Schnee oberhalb 1000 m
  // linke Hälfte Tal (500 m), rechte Hälfte Berg (2000 m)
  const heights = new Float32Array(SIZE * SIZE).map((_, i) => (i % SIZE < SIZE / 2 ? 500 : 2000))
  const rgba = colorizePhaseTile(f, PHASE_RAIN_SCALE, PHASE_SNOW_SCALE, heights, 0, 0, 0, SIZE)
  const px = (x: number, y: number) => Array.from(rgba.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3))
  // 12 mm liegt in der Stufe ab 10 mm
  const band = PHASE_RAIN_SCALE.stops.findIndex((s) => s.value === 10)

  it('färbt das Tal als Regen', () => {
    expect(px(1, 4)).toEqual(hex(PHASE_RAIN_SCALE.stops[band].color))
  })
  it('färbt den Berg als Schnee', () => {
    expect(px(6, 4)).toEqual(hex(PHASE_SNOW_SCALE.stops[band].color))
  })
  it('lässt unter 1 mm durchsichtig', () => {
    const dry = colorizePhaseTile(field(0.5, 60), PHASE_RAIN_SCALE, PHASE_SNOW_SCALE, heights, 0, 0, 0, SIZE)
    expect(dry.every((v) => v === 0)).toBe(true)
  })
})

describe('samplePhaseLine', () => {
  it('liest die Höhe am Punkt, null ohne Wert', () => {
    expect(samplePhaseLine(field(5, 70), 0, 0)).toBe(1200)
    const empty = field(5, 70)
    empty.codes.fill(0)
    expect(samplePhaseLine(empty, 0, 0)).toBeNull()
  })
})
