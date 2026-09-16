// Radar: Zeitdimension und Bildfolge. Beides ist reine String-/Zahlenarbeit —
// und beides hat eine Falle, die genau hier festgehalten wird: der Dienst
// antwortet auf eine Zeit ABSEITS des Rasters mit einer ServiceException statt
// mit einem Bild, die Zeiten dürfen also nicht geraten werden, und das Ende
// der Dimension ist NICHT der letzte Analysezeitpunkt, sondern das Ende des
// Nowcasts.

import { describe, expect, it } from 'vitest'
import {
  analysisTime,
  DEFAULT_RADAR_PRODUCT,
  nearestFrame,
  parseIsoDuration,
  parseRadarCapabilities,
  parseTimeExtent,
  radarFrames,
  radarImageCoordinates,
  radarImageHeight,
  radarImageUrl,
  type RadarMeta,
} from './radar'

const P = DEFAULT_RADAR_PRODUCT

/** Ausschnitt einer echten Antwort (maps.dwd.de, 2026-09-16). */
const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0">
 <Layer queryable="1">
  <Name>Radar_rv_product_1x1km_ger</Name>
  <Title>Deutsches Radarkomposit Analyse und Vorhersage (RV)</Title>
  <EX_GeographicBoundingBox>
   <westBoundLongitude>1.4656230211257935</westBoundLongitude>
   <eastBoundLongitude>18.71379280090332</eastBoundLongitude>
   <southBoundLatitude>45.68555450439453</southBoundLatitude>
   <northBoundLatitude>56.21059036254883</northBoundLatitude>
  </EX_GeographicBoundingBox>
  <BoundingBox CRS="EPSG:4326" minx="45.685" miny="1.465" maxx="56.210" maxy="18.713"/>
  <BoundingBox CRS="EPSG:3857" minx="163152.40840662256" miny="5730101.503917769" maxx="2083209.8854073866" maxy="7600452.973715202"/>
  <Dimension name="time" default="current" units="ISO8601">2026-09-13T00:00:00.000Z/2026-09-16T23:40:00.000Z/PT5M</Dimension>
 </Layer>
