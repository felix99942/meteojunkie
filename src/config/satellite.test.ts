// Tests des Satelliten-Kerns. Geprüft wird, was schiefgehen KANN, ohne dass
// man es dem Bild ansieht: die Projektion der Fläche, das Zeitraster und die
// GetMap-Parameter.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SATELLITE_PRODUCT,
  SATELLITE_IMAGE_WIDTH,
  productImageWidth,
  SATELLITE_AREA,
  SATELLITE_MERC,
  SATELLITE_PRODUCTS,
  getSatelliteProduct,
  parseSatelliteCapabilities,
  satelliteCapabilitiesUrl,
  satelliteImageHeight,
  satelliteImageUrl,
  satelliteLayer,
  satelliteTimes,
} from './satellite'
import { toMercator } from './wmsTime'

const MIN = 60_000

describe('Fläche', () => {
  // Die Fläche wird NICHT vom Dienst gelesen, sondern hier gesetzt und selbst
  // projiziert — ein Rechenfehler verschöbe das Bild gegen die Grenzen, ohne
  // dass es nach einem Fehler aussähe. Werte gegen die Referenzrechnung.
  it('projiziert die Ecken nach EPSG:3857', () => {
    expect(SATELLITE_MERC.minx).toBeCloseTo(0, 0)
    expect(SATELLITE_MERC.miny).toBeCloseTo(5_012_342, -1)
    expect(SATELLITE_MERC.maxx).toBeCloseTo(2_449_029, -1)
    expect(SATELLITE_MERC.maxy).toBeCloseTo(7_558_416, -1)
  })

  it('Mercator ist nach Norden gedehnt — sonst stimmt das Seitenverhältnis nicht', () => {
    const south = toMercator(0, 41).y
    const mid = toMercator(0, 48.5).y
    const north = toMercator(0, 56).y
    expect(north - mid).toBeGreaterThan(mid - south)
  })

  it('leitet die Bildhöhe aus dem Seitenverhältnis ab', () => {
    const w = 1100
    const expected = Math.round(
      (w * (SATELLITE_MERC.maxy - SATELLITE_MERC.miny)) /
        (SATELLITE_MERC.maxx - SATELLITE_MERC.minx),
    )
    expect(satelliteImageHeight(w)).toBe(expected)
  })

  it('umfasst D-A-CH mit Anlauf', () => {
    for (const [lon, lat] of [
      [13.4, 52.5], // Berlin
      [16.4, 48.2], // Wien
      [8.5, 47.4], // Zürich
      [11.4, 47.3], // Innsbruck
    ]) {
      expect(lon).toBeGreaterThan(SATELLITE_AREA.west)
      expect(lon).toBeLessThan(SATELLITE_AREA.east)
      expect(lat).toBeGreaterThan(SATELLITE_AREA.south)
      expect(lat).toBeLessThan(SATELLITE_AREA.north)
    }
  })
})

