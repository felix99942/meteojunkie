// Tests des Verifikations-Rechenkerns.

import { describe, expect, it } from 'vitest'
import {
  climateDay,
  contingency,
  dailyValues,
  dayRange,
  ets,
  EXTREME_DAY_OFFSET_H,
  far,
  frequencyBias,
  leadsFor,
  persistenceForecast,
  pod,
  precipDay,
  PRECIP_DAY_OFFSET_H,
  score,
  skillScore,
  utcDay,
} from './verify'

const H = 3600_000
const day0 = Date.parse('2026-08-20T00:00:00Z')
/** 24 Stundenwerte eines Tages, beginnend 00 UTC. */
const hours = (start: number, vals: number[]) =>
  vals.map((_, i) => start + i * H) as number[]

describe('climateDay', () => {
  // Der GeoSphere-Klimatag läuft 18 UTC (Vortag) bis 18 UTC — gemessen gegen
  // die 10-Minuten-Reihe an 5 Stationen über 298 Stationstage (siehe
  // verify.ts). Das ist die Konvention 19–19 MEZ und steht in keiner Doku.
  it('zieht den Abend ab 18 UTC schon zum FOLGENDEN Tag', () => {
    expect(climateDay(Date.parse('2026-08-20T17:59:00Z'))).toBe('2026-08-20')
    expect(climateDay(Date.parse('2026-08-20T18:00:00Z'))).toBe('2026-08-21')
    expect(climateDay(Date.parse('2026-08-20T23:00:00Z'))).toBe('2026-08-21')
  })

  it('lässt Nacht und Nachmittag beim Kalendertag', () => {
    expect(climateDay(Date.parse('2026-08-21T00:00:00Z'))).toBe('2026-08-21')
    expect(climateDay(Date.parse('2026-08-21T14:00:00Z'))).toBe('2026-08-21')
  })

  it('ist NICHT der UTC-Tag — sonst gäbe es den Fehler nicht, den er behebt', () => {
    const evening = Date.parse('2026-08-20T20:00:00Z')
    expect(utcDay(evening)).toBe('2026-08-20')
    expect(climateDay(evening)).toBe('2026-08-21')
  })
})

describe('dailyValues', () => {
  // Zwei volle Klimatage: 20.8. 18 UTC … 22.8. 18 UTC.
  const t = hours(day0 + 18 * H, new Array(48).fill(0))
  const v = [
    ...Array.from({ length: 24 }, (_, i) => i), // Klimatag 21.8.: 0 … 23
    ...Array.from({ length: 24 }, (_, i) => 100 - i), // Klimatag 22.8.: 100 … 77
  ]

  it('reduziert je KLIMATAG auf Maximum bzw. Minimum', () => {
    expect(dailyValues(t, v, 'max', EXTREME_DAY_OFFSET_H).get('2026-08-21')).toBe(23)
    expect(dailyValues(t, v, 'min', EXTREME_DAY_OFFSET_H).get('2026-08-21')).toBe(0)
    expect(dailyValues(t, v, 'max', EXTREME_DAY_OFFSET_H).get('2026-08-22')).toBe(100)
  })

  it('rechnet den Abend des Vortags in den Klimatag hinein', () => {
    // DER Fall, an dem sich das Fenster entscheidet: heißer Abend, kühler
    // Folgetag. Über 00–24 UTC käme 10 heraus, richtig ist die 30 vom Vorabend
    // — genau so setzt GeoSphere das Klima-Tagesmaximum (Wien Hohe Warte,
    // 29.08.2026: 29,5 °C aus dem Abend des 28., während der Kalendertag nur
    // 26,2 °C brachte).
    const times = hours(day0 + 18 * H, new Array(24).fill(0))
    const vals = [...new Array(6).fill(30), ...new Array(18).fill(10)]
    expect(dailyValues(times, vals, 'max', EXTREME_DAY_OFFSET_H).get('2026-08-21')).toBe(30)
  })

  it('verwirft angeschnittene Tage', () => {
    // Am Rand des Zeitraums stehen regelmäßig Bruchstücke; ein aus vier
    // Stunden gebildetes „Tagesmaximum" wäre eine falsche Aussage.
    const short = dailyValues(t.slice(0, 4), v.slice(0, 4), 'max', EXTREME_DAY_OFFSET_H)
    expect(short.size).toBe(0)
  })

  it('ignoriert Lücken, zählt aber die verbleibenden Stunden', () => {
    const withGaps = [...v]
    for (let i = 0; i < 6; i++) withGaps[i] = null as unknown as number
    // 18 von 24 Stunden → unter der Schwelle, kein Tageswert.
    expect(dailyValues(t, withGaps, 'max', EXTREME_DAY_OFFSET_H).get('2026-08-21')).toBeUndefined()
    // Mit gelockerter Schwelle wieder da.
    expect(dailyValues(t, withGaps, 'max', EXTREME_DAY_OFFSET_H, 12)?.get('2026-08-21')).toBe(23)
  })

  it('nutzt UTC, nicht die Ortszeit', () => {
    // Der Bezug ist UTC (plus der Klimatag-Versatz), nicht die Zeitzone des
    // Punkts — Open-Meteo wird überall mit `timezone: 'UTC'` abgefragt.
    expect(utcDay(Date.parse('2026-08-20T22:00:00Z'))).toBe('2026-08-20')
  })
})

