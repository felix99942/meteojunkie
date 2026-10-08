import { describe, expect, it } from 'vitest'
import { timeOfUrl } from './imageStore'

describe('Bildablage', () => {
  it('liest den Termin aus der WMS-URL — danach wird aufgeräumt', () => {
    const u = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?layers=X&time=2026-10-08T05%3A00%3A00Z&width=10'
    expect(timeOfUrl(u)).toBe(Date.parse('2026-10-08T05:00:00Z'))
    expect(Number.isNaN(timeOfUrl('https://example.org/x.png'))).toBe(true)
  })
})