describe('Registry', () => {
  it('Voreinstellung ist Geocolour — das einzige Produkt für Tag UND Nacht', () => {
    expect(DEFAULT_SATELLITE_PRODUCT.id).toBe('geocolour')
  })

  it('IDs sind eindeutig', () => {
    const ids = SATELLITE_PRODUCTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('unbekannte ID fällt auf die Voreinstellung zurück', () => {
    expect(getSatelliteProduct('gibtsnicht').id).toBe(DEFAULT_SATELLITE_PRODUCT.id)
  })

  // Der hochaufgelöste sichtbare Kanal ist der Grund, warum es überhaupt eine
  // produkteigene Breite gibt: mit der Vorgabe (1,5 km/px) landete sein
  // Vorteil unter dem Zielraster. Ein Test hält beides fest — dass er sie hat
  // und dass sonst niemand sie braucht.
  it('fordert nur den hochaufgelösten Kanal breiter an', () => {
    const vis = getSatelliteProduct('vis06')
    expect(vis.imageWidth).toBe(1600)
    expect(productImageWidth(vis)).toBe(1600)
    for (const p of SATELLITE_PRODUCTS) {
      if (p.id === 'vis06') continue
      expect(productImageWidth(p)).toBe(SATELLITE_IMAGE_WIDTH)
    }
  })

  // `dayOnly` steuert den Hinweis in der Legende. Ein schwarzes Nachtbild
  // sieht nach einem Fehler aus; genau ein Produkt darf so aussehen.
  it('markiert genau den sichtbaren Kanal als Tagesprodukt', () => {
    expect(SATELLITE_PRODUCTS.filter((p) => p.dayOnly).map((p) => p.id)).toEqual(['vis06'])
  })

  // Die Takte sind gemessen (2026-09-19): MTG 10 min, MSG 15 min. Sie stehen
  // hier nur als Rückfall — trotzdem dürfen sie nicht falsch sein, sonst hat
  // ein Dienstausfall ein falsches Raster zur Folge.
  it('führt je Mission den gemessenen Takt', () => {
    for (const p of SATELLITE_PRODUCTS) {
      expect(p.stepMs).toBe((p.mission === 'MTG' ? 10 : 15) * MIN)
    }
  })
})

describe('parseSatelliteCapabilities', () => {
  const xml = (dim: string) =>
    `<Layer><Dimension name="time" default="2026-09-18T22:20:00Z" units="ISO8601" nearestValue="1">${dim}</Dimension></Layer>`

  it('liest Anfang, Ende und Schrittweite', () => {
    const e = parseSatelliteCapabilities(
      xml('2024-09-23T00:00:00.000Z/2026-09-18T22:20:00.000Z/PT10M'),
      DEFAULT_SATELLITE_PRODUCT,
    )
    expect(e).not.toBeNull()
    expect(e!.stepMs).toBe(10 * MIN)
    expect(e!.end).toBe(Date.parse('2026-09-18T22:20:00.000Z'))
  })

  it('ohne Zeitdimension gibt es keine Bilder', () => {
    expect(parseSatelliteCapabilities('<Layer/>', DEFAULT_SATELLITE_PRODUCT)).toBeNull()
  })
})

describe('satelliteTimes', () => {
  const end = Date.parse('2026-09-18T22:20:00.000Z')
  const extent = { start: end - 48 * 3_600_000, end, stepMs: 10 * MIN }

  it('geht vom Ende der Dimension zurück, aufsteigend sortiert', () => {
    const t = satelliteTimes(extent, 60 * MIN)
    expect(t).toHaveLength(7)
    expect(t[t.length - 1]).toBe(end)
    expect(t[0]).toBe(end - 60 * MIN)
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })

  // Anders als beim Radar gibt es KEINEN Vorhersageteil abzuschneiden — das
  // Ende der Dimension IST der neueste Stand.
  it('schneidet am Ende nichts ab', () => {
    expect(satelliteTimes(extent, 30 * MIN).at(-1)).toBe(extent.end)
  })

  it('reicht nie vor den Anfang der Dimension', () => {
    const kurz = { start: end - 20 * MIN, end, stepMs: 10 * MIN }
    expect(satelliteTimes(kurz, 6 * 3_600_000)).toEqual([end - 20 * MIN, end - 10 * MIN, end])
  })
})

describe('URLs', () => {
  const p = DEFAULT_SATELLITE_PRODUCT

  it('holt die Zeitschritte vom LAYER-eigenen WMS, nicht vom ganzen Dienst', () => {
    // 6,5 KB statt 282 KB — derselbe Trick wie beim Radar.
    expect(satelliteCapabilitiesUrl(p)).toContain('/geoserver/mtg_fd/rgb_geocolour/wms')
    expect(satelliteCapabilitiesUrl(p)).toContain('request=GetCapabilities')
  })

  it('fordert das Bild in EPSG:3857 über die feste Fläche an', () => {
    const url = satelliteImageUrl(p, { time: Date.parse('2026-09-18T22:20:00Z'), width: 1100, height: 1144 })
    const q = new URL(url).searchParams
    expect(q.get('crs')).toBe('EPSG:3857')
    expect(q.get('layers')).toBe('mtg_fd:rgb_geocolour')
    expect(q.get('format')).toBe('image/jpeg')
    // Der Zeitstempel muss AUF dem Raster des Dienstes liegen: EUMETView
    // antwortet auf eine Zeit dazwischen mit dem nächstgelegenen Bild, ohne
    // es zu sagen (`nearestValue="1"`, gemessen).
    expect(q.get('time')).toBe('2026-09-18T22:20:00Z')
    const bbox = (q.get('bbox') ?? '').split(',').map(Number)
    expect(bbox[0]).toBeCloseTo(SATELLITE_MERC.minx, 0)
    expect(bbox[3]).toBeCloseTo(SATELLITE_MERC.maxy, 0)
  })

  it('setzt den Layernamen mit Workspace zusammen', () => {
    expect(satelliteLayer(p)).toBe('mtg_fd:rgb_geocolour')
  })
})
