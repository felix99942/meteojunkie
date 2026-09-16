// Ladereihenfolge der Radarbilder. Klein, aber sie entscheidet, ob nach einer
// Sekunde der NEUESTE Stand steht — und der ist beim Radar das, was man sehen
// will; die Vergangenheit füllt die Schleife danach auf.

import { describe, expect, it } from 'vitest'
import { newestFirst } from './dwdRadar'

describe('newestFirst', () => {
  it('holt den neuesten Zeitschritt zuerst', () => {
    expect(newestFirst([100, 400, 200, 300])).toEqual([400, 300, 200, 100])
  })

  it('lässt die übergebene Liste unangetastet', () => {
    const times = [100, 200, 300]
    newestFirst(times)
    expect(times).toEqual([100, 200, 300])
  })

  it('verträgt leere Listen', () => {
    expect(newestFirst([])).toEqual([])
  })
})