describe('precipDay', () => {
  // Der Niederschlagstag läuft in die ANDERE Richtung als der Extremtag:
  // 06–06 UTC vorwärts (07–07 MEZ). Gemessen an 126 nassen Stationstagen —
  // 0,03 mm Restfehler gegen 1,14 mm bei 00–24 UTC und 3,66 mm beim
  // Extremtag-Fenster. Die beiden Vorzeichen NICHT angleichen.
  it('zählt den frühen Morgen noch zum VORTAG', () => {
    expect(precipDay(Date.parse('2026-08-21T05:59:00Z'))).toBe('2026-08-20')
    expect(precipDay(Date.parse('2026-08-21T06:00:00Z'))).toBe('2026-08-21')
    expect(precipDay(Date.parse('2026-08-21T23:00:00Z'))).toBe('2026-08-21')
  })

  it('läuft dem Extremtag entgegengesetzt', () => {
    // Derselbe Zeitpunkt, zwei Messtage: 20:00 UTC am 20.8. gehört beim
    // Extremtag schon zum 21., beim Niederschlag noch zum 20.
    const evening = Date.parse('2026-08-20T20:00:00Z')
    expect(climateDay(evening)).toBe('2026-08-21')
    expect(precipDay(evening)).toBe('2026-08-20')
    expect(EXTREME_DAY_OFFSET_H).toBe(-PRECIP_DAY_OFFSET_H)
  })
})

describe('dailyValues – Summen', () => {
  it('summiert über den Niederschlagstag statt zu extremieren', () => {
    // 24 Stunden ab 06 UTC = genau ein Niederschlagstag.
    const t = hours(day0 + 6 * H, new Array(24).fill(0))
    const v = new Array(24).fill(0.5)
    expect(dailyValues(t, v, 'sum', PRECIP_DAY_OFFSET_H).get('2026-08-20')).toBeCloseTo(12, 6)
  })

  it('verwirft angeschnittene Tage — bei einer Summe ist das heikler', () => {
    // Ein halber Tag Regen sähe nicht kaputt aus, sondern einfach nach
    // weniger Regen. Genau deshalb greift die Mindeststundenzahl auch hier.
    const t = hours(day0 + 6 * H, new Array(12).fill(0))
    expect(dailyValues(t, new Array(12).fill(1), 'sum', PRECIP_DAY_OFFSET_H).size).toBe(0)
  })
})

