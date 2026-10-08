import { describe, expect, it } from 'vitest'
import { contourTile, CONTOUR_STYLES, smoothField } from './globeContours'
import { CLOUD_LAYER_RAMPS, CLOUD_OCTA_ALPHA, colorizeRgbTile, toOcta } from './globeTiles'
import { sampleRgb3, tilePixelLat, tilePixelLon, type GlobeField, type GlobeGrid } from '../config/globe'

const GRID: GlobeGrid = { ni: 1440, nj: 721, lon0: -180, lat0: 90, dlon: 0.25, dlat: -0.25, global: true }

function field(fn: (lat: number, lon: number) => number, lo = 900, step = 0.5, grid = GRID): GlobeField {
  const codes = new Uint16Array(grid.ni * grid.nj)
  for (let j = 0; j < grid.nj; j++)
    for (let i = 0; i < grid.ni; i++) {
      const v = fn(grid.lat0 + j * grid.dlat, grid.lon0 + i * grid.dlon)
      codes[j * grid.ni + i] = Number.isFinite(v) ? Math.round((v - lo) / step) + 1 : 0
    }
  return { grid, lo, step, codes }
}

describe('smoothField', () => {
  it('lässt ein lineares Feld unverändert (Kastenfilter ist symmetrisch)', () => {
    const f = field((_, lon) => 1000 + lon / 10)
    const raw = smoothField(f, 0)
    const sm = smoothField(f, 3)
    const i = 300 * 1440 + 700
    expect(sm[i]).toBeCloseTo(raw[i], 4)
  })

  it('zählt fehlende Zellen nicht mit und lässt sie fehlend', () => {
    const f = field((lat, lon) => (lat === 10 && lon === 10 ? NaN : 1000))
    const sm = smoothField(f, 2)
    const j = (90 - 10) / 0.25
    const i = (10 + 180) / 0.25
    expect(Number.isNaN(sm[j * 1440 + i])).toBe(true)
    expect(sm[j * 1440 + i + 1]).toBeCloseTo(1000, 4)
  })

  it('dämpft Rauschen', () => {
    const f = field((lat, lon) => 1000 + ((Math.round(lat * 4) + Math.round(lon * 4)) % 2 ? 2 : -2))
    const sm = smoothField(f, 2)
    expect(Math.abs(sm[200 * 1440 + 200] - 1000)).toBeLessThan(0.5)
  })
})

describe('contourTile', () => {
  // Druck steigt nach Osten um 1 hPa je Grad: in Kachel z=4 (22,5° breit)
  // liegen die 5-hPa-Linien senkrecht, alle 5° Länge
  const f = field((_, lon) => 1000 + lon)
  const smooth = smoothField(f, 0)
  const z = 4
  const x = 8 // 0° … 22,5° O
  const y = 5
  const { rgba, labels } = contourTile(f, smooth, 5, CONTOUR_STYLES.msl, z, x, y, 256)
  const alphaAt = (px: number, py: number) => rgba[4 * (py * 256 + px) + 3]

  it('zeichnet die Linie dort, wo der Wert den Linienwert erreicht', () => {
    // 1005 hPa bei 5° O, um die halbe Speicherstufe versetzt: 5,25° O
    let best = 0
    let bestLon = NaN
    for (let px = 0; px < 256; px++) {
      const lon = tilePixelLon(z, x, px, 256)
      if (lon < 3.5 || lon > 7) continue
      if (alphaAt(px, 128) > best) {
        best = alphaAt(px, 128)
        bestLon = lon
      }
    }
    expect(best).toBe(255)
    expect(Math.abs(bestLon - 5.25)).toBeLessThan(0.15)
  })

  it('lässt zwischen den Linien frei', () => {
    // 7,5° O liegt mitten zwischen 1005 und 1010
    let px = 0
    while (tilePixelLon(z, x, px, 256) < 7.5) px++
    expect(alphaAt(px, 128)).toBe(0)
  })

  it('beschriftet mit runden Linienwerten und nicht am Kachelrand', () => {
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) {
      expect(['1005', '1010', '1015', '1020']).toContain(l.text)
      expect(l.x).toBeGreaterThanOrEqual(18)
      expect(l.y).toBeGreaterThanOrEqual(18)
      expect(l.x).toBeLessThanOrEqual(256 - 18)
    }
  })

  it('zeichnet weder Doppellinie noch Geisterstrich um eine Fläche, die genau auf einem Linienwert liegt', () => {
    // Plateau 1010,0 hPa über 1°, außen Gefälle: früher entstand der Umriss
    const g = field((_, lon) => (lon >= 8 && lon <= 9 ? 1010 : 1000 + lon + (lon > 9 ? 1 : 0)))
    const { rgba: r } = contourTile(g, smoothField(g, 0), 5, CONTOUR_STYLES.msl, z, x, y, 256)
    // Querschnitt: zusammenhängende Linienstücke zählen — erwartet höchstens eines um das Plateau
    let runs = 0
    let inRun = false
    for (let px = 0; px < 256; px++) {
      const lon = tilePixelLon(z, x, px, 256)
      if (lon < 7 || lon > 10) continue
      const on = r[4 * (128 * 256 + px) + 3] > 0
      if (on && !inRun) runs++
      inRun = on
    }
    expect(runs).toBeLessThanOrEqual(1)
  })
})

