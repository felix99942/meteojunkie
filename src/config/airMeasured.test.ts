import { describe, expect, it } from 'vitest'
import {
  distanceKm,
  measuredFor,
  stationKind,
  viennaOffsetMs,
  viennaWallToUtc,
  type AirStation,
  type MeasuredRow,
} from './airMeasured'

const H = 3_600_000

describe('Wiener Ortszeit → UTC', () => {
  it('Sommerzeit: 16:00 Wandzeit am 18.10.2026 ist 14:00 UTC (gegen Oberösterreich gemessen)', () => {
    expect(viennaWallToUtc(Date.UTC(2026, 9, 18, 16))).toBe(Date.UTC(2026, 9, 18, 14))
  })
  it('Winterzeit: 16:00 Wandzeit am 18.12.2026 ist 15:00 UTC', () => {
    expect(viennaWallToUtc(Date.UTC(2026, 11, 18, 16))).toBe(Date.UTC(2026, 11, 18, 15))
  })
  it('Versatz +2 h im Sommer, +1 h im Winter', () => {
    expect(viennaOffsetMs(Date.UTC(2026, 6, 1, 12))).toBe(2 * H)
    expect(viennaOffsetMs(Date.UTC(2026, 0, 1, 12))).toBe(H)
  })
  it('über die Umstellung (25.10.2026, 03:00 → 02:00) bleibt die Folge streng steigend', () => {
    const before = viennaWallToUtc(Date.UTC(2026, 9, 25, 1))
    const after = viennaWallToUtc(Date.UTC(2026, 9, 25, 4))
    expect(after - before).toBe(4 * H)
  })
})

describe('distanceKm', () => {
  it('Linz – Wien ≈ 155 km', () => {
    expect(distanceKm(48.306, 14.286, 48.208, 16.373)).toBeGreaterThan(150)
    expect(distanceKm(48.306, 14.286, 48.208, 16.373)).toBeLessThan(160)
  })
})

const st = (id: string, p: number, lat: number, lon: number, type = 'background', area = 'urban'): AirStation => ({
  id,
  p,
  name: id,
  lat,
  lon,
  alt: 300,
  type,
  area,
})
const rowsFor = (sp: string, n: number): MeasuredRow[] => Array.from({ length: n }, (_, i) => ({ sp, t: i * H, v: 10 + i }))

describe('measuredFor', () => {
  it('nimmt die nächste HINTERGRUNDstation, auch wenn eine Verkehrsstation näher liegt', () => {
    const stations = [st('verkehr', 8, 48.0, 13.0, 'traffic'), st('hinter', 8, 48.05, 13.0)]
    const rows = [...rowsFor('verkehr', 5), ...rowsFor('hinter', 5)]
    expect(measuredFor(8, 48.0, 13.0, stations, rows)?.station.id).toBe('hinter')
  })
  it('ohne Hintergrundstation im Umkreis die nächste andere', () => {
    const stations = [st('verkehr', 8, 48.0, 13.0, 'traffic')]
    expect(measuredFor(8, 48.0, 13.0, stations, rowsFor('verkehr', 3))?.station.id).toBe('verkehr')
  })
  it('weiter als 15 km: keine Messung', () => {
    const stations = [st('weit', 8, 48.3, 13.0)]
    expect(measuredFor(8, 48.0, 13.0, stations, rowsFor('weit', 3))).toBeNull()
  })
  it('Messpunkte ohne Werte zählen nicht, und bei zwei Geräten am selben Ort gewinnt das vollere', () => {
    const stations = [st('leer', 6001, 48.0, 13.0), st('a', 6001, 48.01, 13.0), st('b', 6001, 48.01, 13.0)]
    const rows = [...rowsFor('a', 2), ...rowsFor('b', 6)]
    expect(measuredFor(6001, 48.0, 13.0, stations, rows)?.station.id).toBe('b')
  })
  it('nur der gefragte Stoff', () => {
    const stations = [st('ozon', 7, 48.0, 13.0)]
    expect(measuredFor(8, 48.0, 13.0, stations, rowsFor('ozon', 3))).toBeNull()
  })
})

describe('stationKind', () => {
  it('Klartext aus Typ und Lage', () => {
    expect(stationKind(st('x', 8, 0, 0, 'traffic', 'urban'))).toBe('verkehrsnah, städtisch')
    expect(stationKind(st('x', 8, 0, 0, 'background', 'rural-regional'))).toBe('Hintergrund, ländlich')
  })
})