describe('persistenceForecast', () => {
  it('schiebt die Messung um einen Tag nach vorn', () => {
    const obs = new Map([
      ['2026-08-20', 25],
      ['2026-08-21', 30],
    ])
    const p = persistenceForecast(obs)
    expect(p.get('2026-08-21')).toBe(25)
    expect(p.get('2026-08-22')).toBe(30)
    // Für den ERSTEN Tag der Messreihe gibt es keine Persistenz — deshalb
    // holt das Panel einen Tag mehr, als es zeigt.
    expect(p.has('2026-08-20')).toBe(false)
  })

  it('trägt über Monatsgrenzen', () => {
    expect(persistenceForecast(new Map([['2026-08-31', 20]])).get('2026-09-01')).toBe(20)
  })
})

describe('skillScore', () => {
  const obs = new Map([
    ['2026-08-21', 20],
    ['2026-08-22', 30],
    ['2026-08-23', 20],
  ])
  // Persistenz liegt hier bei jedem Tag um 10 daneben (20→30→20).
  const ref = persistenceForecast(new Map([['2026-08-20', 30], ...obs]))

  it('ist 1, wenn die Vorhersage fehlerfrei ist', () => {
    expect(skillScore(obs, obs, ref).ss).toBeCloseTo(1, 6)
  })

  it('ist 0, wenn sie genauso gut ist wie die Referenz', () => {
    expect(skillScore(ref, obs, ref).ss).toBeCloseTo(0, 6)
  })

  it('wird NEGATIV, wenn das Modell schlechter ist als „wie gestern"', () => {
    // Das ist die Aussage, für die es den Score gibt: ein Fehlerbetrag allein
    // sagt nicht, ob das Modell überhaupt etwas beigetragen hat.
    const bad = new Map([
      ['2026-08-21', 0],
      ['2026-08-22', 60],
      ['2026-08-23', 0],
    ])
    expect(skillScore(bad, obs, ref).ss).toBeLessThan(0)
  })

  it('gibt keine Zahl aus, wenn die Referenz fehlerfrei ist', () => {
    // Kommt bei Niederschlag vor: zwei trockene Tage hintereinander. 0/0 als
    // 0 hinzuschreiben wäre eine Aussage, die niemand gemessen hat.
    const flat = new Map([
      ['2026-08-21', 0],
      ['2026-08-22', 0],
    ])
    const flatRef = persistenceForecast(new Map([['2026-08-20', 0], ...flat]))
    const s = skillScore(new Map([['2026-08-21', 5], ['2026-08-22', 5]]), flat, flatRef)
    expect(Number.isNaN(s.ss)).toBe(true)
  })

  it('wertet nur Tage, die ALLE DREI Reihen führen', () => {
    const partial = new Map([['2026-08-22', 30]])
    expect(skillScore(partial, obs, ref).n).toBe(1)
  })
})

