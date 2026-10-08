import { describe, expect, it } from 'vitest'
import { computeSounding } from '../lib/sounding'
import { distanceKm, formatTerm, nearestSonde, sondeColumn, type SondeData, type SondeStation } from './sondes'
// @ts-expect-error — reines Node-ESM ohne Typen, der Parser wird hier mitgeprüft
import { parseUwyoCsv } from '../../scripts/sonde-ingest.mjs'

const station = (id: string, lat: number, lon: number, n = 1): SondeStation => ({
  id,
  name: id,
  country: 'AT',
  lat,
  lon,
  elev: 0,
  soundings: Array.from({ length: n }, (_, i) => ({
    term: `2026-10-0${2 - i}T12:00:00.000Z`,
    launch: '',
    top: 100,
    file: '',
  })),
})

describe('sondeColumn', () => {
  const data: SondeData = {
    id: 'x',
    term: '',
    launch: '',
    lat: 0,
    lon: 0,
    p: [1000, 950, 900, 850, 300],
    z: [100, 540, 990, 1460, 9200],
    T: [20, 16, 12, 9, -40],
    Td: [12, 10, 6, 0, null],
    dir: [270, 270, null, 180, 0],
    spd: [5, 10, 10, 10, 30],
  }

  it('lässt Punkte ohne Taupunkt weg, Boden zuerst', () => {
    const col = sondeColumn(data)!
    expect(col.p).toEqual([1000, 950, 900, 850])
  })

  it('rechnet die Herkunftsrichtung in u/v um (Westwind → u > 0)', () => {
    const col = sondeColumn(data)!
    expect(col.u[0]).toBeCloseTo(5)
    expect(col.v[0]).toBeCloseTo(0)
    // Südwind weht nach Norden
    expect(col.v[3]).toBeCloseTo(10)
    expect(col.u[2]).toBeNull()
  })

  it('läuft durch dieselbe Kennzahlenrechnung wie ein Modellprofil', () => {
    const s = computeSounding(sondeColumn(data)!)
    expect(s.pwat).toBeGreaterThan(0)
  })
})

describe('nearestSonde', () => {
  const list = [station('wien', 48.25, 16.36), station('muc', 48.24, 11.55), station('leer', 47, 13, 0)]
  it('nimmt die nächste Station mit Aufstieg', () => {
    const r = nearestSonde(list, { lat: 47.8, lon: 13.04 })!
    expect(r.station.id).toBe('muc')
    expect(r.km).toBeGreaterThan(100)
  })
  it('Entfernung Salzburg–Wien ≈ 250 km', () => {
    expect(distanceKm({ lat: 47.8, lon: 13.04 }, { lat: 48.25, lon: 16.36 })).toBeCloseTo(251, -1)
  })
})

describe('formatTerm', () => {
  const now = Date.parse('2026-10-03T08:00:00Z')
  it('nennt den Tag', () => {
    expect(formatTerm('2026-10-03T00:00:00Z', now)).toBe('heute 00 UTC')
    expect(formatTerm('2026-10-02T12:00:00Z', now)).toBe('gestern 12 UTC')
    expect(formatTerm('2026-10-01T12:00:00Z', now)).toBe('01.10. 12 UTC')
  })
})

describe('parseUwyoCsv', () => {
  const head =
    'time,longitude,latitude,pressure_hPa,geopotential height_m,temperature_C,dew point temperature_C,ice point temperature_C,relative humidity_%,humidity wrt ice_%,mixing ratio_g/kg,wind direction_degree,wind speed_m/s'
  const row = (p: number, t: number, td: string, wd = '270', ws = '5.0') =>
    `2026-10-02 10:45:00, 11.55,48.24,${p},  500,${t},${td},,,,,${wd},${ws}`

  it('dünnt aus, verlangt streng fallenden Druck und hört bei 100 hPa auf', () => {
    const csv = [
      head,
      row(1000, 20, '10'),
      row(999.5, 20, '10'), // < 2 hPa gefallen → weg
      row(998, 19.8, '10'),
      row(999, 19.9, '10'), // Ballon pendelt zurück → weg
      row(990, 19, '9'),
      row(500, -10, ''), // fehlender Taupunkt bleibt als null
      row(400, -20, '-30'),
      row(250, -45, '-55'),
      row(99, -60, '-70'), // über der Achse
    ].join('\n')
    const d = parseUwyoCsv(csv)
    expect(d.p).toEqual([1000, 998, 990, 500, 400, 250])
    expect(d.Td[3]).toBeNull()
    expect(d.launch).toBe('2026-10-02T10:45:00.000Z')
  })

  it('lehnt die Fehlermeldung von UWyo ab', () => {
    expect(parseUwyoCsv('Unable to retrieve the data for 11120 at 2026-10-02 12:00:00.')).toBeNull()
  })
})
