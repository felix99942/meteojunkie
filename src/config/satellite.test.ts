// Tests des Satelliten-Kerns. Geprüft wird, was schiefgehen KANN, ohne dass
// man es dem Bild ansieht: die Projektion der Fläche, das Zeitraster und die
// GetMap-Parameter.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SATELLITE_PRODUCT,
  PREFETCH_RECENT,
  wantedTimes,
  SATELLITE_AREA,
  SATELLITE_DETAIL_AREA,
  SATELLITE_MERC,
  SATELLITE_PRODUCTS,
  getSatelliteProduct,
  magnificationZoom,
  parseSatelliteCapabilities,
  productArea,
  productImageSize,
  productMerc,
  resamplingSwitchZoom,
  satelliteCapabilitiesUrl,
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

  it('leitet die Bildhöhe aus dem Seitenverhältnis DER EIGENEN Fläche ab', () => {
    // Höhe und Breite eines Bildes gehören zu EINER Fläche. Seit es zwei gibt,
    // ist das die Stelle, an der ein Bild still verzerrt würde: der Dienst
    // rendert jedes Seitenverhältnis klaglos, und die Karte spannt es klaglos
    // über die richtigen Ecken — auffallen würde es erst an der Küstenlinie.
    for (const p of SATELLITE_PRODUCTS) {
      const merc = productMerc(p)
      const { width, height } = productImageSize(p)
      expect(height).toBe(
        Math.round((width * (merc.maxy - merc.miny)) / (merc.maxx - merc.minx)),
      )
    }
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

  // DAS IST DER KERN DER FLÄCHENTRENNUNG, und er ist gemessen (2026-09-21,
  // Blockstruktur des ausgelieferten Rasters über den Alpen — Tabelle im Kopf
  // von `satellite.ts`): je Produkt das native Abtastintervall in
  // Mercator-Metern. Der Abruf muss MINDESTENS so fein sein, sonst wirft er
  // Bildinhalt weg — und höchstens doppelt so fein, sonst zahlt er Bytes für
  // Pixel, in denen nichts steht.
  const NATIVE_MERC_M: Record<string, number> = {
    geocolour: 1577,
    vis06: 788,
    ir105: 1113,
    // MSG/SEVIRI, 3 km am Boden; über den Alpen keine Periodik unter 24 px
    // messbar, die Zahl ist deshalb gerechnet statt abgelesen.
    airmass: 4400,
    convection: 4400,
  }

  it('fordert jedes Produkt in seinem nativen Raster an', () => {
    for (const p of SATELLITE_PRODUCTS) {
      const native = NATIVE_MERC_M[p.id]
      expect(native).toBeDefined()
      const merc = productMerc(p)
      const { width } = productImageSize(p)
      const mPerPx = (merc.maxx - merc.minx) / width
      // kein Detailverlust …
      expect(mPerPx).toBeLessThanOrEqual(native * 1.01)
      // … und keine Bytes für nichts
      expect(mPerPx).toBeGreaterThan(native / 2.1)
    }
  })

  // Die engere Fläche haben genau die beiden HRFI-Kanäle: auf der Vollfläche
  // bräuchten sie 2500 bzw. 3200 px für dasselbe Raster, also rund das
  // Doppelte an Bytes je Bild.
  it('gibt die Detailfläche genau den beiden HRFI-Kanälen', () => {
    const detail = SATELLITE_PRODUCTS.filter((p) => productArea(p) === SATELLITE_DETAIL_AREA)
    expect(detail.map((p) => p.id)).toEqual(['vis06', 'ir105'])
    for (const p of SATELLITE_PRODUCTS) {
      if (detail.includes(p)) continue
      expect(productArea(p)).toBe(SATELLITE_AREA)
    }
  })

  // Die Detailfläche darf NICHT enger sein als die Sprungziele der
  // Werkzeugleiste (`FIXED_VIEWS` in `SatellitePanel`): ein Sprung auf einen
  // Ausschnitt, der über den Bildrand hinausreicht, zeigt leere Ränder und
  // sieht nach einem Ladefehler aus.
  it('umfasst in JEDER Produktfläche die Sprungziele der Leiste', () => {
    const views: [[number, number], [number, number]][] = [
      [[5.4, 45.8], [17.4, 55.3]], // D-A-CH
      [[5.8, 44.8], [17.2, 49.3]], // Alpen
    ]
    for (const p of SATELLITE_PRODUCTS) {
      const a = productArea(p)
      for (const [[w, s2], [e, n]] of views) {
        expect(w).toBeGreaterThanOrEqual(a.west)
        expect(e).toBeLessThanOrEqual(a.east)
        expect(s2).toBeGreaterThanOrEqual(a.south)
        expect(n).toBeLessThanOrEqual(a.north)
      }
    }
  })

  // Ab wann die Karte das Bild VERGRÖSSERT, ist eine Rechnung und kein
  // Gefühl — an ihr hängt, ob gestuft oder geglättet dargestellt wird.
  // Geprüft wird die Identität selbst: auf dieser Zoomstufe deckt sich ein
  // Bildpixel mit einem GERÄTEpixel.
  it('rechnet die 1:1-Zoomstufe je Produkt und Gerätedichte', () => {
    for (const p of SATELLITE_PRODUCTS) {
      const a = productArea(p)
      const { width } = productImageSize(p)
      for (const dpr of [1, 2, 3]) {
        const z = magnificationZoom(p, dpr)
        const devicePxOfImage = 512 * 2 ** z * ((a.east - a.west) / 360) * dpr
        expect(devicePxOfImage).toBeCloseTo(width, 6)
      }
      // Ein doppelt so dichter Schirm vergrössert eine ganze Stufe früher.
      expect(magnificationZoom(p, 2)).toBeCloseTo(magnificationZoom(p, 1) - 1, 10)
    }
  })

  // Ankerwert, damit die Formel nicht unbemerkt driftet: der sichtbare Kanal
  // ist mit 2000 px über 14° bei z ≈ 6,65 deckungsgleich, vor der
  // Flächentrennung (1600 px über 22°) war es z ≈ 5,68.
  it('hält den gemessenen Ankerwert des sichtbaren Kanals', () => {
    expect(magnificationZoom(getSatelliteProduct('vis06'))).toBeCloseTo(6.65, 2)
    expect(magnificationZoom(getSatelliteProduct('geocolour'))).toBeCloseTo(5.68, 2)
  })

  // Umgeschaltet wird eine Stufe FRÜHER als 1:1 (Begründung dort): bilinear
  // verwischt schon bei knapper Verkleinerung, Aliasing droht erst deutlich
  // darunter.
  it('schaltet eine Zoomstufe vor der 1:1-Grenze auf gestuft', () => {
    for (const p of SATELLITE_PRODUCTS) {
      expect(resamplingSwitchZoom(p, 2)).toBeCloseTo(magnificationZoom(p, 2) - 1, 10)
      expect(resamplingSwitchZoom(p)).toBeLessThan(magnificationZoom(p))
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

  // Seit es zwei Flächen gibt, ist die bbox produktabhängig — nimmt sie
  // jemand wieder aus einer Konstanten, wird das Bild über die falsche Fläche
  // gespannt und ALLES liegt verschoben, ohne dass etwas fehlschlägt.
  it('fordert jedes Produkt über seine EIGENE Fläche an', () => {
    for (const prod of SATELLITE_PRODUCTS) {
      const { width, height } = productImageSize(prod)
      const url = satelliteImageUrl(prod, { time: Date.parse('2026-09-18T22:20:00Z'), width, height })
      const bbox = (new URL(url).searchParams.get('bbox') ?? '').split(',').map(Number)
      const merc = productMerc(prod)
      expect(bbox[0]).toBeCloseTo(merc.minx, 0)
      expect(bbox[1]).toBeCloseTo(merc.miny, 0)
      expect(bbox[2]).toBeCloseTo(merc.maxx, 0)
      expect(bbox[3]).toBeCloseTo(merc.maxy, 0)
    }
    const vis = getSatelliteProduct('vis06')
    expect(productMerc(vis).minx).toBeGreaterThan(SATELLITE_MERC.minx)
  })

  it('setzt den Layernamen mit Workspace zusammen', () => {
    expect(satelliteLayer(p)).toBe('mtg_fd:rgb_geocolour')
  })
})

describe('wantedTimes', () => {
  // 24 Stunden sind bei MTG 145 Bilder à ~180 KB — vorladen scheidet aus.
  // Diese Funktion entscheidet, was stattdessen geholt wird.
  const times = Array.from({ length: 145 }, (_, i) => i * 10 * MIN)
  const last = times.length - 1

  it('holt immer die jüngsten Bilder', () => {
    const w = wantedTimes(times, last, false)
    for (let i = times.length - PREFETCH_RECENT; i < times.length; i++) {
      expect(w).toContain(times[i])
    }
  })

  // Der Fehler, den es beim Aufbau gab: ohne diese Regel lud der Bereich ein
  // Fenster um Index 0 — den Stand von vor 24 Stunden, den in dem Moment
  // niemand sehen will.
  it('holt vor dem ersten Zeigerstand NUR die jüngsten', () => {
    const w = wantedTimes(times, -1, false)
    expect(w).toHaveLength(PREFETCH_RECENT)
    expect(w).not.toContain(times[0])
  })

  it('holt ein Fenster um den Zeiger', () => {
    const w = wantedTimes(times, 40, false)
    expect(w).toContain(times[40])
    expect(w).toContain(times[38])
    expect(w).not.toContain(times[20])
  })

  // Beim Abspielen zählt der Vorlauf: sonst bleibt die Schleife bei jedem
  // Bild stehen und wartet.
  it('schaut beim Abspielen weiter voraus als beim Ziehen', () => {
    const still = wantedTimes(times, 40, false).length
    const playing = wantedTimes(times, 40, true).length
    expect(playing).toBeGreaterThan(still)
  })

  it('bleibt innerhalb der Reihe und ohne Doppelte', () => {
    for (const idx of [0, 1, 72, last]) {
      const w = wantedTimes(times, idx, true)
      expect(new Set(w).size).toBe(w.length)
      for (const t of w) expect(times).toContain(t)
    }
  })

  it('liefert für eine leere Reihe nichts', () => {
    expect(wantedTimes([], 0, false)).toEqual([])
  })
})
