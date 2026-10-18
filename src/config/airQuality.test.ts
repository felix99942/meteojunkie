import { describe, expect, it } from 'vitest'
import {
  AIR_VARIABLES,
  currentIndex,
  dataEnd,
  dominantPollutant,
  eaqiAxisTop,
  EAQI_BANDS,
  EAQI_PARTS,
  eaqiBand,
  parseAirQuality,
  rollingMean,
  WHO_GUIDELINES,
  concBand,
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

describe('eaqiAxisTop', () => {
  it('endet auf der nächsten Stufengrenze über dem Höchstwert', () => {
    expect(eaqiAxisTop([12, 18])).toBe(20)
    expect(eaqiAxisTop([25, 38.5])).toBe(40)
    expect(eaqiAxisTop([30, 61])).toBe(80)
  })
  it('ein Wert genau auf der Grenze bekommt Luft bis zur nächsten', () => {
    expect(eaqiAxisTop([40])).toBe(60)
  })
  it('ohne Werte die unterste Stufe', () => {
    expect(eaqiAxisTop([null, null])).toBe(20)
  })
})

describe('rollingMean', () => {
  it('mittelt nachlaufend über das Fenster', () => {
    expect(rollingMean([1, 2, 3, 4, 5], 2)).toEqual([null, 1.5, 2.5, 3.5, 4.5])
  })
  it('erst ab vollem Fensterumfang, und nur mit drei Vierteln belegter Stunden', () => {
    const v = [8, 8, 8, null, 8, 8, null, null, 8, 8]
    const m = rollingMean(v, 4)
    expect(m.slice(0, 3)).toEqual([null, null, null])
    expect(m[3]).toBe(8) // 3 von 4 belegt
    expect(m[7]).toBeNull() // 2 von 4 belegt
  })
  it('die Lücke fällt aus dem Fenster wieder heraus', () => {
    expect(rollingMean([null, 2, 2, 2, 2], 4)[4]).toBe(2)
  })
})

describe('WHO_GUIDELINES', () => {
  it('Kurzzeit-Richtwerte 2021 mit ihrem Mittelungszeitraum', () => {
    expect(WHO_GUIDELINES.pm2_5).toEqual({ value: 15, hours: 24 })
    expect(WHO_GUIDELINES.pm10).toEqual({ value: 45, hours: 24 })
    expect(WHO_GUIDELINES.nitrogen_dioxide).toEqual({ value: 25, hours: 24 })
    expect(WHO_GUIDELINES.ozone).toEqual({ value: 100, hours: 8 })
  })
})

describe('concBand', () => {
  it('ordnet Konzentrationen den EAQI-Stufen zu (neue EEA-Einteilung, gemessen)', () => {
    expect(concBand('nitrogen_dioxide', 9.4).label).toBe('gut')
    expect(concBand('nitrogen_dioxide', 25).label).toBe('ausreichend')
    expect(concBand('nitrogen_dioxide', 25.1).label).toBe('mäßig')
    expect(concBand('ozone', 61).label).toBe('ausreichend')
    expect(concBand('ozone', 130).label).toBe('schlecht')
    expect(concBand('ozone', 500).label).toBe('extrem schlecht')
  })
  it('die Grenze zu „mäßig" ist der WHO-Richtwert', () => {
    expect(concBand('nitrogen_dioxide', WHO_GUIDELINES.nitrogen_dioxide.value).label).toBe('ausreichend')
    expect(concBand('ozone', WHO_GUIDELINES.ozone.value).label).toBe('ausreichend')
    expect(concBand('ozone', WHO_GUIDELINES.ozone.value + 0.1).label).toBe('mäßig')
  })
})
