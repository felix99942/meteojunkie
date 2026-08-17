// Tests der reinen Klima-Rechenkerne (Aggregation, Anomalie) — Schritt 6.

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  anomaly,
  anomalyDisplay,
  anomalyScaleFor,
  AT_PARAMETERS,
  getAtParameter,
  paramOptionLabel,
  scaleFor,
  valueCaption,
} from './atParameters'
import { colorForValue } from './colorscales'

describe('aggregate', () => {
  it('reduziert je Modus korrekt', () => {
    const v = [1, 2, 3, 4]
    expect(aggregate(v, 'mean')).toBe(2.5)
    expect(aggregate(v, 'sum')).toBe(10)
    expect(aggregate(v, 'max')).toBe(4)
    expect(aggregate(v, 'min')).toBe(1)
    expect(aggregate(v, 'last')).toBe(4)
  })

  it('ignoriert null/NaN-Lücken', () => {
    expect(aggregate([1, null, 3], 'mean')).toBe(2)
    expect(aggregate([null, 5, null], 'last')).toBe(5)
    expect(aggregate([Number.NaN, 2], 'sum')).toBe(2)
  })

  it('gibt null bei ausschließlich fehlenden Werten', () => {
    expect(aggregate([], 'mean')).toBeNull()
    expect(aggregate([null, null], 'sum')).toBeNull()
  })
})

describe('anomaly', () => {
  it('delta = Wert − Normal', () => {
    expect(anomaly(12, 10, 'delta')).toBe(2)
    expect(anomaly(8, 10, 'delta')).toBe(-2)
  })

  it('percent = 100·Wert/Normal', () => {
    expect(anomaly(150, 100, 'percent')).toBe(150)
    expect(anomaly(65, 130, 'percent')).toBe(50)
  })

  it('percent bei Normal 0 → null (keine Division durch 0)', () => {
    expect(anomaly(5, 0, 'percent')).toBeNull()
  })
})

describe('scaleFor', () => {
  const rr = getAtParameter('rr')
  const t = getAtParameter('tl_mittel')

  it('streckt die Niederschlagsskala auf Monat und Jahr', () => {
    expect(scaleFor(rr, 'day').stops.at(-1)!.value).toBe(100)
    expect(scaleFor(rr, 'month').stops.at(-1)!.value).toBe(1000)
    expect(scaleFor(rr, 'year').stops.at(-1)!.value).toBe(3000)
  })

  it('trennt Jahresniederschläge farblich, statt alles ins oberste Band zu legen', () => {
    const year = scaleFor(rr, 'year')
    const [dry, wet] = [600, 2000].map((v) => colorForValue(year, v))
    expect(dry).not.toBe(wet)
    // auf der Tagesskala lägen beide im obersten Band
    expect(colorForValue(rr.scale, 600)).toBe(colorForValue(rr.scale, 2000))
  })

  it('lässt Größen ohne Zeitbezugs-Skala unverändert', () => {
    expect(scaleFor(t, 'year')).toBe(t.scale)
  })
})

describe('anomalyScaleFor', () => {
  const t = getAtParameter('tl_mittel')

  it('nutzt die Wetterskala für Monat/Jahr', () => {
    expect(anomalyScaleFor(t, false)).toBe(t.anomalyScale)
  })

  it('löst das Klimasignal zwischen zwei Perioden feiner auf', () => {
    const climate = anomalyScaleFor(t, true)
    // +0,6 K und +1,2 K sind in der Wetterskala dasselbe Band, im Periodenvergleich nicht
    expect(colorForValue(t.anomalyScale, 0.6)).toBe(colorForValue(t.anomalyScale, 1.2))
    expect(colorForValue(climate, 0.6)).not.toBe(colorForValue(climate, 1.2))
  })
})

describe('anomalyDisplay', () => {
  it('beschriftet Differenzen mit Δ und Vorzeichen', () => {
    const d = anomalyDisplay(getAtParameter('tl_mittel'))
    expect(d.unit).toBe('Δ K')
    expect(d.signed).toBe(true)
  })

  it('beschriftet Anteile als „% vom Normal" OHNE Vorzeichen', () => {
    // 143 % heißt „das 1,43-Fache des Normals". Mit einem „+" davor läse man
    // 143 Prozentpunkte ÜBER dem Normal — also fast das Dreifache.
    const d = anomalyDisplay(getAtParameter('rr'))
    expect(d.unit).toBe('% vom Normal')
    expect(d.signed).toBe(false)
    expect(d.caption).toContain('100 %')
  })

  it('passt zur Rechnung in anomaly()', () => {
    // percent liefert den Anteil, nicht die Differenz — Beschriftung und
    // Rechenkern dürfen nie auseinanderlaufen
    expect(anomaly(143, 100, 'percent')).toBeCloseTo(143)
    expect(anomaly(12, 10, 'delta')).toBeCloseTo(2)
  })
})

describe('paramOptionLabel', () => {
  it('wiederholt die Kategorie nicht und nennt die Einheit', () => {
    expect(paramOptionLabel(getAtParameter('tl_mittel'))).toBe('Temperatur – Mittel (°C)')
    expect(paramOptionLabel(getAtParameter('rr'))).toBe('Niederschlag – Summe (mm)')
  })

  it('hat für jeden Parameter eine Kurzform ohne Kategoriedopplung', () => {
    for (const p of AT_PARAMETERS) {
      expect(p.shortLabel.length).toBeGreaterThan(0)
      expect(p.shortLabel.startsWith(p.category + ' ')).toBe(false)
    }
  })
})

