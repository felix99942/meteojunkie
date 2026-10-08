import { describe, expect, it } from 'vitest'
import { colorCandidates, colorToValue, parseGibsColormap, tilePixel, valueAtPixel, type ColorStop } from './gibsReadout'

// Ausschnitt der echten GIBS-Tabelle (Clean_Longwave_Infrared_Window_Band.xml, v1.3)
const XML = `<ColorMaps><ColorMap title="Infrared Brightness Temperature" units="°C"><Entries>
<ColorMapEntry rgb="0,85,77" transparent="false" sourceValue="(-33.1,-32.1]" value="(-33.1,-32.1]" ref="59"/>
<ColorMapEntry rgb="0,64,86" transparent="false" sourceValue="(-32.1,-31.1]" value="(-32.1,-31.1]" ref="60"/>
<ColorMapEntry rgb="0,42,96" transparent="false" sourceValue="(-31.1,-30.6]" value="(-31.1,-30.6]" ref="61"/>
<ColorMapEntry rgb="114,114,114" transparent="false" sourceValue="(12.9,13.4]" value="(12.9,13.4]" ref="117"/>
<ColorMapEntry rgb="112,112,112" transparent="false" sourceValue="(13.9,14.4]" value="(13.9,14.4]" ref="118"/>
</Entries></ColorMap><ColorMap title="No Data"><Entries>
<ColorMapEntry rgb="0,0,0" transparent="true" nodata="true" ref="162"/>
</Entries></ColorMap></ColorMaps>`

describe('GIBS-Farbtabelle', () => {
  const stops = parseGibsColormap(XML)

  it('liest Farbe und Mitte der Spanne, ohne den „No Data"-Eintrag', () => {
    expect(stops).toHaveLength(5)
    expect(stops[0]).toEqual({ rgb: [0, 85, 77], value: -32.6 })
    expect(stops[3].value).toBeCloseTo(13.15)
  })

  it('trifft eine Tabellenfarbe exakt', () => {
    expect(colorToValue(0, 64, 86, stops)).toBeCloseTo(-31.6)
  })

  it('liest eine gemischte Nachbarfarbe auf dem Verlauf zwischen zwei Einträgen', () => {
    // halb zwischen (0,85,77) und (0,64,86): −32,6 … −31,6
    const v = colorToValue(0, 75, 81, stops)!
    expect(v).toBeGreaterThan(-32.6)
    expect(v).toBeLessThan(-31.6)
  })

  it('Grau eine Stufe neben dem Eintrag bleibt beim Eintrag', () => {
    // gemessen: GIBS-Kacheln enthalten 113 neben den Einträgen 114/112
    expect(colorToValue(113, 113, 113, stops)).toBeGreaterThan(13)
    expect(colorToValue(113, 113, 113, stops)).toBeLessThan(14.2)
  })

  it('weit vom Verlauf (Mischung nicht benachbarter Abschnitte): keine Zahl', () => {
    expect(colorToValue(255, 0, 0, stops)).toBeNull()
  })
})

describe('Kachel am Punkt', () => {
  it('rechnet die XYZ-Kachel und das Pixel darin', () => {
    // Stufe 1 hat vier Kacheln; (0°, 0°) ist die obere linke Ecke von Kachel (1, 1)
    expect(tilePixel(0, 0, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 })
    // Phnom Penh auf Stufe 6 (geprüft gegen die Kachel, die GIBS dort liefert)
    const t = tilePixel(11.5, 105, 6)
    expect([t.x, t.y]).toEqual([50, 29])
  })
})

describe('Grau bedeutet zweimal etwas', () => {
  // Die echte Tabelle führt ein kaltes Grauband (−80 … −70 °C) UND die warme
  // Graurampe (+13 … +57 °C); (105,105,105) ist +16,65 °C ODER ≈ −74,7 °C.
  const stops: ColorStop[] = [
    { rgb: [129, 129, 129], value: -75.6 },
    { rgb: [102, 102, 102], value: -74.6 },
    { rgb: [76, 76, 76], value: -73.6 },
    { rgb: [200, 0, 0], value: -68 },
    { rgb: [106, 106, 106], value: 16.15 },
    { rgb: [105, 105, 105], value: 16.65 },
    { rgb: [104, 104, 104], value: 17.15 },
  ]
  const tile = (fill: [number, number, number], center: [number, number, number]) => {
    const size = 21
    const d = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i++) d.set([...fill, 255], 4 * i)
    d.set([...center, 255], 4 * (10 * size + 10))
    return { d, size }
  }

  it('liefert für Grau zwei Deutungen und deshalb allein keinen Wert', () => {
    const c = colorCandidates(105, 105, 105, stops)
    expect(c).toHaveLength(2)
    expect(colorToValue(105, 105, 105, stops)).toBeNull()
  })

  it('eine graue Fläche ohne Farbe ringsum ist WARM (Golf von Bengalen, wolkenfrei)', () => {
    const { d, size } = tile([105, 105, 105], [105, 105, 105])
    expect(valueAtPixel(d, size, 10, 10, stops)).toBeCloseTo(16.65, 0)
  })

  it('Grau mitten in kalten farbigen Gipfeln ist KALT', () => {
    const { d, size } = tile([200, 0, 0], [105, 105, 105])
    const v = valueAtPixel(d, size, 10, 10, stops) as number
    expect(v).toBeLessThan(-70)
  })

  it('durchsichtig: kein Wert', () => {
    const d = new Uint8ClampedArray(4)
    expect(valueAtPixel(d, 1, 0, 0, stops)).toBe('none')
  })
})
