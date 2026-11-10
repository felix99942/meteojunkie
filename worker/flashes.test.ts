import { describe, expect, it } from 'vitest'
import { bucketEnds } from './flashes'
import { flashCells } from '../src/render/lightning'
import { FLASH_AREA_BOX, flashBucketKey, flashLevel } from '../src/config/radar'
import { mercBox } from '../src/config/wmsTime'

const T = (s: string) => Date.parse(s)

describe('bucketEnds', () => {
  it('teilt ein 10-Minuten-Paket mit 5 s Versatz in die Fenster mit Ende :25 und :30', () => {
    expect(bucketEnds(T('2026-11-10T12:20:05Z'), T('2026-11-10T12:30:05Z'))).toEqual([
      T('2026-11-10T12:25:00Z'),
      T('2026-11-10T12:30:00Z'),
    ])
  })
  it('macht aus einem kurzen Paket ein Fenster', () => {
    expect(bucketEnds(T('2026-11-10T12:20:05Z'), T('2026-11-10T12:22:05Z'))).toEqual([T('2026-11-10T12:25:00Z')])
  })
})

describe('flashBucketKey', () => {
  it('liegt unter radar/ mit Terminstempel (fällt damit unter IMMUTABLE)', () => {
    expect(flashBucketKey(T('2026-11-10T12:25:00Z'))).toBe('radar/mtgflash/20261110T1225Z.json')
  })
})

describe('flashCells', () => {
  const merc = mercBox(FLASH_AREA_BOX)
  it('setzt Ecken der Fläche auf 0/1 und lässt Blitze außerhalb weg', () => {
    const cells = flashCells(
      {
        start: 0,
        end: 0,
        f: [FLASH_AREA_BOX.north, FLASH_AREA_BOX.west, 0, 10, FLASH_AREA_BOX.south, FLASH_AREA_BOX.east, 0, 5000, 60, 10, 0, 100],
      },
      merc,
    )
    expect(cells).toHaveLength(2)
    expect(cells[0].x).toBeCloseTo(0, 6)
    expect(cells[0].y).toBeCloseTo(0, 6)
    expect(cells[1].x).toBeCloseTo(1, 6)
    expect(cells[1].y).toBeCloseTo(1, 6)
    expect(cells.map((c) => c.level)).toEqual([0, 4])
  })
  it('stuft die Leuchtstärke monoton', () => {
    const levels = [10, 60, 200, 600, 2000].map(flashLevel)
    expect(levels).toEqual([0, 1, 2, 3, 4])
  })
})
