import { describe, expect, it } from 'vitest'
import {
  contoursFor,
  formatReadout,
  decodeCodes,
  decodeUv8,
  GLOBE_GROUPS,
  GLOBE_VARIABLES,
  getGlobeModel,
  globeFreshness,
  GLOBE_MODELS,
  intervalHours,
  nearestStepIndex,
  overlaysOffFor,
  sampledGapHours,
  sampleField,
  particleSource,
  sampleWind,
  tilePixelLat,
  tilePixelLon,
  type GlobeField,
  type GlobeGrid,
  type GlobeMeta,
} from './globe'
import { colorizeTile } from '../render/globeTiles'
import { colorForValue } from './colorscales'

const GRID: GlobeGrid = { ni: 1440, nj: 721, lon0: -180, lat0: 90, dlon: 0.25, dlat: -0.25, global: true }
/** Wie ICON-D2 (gemessen): regional, Zeile 0 = SÜDrand, 0,02° */
const D2: GlobeGrid = { ni: 1215, nj: 746, lon0: -3.94, lat0: 43.18, dlon: 0.02, dlat: 0.02, global: false }
const HOUR = 3_600_000

/** Feld aus einer Wertfunktion über (lat, lon) — kodiert wie der Ingest. */
function makeField(fn: (lat: number, lon: number) => number, lo = -100, step = 0.25, grid = GRID): GlobeField {
  const codes = new Uint16Array(grid.ni * grid.nj)
  for (let j = 0; j < grid.nj; j++)
    for (let i = 0; i < grid.ni; i++) {
      const v = fn(grid.lat0 + j * grid.dlat, grid.lon0 + i * grid.dlon)
      codes[j * grid.ni + i] = Number.isFinite(v) ? Math.round((v - lo) / step) + 1 : 0
    }
  return { grid, lo, step, codes }
}

describe('decodeCodes', () => {
  it('liest R als hohes und G als tiefes Byte, B und A zählen nicht', () => {
    const px = [0x01, 0x02, 99, 255, 0xff, 0xff, 0, 255, 0, 0, 7, 3]
    expect(Array.from(decodeCodes(px, 3))).toEqual([0x0102, 0xffff, 0])
  })
})

describe('sampleField', () => {
  it('trifft Gitterpunkte exakt (Rundlauf der Kodierung)', () => {
    const f = makeField((lat, lon) => lat / 3 + lon / 7)
    expect(sampleField(f, 47.25, 11.5)).toBeCloseTo(47.25 / 3 + 11.5 / 7, 0)
    expect(Math.abs(sampleField(f, 47.25, 11.5) - (47.25 / 3 + 11.5 / 7))).toBeLessThanOrEqual(0.125)
  })

  it('interpoliert bilinear zwischen den Punkten', () => {
    const f = makeField((lat) => lat, -100, 0.01)
    expect(sampleField(f, 10.125, 0)).toBeCloseTo(10.125, 2)
  })

  it('wickelt über die Datumsgrenze: 179,875° O liegt zwischen 179,75° O und 180° W', () => {
    // Werte 0 bei 179,75° O und 10 bei 180° W (= Spalte 0)
    const f = makeField((_, lon) => (lon === -180 ? 10 : lon === 179.75 ? 0 : 5), -100, 0.01)
    expect(sampleField(f, 0, 179.875)).toBeCloseTo(5, 1)
    // und dieselbe Stelle als −180,125°
    expect(sampleField(f, 0, -180.125)).toBeCloseTo(5, 1)
    // 360° weiter ist derselbe Ort
    expect(sampleField(f, 20, 11)).toBeCloseTo(sampleField(f, 20, 371), 6)
  })

  it('klemmt an den Polen statt außerhalb zu lesen', () => {
    const f = makeField((lat) => lat, -100, 0.01)
    expect(sampleField(f, 90, 0)).toBeCloseTo(90, 2)
    expect(sampleField(f, -90, 0)).toBeCloseTo(-90, 2)
  })

  it('gibt NaN, sobald ein Nachbar keinen Wert hat — keine halbe Mittelung', () => {
    const f = makeField((lat, lon) => (lat === 10 && lon === 10 ? NaN : 1))
    expect(sampleField(f, 10.1, 10.1)).toBeNaN()
    expect(sampleField(f, 20, 20)).toBeCloseTo(1, 1)
  })
})

