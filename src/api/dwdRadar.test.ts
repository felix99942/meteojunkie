// Ladereihenfolge der Radarbilder. Klein, aber sie entscheidet, ob nach einer
// Sekunde das GEFRAGTE Bild steht oder ob eine chronologische Warteschlange
// erst eine halbe Minute Vergangenheit abarbeitet.

import { describe, expect, it } from 'vitest'
import { frameLoadOrder } from './dwdRadar'

describe('frameLoadOrder', () => {
  it('beginnt beim angezeigten Bild, geht vorwärts, dann rückwärts', () => {
    expect(frameLoadOrder(6, 2)).toEqual([2, 3, 4, 5, 1, 0])
  })

  it('holt jedes Bild genau einmal', () => {
    const order = frameLoadOrder(37, 12)
    expect(order).toHaveLength(37)
    expect(new Set(order).size).toBe(37)
  })

  it('verträgt Ränder und leere Folgen', () => {
    expect(frameLoadOrder(3, 0)).toEqual([0, 1, 2])
    expect(frameLoadOrder(3, 2)).toEqual([2, 1, 0])
    expect(frameLoadOrder(3, 99)).toEqual([2, 1, 0])
    expect(frameLoadOrder(0, 0)).toEqual([])
  })
})