describe('valueCaption', () => {
  const tmax = getAtParameter('tlmax')
  const tmean = getAtParameter('tl_mittel')
  const rr = getAtParameter('rr')

  it('benennt beim Maximum-Parameter je Zeitbezug die richtige Größe', () => {
    expect(valueCaption(tmax, 'day')).toBe('Tageshöchstwert')
    expect(valueCaption(tmax, 'month')).toBe('höchster Tageswert des Monats')
    expect(valueCaption(tmax, 'year')).toBe('höchster Tageswert des Jahres')
  })

  it('macht klar, dass ein Normal auch beim Maximum ein MITTEL ist', () => {
    // Der eigentliche Stolperstein: Klimaperiode + Jahr + „Temperatur Maximum"
    // zeigt keinen Höchstwert, sondern das Mittel der 30 Jahreshöchstwerte
    expect(valueCaption(tmax, 'normal')).toBe('Mittel der Jahreshöchstwerte')
    expect(valueCaption(tmax, 'normal', 'month')).toBe('Mittel der Monatshöchstwerte')
    expect(valueCaption(tmax, 'normal', 'season')).toBe('Mittel der Saisonhöchstwerte')
  })

  it('unterscheidet Mittel- und Summenparameter', () => {
    expect(valueCaption(tmean, 'normal')).toBe('langjähriges Jahresmittel')
    expect(valueCaption(rr, 'year')).toBe('Jahressumme')
    expect(valueCaption(rr, 'normal')).toBe('mittlere Jahressumme')
    expect(valueCaption(rr, 'normal', 'month')).toBe('mittlere Monatssumme')
    expect(valueCaption(rr, 'season')).toBe('Saisonsumme')
    expect(valueCaption(rr, 'normal', 'season')).toBe('mittlere Saisonsumme')
  })

  it('liefert für jeden Parameter und Zeitbezug einen Text', () => {
    for (const p of AT_PARAMETERS) {
      for (const kind of ['day', 'month', 'season', 'year', 'normal'] as const) {
        expect(valueCaption(p, kind).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('scaleFor mit Saison', () => {
  it('nutzt bei Summenparametern eine eigene Saisonskala', () => {
    // Eine Saisonsumme (3 Monate) läge in der Monatsskala im obersten Band und
    // in der Jahresskala im untersten — beides unbrauchbar
    const rr = getAtParameter('rr')
    const month = scaleFor(rr, 'month')
    const season = scaleFor(rr, 'season')
    const year = scaleFor(rr, 'year')
    const top = (sc: { stops: { value: number }[] }) => sc.stops[sc.stops.length - 1].value
    expect(top(month)).toBeLessThan(top(season))
    expect(top(season)).toBeLessThan(top(year))
  })

  it('fällt bei Parametern ohne Saisonskala auf die Monatsskala zurück', () => {
    const t = getAtParameter('tl_mittel')
    expect(scaleFor(t, 'season')).toBe(scaleFor(t, 'month'))
  })
})

describe('Anomalie-Farbskala Sonnenschein', () => {
  const so = getAtParameter('so_h')
  const rr = getAtParameter('rr')

  /** Relative Helligkeit (grob) — reicht, um „heller/wärmer" zu prüfen. */
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  }
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

  it('färbt Sonnen-Überschuss warm, nicht türkis', () => {
    // Der Fehler davor: über 100 % lief die Niederschlagsrampe ins Türkis —
    // „viel Sonne" sah aus wie „viel Regen"
    const c = colorForValue(anomalyScaleFor(so, false), 150) as string
    const { r, b } = rgb(c)
    expect(r).toBeGreaterThan(b + 60)
  })

  it('färbt Sonnenmangel kühl und dunkel', () => {
    const c = colorForValue(anomalyScaleFor(so, false), 50) as string
    const { r, b } = rgb(c)
    expect(b).toBeGreaterThan(r + 20)
    expect(lum(c)).toBeLessThan(140)
  })

  it('wird mit mehr Sonne kräftiger', () => {
    const sc = anomalyScaleFor(so, false)
    const mild = colorForValue(sc, 110) as string
    const stark = colorForValue(sc, 190) as string
    expect(lum(mild)).toBeGreaterThan(lum(stark)) // von blassgelb zu sattem Orange
  })

  it('lässt den Niederschlag bei seiner eigenen Rampe', () => {
    // Für Regen ist türkis = nass genau richtig — die Sonnenskala darf nicht
    // versehentlich auf alle Prozent-Parameter durchschlagen
    expect(anomalyScaleFor(rr, false)).not.toBe(anomalyScaleFor(so, false))
    const nass = colorForValue(anomalyScaleFor(rr, false), 150) as string
    expect(rgb(nass).b).toBeGreaterThan(rgb(nass).r)
  })

  it('nutzt auch im Klimavergleich die Sonnenrampe', () => {
    const c = colorForValue(anomalyScaleFor(so, true), 115) as string
    expect(rgb(c).r).toBeGreaterThan(rgb(c).b)
  })
})