describe('Kachelgeometrie', () => {
  // Referenz: die Kachelformel aus dem OSM-Wiki (Slippy map tilenames),
  // unabhängig von der eigenen Umsetzung
  const tileY = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  }
  const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z

  it('legt Pixelmitten dorthin, wo die OSM-Formel sie erwartet', () => {
    for (const [z, x, y, px, py] of [
      [0, 0, 0, 128, 128],
      [3, 4, 2, 17, 200],
      [6, 34, 22, 255, 0],
    ]) {
      const lat = tilePixelLat(z, y, py, 256)
      const lon = tilePixelLon(z, x, px, 256)
      expect(tileX(lon, z)).toBeCloseTo(x + (px + 0.5) / 256, 6)
      expect(tileY(lat, z)).toBeCloseTo(y + (py + 0.5) / 256, 6)
    }
  })

  it('reicht in Stufe 0 bis knapp an 85,05° heran', () => {
    expect(tilePixelLat(0, 0, 0, 256)).toBeGreaterThan(84.9)
    expect(tilePixelLat(0, 0, 0, 256)).toBeLessThan(85.0512)
  })
})

describe('colorizeTile', () => {
  const scale = GLOBE_VARIABLES[0].scale

  it('färbt jedes Pixel in der Farbe seines interpolierten Werts', () => {
    const f = makeField((lat) => lat * 0.6) // −54 … 54 °C über die Breite
    const rgba = colorizeTile(f, scale, 2, 1, 1, 64)
    let checked = 0
    for (let py = 0; py < 64; py++)
      for (let px = 0; px < 64; px++) {
        const v = sampleField(f, tilePixelLat(2, 1, py, 64), tilePixelLon(2, 1, px, 64))
        // Direkt an einer 2-K-Bandgrenze darf die LUT (4096 Zellen, 0,025 K)
        // eine Zelle daneben liegen — das ist ihre Quantisierung, kein Fehler
        const toEdge = Math.abs(v / 2 - Math.round(v / 2)) * 2
        if (toEdge < 0.05) continue
        const want = colorForValue(scale, v)!.slice(0, 7)
        const o = 4 * (py * 64 + px)
        const got = `#${[rgba[o], rgba[o + 1], rgba[o + 2]].map((c) => c.toString(16).padStart(2, '0')).join('')}`
        expect(got).toBe(want)
        expect(rgba[o + 3]).toBe(255)
        checked++
      }
    expect(checked).toBeGreaterThan(3500)
  })

  it('lässt Pixel ohne Wert durchsichtig', () => {
    const f = makeField(() => NaN)
    const rgba = colorizeTile(f, scale, 0, 0, 0, 16)
    expect(rgba.every((c) => c === 0)).toBe(true)
  })
})

describe('Zeit und Laufalter', () => {
  const run = Date.UTC(2026, 9, 5, 0)

  it('wählt den Schritt mit der nächsten Gültigkeitszeit', () => {
    const steps = [0, 3, 6, 9, 144, 150]
    expect(nearestStepIndex(steps, run, run + 4 * HOUR)).toBe(1)
    expect(nearestStepIndex(steps, run, run + 146 * HOUR)).toBe(4)
    expect(nearestStepIndex(steps, run, run - 50 * HOUR)).toBe(0)
  })

  it('warnt erst jenseits des Normalalters, und das hängt am Modell', () => {
    const ifs = getGlobeModel('ecmwf-ifs').staleHours
    const d2 = getGlobeModel('icon-d2').staleHours
    // IFS ist im Normalbetrieb bis ~22,5 h alt — dort darf nichts warnen
    expect(globeFreshness(run, run + 360 * HOUR, run + 22.5 * HOUR, ifs)).toBe('ok')
    expect(globeFreshness(run, run + 360 * HOUR, run + (ifs + 1) * HOUR, ifs)).toBe('old')
    // ICON-D2 läuft alle 3 h: 10 h alt heißt, mindestens zwei Läufe fehlen
    expect(globeFreshness(run, run + 48 * HOUR, run + 10 * HOUR, d2)).toBe('old')
    expect(d2).toBeLessThan(ifs)
  })

  it('„verbraucht" schlägt „alt", sobald der letzte Termin vorbei ist', () => {
    expect(globeFreshness(run, run + 360 * HOUR, run + 361 * HOUR, 30)).toBe('spent')
  })

  it('liest das Intervall eines Schritts aus den Metadaten', () => {
    const vm = { lo: 0, step: 1, unit: 'km/h', steps: [3, 93, 150], intervals: [1, 3, 6] }
    expect(intervalHours(vm, 93)).toBe(3)
    expect(intervalHours(vm, 4)).toBeUndefined()
    expect(intervalHours({ lo: 0, step: 1, unit: '°C', steps: [3] }, 3)).toBeUndefined()
  })
})