describe('kategorische Bewertung', () => {
  // Zwölf Tage, davon vier mit Regen ab 1 mm.
  const obs = new Map<string, number>([
    ['d1', 0], ['d2', 5], ['d3', 0], ['d4', 0.2],
    ['d5', 12], ['d6', 0], ['d7', 3], ['d8', 0],
    ['d9', 0], ['d10', 8], ['d11', 0], ['d12', 0],
  ])

  it('zählt Treffer, Verpasste und Fehlalarme getrennt', () => {
    const fc = new Map<string, number>([
      ['d1', 0], ['d2', 4], ['d3', 2], ['d4', 0],
      ['d5', 9], ['d6', 0], ['d7', 0], ['d8', 0],
      ['d9', 0], ['d10', 6], ['d11', 0], ['d12', 0],
    ])
    const c = contingency(fc, obs, 1)
    expect(c.hits).toBe(3) // d2, d5, d10
    expect(c.misses).toBe(1) // d7
    expect(c.falseAlarms).toBe(1) // d3
    expect(c.correctNegatives).toBe(7)
    expect(c.n).toBe(12)
    expect(pod(c)).toBeCloseTo(0.75, 6)
    expect(far(c)).toBeCloseTo(0.25, 6)
    expect(frequencyBias(c)).toBeCloseTo(1, 6)
  })

  it('die Schwelle entscheidet, was überhaupt ein Ereignis ist', () => {
    // d4 mit 0,2 mm ist ab 0,1 mm ein Regentag und ab 1 mm keiner.
    expect(contingency(obs, obs, 0.1).hits).toBe(5)
    expect(contingency(obs, obs, 1).hits).toBe(4)
    expect(contingency(obs, obs, 5).hits).toBe(3)
  })

  it('ETS: perfekt ist 1, Zufall ist 0', () => {
    expect(ets(contingency(obs, obs, 1))).toBeCloseTo(1, 6)
    // „nie Regen" trifft nichts — kein Können, und der ETS sagt das.
    const never = new Map([...obs].map(([d]) => [d, 0] as [string, number]))
    expect(ets(contingency(never, obs, 1))).toBeCloseTo(0, 6)
  })

  it('ETS zieht die Zufallstreffer ab — das ist sein ganzer Zweck', () => {
    // „immer Regen" erwischt jeden Regentag: Trefferquote 100 %, und der
    // einfache Threat Score sähe mit 4/12 = 0,33 noch nach etwas aus. Der ETS
    // rechnet gegen, was bei dieser Ansagehäufigkeit ohnehin zufällig
    // zusammenkäme, und landet bei 0.
    const always = new Map([...obs].map(([d]) => [d, 99] as [string, number]))
    const c = contingency(always, obs, 1)
    expect(pod(c)).toBeCloseTo(1, 6)
    expect(c.hits / (c.hits + c.misses + c.falseAlarms)).toBeCloseTo(4 / 12, 6)
    expect(ets(c)).toBeCloseTo(0, 6)
  })

  it('Häufigkeitsbias trennt „zu nass" von „falsch getroffen"', () => {
    // Die richtige ZAHL Regentage, aber alle am falschen Tag: Bias 1,
    // Trefferquote 0. Ein Maß allein könnte das nicht auseinanderhalten.
    const shifted = new Map<string, number>([
      ['d1', 5], ['d2', 0], ['d3', 5], ['d4', 0],
      ['d5', 0], ['d6', 5], ['d7', 0], ['d8', 5],
      ['d9', 0], ['d10', 0], ['d11', 0], ['d12', 0],
    ])
    const c = contingency(shifted, obs, 1)
    expect(frequencyBias(c)).toBeCloseTo(1, 6)
    expect(pod(c)).toBeCloseTo(0, 6)
    expect(ets(c)).toBeLessThan(0)
  })

  it('ohne eingetretene Ereignisse gibt es keine Quoten', () => {
    const dry = new Map([['d1', 0], ['d2', 0]])
    const c = contingency(dry, dry, 1)
    expect(Number.isNaN(pod(c))).toBe(true)
    expect(Number.isNaN(frequencyBias(c))).toBe(true)
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
  it('bildet die GEMESSENE Verfügbarkeit der API ab', () => {
    // Diese Erwartungen sind abgelesen, nicht hergeleitet (2026-09-01, alle
    // Reihen vollstaendig oder gar nicht, nie teilweise): AROME Austria 60 h
    // und ICON-D2 48 h bieten nur n=1, ICON-EU 120 h bietet n=1-4, IFS 360 h
    // alle sieben. Die Regel forecastHours >= n*24+24 trifft das exakt.
    // Sie folgt NICHT aus dem gleitenden Vorlauf - bei 48 h Vorlauf laege
    // AROME mit 60 h Horizont im Rahmen, die Reihe fehlt trotzdem.
    expect(leadsFor(60, 7)).not.toContain(2)
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