</WMS_Capabilities>`

const META = parseRadarCapabilities(CAPS) as RadarMeta

describe('parseIsoDuration', () => {
  it('liest die Formen, die dieser Dienst schickt', () => {
    expect(parseIsoDuration('PT5M')).toBe(300_000)
    expect(parseIsoDuration('PT10M')).toBe(600_000)
    expect(parseIsoDuration('PT1H')).toBe(3_600_000)
    expect(parseIsoDuration('P1D')).toBe(86_400_000)
  })

  it('gibt null statt 0 zurück, wenn nichts Brauchbares drinsteht', () => {
    expect(parseIsoDuration('P')).toBeNull()
    expect(parseIsoDuration('5M')).toBeNull()
    expect(parseIsoDuration('')).toBeNull()
  })
})

describe('parseTimeExtent', () => {
  it('liest Anfang/Ende/Schritt', () => {
    const e = parseTimeExtent('2026-09-13T00:00:00.000Z/2026-09-16T23:40:00.000Z/PT5M')
    expect(e).not.toBeNull()
    expect(new Date(e!.end).toISOString()).toBe('2026-09-16T23:40:00.000Z')
    expect(e!.stepMs).toBe(300_000)
  })

  // Der Standard erlaubt mehrere Intervalle; interessant ist immer das letzte,
  // weil dort die aktuellen Zeitschritte stehen.
  it('nimmt bei mehreren Intervallen das letzte', () => {
    const e = parseTimeExtent(
      '2026-09-01T00:00:00Z/2026-09-02T00:00:00Z/PT1H,2026-09-13T00:00:00Z/2026-09-16T23:40:00Z/PT5M',
    )
    expect(e!.stepMs).toBe(300_000)
    expect(new Date(e!.start).toISOString()).toBe('2026-09-13T00:00:00.000Z')
  })

  it('verweigert Unsinn statt zu raten', () => {
    expect(parseTimeExtent('')).toBeNull()
    expect(parseTimeExtent('2026-09-13T00:00:00Z/PT5M')).toBeNull()
    expect(parseTimeExtent('2026-09-16T23:40:00Z/2026-09-13T00:00:00Z/PT5M')).toBeNull()
  })
})

describe('parseRadarCapabilities', () => {
  it('liest Zeitdimension UND beide Flächenangaben', () => {
    expect(META.geo.west).toBeCloseTo(1.4656, 4)
    expect(META.geo.north).toBeCloseTo(56.2106, 4)
    expect(META.merc.minx).toBeCloseTo(163152.4, 1)
    expect(META.merc.maxy).toBeCloseTo(7600453, 0)
    expect(META.extent.stepMs).toBe(300_000)
  })

  it('gibt null zurück, wenn die Zeitdimension fehlt', () => {
    expect(parseRadarCapabilities('<WMS_Capabilities/>')).toBeNull()
  })

  // Die EPSG:3857-BBox ist Pflicht: das Bild wird in Web-Mercator angefordert,
  // damit MapLibres lineare image-Source-Abbildung exakt stimmt. Ohne sie
  // dürfen wir NICHT auf EPSG:4326 zurückfallen — das wäre eine stille
  // Verschiebung der Echos um Kilometer.
  it('gibt null zurück, wenn die Mercator-BBox fehlt', () => {
    const without = CAPS.replace(/<BoundingBox CRS="EPSG:3857"[^>]*\/>/, '')
    expect(parseRadarCapabilities(without)).toBeNull()
  })
})

describe('radarFrames', () => {
  it('endet am Ende des Nowcasts und trennt Analyse von Vorhersage', () => {
    const frames = radarFrames(META, P, 60 * 60_000, true)
    // 60 min Rückblick (12 Schritte) + jetzt + 120 min Nowcast (24 Schritte)
    expect(frames).toHaveLength(37)
    const analysis = analysisTime(META, P)
    expect(new Date(analysis).toISOString()).toBe('2026-09-16T21:40:00.000Z')
    expect(frames.filter((f) => !f.forecast)).toHaveLength(13)
    expect(frames.filter((f) => f.forecast)).toHaveLength(24)
    expect(new Date(frames[0].time).toISOString()).toBe('2026-09-16T20:40:00.000Z')
    expect(new Date(frames[frames.length - 1].time).toISOString()).toBe('2026-09-16T23:40:00.000Z')
  })

  it('hört ohne Nowcast beim letzten Analysebild auf', () => {
    const frames = radarFrames(META, P, 30 * 60_000, false)
    expect(frames).toHaveLength(7)
    expect(frames.every((f) => !f.forecast)).toBe(true)
    expect(new Date(frames[frames.length - 1].time).toISOString()).toBe('2026-09-16T21:40:00.000Z')
  })

  it('geht nie vor den Anfang der Dimension zurück', () => {
    const frames = radarFrames(META, P, 999 * 60 * 60_000, false)
    expect(frames[0].time).toBe(META.extent.start)
  })

  // Jeder Zeitschritt muss auf dem Raster liegen — sonst antwortet der Dienst
  // mit einer ServiceException statt mit einem Bild.
  it('legt jeden Zeitschritt auf das 5-Minuten-Raster', () => {
    for (const f of radarFrames(META, P, 60 * 60_000, true)) {
      expect(f.time % 300_000).toBe(0)
    }
  })
})

describe('nearestFrame', () => {
  it('findet den Zeitschritt, der einer Zeit am nächsten liegt', () => {
    const frames = radarFrames(META, P, 60 * 60_000, true)
    expect(nearestFrame(frames, analysisTime(META, P))).toBe(12)
    expect(nearestFrame(frames, frames[0].time - 10 * 60_000)).toBe(0)
    expect(nearestFrame([], Date.now())).toBe(0)
  })
})

describe('radarImageUrl', () => {
  const url = radarImageUrl(P, META, { time: Date.parse('2026-09-16T21:40:00Z'), width: 1200, height: 1169 })
  const q = new URLSearchParams(url.split('?')[1])

  it('fordert Web-Mercator an, nicht lat/lon', () => {
    // Der Grund steht in config/radar.ts: MapLibre spannt eine image-Source
    // LINEAR im Mercator-Raum auf.
    expect(q.get('crs')).toBe('EPSG:3857')
    expect(q.get('bbox')).toBe('163152.40840662256,5730101.503917769,2083209.8854073866,7600452.973715202')
  })

  it('schickt die Zeit sekundengenau in UTC', () => {
    expect(q.get('time')).toBe('2026-09-16T21:40:00Z')
  })

  it('bleibt beim transparenten PNG des Produktstils', () => {
    expect(q.get('layers')).toBe('dwd:Radar_rv_product_1x1km_ger')
    expect(q.get('format')).toBe('image/png')
    expect(q.get('transparent')).toBe('true')
  })
})

describe('Bildgeometrie', () => {
  it('leitet die Höhe aus dem Seitenverhältnis der Mercator-Fläche ab', () => {
    // 1.920 km breit, 1.870 km hoch → nahe quadratisch
    expect(radarImageHeight(META, 1200)).toBe(1169)
  })

  it('gibt die Ecken im Uhrzeigersinn ab oben links', () => {
    const c = radarImageCoordinates(META)
    expect(c[0]).toEqual([META.geo.west, META.geo.north])
    expect(c[2]).toEqual([META.geo.east, META.geo.south])
  })
})
