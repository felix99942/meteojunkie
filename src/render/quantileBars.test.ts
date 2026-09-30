// Die Rasterung der Quantil-Säulen. Gezeichnet wird auf Canvas und damit
// hier nicht prüfbar — die Entscheidungen DAVOR schon, und an ihnen hängt,
// ob aus der Verteilung eine lesbare Reihe oder eine geschlossene Fläche wird.

import { describe, expect, it } from 'vitest'
import { barIndices, barStepHours, barWidth, densityBins, smoothBins } from './quantileBars'

const H = 3_600_000

describe('barStepHours', () => {
  // Stündliche Summenkurve, eng gezoomt: jede Stunde bekommt ihre Säule.
  it('nimmt bei viel Platz den feinsten Schritt', () => {
    expect(barStepHours(20, 1, 7)).toBe(1)
  })

  // 15 Tage auf 1000 px sind ~2,8 px je Stunde — bei 7 px Mindestabstand
  // bleibt der 3-Stunden-Schritt.
  it('dünnt bei dichter Reihe aus', () => {
    expect(barStepHours(2.8, 1, 7)).toBe(3)
    expect(barStepHours(1, 1, 7)).toBe(12)
  })

  /**
   * NUR RUNDE SCHRITTE. Ein aus der Breite gerechneter krummer Wert (5 h,
   * 7 h) setzte die Säulen auf wandernde Uhrzeiten, und beim Zoomen sprängen
   * sie über die Tagesgrenzen — dieselbe Regel wie bei den Symbolreihen des
   * klassischen Meteogramms.
   */
  it('liefert immer ein rundes Stundenvielfaches', () => {
    const erlaubt = [1, 2, 3, 6, 12, 24, 48]
    for (let px = 0.2; px < 40; px += 0.2) {
      expect(erlaubt, String(px)).toContain(barStepHours(px, 1, 7))
    }
  })

  // Feiner als das Datenraster geht nicht: die 6-h-Mengen haben zwischen
  // ihren Stützstellen keine Werte, eine 1-h-Säule wäre erfunden.
  it('geht nie unter das Datenraster', () => {
    expect(barStepHours(40, 6, 7)).toBe(6)
    expect(barStepHours(0.5, 6, 7)).toBeGreaterThanOrEqual(6)
  })
})

describe('barIndices', () => {
  // An der UTC-Zeit festgemacht, nicht am Datenbeginn — sonst stünden zwei
  // Panels nebeneinander versetzt (dieselbe Überlegung wie bucketMembers).
  it('trifft die vollen Stunden des Rasters, egal wo die Reihe beginnt', () => {
    const start = Date.UTC(2026, 0, 1, 5) // 05 UTC
    const times = Array.from({ length: 24 }, (_, i) => start + i * H) // 05 … 04 UTC
    const idx = barIndices(times, 6)
    expect(idx.map((i) => new Date(times[i]).getUTCHours())).toEqual([6, 12, 18, 0])
  })

  it('nimmt bei Schritt 1 alles', () => {
    const times = [0, H, 2 * H]
    expect(barIndices(times, 1)).toEqual([0, 1, 2])
  })

  it('verträgt ein Raster, das gröber ist als der Schritt', () => {
    const times = [0, 6 * H, 12 * H, 18 * H]
    expect(barIndices(times, 12)).toEqual([0, 2])
  })
})

describe('barWidth', () => {
  it('lässt zwischen zwei Säulen Luft', () => {
    expect(barWidth(20, 1, 1)).toBeLessThan(20)
  })

  // Unter 5 px trägt eine Säule keine Memberstriche mehr, über 24 px sieht
  // sie aus wie ein Mengenbalken — sie zeigt aber eine Verteilung.
  it('bleibt zwischen 5 und 24 px', () => {
    expect(barWidth(0.1, 1, 1)).toBe(5)
    expect(barWidth(200, 1, 1)).toBe(24)
  })

  it('rechnet den Schritt in die Breite ein', () => {
    // 3-h-Schritt auf stündlichem Raster: drei Slots stehen zur Verfügung.
    expect(barWidth(4, 3, 1)).toBe(Math.round(12 * 0.62))
  })
})

describe('densityBins', () => {
  it('zählt die Member in ihren Höhenabschnitten', () => {
    // Kasten von y=0 bis y=100, vier Abschnitte à 25 px.
    expect(densityBins([10, 12, 60, 99], 0, 100, 4)).toEqual([2, 0, 1, 1])
  })

  /**
   * Ein Wert ÜBER oder UNTER dem Kasten (im Fühlerbereich) verschwindet
   * nicht, er zählt zum Randabschnitt: er ist Teil der Verteilung, nur eben
   * ein Ausreißer, und seine Masse gehört an den Rand der Dichte.
   */
  it('schlägt Werte außerhalb dem Randabschnitt zu', () => {
    expect(densityBins([-50, 150], 0, 100, 4)).toEqual([1, 0, 0, 1])
  })

  it('verträgt einen Kasten ohne Höhe (alle Member gleich)', () => {
    expect(densityBins([7, 7, 7], 7, 0, 5)[0]).toBe(3)
  })

  it('summiert sich immer auf die Memberzahl', () => {
    const ys = [0, 3, 3, 3, 40, 41, 99, 100]
    const sum = densityBins(ys, 0, 100, 7).reduce((a, b) => a + b, 0)
    expect(sum).toBe(ys.length)
  })
})

describe('smoothBins', () => {
  // Ohne Glättung springt die Deckkraft von Abschnitt zu Abschnitt zwischen
  // 0, 1 und 2 Treffern — das sieht nach Rauschen aus, nicht nach Verteilung.
  it('mittelt über die Nachbarn', () => {
    expect(smoothBins([0, 3, 0])).toEqual([1, 1, 1])
  })

  // Der Rand zählt sich selbst doppelt, sonst bräche die Dichte oben und
  // unten künstlich ein.
  it('lässt den Rand nicht einbrechen', () => {
    expect(smoothBins([3, 3, 3])).toEqual([3, 3, 3])
  })

  it('erhält die Gesamtmasse ungefähr', () => {
    const c = [0, 2, 5, 9, 4, 1, 0]
    const before = c.reduce((a, b) => a + b, 0)
    const after = smoothBins(c).reduce((a, b) => a + b, 0)
    expect(Math.abs(after - before)).toBeLessThan(1.5)
  })

  it('lässt sehr kurze Listen in Ruhe', () => {
    expect(smoothBins([4, 1])).toEqual([4, 1])
  })
})
