// Radar: Zeitdimension und Bildfolge. Beides ist reine String-/Zahlenarbeit —
// und beides hat eine Falle, die genau hier festgehalten wird: der Dienst
// antwortet auf eine Zeit ABSEITS des Rasters mit einer ServiceException statt
// mit einem Bild, die Zeiten dürfen also nicht geraten werden, und das Ende
// der Dimension ist NICHT der letzte Analysezeitpunkt, sondern das Ende der
// Verlagerungsrechnung, die dieser Bereich NICHT zeigt.

import { describe, expect, it } from 'vitest'
import {
  analysisTime,
  LIGHTNING_AGES,
  RADAR_IMAGE_WIDTH,
  RADAR_OVERLAYS,
  RADAR_PRODUCTS,
  RV_LEGEND,
  sourceImageWidth,
  WN_LEGEND,
  DEFAULT_RADAR_PRODUCT,
  nearestFrame,
  parseIsoDuration,
  parseRadarCapabilities,
  parseTimeExtent,
  radarTimes,
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

describe('radarTimes', () => {
  // Der Bereich zeigt NUR Gemessenes: die 2 Stunden Verlagerungsrechnung am
  // Ende der Zeitdimension werden abgeschnitten. Genau das ist die Stelle, an
  // der das passiert.
  it('endet am letzten ANALYSEbild, nicht am Ende der Zeitdimension', () => {
    const times = radarTimes(META, P, 60 * 60_000)
    expect(new Date(META.extent.end).toISOString()).toBe('2026-09-16T23:40:00.000Z')
    expect(new Date(analysisTime(META, P)).toISOString()).toBe('2026-09-16T21:40:00.000Z')
    expect(new Date(times[times.length - 1]).toISOString()).toBe('2026-09-16T21:40:00.000Z')
  })

  it('reicht genau den gewünschten Rückblick zurück', () => {
    const times = radarTimes(META, P, 60 * 60_000)
    expect(times).toHaveLength(13) // 12 Schritte à 5 min plus der neueste
    expect(new Date(times[0]).toISOString()).toBe('2026-09-16T20:40:00.000Z')
    const half = radarTimes(META, P, 30 * 60_000)
    expect(half).toHaveLength(7)
  })

  it('geht nie vor den Anfang der Dimension zurück', () => {
    const times = radarTimes(META, P, 999 * 60 * 60_000)
    expect(times[0]).toBe(META.extent.start)
  })

  // Jeder Zeitschritt muss auf dem Raster liegen — sonst antwortet der Dienst
  // mit einer ServiceException statt mit einem Bild.
  it('legt jeden Zeitschritt auf das 5-Minuten-Raster', () => {
    for (const t of radarTimes(META, P, 3 * 60 * 60_000)) {
      expect(t % 300_000).toBe(0)
    }
  })

  it('ist aufsteigend sortiert — das letzte Element ist der neueste Stand', () => {
    const times = radarTimes(META, P, 120 * 60_000)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(times[times.length - 1]).toBe(analysisTime(META, P))
  })
})

describe('nearestFrame', () => {
  // Hält den Zeiger beim Nachrücken auf SEINER Zeit, obwohl sich alle Indizes
  // verschieben (siehe RadarPanel).
  it('findet den Zeitschritt, der einer Zeit am nächsten liegt', () => {
    const times = radarTimes(META, P, 60 * 60_000)
    expect(nearestFrame(times, analysisTime(META, P))).toBe(12)
    expect(nearestFrame(times, times[0] - 10 * 60_000)).toBe(0)
    expect(nearestFrame(times, times[4] + 60_000)).toBe(4)
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
    expect(q.get('layers')).toBe('dwd:Radar_wn-product_1x1km_ger')
    expect(q.get('transparent')).toBe('true')
  })

  // PNG8 ist gemessen die halbe Größe bei gleicher Farbanzahl (Radar 44 statt
  // 93 KB, ein leeres Symbol-Overlay 1,1 statt 37,7 KB) — nicht auf
  // `image/png` zurückdrehen, das kostet bei 13 Bildern je Schleife.
  it('fordert die Palettenvariante PNG8 an', () => {
    expect(q.get('format')).toBe('image/png8')
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

describe('Produkt-Registry', () => {
  // Die Vorgabe ist die MESSGRÖSSE des Radars, nicht die daraus abgeleitete
  // Rate: mm/h setzt eine Z-R-Beziehung voraus, dBZ nicht.
  it('zeigt Reflektivität in dBZ als Vorgabe', () => {
    expect(DEFAULT_RADAR_PRODUCT.id).toBe('wn')
    expect(DEFAULT_RADAR_PRODUCT.unit).toBe('dBZ')
    expect(DEFAULT_RADAR_PRODUCT.legend).toBe(WN_LEGEND)
  })

  it('führt beide Produkte mit Vorhersageteil und 5-Minuten-Takt', () => {
    expect(RADAR_PRODUCTS.map((p) => p.id)).toEqual(['wn', 'rv'])
    for (const p of RADAR_PRODUCTS) {
      expect(p.stepMs, p.id).toBe(300_000)
      expect(p.forecastMs, p.id).toBe(7_200_000)
      expect(p.legend.length, p.id).toBeGreaterThan(10)
      // Die Maskendeckkraft steht im Produktstil und unterscheidet sich —
      // geraten werden darf sie nicht, die Nachbearbeitung färbt darauf um.
      expect(p.maskOpacity, p.id).toBeGreaterThan(0)
      expect(p.maskOpacity, p.id).toBeLessThan(1)
    }
    expect(RADAR_PRODUCTS[0].maskOpacity).toBe(0.5)
    expect(RADAR_PRODUCTS[1].maskOpacity).toBe(0.3)
  })

  it('hat in jeder Skala eindeutige Farben (React-Key und Legende)', () => {
    for (const legend of [WN_LEGEND, RV_LEGEND]) {
      const colors = legend.map((s) => s.color)
      expect(new Set(colors).size).toBe(colors.length)
      for (const s of legend) expect(s.color).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  // Die Maske ist KEIN Skalenschritt — sie markiert die Abdeckungsgrenze und
  // steht als eigene Zeile in der Legende.
  it('führt die Maskenfarbe nicht als Skalenschritt', () => {
    for (const legend of [WN_LEGEND, RV_LEGEND]) {
      expect(legend.map((s) => s.color)).not.toContain('#7D7D7D')
    }
  })
})

describe('Overlays', () => {
  it('sind alle vom DWD-WMS und ohne Vorhersageteil', () => {
    expect(RADAR_OVERLAYS.map((o) => o.id)).toEqual(['blitze', 'zellen', 'cluster', 'konrad'])
    for (const o of RADAR_OVERLAYS) {
      expect(o.layer, o.id).toMatch(/^dwd:/)
      expect(o.stepMs, o.id).toBe(300_000)
      // Die `fcst_*`-Layer bleiben draußen, wie die Radarvorhersage auch.
      expect(o.forecastMs, o.id).toBe(0)
      expect(o.layer, o.id).not.toMatch(/fcst/)
    }
  })

  // Die Randlinien-Regel darf NUR auf die Radarprodukte laufen: die
  // Blitzskala führt mit #DA28C6 eine Farbe, die ihr bis auf drei Einheiten
  // nahekommt. `maskOpacity: null` ist der Schalter dafür.
  it('sind von der Randlinien-Nachbearbeitung ausgenommen', () => {
    for (const o of RADAR_OVERLAYS) expect(o.maskOpacity, o.id).toBeNull()
  })

  // Der Vorgabestil der KONRAD-Zellen füllt sie DECKEND und verdeckt damit
  // das Radarecho — deshalb der Umriss-Stil, und deshalb zwei Layer in einem
  // Bild (Zellen plus bisherige Spuren).
  it('zeichnet die KONRAD-Zellen als Umriss samt Spur', () => {
    const k = RADAR_OVERLAYS.find((o) => o.id === 'konrad')!
    expect(k.layer.split(',')).toHaveLength(2)
    expect(k.style).toContain('unfilled_polygons_colored_border')
    expect(k.style!.split(',')).toHaveLength(2) // Stil je Layer, zweiter = Vorgabe
    expect(k.capsLayer).toBe('K3D_EVAL_current_cells')
  })

  it('fordert die Symbol-Overlays GRÖSSER und das Blitzraster KLEINER an', () => {
    // Kreise und Pfeile werden in Pixeln des BILDES gezeichnet; zu klein
    // angefordert stehen sie hochskaliert und unscharf auf der Karte.
    for (const id of ['zellen', 'cluster', 'konrad']) {
      const o = RADAR_OVERLAYS.find((x) => x.id === id)!
      expect(sourceImageWidth(o), id).toBeGreaterThan(RADAR_IMAGE_WIDTH)
    }
    // Die Blitzdichte dagegen wird bewusst grob geholt: gezeichnet werden
    // Kreuze je 10-km-Zelle, ein feineres Bild trägt keine Information.
    const blitze = RADAR_OVERLAYS.find((o) => o.id === 'blitze')!
    expect(sourceImageWidth(blitze)).toBeLessThan(RADAR_IMAGE_WIDTH / 2)
    expect(sourceImageWidth(DEFAULT_RADAR_PRODUCT)).toBe(RADAR_IMAGE_WIDTH)
  })

  // Die Farbe IST die Information: vier Stufen à 5 Minuten, jüngste zuerst.
  it('führt die Blitze als Kreuze mit Altersstufen', () => {
    const blitze = RADAR_OVERLAYS.find((o) => o.id === 'blitze')!
    expect(blitze.legend.kind).toBe('crosses')
    expect(blitze.legend.items).toBe(LIGHTNING_AGES)
    expect(LIGHTNING_AGES).toHaveLength(4)
    expect(LIGHTNING_AGES[0].label).toBe('0–5')
    expect(new Set(LIGHTNING_AGES.map((a) => a.color)).size).toBe(4)
  })

  it('schaltet Blitze und Zellen von vornherein ein', () => {
    const on = RADAR_OVERLAYS.filter((o) => o.defaultOn).map((o) => o.id)
    expect(on).toEqual(['blitze', 'zellen'])
  })
})
