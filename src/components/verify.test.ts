// Tests des Verifikations-Rechenkerns.

import { describe, expect, it } from 'vitest'
import { dailyExtremes, dayRange, leadsFor, score, utcDay } from './verify'

const H = 3600_000
const day0 = Date.parse('2026-08-20T00:00:00Z')
/** 24 Stundenwerte eines Tages, beginnend 00 UTC. */
const hours = (start: number, vals: number[]) =>
  vals.map((_, i) => start + i * H) as number[]

describe('dailyExtremes', () => {
  const t = hours(day0, new Array(48).fill(0))
  const v = [
    ...Array.from({ length: 24 }, (_, i) => i), // 20.8.: 0 … 23
    ...Array.from({ length: 24 }, (_, i) => 100 - i), // 21.8.: 100 … 77
  ]

  it('reduziert je UTC-Tag auf Maximum bzw. Minimum', () => {
    expect(dailyExtremes(t, v, 'max').get('2026-08-20')).toBe(23)
    expect(dailyExtremes(t, v, 'min').get('2026-08-20')).toBe(0)
    expect(dailyExtremes(t, v, 'max').get('2026-08-21')).toBe(100)
  })

  it('verwirft angeschnittene Tage', () => {
    // Am Rand des Zeitraums stehen regelmäßig Bruchstücke; ein aus vier
    // Stunden gebildetes „Tagesmaximum" wäre eine falsche Aussage.
    const short = dailyExtremes(t.slice(0, 4), v.slice(0, 4), 'max')
    expect(short.size).toBe(0)
  })

  it('ignoriert Lücken, zählt aber die verbleibenden Stunden', () => {
    const withGaps = [...v]
    for (let i = 0; i < 6; i++) withGaps[i] = null as unknown as number
    // 18 von 24 Stunden → unter der Schwelle, kein Tageswert.
    expect(dailyExtremes(t, withGaps, 'max').get('2026-08-20')).toBeUndefined()
    // Mit gelockerter Schwelle wieder da.
    expect(dailyExtremes(t, withGaps, 'max', 12)?.get('2026-08-20')).toBe(23)
  })

  it('nutzt den UTC-Tag, nicht die Ortszeit', () => {
    // 22:00 UTC am 20. ist in Wien schon der 21. — für die Zuordnung zählt
    // UTC, weil GeoSphere-Klimatage ebenso laufen.
    expect(utcDay(Date.parse('2026-08-20T22:00:00Z'))).toBe('2026-08-20')
  })
})

describe('score', () => {
  const obs = new Map([
    ['2026-08-20', 30],
    ['2026-08-21', 25],
    ['2026-08-22', 20],
  ])

  it('rechnet Bias, MAE und RMSE', () => {
    const fc = new Map([
      ['2026-08-20', 32], // +2
      ['2026-08-21', 24], // −1
      ['2026-08-22', 20], //  0
    ])
    const s = score(fc, obs)
    expect(s.n).toBe(3)
    expect(s.bias).toBeCloseTo(1 / 3, 6)
    expect(s.mae).toBeCloseTo(1, 6)
    expect(s.rmse).toBeCloseTo(Math.sqrt(5 / 3), 6)
  })

  it('behält das Vorzeichen des Bias — es IST die Aussage', () => {
    // Zwei Modelle mit DEMSELBEN MAE von 2 K: eines rechnet durchgehend 2 K zu
    // warm (Bias +2, systematisch und korrigierbar), das andere liegt
    // abwechselnd +2 und −2 daneben (Bias 0, aber genauso ungenau). Ein
    // Fehlermaß ohne Vorzeichen könnte die beiden nicht unterscheiden.
    const obs4 = new Map([
      ['2026-08-20', 30],
      ['2026-08-21', 25],
      ['2026-08-22', 20],
      ['2026-08-23', 22],
    ])
    const warm = new Map([...obs4].map(([d, v]) => [d, v + 2]))
    expect(score(warm, obs4).bias).toBeCloseTo(2, 6)
    expect(score(warm, obs4).mae).toBeCloseTo(2, 6)

    const scatter = new Map<string, number>([
      ['2026-08-20', 32],
      ['2026-08-21', 23],
      ['2026-08-22', 22],
      ['2026-08-23', 20],
    ])
    expect(score(scatter, obs4).bias).toBeCloseTo(0, 6)
    expect(score(scatter, obs4).mae).toBeCloseTo(2, 6)
  })

  it('vergleicht nur Tage, die BEIDE Reihen führen', () => {
    // Sonst mittelt eine Spalte über einen anderen Zeitraum als die daneben,
    // und die Modelle wären nicht mehr vergleichbar.
    const fc = new Map([
      ['2026-08-20', 31],
      ['2026-08-99', 99],
    ])
    const s = score(fc, obs)
    expect(s.n).toBe(1)
    expect(s.mae).toBeCloseTo(1, 6)
  })

  it('nennt den größten Einzelfehler samt Tag', () => {
    const fc = new Map([
      ['2026-08-20', 31],
      ['2026-08-21', 30],
      ['2026-08-22', 19],
    ])
    expect(score(fc, obs).worst).toEqual({ day: '2026-08-21', error: 5 })
  })

  it('ohne gemeinsame Tage keine Zahlen statt einer Null', () => {
    const s = score(new Map(), obs)
    expect(s.n).toBe(0)
    expect(Number.isNaN(s.mae)).toBe(true)
  })
})

describe('leadsFor', () => {
  it('folgt dem tatsächlichen Lauf: 00 UTC, Vorlauf 24·n bis 24·n+23', () => {
    // WELCHER Lauf hinter `previous_dayN` steckt, ist live ermittelt: der von
    // 00 UTC des Tages n Tage vorher. Beweis über die Horizonte — bei
    // KONSTANTEM Vorlauf 48 h müsste AROME Austria (60 h) `previous_day2`
    // liefern, die Spalte ist aber vollständig leer. Mit 24·n + Tagesstunde
    // bräuchte sie 71 h.
    expect(leadsFor(60, 7)).not.toContain(2)
    // ICON-EU (120 h) trägt n=4 (braucht 119 h), aber nicht n=5 (143 h) —
    // bei konstantem Vorlauf hätte n=5 mit genau 120 h noch gepasst.
    expect(leadsFor(120, 7)).toContain(4)
    expect(leadsFor(120, 7)).not.toContain(5)
  })

  it('deckelt den Vorlauf am Modellhorizont', () => {
    // Ein Tagesmaximum braucht den GANZEN Zieltag: für Vorlauf 1 muss das
    // Modell 48 h weit rechnen, für Vorlauf 4 volle 120 h. Die Erwartungen
    // sind LIVE gegen die API gemessen (2026-09-01) und nicht hergeleitet —
    // die Regel trifft alle vier Fälle exakt.
    expect(leadsFor(48, 7)).toEqual([1]) // ICON-D2, gemessen: 1
    expect(leadsFor(60, 7)).toEqual([1]) // AROME Austria, gemessen: 1
    expect(leadsFor(120, 7)).toEqual([1, 2, 3, 4]) // ICON-EU, gemessen: 1–4
    expect(leadsFor(360, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]) // ECMWF IFS
  })

  it('gibt nichts zurück, wenn das Modell nicht einmal einen Tag weit reicht', () => {
    expect(leadsFor(24, 7)).toEqual([])
  })
})

describe('dayRange', () => {
  it('zählt einschließlich beider Enden und über Monatsgrenzen', () => {
    expect(dayRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })
})
