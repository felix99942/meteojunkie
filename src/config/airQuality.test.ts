import { describe, expect, it } from 'vitest'
import {
  AIR_VARIABLES,
  currentIndex,
  dataEnd,
  dominantPollutant,
  EAQI_BANDS,
  EAQI_PARTS,
  eaqiBand,
  parseAirQuality,
} from './airQuality'

describe('eaqiBand', () => {
  it('ordnet die Grenzen der unteren Stufe zu (0–20 gut, 20–40 ausreichend …)', () => {
    expect(eaqiBand(0).label).toBe('gut')
    expect(eaqiBand(20).label).toBe('gut')
    expect(eaqiBand(20.5).label).toBe('ausreichend')
    expect(eaqiBand(60).label).toBe('mäßig')
    expect(eaqiBand(100).label).toBe('sehr schlecht')
    expect(eaqiBand(180).label).toBe('extrem schlecht')
  })
  it('Stufen steigen streng an und die letzte ist offen', () => {
    const tops = EAQI_BANDS.map((b) => b.upTo)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(tops[tops.length - 1]).toBe(Infinity)
  })
})

describe('parseAirQuality', () => {
  const body = {
    hourly: {
      time: [0, 3600, 7200],
      european_aqi: [30, 45, null],
      pm2_5: [5, 9, null],
    },
  }
  it('rechnet unixtime in ms um und füllt fehlende Größen mit null', () => {
    const d = parseAirQuality(body, 'cams_europe')
    expect(d.times).toEqual([0, 3_600_000, 7_200_000])
    expect(d.values.european_aqi).toEqual([30, 45, null])
    expect(d.values.ozone).toEqual([null, null, null])
    for (const v of AIR_VARIABLES) expect(d.values[v]).toHaveLength(3)
  })
  it('die Achse endet am letzten Wert, nicht am angefragten Zeitraum (null-Ende der API)', () => {
    expect(dataEnd(parseAirQuality(body, 'cams_europe'))).toBe(3_600_000)
    expect(dataEnd(parseAirQuality({ hourly: { time: [0] } }, 'cams_europe'))).toBeNull()
  })
})

describe('currentIndex', () => {
  it('findet die laufende Stunde, außerhalb des Rasters null', () => {
    const times = [0, 3_600_000, 7_200_000]
    expect(currentIndex(times, 3_600_000 + 59 * 60_000)).toBe(1)
    expect(currentIndex(times, 10 * 3_600_000)).toBeNull()
  })
})

describe('dominantPollutant', () => {
  it('nennt den Teilindex mit dem höchsten Wert', () => {
    const values: Record<string, (number | null)[]> = {}
    for (const v of AIR_VARIABLES) values[v] = [null]
    values.european_aqi_ozone = [48]
    values.european_aqi_pm2_5 = [31]
    const d = { domain: 'cams_europe' as const, times: [0], values }
    expect(dominantPollutant(d, 0)).toBe('Ozon')
  })
  it('ohne Teilindizes keine Angabe', () => {
    const values: Record<string, (number | null)[]> = {}
    for (const p of EAQI_PARTS) values[p.key] = [null]
    expect(dominantPollutant({ domain: 'cams_europe', times: [0], values }, 0)).toBeNull()
  })
})