describe('regionales Gitter (ICON)', () => {
  it('liest bei Süd→Nord-Abtastung die richtige Zeile', () => {
    const f = makeField((lat) => lat, -100, 0.01, D2)
    expect(sampleField(f, 47.5, 11)).toBeCloseTo(47.5, 2)
    expect(sampleField(f, 43.18, 0)).toBeCloseTo(43.18, 2)
    expect(sampleField(f, 58.08, 20)).toBeCloseTo(58.08, 2)
  })

  it('gibt außerhalb des Gebiets NaN statt über die Datumsgrenze zu wickeln oder zu klemmen', () => {
    const f = makeField(() => 5, -100, 0.01, D2)
    expect(sampleField(f, 47, 25)).toBeNaN() // östlich
    expect(sampleField(f, 47, -10)).toBeNaN() // westlich
    expect(sampleField(f, 40, 10)).toBeNaN() // südlich
    expect(sampleField(f, 60, 10)).toBeNaN() // nördlich
    expect(sampleField(f, 47, 10)).toBeCloseTo(5, 2)
  })

  it('färbt eine Kachel, die das Gebiet nur teilweise schneidet, genau bis zum Rand', () => {
    const scale = GLOBE_VARIABLES[0].scale
    const f = makeField(() => 10, -100, 0.25, D2)
    // Kachel z=5, x=17, y=11: lon 11,25…22,5 / lat ~40,98…48,92 — der Ostrand
    // (20,34° O) und der Südrand (43,18° N) des Gebiets laufen hindurch
    const size = 64
    const rgba = colorizeTile(f, scale, 5, 17, 11, size)
    let inside = 0
    let outside = 0
    for (let py = 0; py < size; py++)
      for (let px = 0; px < size; px++) {
        const lat = tilePixelLat(5, 11, py, size)
        const lon = tilePixelLon(5, 17, px, size)
        const a = rgba[4 * (py * size + px) + 3]
        if (Number.isNaN(sampleField(f, lat, lon))) {
          expect(a).toBe(0)
          outside++
        } else {
          expect(a).toBe(255)
          inside++
        }
      }
    // beide Teile kommen wirklich vor — sonst prüfte der Test nichts
    expect(inside).toBeGreaterThan(500)
    expect(outside).toBeGreaterThan(500)
  })
})

