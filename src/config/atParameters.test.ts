// Tests der reinen Klima-Rechenkerne (Aggregation, Anomalie) — Schritt 6.

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  anomaly,
  anomalyBarColors,
  RECORD_TONES,
  recordToneColors,
  anomalyDisplay,
  anomalyScaleFor,
  AT_PARAMETERS,
  defaultRecordExtreme,
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

  it('unterscheidet beim Allzeit-Rekord die beiden RICHTUNGEN', () => {
    // Der Kern des Zeitbezugs „Allzeit": bei „Temperatur Maximum" ist das
    // Maximum über alle Monatsmaxima der höchste je gemessene Tageswert — das
    // MINIMUM derselben Reihe aber der kühlste Monatshöchstwert. Beides ist
    // ein Rekord, und nur der Text hält sie auseinander.
    expect(valueCaption(tmax, 'record', 'series', 'max')).toBe('höchster je gemessener Tageswert')
    expect(valueCaption(tmax, 'record', 'series', 'min')).toBe('tiefster Monatshöchstwert der Messreihe')
    const tmin = getAtParameter('tlmin')
    expect(valueCaption(tmin, 'record', 'series', 'min')).toBe('tiefster je gemessener Tageswert')
    expect(valueCaption(tmin, 'record', 'series', 'max')).toBe('höchster Monatstiefstwert der Messreihe')
  })

  it('trennt beim Allzeit-Rekord den besten EINZELMONAT vom JAHRESwert', () => {
    // Der Fehler, der das ausgelöst hat: „höchster Jahresniederschlag" wurde
    // mit dem nassesten Monat beantwortet (404 mm statt 1.835 mm). Bei Summen
    // liegen die Ebenen um eine Größenordnung auseinander, der Text muss sie
    // benennen.
    expect(valueCaption(rr, 'record', 'series', 'max')).toBe('höchste Monatssumme der Messreihe')
    expect(valueCaption(rr, 'record', 'year', 'max')).toBe('höchste Jahressumme der Messreihe')
    expect(valueCaption(rr, 'record', 'month', 'max')).toBe('höchste Monatssumme der Messreihe')
    expect(valueCaption(rr, 'record', 'season', 'max')).toBe('höchste Saisonsumme der Messreihe')
  })

  it('lässt bei Maximum-Größen Jahres- und Reihenrekord zusammenfallen', () => {
    // Das höchste JAHRESmaximum IST das absolute Maximum — anders als bei
    // Summen gibt es hier keinen Unterschied, und der Text darf keinen
    // behaupten.
    expect(valueCaption(tmax, 'record', 'year', 'max')).toBe(
      valueCaption(tmax, 'record', 'series', 'max'),
    )
  })

  it('setzt die Richtung je Parameter sinnvoll vor', () => {
    expect(defaultRecordExtreme(getAtParameter('tlmin'))).toBe('min')
    expect(defaultRecordExtreme(tmax)).toBe('max')
    expect(defaultRecordExtreme(rr)).toBe('max')
  })

  it('liefert für jeden Parameter und Zeitbezug einen Text', () => {
    for (const p of AT_PARAMETERS) {
      for (const kind of ['day', 'month', 'season', 'year', 'normal'] as const) {
        expect(valueCaption(p, kind).length).toBeGreaterThan(0)
      }
      for (const scope of ['year', 'month', 'season', 'series'] as const) {
        for (const extreme of ['max', 'min'] as const) {
          expect(valueCaption(p, 'record', scope, extreme).length).toBeGreaterThan(0)
        }
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

describe('aggregate — Kenntage', () => {
  const summer = { source: 'tlmax', op: '>=' as const, value: 25 }
  const frost = { source: 'tlmin', op: '<' as const, value: 0 }

  it('zählt die Tage, die die Schwelle erfüllen', () => {
    expect(aggregate([24.9, 25, 25.1, 30], 'count', summer)).toBe(3)
  })

  it('behandelt „<" als echt kleiner, „>=" als einschließend', () => {
    // Ein Tagesminimum von genau 0 °C ist KEIN Frosttag.
    expect(aggregate([0, -0.1, -5], 'count', frost)).toBe(2)
    // Genau 25 °C IST ein Sommertag.
    expect(aggregate([25], 'count', summer)).toBe(1)
  })

  it('überspringt Lücken, statt sie als nicht erfüllt zu zählen', () => {
    expect(aggregate([30, null, 30], 'count', summer)).toBe(2)
  })

  it('gibt null statt einer Zahl zurück, wenn die Regel fehlt', () => {
    // Eine Anzahl ohne Vergleich ist nicht bestimmbar — eine stillschweigende
    // 0 wäre die gefährlichere Antwort.
    expect(aggregate([30, 30], 'count')).toBeNull()
  })

  it('gibt bei ausschließlich Lücken null zurück, nicht 0', () => {
    expect(aggregate([null, null], 'count', summer)).toBeNull()
  })
})

describe('Registry-Identität', () => {
  it('vergibt jeden Parametercode genau einmal', () => {
    // `code` ist der Schlüssel für `getAtParameter`, den Dropdown-Wert und den
    // gespeicherten Zustand. Ein doppelter Code verdeckt still den anderen
    // Parameter — genau das passierte, als die Kenntage ihren Tagesrohwert
    // (`tlmax`) als Code trugen.
    const codes = AT_PARAMETERS.map((p) => p.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('nennt bei Kenntagen die Tagesquelle getrennt vom Code', () => {
    for (const p of AT_PARAMETERS.filter((p) => p.countRule)) {
      expect(p.agg).toBe('count')
      expect(p.monthlyCode).toBe(p.code)
      expect(p.countRule?.source).not.toBe(p.code)
    }
  })
})

// ---------------------------------------------------------------------------
// Kälte-Kenntage: das OBERE Ende bedeutet KALT, also dreht die Farbpolarität.
// Der Anlass war das Stationsdetail — roter ▲ auf „86 Frosttage, Winter 1963",
// während die Karte dieselben 86 Tage über COLD_RAMP hellblau zeichnet.
// ---------------------------------------------------------------------------

describe('highIsCold — gedrehte Farbpolarität', () => {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

  it('markiert genau die Kälte-Kenntage', () => {
    const cold = AT_PARAMETERS.filter((p) => p.highIsCold).map((p) => p.code)
    expect(cold).toEqual(['tage_frost', 'tage_eis'])
    // Gegenprobe: Hitze- und Ereignis-Kenntage bleiben normal gepolt —
    // „mehr Regentage" ist weder warm noch kalt.
    expect(getAtParameter('tage_tropen').highIsCold).toBeUndefined()
    expect(getAtParameter('tage_rr_1').highIsCold).toBeUndefined()
  })

  it('färbt MEHR Frosttage blau und WENIGER rot', () => {
    const sc = anomalyScaleFor(getAtParameter('tage_frost'), false)
    const mehr = rgb(colorForValue(sc, 20) as string)
    const weniger = rgb(colorForValue(sc, -20) as string)
    expect(mehr.b).toBeGreaterThan(mehr.r)
    expect(weniger.r).toBeGreaterThan(weniger.b)
  })

  it('… und lässt die Hitzetage anders herum', () => {
    const sc = anomalyScaleFor(getAtParameter('tage_tropen'), false)
    const mehr = rgb(colorForValue(sc, 20) as string)
    expect(mehr.r).toBeGreaterThan(mehr.b)
  })

  it('dreht auch den Klimaperioden-Vergleich', () => {
    const sc = anomalyScaleFor(getAtParameter('tage_eis'), true)
    const mehr = rgb(colorForValue(sc, 1.8) as string)
    expect(mehr.b).toBeGreaterThan(mehr.r)
  })

  // Balken und Karte MÜSSEN dieselbe Lesart treffen — sonst sagt der Balken
  // „wärmer", wo die Karte darüber „kälter" zeigt.
  it('dreht die Balken der Perioden-Historie mit', () => {
    const frost = anomalyBarColors(getAtParameter('tage_frost'))
    const hitze = anomalyBarColors(getAtParameter('tage_tropen'))
    expect(frost.pos).toBe(hitze.neg)
    expect(frost.neg).toBe(hitze.pos)
    expect(rgb(frost.pos).b).toBeGreaterThan(rgb(frost.pos).r)
  })

  // Die gespiegelte Skala darf nur die FARBEN tauschen, nicht die Schwellen:
  // sonst wanderte die Neutralzone.
  it('spiegelt nur die Farben, nicht die Schwellen', () => {
    const frost = anomalyScaleFor(getAtParameter('tage_frost'), false)
    const hitze = anomalyScaleFor(getAtParameter('tage_tropen'), false)
    expect(frost.stops.map((s) => s.value)).toEqual(hitze.stops.map((s) => s.value))
    expect(frost.stops.map((s) => s.color)).toEqual(
      hitze.stops.map((s) => s.color).slice().reverse(),
    )
  })
})

// ---------------------------------------------------------------------------
// Farbe der Rekordpfeile im Stationsdetail. Sie muss sich wie die Balken der
// Perioden-Historie im selben Fenster lesen — und als TEXT lesbar sein.
// ---------------------------------------------------------------------------

describe('recordToneColors', () => {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  /** Relative Leuchtdichte nach WCAG. */
  const lum = (hex: string) => {
    const { r, g, b } = rgb(hex)
    const f = (v: number) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contrast = (a: string, b: string) => {
    const la = lum(a)
    const lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  /** Hintergrund der Rekordzellen (`--bg-control` im Detailfenster). */
  const BG = '#232428'

  it('färbt Temperatur warm nach oben', () => {
    const t = recordToneColors(getAtParameter('tlmax'))
    expect(rgb(t.high).r).toBeGreaterThan(rgb(t.high).b)
    expect(rgb(t.low).b).toBeGreaterThan(rgb(t.low).r)
  })

  /**
   * DER ANLASS: beim Niederschlag stand ein roter ▲ auf der nassesten
   * Jahreszeit, während das Balkendiagramm zwei Zentimeter darüber Nässe
   * türkis zeichnete. Jetzt liest sich beides gleich.
   */
  it('färbt Niederschlag nass nach oben — wie die Balken darüber', () => {
    for (const code of ['rr', 'tage_rr_1']) {
      const t = recordToneColors(getAtParameter(code))
      // Türkis: mehr Grün+Blau als Rot.
      expect(rgb(t.high).b, code).toBeGreaterThan(rgb(t.high).r)
      expect(rgb(t.high).g, code).toBeGreaterThan(rgb(t.high).r)
      // Trocken: warmer Ockerton.
      expect(rgb(t.low).r, code).toBeGreaterThan(rgb(t.low).b)
      // Und dieselbe Leserichtung wie die Balken der Perioden-Historie.
      const bars = anomalyBarColors(getAtParameter(code))
      expect(rgb(bars.pos).b, code).toBeGreaterThan(rgb(bars.pos).r)
      expect(rgb(bars.neg).r, code).toBeGreaterThan(rgb(bars.neg).b)
    }
  })

  // Die Kälte-Kenntage bleiben umgedreht (eigene Regel, `highIsCold`), und
  // die Niederschlagsregel darf sie nicht überschreiben.
  it('lässt die Kälte-Kenntage umgedreht', () => {
    const t = recordToneColors(getAtParameter('tage_frost'))
    expect(rgb(t.high).b).toBeGreaterThan(rgb(t.high).r)
    expect(rgb(t.low).r).toBeGreaterThan(rgb(t.low).b)
  })

  // Sonne braucht keinen eigenen Eintrag: viel Sonne = warmes Orange ist
  // schon die richtige Lesart.
  it('lässt die Sonnenscheindauer bei warm/kalt', () => {
    expect(recordToneColors(getAtParameter('so_h'))).toEqual(
      recordToneColors(getAtParameter('tl_mittel')),
    )
  })

  /**
   * Als TEXT müssen die Farben lesbar sein — und genau daran scheiterte das
   * naheliegende „nimm einfach die Balkenfarben": gemessen kommt das
   * BrBG-Türkis #35978f auf 4,4:1, das Trüb-Blau der Sonnenrampe #4d6183
   * sogar nur auf 2,5:1. Die Pfeilfarben sind aufgehellte Fassungen.
   */
  it('hält jede Pfeilfarbe über 4,5:1 auf dem Zellenhintergrund', () => {
    for (const c of RECORD_TONES) expect(contrast(c, BG), c).toBeGreaterThanOrEqual(4.5)
    // Die rohen Balkenfarben täten das NICHT — deshalb gibt es zwei Sätze.
    expect(contrast('#35978f', BG)).toBeLessThan(4.5)
    expect(contrast('#4d6183', BG)).toBeLessThan(3)
  })

  it('gibt für jede Größe zwei verschiedene Farben', () => {
    for (const p of AT_PARAMETERS) {
      const t = recordToneColors(p)
      expect(t.high, p.code).not.toBe(t.low)
    }
  })
})
