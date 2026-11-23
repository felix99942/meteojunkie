import { describe, expect, it } from 'vitest'
import { bandLat, CAP_LAT, CAP_NO_VALUE, capFillRaster, capTexelLatLon, capUV, capValueRaster } from './polarCap'
import { POLE_RING_LAT, sampleField, type GlobeField } from '../config/globe'
import { colorForValue, type ColorScale } from '../config/colorscales'

/** Globales 1°-Feld; Wert = f(lat, lon) in 0,1er Codes */
function field(fn: (lat: number, lon: number) => number): GlobeField {
  const ni = 360
  const nj = 181
  const codes = new Uint16Array(ni * nj)
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++) codes[j * ni + i] = Math.round((fn(90 - j, -180 + i) - 0) / 0.1) + 1
  return { grid: { ni, nj, lon0: -180, lat0: 90, dlon: 1, dlat: -1, global: true }, lo: 0, step: 0.1, codes }
}

describe('Polkappe', () => {
  it('bildet Texel und Breite/Länge umkehrbar ab', () => {
    const size = 512
    for (const [px, py] of [[256, 10], [100, 300], [400, 420], [255, 255]]) {
      const ll = capTexelLatLon(px, py, size)!
      const [u, v] = capUV(ll.lat, ll.lon)
      expect(u * size - 0.5).toBeCloseTo(px, 6)
      expect(v * size - 0.5).toBeCloseTo(py, 6)
    }
    expect(capTexelLatLon(0, 0, size)).toBeNull() // Ecke liegt außerhalb der Scheibe
    expect(capTexelLatLon(255, 255, size)!.lat).toBeGreaterThan(89.9)
  })

  it('reicht südlich über den gestreckten Kachelrand jeder Stufe hinaus', () => {
    for (let z = 0; z <= 8; z++) {
      expect(bandLat(z)).toBeGreaterThan(CAP_LAT)
      expect(bandLat(z)).toBeLessThan(POLE_RING_LAT)
    }
  })

  it('färbt mit dem Wert des Felds an derselben Stelle, nicht mit dem Ringmittel', () => {
    // Wert hängt von der LÄNGE ab: das Ringmittel wäre überall gleich
    const f = field((_lat, lon) => 50 + 40 * Math.cos((lon * Math.PI) / 180))
    const scale: ColorScale = {
      kind: 'stepped',
      stops: Array.from({ length: 10 }, (_, i) => ({ value: i * 10, color: `#${(i * 25).toString(16).padStart(2, '0')}0000` })),
    }
    const size = 64
    const rgba = capFillRaster(f, scale, size)
    for (const [px, py] of [[32, 5], [32, 58], [5, 32], [58, 32]]) {
      const ll = capTexelLatLon(px, py, size)!
      const want = colorForValue(scale, sampleField(f, ll.lat, ll.lon))!
      const o = (py * size + px) * 4
      // Rotkanal der Bandfarbe, ±1 Band an einer Grenze
      expect(Math.abs(rgba[o] - parseInt(want.slice(1, 3), 16))).toBeLessThanOrEqual(25)
      expect(rgba[o + 3]).toBe(255)
    }
  })

  it('liefert die Werte für die Linien an derselben Stelle wie das Feld, mit Saum am Rand', () => {
    // Geneigte Ebene durch den Pol: hängt von Länge UND Breite ab
    const f = field((lat, lon) => 100 + (90 - lat) * Math.cos((lon * Math.PI) / 180))
    const smooth = new Float32Array(f.codes.length)
    for (let i = 0; i < smooth.length; i++) smooth[i] = f.lo + (f.codes[i] - 1) * f.step
    const size = 128
    const v = capValueRaster(f, smooth, size)
    for (const [px, py] of [[64, 3], [10, 64], [100, 90], [64, 64]]) {
      const ll = capTexelLatLon(px, py, size)!
      expect(v[py * size + px]).toBeCloseTo(sampleField(f, ll.lat, ll.lon), 1)
    }
    expect(v[0]).toBeLessThan(CAP_NO_VALUE / 10) // Ecke weit außerhalb der Scheibe (Float32 rundet den Merker)
    expect(v[64 * size]).toBeGreaterThan(CAP_NO_VALUE / 10) // Saum direkt am Rand
  })
})