describe('Registry', () => {
  it('führt jedes Modell einmal, mit Zoomgrenze passend zur Auflösung', () => {
    const ids = GLOBE_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    const z = (id: string) => getGlobeModel(id).maxzoom
    expect(z('ecmwf-ifs')).toBeLessThan(z('icon-eu'))
    expect(z('icon-eu')).toBeLessThan(z('icon-d2'))
  })

  it('führt jede Größe genau einmal und mit Skala', () => {
    const ids = GLOBE_VARIABLES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const v of GLOBE_VARIABLES) expect(v.scale?.stops.length).toBeGreaterThan(1)
  })

  it('ordnet jede Größe einer Gruppe zu, und keine Gruppe bleibt leer', () => {
    for (const v of GLOBE_VARIABLES) expect(GLOBE_GROUPS).toContain(v.group)
    for (const g of GLOBE_GROUPS) expect(GLOBE_VARIABLES.some((v) => v.group === g)).toBe(true)
  })

  it('schaltet Linien und Partikel nur bei Flächengrößen ab, nicht bei der Relativen Topografie', () => {
    const off = GLOBE_VARIABLES.filter(overlaysOffFor).map((v) => v.id).sort()
    expect(off).toEqual(['cape', 'hzerocl', 'precip', 'precipsum', 'rh700', 'snow', 't2m', 't850', 'tcwv', 'td2m'])
  })

  it('erkennt Böen, die nur eine Stichprobe des Schrittabstands sind', () => {
    // IFS: Schritte alle 3 h, Böe bis +90 h nur die letzte Stunde, dann 3 h, ab +150 6 h
    const vm = { lo: 0, step: 1, unit: 'km/h', steps: [3, 6, 90, 93, 144, 150], intervals: [1, 1, 1, 3, 3, 6] }
    expect(sampledGapHours(vm, 3)).toBeUndefined() // erster Schritt: kein Vorgänger
    expect(sampledGapHours(vm, 6)).toBe(3)
    expect(sampledGapHours(vm, 93)).toBeUndefined()
    expect(sampledGapHours(vm, 150)).toBeUndefined()
    // ICON-D2: stündlich, lückenlos
    expect(sampledGapHours({ ...vm, steps: [1, 2, 3], intervals: [1, 1, 1] }, 2)).toBeUndefined()
    // Termingrößen ohne Intervall
    expect(sampledGapHours({ lo: 0, step: 1, unit: '', steps: [0, 3] }, 3)).toBeUndefined()
  })

  it('stuft die Skalen streng aufsteigend', () => {
    for (const v of GLOBE_VARIABLES) {
      const vals = v.scale.stops.map((s) => s.value)
      for (let i = 1; i < vals.length; i++) expect(vals[i], v.id).toBeGreaterThan(vals[i - 1])
    }
  })

  it('reicht mit der Temperaturskala von −56 bis 52 °C in 1-K-Bändern (global, nicht europäisch)', () => {
    const stops = GLOBE_VARIABLES.find((v) => v.id === 't2m')!.scale.stops
    expect(stops[0].value).toBe(-56)
    expect(stops[stops.length - 1].value).toBe(52)
    expect(stops[1].value - stops[0].value).toBe(1)
  })

  // Der gemeldete Fehler: eine europäische 850-hPa-Lage stand in EINER Farbe.
  // Gemessen über −20 … +30 °C: vorher 5 Bänder je 10 K, Nachbarabstand im
  // Mittel 19 (RGB) — aber benachbarte Bänder liefen weich ineinander. Jetzt
  // 10 Bänder je 10 K, und jedes zweite ist abgedunkelt: kein Nachbarpaar
  // darf mehr unter der Schwelle liegen, ab der man zwei Flächen trennt.
  it('trennt jedes 1-K-Band sichtbar vom Nachbarn (−20 … +30 °C)', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((x, i) => x - rgb(b)[i]))
    for (const id of ['t2m', 't850']) {
      const s = GLOBE_VARIABLES.find((v) => v.id === id)!.scale.stops.filter((x) => x.value >= -20 && x.value <= 30)
      expect(s.length, id).toBe(51)
      const minD = Math.min(...s.slice(1).map((x, i) => dist(x.color, s[i].color)))
      expect(minD, id).toBeGreaterThan(15)
    }
  })

  it('beschriftet die Temperaturlegende auf runden Werten', () => {
    const t = GLOBE_VARIABLES.find((v) => v.id === 't850')!
    const labelled = t.scale.stops.filter((s) => s.value % t.legendMultiple! === 0).map((s) => s.value)
    expect(labelled).toContain(0)
    expect(labelled.every((v) => v % 10 === 0)).toBe(true)
  })
})

describe('Windkomponenten (uv8)', () => {
  const grid: GlobeGrid = { ni: 2, nj: 2, lon0: 0, lat0: 0, dlon: 1, dlat: 1, global: false }
  // Zelle → [u, v] in m/s als Code (code − 128) · 0,5
  const code = (u: number, v: number) => [u / 0.5 + 128, v / 0.5 + 128]
  const rgba = (cells: number[][]) => cells.flatMap(([u, v]) => [u, v, 0, 255])
  it('dekodiert R = u, G = v', () => {
    expect([...decodeUv8(rgba([code(5, -3)]), 1)]).toEqual(code(5, -3))
  })
  it('interpoliert bilinear und rechnet in m/s um', () => {
    const uv = decodeUv8(rgba([code(0, 0), code(10, 0), code(0, 4), code(10, 4)]), 4)
    const f: GlobeField = { grid, lo: -63.5, step: 0.5, codes: new Uint16Array(0), uv }
    const w = sampleWind(f, 0.5, 0.5)!
    expect(w[0]).toBeCloseTo(5)
    expect(w[1]).toBeCloseTo(2)
  })
  it('Höhenwind: rechnet mit der Stufe des Felds (1 m/s), damit der Strahlstrom nicht bei 63,5 klemmt', () => {
    const c1 = (u: number, v: number) => [u + 128, v + 128]
    const uv = decodeUv8(rgba([c1(90, -20), c1(90, -20), c1(90, -20), c1(90, -20)]), 4)
    const f: GlobeField = { grid, lo: -127, step: 1, codes: new Uint16Array(0), uv }
    expect(sampleWind(f, 0.5, 0.5)).toEqual([90, -20])
  })
  it('kein Wert, sobald ein Nachbar fehlt oder der Punkt außerhalb liegt', () => {
    const uv = decodeUv8(rgba([code(0, 0), [0, 0], code(0, 4), code(10, 4)]), 4)
    const f: GlobeField = { grid, lo: -63.5, step: 0.5, codes: new Uint16Array(0), uv }
    expect(sampleWind(f, 0.5, 0.5)).toBeNull()
    expect(sampleWind(f, 5, 5)).toBeNull()
  })
})

