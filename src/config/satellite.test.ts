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
  SATELLITE_GROUPS,
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
  sharpenLayer,
  sharpenPanTime,
  satelliteTimes,
} from './satellite'
import { toMercator } from './wmsTime'

const MIN = 60_000

describe('Fläche', () => {
  // Die Fläche wird NICHT vom Dienst gelesen, sondern hier gesetzt und selbst
  // projiziert — ein Rechenfehler verschöbe das Bild gegen die Grenzen, ohne
  // dass es nach einem Fehler aussähe. Werte gegen die Referenzrechnung.
  it('projiziert die Ecken nach EPSG:3857', () => {
    expect(SATELLITE_MERC.minx).toBeCloseTo(-3_130_861, -1)
    expect(SATELLITE_MERC.miny).toBeCloseTo(3_757_033, -1)
    expect(SATELLITE_MERC.maxx).toBeCloseTo(5_009_377, -1)
    expect(SATELLITE_MERC.maxy).toBeCloseTo(11_897_271, -1)
  })

  // In Mercator exakt quadratisch — das ist keine Zierde, sondern die
  // Kontrolle, ob das Kachelfenster noch stimmt (Zoomstufe 6, x 27…40,
  // y 13…26). Verschiebt jemand eine Kante, fällt es hier auf.
  it('ist in Mercator quadratisch', () => {
    const w = SATELLITE_MERC.maxx - SATELLITE_MERC.minx
    const h = SATELLITE_MERC.maxy - SATELLITE_MERC.miny
    expect(h / w).toBeCloseTo(1, 3)
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
    // Die übrigen FCI-RGBs liegen auf DEMSELBEN Raster wie Geocolour —
    // nachgemessen 2026-09-29 mit derselben Methode (Autokorrelation des
    // Spaltengradienten über den Alpen, Kontrollwerte 779/1558/1169 gegen die
    // dokumentierten 788/1577/1113). Wo die Messung ein Vielfaches traf
    // (Wolkenphase, Echtfarben: 3312 m = 2×1558) bzw. am 502 des Dienstes
    // scheiterte (Nebel), gilt derselbe Wert: es ist dieselbe Produktfamilie.
    fog: 1577,
    dust: 1577,
    cloudphase: 1577,
    cloudtype: 1577,
    snow: 1577,
    truecolour: 1577,
    // MSG/SEVIRI, 3 km am Boden; über den Alpen keine Periodik unter 24 px
    // messbar, die Zahl ist deshalb gerechnet statt abgelesen. Die Messung
    // schlägt hier reproduzierbar fehl — auch beim Kontrollwert `airmass`,
    // genau wie beim ersten Mal.
    airmass: 4400,
    convection: 4400,
    wv062: 4400,
    ash: 4400,
    naturalenh: 4400,
    hrv: 788,
    // Beim GESCHÄRFTEN Produkt (`hrv`) zählt das Raster des
    // SCHÄRFUNGSkanals — es bestimmt, wie fein das Ergebnis wird; die Farbe
    // wird bewusst bei ihren eigenen 1.558 m geholt (eigener Test).

  }

  /**
   * **Diese Regel hat sich mit der Europafläche UMGEDREHT, und das ist der
   * Punkt des Tests.**
   *
   * Früher galt: fordere jedes Produkt in SEINEM nativen Raster an — dafür
   * gab es die engere Detailfläche. Über ganz Europa ist das unmöglich:
   * HRFI nativ wären 8.000 px Bildbreite und mehrere MB je Zeitschritt. Was
   * bleibt, ist die eine Hälfte der alten Regel, die weiter gilt und weiter
   * Bytes spart: **niemals FEINER anfordern als die Quelle liefert.**
   *
   * Dazu die Vergröberung je Produkt als Zahl, damit ein Eingriff auffällt.
   */
  it('fordert nie feiner an als die Quelle liefert', () => {
    for (const p of SATELLITE_PRODUCTS) {
      const native = NATIVE_MERC_M[p.id]
      expect(native, p.id).toBeDefined()
      const merc = productMerc(p)
      const { width } = productImageSize(p)
      const mPerPx = (merc.maxx - merc.minx) / width
      expect(mPerPx, p.id).toBeGreaterThanOrEqual(native * 0.95)
    }
  })

  it('vergröbert je Mission um den erwarteten Faktor', () => {
    const factor = (id: string) => {
      const p = SATELLITE_PRODUCTS.find((x) => x.id === id)!
      const merc = productMerc(p)
      return (merc.maxx - merc.minx) / productImageSize(p).width / NATIVE_MERC_M[id]
    }
    // MSG-Kanäle sind mit 1800 px praktisch genau bedient …
    expect(factor('airmass')).toBeCloseTo(1.03, 1)
    expect(factor('wv062')).toBeCloseTo(1.03, 1)
    // … die FCI-RGBs liegen Faktor 2,6 darüber …
    expect(factor('geocolour')).toBeCloseTo(2.6, 1)
    // … und der hochaufgelöste sichtbare Kanal Faktor 5. Das ist der Preis
    // der Europafläche, ausdrücklich dokumentiert bei `SATELLITE_AREA`.
    expect(factor('vis06')).toBeCloseTo(5.2, 1)
  })

  // Genau EIN Produkt hat eine eigene Fläche — das geschärfte, und es kann
  // gar keine andere haben: dieselbe Schärfe über ganz Europa wäre ein Bild
  // von rund 10.400 px (Begründung bei `SATELLITE_DETAIL_AREA`). Alle
  // übrigen zeigen ganz Europa.
  it('gibt nur dem geschärften Produkt eine eigene Fläche', () => {
    const eigen = SATELLITE_PRODUCTS.filter((p) => p.area)
    expect(eigen.map((p) => p.id)).toEqual(['hrv'])
    expect(productArea(eigen[0])).toBe(SATELLITE_DETAIL_AREA)
    for (const p of SATELLITE_PRODUCTS) {
      if (p.area) continue
      expect(productArea(p), p.id).toBe(SATELLITE_AREA)
    }
  })

  // Die Fläche darf NICHT enger sein als die Sprungziele der Werkzeugleiste
  // (`FIXED_VIEWS` in `SatellitePanel`): ein Sprung auf einen Ausschnitt, der
  // über den Bildrand hinausreicht, zeigt leere Ränder — und seit der
  // Untergrund neben dem Bild weg ist, ist das schwarze Fläche.
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

  // Ankerwerte, damit die Formel nicht unbemerkt driftet. Über der
  // Europafläche (73,125°) sind das MTG-Produkt mit 2000 px und das
  // MSG-Produkt mit 1800 px bei diesen Stufen deckungsgleich. Zur
  // Geschichte: mit der Detailfläche (2000 px über 14°) lag der sichtbare
  // Kanal bei z ≈ 6,65, davor (1600 px über 22°) bei z ≈ 5,68 — die Zahl
  // sinkt, weil dieselbe Pixelzahl jetzt eine fünfmal breitere Fläche trägt.
  it('hält die Ankerwerte der beiden Missionsbreiten', () => {
    const z = (id: string) => magnificationZoom(getSatelliteProduct(id))
    expect(z('vis06')).toBeCloseTo(z('geocolour'), 10)
    expect(z('geocolour')).toBeCloseTo(4.27, 2)
    expect(z('airmass')).toBeCloseTo(4.11, 2)
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
  it('markiert die Tagesprodukte — und nur die', () => {
    // Gemessen (2026-09-29, je ein Bild um 12 und um 20 UTC über die
    // Standardfläche): diese sechs liefern nachts ein praktisch leeres Bild
    // (4–9 KB, Helligkeit 0–2), die übrigen tragen durch.
    expect(SATELLITE_PRODUCTS.filter((p) => p.dayOnly).map((p) => p.id)).toEqual([
      'vis06',
      'cloudphase',
      'cloudtype',
      'snow',
      'truecolour',
      'naturalenh',
      'hrv',
    ])
    // Gegenprobe: die IR-basierten RGBs und der Wasserdampfkanal sind es
    // NICHT — sie waren nachts genauso gefüllt wie tagsüber.
    for (const id of ['geocolour', 'ir105', 'fog', 'dust', 'airmass', 'convection', 'wv062', 'ash']) {
      expect(SATELLITE_PRODUCTS.find((p) => p.id === id)!.dayOnly, id).toBeUndefined()
    }
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
    // Zurzeit teilen sich alle Produkte die Europafläche — der Test oben
    // bleibt trotzdem der richtige: er prüft, dass die bbox aus
    // `productMerc` kommt und nicht aus einer Konstanten. Genau daran hinge
    // es, wenn wieder ein Produkt mit eigenem Ausschnitt dazukäme.
    expect(productMerc(getSatelliteProduct('vis06'))).toEqual(SATELLITE_MERC)
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

// ---------------------------------------------------------------------------
// Der erweiterte Katalog (2026-09-29). Alles hier ist live gemessen; die
// Tests halten fest, WAS gemessen wurde, damit eine spätere Änderung am
// Dienst auffällt statt still durchzulaufen.
// ---------------------------------------------------------------------------

describe('Katalog', () => {
  it('führt beide Missionen und gruppiert vollständig', () => {
    const inGroups = SATELLITE_GROUPS.flatMap((g) => g.items)
    // Keine Lücke und keine Dublette: jede Gruppe kommt aus derselben
    // Registry, und zusammen ergeben sie genau sie.
    expect(inGroups).toHaveLength(SATELLITE_PRODUCTS.length)
    expect(new Set(inGroups.map((p) => p.id)).size).toBe(SATELLITE_PRODUCTS.length)
    for (const g of SATELLITE_GROUPS) {
      for (const p of g.items) expect(p.mission, p.id).toBe(g.mission)
    }
  })

  // Die Vorgabe muss das Produkt bleiben, das rund um die Uhr trägt — sonst
  // öffnet der Bereich nachts schwarz.
  it('startet mit einem Produkt, das auch nachts trägt', () => {
    expect(DEFAULT_SATELLITE_PRODUCT.id).toBe('geocolour')
    expect(DEFAULT_SATELLITE_PRODUCT.dayOnly).toBeUndefined()
  })

  /**
   * Der Wasserdampfkanal ist ein GRAUSTUFENkanal und bekommt trotzdem KEINE
   * `cloudMask` — das ist kein Versehen: 6,2 µm sieht die obere Troposphäre
   * und erreicht den Boden nicht. Es gibt dort keinen wolkenfreien
   * Untergrund, den man darunter durchscheinen lassen könnte; die
   * Zusammensetzung würde eine Bodenansicht vortäuschen, die der Kanal nie
   * gemessen hat.
   */
  it('setzt die Wolken-über-Boden-Zusammensetzung nur bei den beiden HRFI-Kanälen', () => {
    expect(SATELLITE_PRODUCTS.filter((p) => p.cloudMask).map((p) => p.id)).toEqual([
      'vis06',
      'ir105',
    ])
    expect(SATELLITE_PRODUCTS.find((p) => p.id === 'wv062')!.cloudMask).toBeUndefined()
  })

  it('kennt je Produkt den richtigen Takt der Mission', () => {
    for (const p of SATELLITE_PRODUCTS) {
      expect(p.stepMs, p.id).toBe(p.mission === 'MTG' ? 600_000 : 900_000)
    }
  })

  // Alle Layer sind live geprüft; die Workspaces sind die beiden
  // geostationären Vollscheiben-Dienste. `msg_iodc` (Indischer Ozean),
  // `msg_rss` (Rapid Scan, nur Tagesprodukte) und die Polarumläufer
  // (`eps`, `copernicus`) sind bewusst draußen — Begründung in CLAUDE.md.
  it('holt nur von den beiden Vollscheiben-Diensten', () => {
    for (const p of SATELLITE_PRODUCTS) {
      expect(['mtg_fd', 'msg_fes'], p.id).toContain(p.workspace)
    }
  })
})

// ---------------------------------------------------------------------------
// PAN-SHARPENING. Natural Colour ist ein RGB aus drei 3-km-Kanälen und kann
// nicht feiner sein als sein gröbster; die Schärfe wird GERECHNET, aus einem
// zweiten Layer. Alles hier gemessen 2026-09-30.
// ---------------------------------------------------------------------------

describe('Geschärftes Produkt', () => {
  const p = SATELLITE_PRODUCTS.find((x) => x.id === 'hrv')!

  it('nimmt die FARBE aus dem eigenen Layer und die STRUKTUR aus `sharpen`', () => {
    expect(satelliteLayer(p)).toBe('msg_fes:rgb_eview')
    expect(sharpenLayer(p.sharpen!)).toBe('mtg_fd:vis06_hrfi')
    // Die Zeitachse folgt der Farbe, also dem MSG-Takt.
    expect(p.stepMs).toBe(900_000)
    expect(p.sharpen!.stepMs).toBe(600_000)
  })

  /**
   * Die Zeitpaarung ist der Preis des Verfahrens: Farbe alle 15 Minuten,
   * Schärfe alle 10. Gepaart wird auf den NÄCHSTGELEGENEN Termin, und der
   * Versatz darf nie über die halbe Schrittweite des Pan-Kanals gehen.
   */
  it('paart den Schärfungskanal auf höchstens 5 Minuten genau', () => {
    const base = Date.parse('2026-09-29T00:00:00Z')
    for (let k = 0; k < 8; k++) {
      const t = base + k * p.stepMs
      const pan = sharpenPanTime(t, p.sharpen!)
      expect(pan % p.sharpen!.stepMs).toBe(0)
      expect(Math.abs(pan - t)).toBeLessThanOrEqual(p.sharpen!.stepMs / 2)
    }
    // Die vier Fälle ausgeschrieben. Bei :15 und :45 liegen zwei Termine
    // GLEICH weit weg — genommen wird der FRÜHERE, weil der spätere am
    // aktuellen Rand oft noch nicht da ist.
    const at = (m: number) => Date.parse(`2026-09-29T12:${String(m).padStart(2, '0')}:00Z`)
    expect(sharpenPanTime(at(0), p.sharpen!)).toBe(at(0))
    expect(sharpenPanTime(at(15), p.sharpen!)).toBe(at(10))
    expect(sharpenPanTime(at(30), p.sharpen!)).toBe(at(30))
    expect(sharpenPanTime(at(45), p.sharpen!)).toBe(at(40))
    // Kein Gleichstand: der wirklich nächste gewinnt, auch in die Zukunft.
    expect(sharpenPanTime(at(19), p.sharpen!)).toBe(at(20))
  })

  /**
   * Die FARBE wird bewusst klein geholt — sie ist mit 3 km nativ, und die
   * Struktur kommt ohnehin aus dem Pan-Kanal. Ein Abruf in Zielgröße wäre
   * das Fünffache an Bytes für null zusätzliche Information.
   */
  it('fordert die Farbe bei ihrem nativen Raster an, nicht in Zielgröße', () => {
    const merc = productMerc(p)
    const spanM = merc.maxx - merc.minx
    const colourMPerPx = spanM / p.sharpen!.colourWidth
    expect(colourMPerPx).toBeGreaterThanOrEqual(p.sharpen!.colourMercM * 0.95)
    // … und deutlich gröber als das Zielraster, sonst hätte die Trennung
    // keinen Zweck.
    const targetMPerPx = spanM / productImageSize(p).width
    // … und gröber als das Zielraster, sonst hätte die Trennung keinen
    // Zweck. Beim HRV-RGB ist der Abstand Faktor 2 (1.558 gegen 779 m) —
    // weniger als beim 3-km-Natural-Colour, dafür auf einem Bild, das schon
    // Struktur hat.
    expect(colourMPerPx / targetMPerPx).toBeCloseTo(2, 0)
  })

  // Das Zielraster IST das des Schärfungskanals — dafür gibt es die engere
  // Fläche. 14° bei 2000 px sind 779 m/px, gemessenes HRFI-Raster 788 m.
  it('trifft mit der Zielgröße das Raster des Schärfungskanals', () => {
    const merc = productMerc(p)
    const mPerPx = (merc.maxx - merc.minx) / productImageSize(p).width
    expect(mPerPx).toBeCloseTo(779, -1)
  })

  it('ist ein Tagesprodukt — beide Zutaten sind es', () => {
    expect(p.dayOnly).toBe(true)
    expect(SATELLITE_PRODUCTS.find((x) => x.id === 'vis06')!.dayOnly).toBe(true)
  })

  // Es ist das einzige; ein zweites bräuchte wieder eine eigene Fläche und
  // einen zweiten Abruf je Bild.
  it('ist das einzige Produkt mit Schärfung', () => {
    expect(SATELLITE_PRODUCTS.filter((x) => x.sharpen).map((x) => x.id)).toEqual(['hrv'])
  })
})
