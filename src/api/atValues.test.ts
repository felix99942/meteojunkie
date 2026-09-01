// Tests der reinen Normal-Auflösung (Klimaperioden-Zeitbezug).

import { describe, expect, it } from 'vitest'
import {
  hasRecords,
  histalpCovers,
  isParamAvailable,
  normalFor,
  normalValue,
  recordLevel,
  type NormalsMap,
  type Period,
  type RecordIndex,
} from './atValues'
import { comparePeriod, normalPeriod } from '../config/atNormals'
import { AT_PARAMETERS, getAtParameter } from '../config/atParameters'

const rr = getAtParameter('rr')
const monthly = Array.from({ length: 12 }, (_, i) => 50 + i)
const normals: NormalsMap = { 1: { rr: { monthly, annual: 1100, ny: 29 } } }

describe('normalValue', () => {
  it('month = null → Jahresnormal', () => {
    expect(normalValue(normals[1].rr, null)).toBe(1100)
  })

  it('month 1..12 → Monatsnormal', () => {
    expect(normalValue(normals[1].rr, 1)).toBe(50)
    expect(normalValue(normals[1].rr, 12)).toBe(61)
  })

  it('fehlender Eintrag → null (kein Scheinwert)', () => {
    expect(normalValue(undefined, null)).toBeNull()
  })
})

describe('normalFor', () => {
  it('Jahr und Klimaperiode ohne Monat ziehen das Jahresnormal', () => {
    const year: Period = { kind: 'year', year: 2024 }
    const clim: Period = { kind: 'normal', periodId: '1961-1990', month: null }
    expect(normalFor(normals, rr, year, 1)).toBe(1100)
    expect(normalFor(normals, rr, clim, 1)).toBe(1100)
  })

  it('Monat und Klimaperioden-Monat ziehen dasselbe Monatsnormal', () => {
    const month: Period = { kind: 'month', year: 2024, month: 3 }
    const clim: Period = { kind: 'normal', periodId: '1991-2020', month: 3 }
    expect(normalFor(normals, rr, month, 1)).toBe(52)
    expect(normalFor(normals, rr, clim, 1)).toBe(52)
  })

  it('Tag hat kein Normal', () => {
    expect(normalFor(normals, rr, { kind: 'day', day: '2024-03-01' }, 1)).toBeNull()
  })

  it('Allzeit hat kein Normal — ein Rekord ist ein Ereignis, kein Mittelwert', () => {
    const rec: Period = { kind: 'record', extreme: 'max', month: null }
    expect(normalFor(normals, rr, rec, 1)).toBeNull()
  })

  it('Parameter ohne Monatscode (Schnee) hat kein Normal', () => {
    const sh = getAtParameter('sh')
    expect(normalFor(normals, sh, { kind: 'year', year: 2024 }, 1)).toBeNull()
  })
})

describe('comparePeriod', () => {
  it('vergleicht mit der nächstälteren Periode', () => {
    expect(comparePeriod('1991-2020')).toBe('1961-1990')
  })

  it('die älteste Periode vergleicht sich mit der jüngeren — nie mit sich selbst', () => {
    expect(comparePeriod('1961-1990')).toBe('1991-2020')
  })

  it('Perioden sind 30-jährig und lückenlos gestaffelt', () => {
    for (const id of ['1991-2020', '1961-1990'] as const) {
      const p = normalPeriod(id)
      expect(p.lastYear - p.firstYear + 1).toBe(30)
    }
  })
})


// --- Allzeit-Rekorde (Zeitbezug „record") ------------------------------------

/** Zwei Stationen, damit die Zuordnung Wert ↔ Station geprüft werden kann. */
const idx: RecordIndex = {
  code: 'tlmax',
  ids: [11, 22],
  abs: { max: { v: [37.7, 41.2] }, min: { v: [-1, 0.5] } },
  ann: { max: { v: [36.9, 40.1] }, min: { v: [-0.5, 1] } },
  mon: Array.from({ length: 12 }, (_, m) => ({
    max: { v: [10 + m, 20 + m] },
    min: { v: [-10 + m, -20 + m] },
  })),
  sea: {
    DJF: { max: { v: [5, 6] }, min: { v: [-5, -6] } },
    MAM: { max: { v: [15, 16] }, min: { v: [-1, -2] } },
    JJA: { max: { v: [35, 36] }, min: { v: [20, 21] } },
    SON: { max: { v: [25, 26] }, min: { v: [0, 1] } },
  },
}