describe('Meeresgrößen', () => {
  it('Wellenhöhe, Periode und Wassertemperatur sind wählbar, mit aufsteigenden Stufen', () => {
    for (const id of ['swh', 'pp1d', 'sst'] as const) {
      const v = GLOBE_VARIABLES.find((x) => x.id === id)
      expect(v, id).toBeDefined()
      const values = v!.scale.stops.map((s) => s.value)
      expect(values).toEqual([...values].sort((a, b) => a - b))
    }
  })
  it('über dem Höhenwind stehen die 300-hPa-Linien statt der 500er', () => {
    expect(contoursFor('wind300').map((c) => c.id)).toEqual(['msl', 'gh300'])
    expect(contoursFor('t850').map((c) => c.id)).toEqual(['msl', 'gh500'])
  })
  it('die Partikelquellen stehen nicht in der Auswahl', () => {
    expect(GLOBE_VARIABLES.some((v) => v.id === 'uv10' || v.id === 'uv300')).toBe(false)
  })
  it('über dem Höhenwind laufen die Partikel mit dem 300-hPa-Wind, sonst mit dem Bodenwind', () => {
    const vm = { lo: 0, step: 1, unit: 'm/s', steps: [0] }
    const meta = { variables: { uv10: vm, uv300: vm } } as unknown as GlobeMeta
    expect(particleSource('wind300', meta)).toEqual({ var: 'uv300', refSpeed: 40 })
    expect(particleSource('t2m', meta).var).toBe('uv10')
    // ein Lauf ohne Höhenwind fällt auf den Bodenwind zurück
    const old = { variables: { uv10: vm } } as unknown as GlobeMeta
    expect(particleSource('wind300', old).var).toBe('uv10')
  })
})

describe('Wassertemperatur-Skala', () => {
  it('stuft im warmen Bereich fein: ab 26 °C in 0,5 K, darunter gröber', () => {
    const v = GLOBE_VARIABLES.find((x) => x.id === 'sst')!.scale.stops.map((s) => s.value)
    const step = (t: number) => v[v.indexOf(t) + 1] - t
    expect(step(26)).toBeCloseTo(0.5)
    expect(step(31)).toBeCloseTo(0.5)
    expect(step(20)).toBe(1)
    expect(step(4)).toBe(2)
    expect(v[0]).toBe(-2)
    expect(v[v.length - 1]).toBe(32)
    // zwischen 26 und 32 °C liegen mindestens zehn unterscheidbare Stufen
    expect(v.filter((x) => x >= 26 && x <= 32).length).toBeGreaterThanOrEqual(10)
  })
})

describe('Werteanzeige', () => {
  it('rundet auf ganze Zahlen, ohne „−0"', () => {
    expect(formatReadout(12.34, 0)).toBe('12')
    expect(formatReadout(-0.3, 0)).toBe('0')
    expect(formatReadout(-0.6, 0)).toBe('-1')
    expect(formatReadout(0.34, 1)).toBe('0,3')
  })

  it('zeigt Nachkommastellen nur bei Niederschlag und Wellenhöhe', () => {
    const mit = GLOBE_VARIABLES.filter((v) => v.decimals > 0).map((v) => v.id)
    expect(mit.sort()).toEqual(['precip', 'swh'])
  })
})
