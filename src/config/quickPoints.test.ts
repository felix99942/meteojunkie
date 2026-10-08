import { describe, expect, it } from 'vitest'
import { QUICK_REGIONS, regionFor } from './quickPoints'

describe('Schnellwahl-Regionen', () => {
  it('jeder Punkt liegt in seiner eigenen Region', () => {
    for (const r of QUICK_REGIONS) {
      for (const p of r.points) expect(regionFor(p).id, `${p.label}`).toBe(r.id)
    }
  })
  it('höchstens acht Knöpfe je Region', () => {
    for (const r of QUICK_REGIONS) expect(r.points.length).toBeLessThanOrEqual(8)
  })
  it('ohne Ort oder irgendwo sonst: Österreich', () => {
    expect(regionFor(null).id).toBe('at')
    expect(regionFor({ lat: 40.7, lon: -74 }).id).toBe('at')
  })
})