describe('recordLevel', () => {
  it('ohne Ausschnitt den absoluten Rekord, in beide Richtungen', () => {
    expect(recordLevel(idx, { extreme: 'max', month: null }).v).toEqual([37.7, 41.2])
    expect(recordLevel(idx, { extreme: 'min', month: null }).v).toEqual([-1, 0.5])
  })

  it('trennt den JAHRESwert vom besten Einzelmonat', () => {
    // Der Fehler, der das ausgelöst hat: „höchster Jahresniederschlag" landete
    // beim nassesten Monat. Beides sind Rekorde, aber verschiedene.
    expect(recordLevel(idx, { extreme: 'max', month: null, annual: true }).v).toEqual([36.9, 40.1])
    expect(recordLevel(idx, { extreme: 'min', month: null, annual: true }).v).toEqual([-0.5, 1])
  })

  it('ein genannter Monat schlägt den Jahreswert', () => {
    expect(recordLevel(idx, { extreme: 'max', month: 1, annual: true }).v).toEqual([10, 20])
  })

  it('Kalendermonat 1..12 auf den Index 0..11 abgebildet', () => {
    // Ein Off-by-one hier zeigte den Juni-Rekord unter der Überschrift „Juli".
    expect(recordLevel(idx, { extreme: 'max', month: 1 }).v).toEqual([10, 20])
    expect(recordLevel(idx, { extreme: 'max', month: 12 }).v).toEqual([21, 31])
  })

  it('die Saison hat Vorrang, wenn beides gesetzt wäre', () => {
    // Die UI setzt immer nur eines von beiden; der Kern muss trotzdem
    // eindeutig entscheiden, statt still den Monat zu mischen.
    expect(recordLevel(idx, { extreme: 'max', month: 7, season: 'JJA' }).v).toEqual([35, 36])
  })
})

describe('Allzeit-Verfügbarkeit', () => {
  const rec: Period = { kind: 'record', extreme: 'max', month: null }

  it('gilt für jeden Parameter mit Rekord-Asset — auch für Kenntage', () => {
    // Kenntage sind im TAG-Modus gesperrt, im Allzeit-Modus aber sinnvoll
    // („meiste Frosttage, die ein Jänner je hatte").
    expect(isParamAvailable(getAtParameter('tage_frost'), rec)).toBe(true)
    expect(isParamAvailable(getAtParameter('rfb_mittel'), rec)).toBe(true)
  })

  it('sperrt Parameter ohne Rekorde statt leere Karten zu zeigen', () => {
    // Schneehöhe hat keinen Monatsdatensatz und damit keine Rekorde;
    // die gefühlte Temperatur gibt es nur für den laufenden Tag.
    expect(hasRecords(getAtParameter('sh'))).toBe(false)
    expect(isParamAvailable(getAtParameter('sh'), rec)).toBe(false)
    expect(isParamAvailable(getAtParameter('gefuehlt'), rec)).toBe(false)
  })

  it('jeder Registry-Parameter mit Monatscode außer Schnee hat Rekorde', () => {
    // Hält Registry und Ingest-Codeliste (scripts/at-ingest-records.mjs)
    // zusammen: ein neuer Monatsparameter ohne Rekord-Ingest fiele hier auf.
    for (const p of AT_PARAMETERS) {
      if (!p.monthlyCode) continue
      expect(hasRecords(p)).toBe(true)
    }
  })
})


describe('histalpCovers', () => {
  const tmean = getAtParameter('tl_mittel')
  const rr = getAtParameter('rr')
  const tmax = getAtParameter('tlmax')
  const clim = (extra: Partial<Period> = {}): Period =>
    ({ kind: 'normal', periodId: '1991-2020', month: null, ...extra }) as Period

  it('deckt Temperaturmittel und Niederschlag im Jahresausschnitt ab', () => {
    expect(histalpCovers(tmean, clim())).toBe(true)
    expect(histalpCovers(rr, clim())).toBe(true)
  })

  it('deckt keinen anderen Parameter ab', () => {
    // HISTALP führt genau zwei Größen; Tmax, Sonnenschein, Kenntage gibt es
    // dort nicht — die Karte muss dort bei klima-v2 bleiben.
    expect(histalpCovers(tmax, clim())).toBe(false)
    expect(histalpCovers(getAtParameter('so_h'), clim())).toBe(false)
    expect(histalpCovers(getAtParameter('tage_frost'), clim())).toBe(false)
  })

  it('deckt Monat und Saison nicht ab — der Datensatz ist JÄHRLICH', () => {
    expect(histalpCovers(tmean, clim({ month: 7 }))).toBe(false)
    expect(histalpCovers(tmean, clim({ season: 'JJA' }))).toBe(false)
  })

  it('gilt nur für den Periodenvergleich, nicht für Wetterzeiträume', () => {
    // Ein einzelnes Jahr gegen das Normal ist Wetter, keine Trendaussage —
    // und der gemessene Wert käme ohnehin aus klima-v2.
    expect(histalpCovers(tmean, { kind: 'year', year: 2024 })).toBe(false)
    expect(histalpCovers(tmean, { kind: 'month', year: 2024, month: 7 })).toBe(false)
    expect(histalpCovers(tmean, { kind: 'day', day: '2024-07-01' })).toBe(false)
  })
})
