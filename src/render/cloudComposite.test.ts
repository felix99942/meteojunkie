// Tests der Rechenteile des Wolken-Komposits. Geprüft wird, was man dem
// fertigen Bild NICHT ansieht: ein verschobener Ausschnitt sieht aus wie eine
// Karte (nur liegt die Küste dann neben der Küstenlinie), und eine
// falsch herum gezogene Schwelle macht aus wolkenfrei bedeckt.

import { describe, expect, it } from 'vitest'
import {
  cloudAlphaLut,
  groundSourceRect,
  maskRange,
  MIN_SUN_DEG,
  MIN_SUN_FACTOR,
} from './cloudComposite'
import { SATELLITE_PRODUCTS, getSatelliteProduct } from '../config/satellite'
import { mercBox } from '../config/wmsTime'

const ground = mercBox({ west: 4, east: 18, south: 44, north: 56 })

describe('groundSourceRect', () => {
  it('nimmt das ganze Bild, wenn die Flächen gleich sind', () => {
    const r = groundSourceRect(ground, ground, 1600, 2149)
    expect(r.sx).toBeCloseTo(0, 6)
    expect(r.sy).toBeCloseTo(0, 6)
    expect(r.sw).toBeCloseTo(1600, 6)
    expect(r.sh).toBeCloseTo(2149, 6)
  })

  // Die y-Achse ist die Falle: Mercator zählt nach NORDEN, Bildzeilen nach
  // UNTEN. Verwechselt man das, steht der Ausschnitt gespiegelt im Bild.
  it('misst y von der Oberkante nach unten', () => {
    const nordhälfte = mercBox({ west: 4, east: 18, south: 50, north: 56 })
    const südhälfte = mercBox({ west: 4, east: 18, south: 44, north: 50 })
    const n = groundSourceRect(ground, nordhälfte, 1600, 2149)
    const s = groundSourceRect(ground, südhälfte, 1600, 2149)
    expect(n.sy).toBeCloseTo(0, 6)
    expect(s.sy).toBeGreaterThan(n.sy)
    expect(n.sh + s.sh).toBeCloseTo(2149, 6)
  })

  it('schneidet die westliche Hälfte links aus', () => {
    const west = mercBox({ west: 4, east: 11, south: 44, north: 56 })
    const r = groundSourceRect(ground, west, 1600, 2149)
    expect(r.sx).toBeCloseTo(0, 6)
    expect(r.sw).toBeCloseTo(800, 6)
  })
})

describe('maskRange', () => {
  it('lässt feste Schwellen in Ruhe', () => {
    expect(maskRange({ min: 78, max: 140 }, 40)).toEqual({ min: 78, max: 140 })
    // auch nachts — das Infrarot misst Wärme, nicht Sonnenlicht
    expect(maskRange({ min: 78, max: 140 }, -30)).toEqual({ min: 78, max: 140 })
  })

  // Gemessen: bei 40° Sonnenhöhe liegt wolkenfreier Boden bei 37–70 und Wolke
  // ab ~90. Die Schwelle muss dazwischen landen.
  it('zieht den sichtbaren Kanal auf den Sonnenstand', () => {
    const m = { min: 124, max: 218, solarScaled: true } as const
    const r = maskRange(m, 40)
    expect(r.min).toBeGreaterThan(70)
    expect(r.min).toBeLessThan(90)
    expect(r.max).toBeGreaterThan(r.min)
    // halber Sonnenstand, halbe Helligkeit: die Schwellen gehen mit
    expect(maskRange(m, 20).min).toBeLessThan(r.min)
  })

  it('sinkt nie unter die gemessene Untergrenze', () => {
    const m = { min: 124, max: 218, solarScaled: true } as const
    expect(maskRange(m, 2).min).toBeCloseTo(124 * MIN_SUN_FACTOR, 6)
    expect(maskRange(m, -20).min).toBeCloseTo(124 * MIN_SUN_FACTOR, 6)
  })

  it('führt Grenzwinkel und Faktor als EINE Zahl', () => {
    expect(MIN_SUN_FACTOR).toBeCloseTo(Math.sin((MIN_SUN_DEG * Math.PI) / 180), 12)
  })
})

describe('cloudAlphaLut', () => {
  it('ist unter min durchsichtig, über max deckend und dazwischen monoton', () => {
    const lut = cloudAlphaLut(80, 140)
    expect(lut[0]).toBe(0)
    expect(lut[79]).toBe(0)
    expect(lut[110]).toBeGreaterThan(100)
    expect(lut[110]).toBeLessThan(160)
    expect(lut[140]).toBe(255)
    expect(lut[255]).toBe(255)
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1])
  })

  // Eine Rampe der Breite null wäre eine Division durch null — heraus käme
  // NaN und damit ein leeres Bild.
  it('überlebt eine Rampe ohne Breite', () => {
    const lut = cloudAlphaLut(100, 100)
    expect(lut[99]).toBe(0)
    expect(lut[101]).toBe(255)
  })
})

describe('Registry', () => {
  // Zusammengesetzt wird nur, wo das Bild eine Graustufe IST. Geocolour bringt
  // seinen Boden mit, die Deutungs-RGBs verlören ihre Aussage.
  it('maskiert genau die beiden Graustufen-Kanäle', () => {
    expect(SATELLITE_PRODUCTS.filter((p) => p.cloudMask).map((p) => p.id)).toEqual([
      'vis06',
      'ir105',
    ])
  })

  it('skaliert nur den sichtbaren Kanal mit der Sonne', () => {
    expect(getSatelliteProduct('vis06').cloudMask?.solarScaled).toBe(true)
    expect(getSatelliteProduct('ir105').cloudMask?.solarScaled).toBeUndefined()
  })

  it('hat in jeder Maske eine aufsteigende Rampe', () => {
    for (const p of SATELLITE_PRODUCTS) {
      if (!p.cloudMask) continue
      expect(p.cloudMask.max).toBeGreaterThan(p.cloudMask.min)
      expect(p.cloudMask.min).toBeGreaterThan(0)
      expect(p.cloudMask.max).toBeLessThanOrEqual(255)
    }
  })
})