describe('Wolkenschichten', () => {
  const grid: GlobeGrid = { ni: 4, nj: 4, lon0: 0, lat0: 0, dlon: 1, dlat: 1, global: false }
  // überall: mittel 40, hoch 100, tief 0 — nur Zelle (0,0) ohne Wert
  const rgb = new Uint8Array(16 * 3)
  for (let i = 0; i < 16; i++) rgb.set([40, 100, 0], 3 * i)
  rgb.set([255, 255, 255], 0)
  const f: GlobeField = { grid, lo: 0, step: 5, codes: new Uint16Array(0), rgb }

  it('liest die drei Schichten am Punkt', () => {
    expect(sampleRgb3(f, 2, 2)).toEqual({ mid: 40, high: 100, low: 0 })
    expect(sampleRgb3(f, 0, 0)).toBeNull()
    expect(sampleRgb3(f, 10, 10)).toBeNull()
  })

  const z = 7
  const xt = Math.floor(((2 + 180) / 360) * 2 ** z)
  const yt = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (2 * Math.PI) / 360)) / Math.PI) / 2) * 2 ** z)
  /** erstes gefärbtes Pixel einer Kachel um (2° N, 2° O) */
  const pixel = (rgb: Uint8Array) => {
    const out = colorizeRgbTile({ ...f, rgb }, z, xt, yt, 64)
    for (let py = 0; py < 64; py++)
      for (let px = 0; px < 64; px++) {
        const lat = tilePixelLat(z, yt, py, 64)
        const lon = tilePixelLon(z, xt, px, 64)
        if (lat < 1.5 || lat > 2.5 || lon < 1.5 || lon > 2.5) continue
        const o = 4 * (py * 64 + px)
        return [out[o], out[o + 1], out[o + 2], out[o + 3]]
      }
    throw new Error('kein Pixel im Prüfgebiet')
  }
  const fill = (mid: number, high: number, low: number) => {
    const a = new Uint8Array(16 * 3)
    for (let i = 0; i < 16; i++) a.set([mid, high, low], 3 * i)
    return a
  }

  it('rechnet Prozent in Achtel wie die Synop-Meldung', () => {
    expect([0, 5, 10, 15, 40, 50, 95, 100].map(toOcta)).toEqual([0, 0, 1, 1, 3, 4, 8, 8])
  })

  it('lässt eine einzelne Schicht genau in der Farbe ihrer Achtelstufe', () => {
    const [r, g, b, a] = pixel(fill(0, 0, 25)) // nur tief, genau 2/8
    expect([r, g, b]).toEqual([...CLOUD_LAYER_RAMPS.low[1]])
    expect(a).toBe(Math.floor(CLOUD_OCTA_ALPHA[1] * 255))
  })

  it('interpoliert zwischen den Achtelstufen stufenlos', () => {
    const [r2] = pixel(fill(25, 0, 0)) // 2/8
    const [r3] = pixel(fill(37, 0, 0)) // knapp 3/8
    const [r4] = pixel(fill(50, 0, 0)) // 4/8
    expect(r3).toBeGreaterThan(r2)
    expect(r3).toBeLessThan(r4)
  })

  it('blendet unter 1/8 weich aus statt hart abzubrechen', () => {
    const a5 = pixel(fill(0, 0, 5))[3] // 0,4/8 — schon leicht sichtbar
    const a10 = pixel(fill(0, 0, 10))[3] // 0,8/8 — fast voll
    expect(a5).toBeGreaterThan(0)
    expect(a5).toBeLessThan(a10)
  })

  it('macht die Stärke sichtbar: 6/8 ist deutlich heller als 3/8', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
    const p3 = pixel(fill(40, 0, 0)) // mittel 3/8
    const p6 = pixel(fill(75, 0, 0)) // mittel 6/8
    expect(lum(p6)).toBeGreaterThan(lum(p3) * 1.5)
    // und bleibt rot
    expect(p6[0]).toBeGreaterThan(p6[1])
    expect(p6[0]).toBeGreaterThan(p6[2])
  })

  it('stapelt halbtransparent: hoch liegt über mittel, deckt aber nicht voll', () => {
    const [r, g, , a] = pixel(fill(40, 100, 0))
    expect(g).toBeGreaterThan(r)
    expect(a).toBeLessThan(255)
  })
})
