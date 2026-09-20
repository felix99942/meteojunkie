import { describe, expect, it } from 'vitest'
// Quelltext des Ingests als Text — über Vites `?raw`, nicht über node:fs:
// die App-tsconfig führt bewusst keine Node-Typen (das tut nur
// tsconfig.server.json), und ein Test soll die nicht hereinziehen.
import scriptSource from '../../scripts/build-relief.mjs?raw'
import { RELIEF_BOUNDS, RELIEF_COORDINATES, RELIEF_STEPS, RELIEF_TILES } from './relief'

// Kachelrechnung wie in scripts/build-relief.mjs — die Bildecken stehen in
// relief.ts als Konstanten, dürfen aber nicht gegen das Skript driften: eine
// verschobene Ecke verschiebt das ganze Relief gegen die Küstenlinien, und
// das sähe wie ein Projektionsfehler aus.
const xToLon = (x: number, n: number) => (x / n) * 360 - 180
const yToLat = (y: number, n: number) => {
  const t = Math.PI * (1 - (2 * y) / n)
  return (180 / Math.PI) * Math.atan(Math.sinh(t))
}

describe('Relief-Bildecken', () => {
  const n = 2 ** RELIEF_TILES.zoom

  it('folgen exakt den Kachelgrenzen', () => {
    expect(xToLon(RELIEF_TILES.x0, n)).toBeCloseTo(RELIEF_BOUNDS.lonMin, 6)
    expect(xToLon(RELIEF_TILES.x1, n)).toBeCloseTo(RELIEF_BOUNDS.lonMax, 6)
    expect(yToLat(RELIEF_TILES.y0, n)).toBeCloseTo(RELIEF_BOUNDS.latMax, 5)
    expect(yToLat(RELIEF_TILES.y1, n)).toBeCloseTo(RELIEF_BOUNDS.latMin, 5)
  })

  it('decken die Europa-Domain vollständig ab', () => {
    // Der Ausschnitt aus build-basemap.mjs — das Relief muss darüber
    // hinausreichen, sonst endet es sichtbar mitten in der Karte.
    expect(RELIEF_BOUNDS.lonMin).toBeLessThanOrEqual(-12)
    expect(RELIEF_BOUNDS.lonMax).toBeGreaterThanOrEqual(40)
    expect(RELIEF_BOUNDS.latMin).toBeLessThanOrEqual(35)
    expect(RELIEF_BOUNDS.latMax).toBeGreaterThanOrEqual(70)
  })

  it('geben die Ecken im uhrzeigersinnigen Bildformat an (NW, NE, SE, SW)', () => {
    const [nw, ne, se, sw] = RELIEF_COORDINATES
    expect(nw).toEqual([RELIEF_BOUNDS.lonMin, RELIEF_BOUNDS.latMax])
    expect(ne[0]).toBeGreaterThan(nw[0])
    expect(ne[1]).toBe(nw[1])
    expect(se[1]).toBeLessThan(ne[1])
    expect(sw[0]).toBe(nw[0])
    expect(sw[1]).toBe(se[1])
  })
})

describe('Relief-Legende', () => {
  it('steigt monoton auf — dunkles Tiefland, helles Hochgebirge', () => {
    // Die Reihenfolge ist die Aussage der Legende: wer die Karte liest, soll
    // „heller = höher" einmal lernen und dann nicht mehr nachsehen müssen.
    const lum = RELIEF_STEPS.map((s) => {
      const v = parseInt(s.color.slice(1), 16)
      return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)
    })
    for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeGreaterThan(lum[i - 1])
  })

  it('bleibt unter der Helligkeit der Grenzlinien', () => {
    // Über dem Relief liegen Grenzen (#b4b9c2) und Stadtlabels. Wird die
    // oberste Stufe zu hell, verschwinden sie darin.
    const top = RELIEF_STEPS[RELIEF_STEPS.length - 1].color
    const v = parseInt(top.slice(1), 16)
    const lum = 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)
    expect(lum).toBeLessThan(0.2126 * 0xb4 + 0.7152 * 0xb9 + 0.0722 * 0xc2)
  })
})

describe('Legende gegen den Ingest', () => {
  // Die Stufen stehen DOPPELT: hier als Legende, im Ingest als Palette des
  // erzeugten Bildes (reines Node ohne TS-Import — dieselbe bewusste
  // Duplizierung wie die AU-BOM-Formel im MOSMIX-Ingest). Driften sie
  // auseinander, beschriftet die Legende Farben, die im Bild nicht vorkommen,
  // und niemand sieht es dem Bild an.
  const script = scriptSource
  const hex = (r: string, g: string, b: string) =>
    '#' + [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  const paletteFromScript = [...script.matchAll(/color: \[(\d+), (\d+), (\d+)\]/g)].map((m) =>
    hex(m[1], m[2], m[3]),
  )

  it('führt dieselben Landfarben in derselben Reihenfolge', () => {
    // Index 0 der Skript-Palette ist das Meer — es hat keine Legendenzeile,
    // weil es keine Höhenstufe ist.
    expect(paletteFromScript.length).toBe(RELIEF_STEPS.length + 1)
    expect(paletteFromScript.slice(1)).toEqual(RELIEF_STEPS.map((s) => s.color))
  })

  it('hält die Meeresfarbe von jeder Landstufe unterscheidbar', () => {
    expect(RELIEF_STEPS.map((s) => s.color)).not.toContain(paletteFromScript[0])
  })
})
