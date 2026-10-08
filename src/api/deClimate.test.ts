import { afterEach, describe, expect, it, vi } from 'vitest'
import { deParamAvailable, fetchDePeriodValues, loadDeSeries } from './deClimate'
import { getAtParameter } from '../config/atParameters'
import type { AtStation } from './geosphere'

const st = (id: number): AtStation => ({
  id,
  name: `S${id}`,
  state: null,
  lat: 50,
  lon: 10,
  altitude: 100,
  validFrom: null,
  validTo: null,
  isActive: true,
  hasSunshine: false,
  hasRadiation: false,
  has10min: false,
})

/** fetch-Attrappe: Pfad → JSON (fehlende Pfade = 404 als HTML wie im Dev-Server). */
function mockAssets(files: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(files).find((k) => url.endsWith(k))
      return key
        ? new Response(JSON.stringify(files[key]), { headers: { 'content-type': 'application/json' } })
        : new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('deParamAvailable', () => {
  it('Kenntage nur ab Monat, Feuchte nur am Tag, keine gefühlte Temperatur, Rekorde nur mit Monatswert', () => {
    const day = { kind: 'day', day: '2026-10-01' } as const
    const month = { kind: 'month', year: 2026, month: 9 } as const
    expect(deParamAvailable(getAtParameter('tage_frost'), day)).toBe(false)
    expect(deParamAvailable(getAtParameter('tage_frost'), month)).toBe(true)
    expect(deParamAvailable(getAtParameter('rfb_mittel'), day)).toBe(true)
    expect(deParamAvailable(getAtParameter('rfb_mittel'), month)).toBe(false)
    expect(deParamAvailable(getAtParameter('gefuehlt'), day)).toBe(false)
    const rec = { kind: 'record', extreme: 'max', month: null } as const
    expect(deParamAvailable(getAtParameter('tl_mittel'), rec)).toBe(true)
    expect(deParamAvailable(getAtParameter('tage_frost'), rec)).toBe(true)
    // Feuchte führt der DWD nicht als Monatswert — also auch keine Rekorde
    expect(deParamAvailable(getAtParameter('rfb_mittel'), rec)).toBe(false)
  })
})

describe('fetchDePeriodValues', () => {
  it('Saisonwert nur aus ALLEN Monaten der Station — eine Lücke gibt keinen Wert', async () => {
    // Sommer 2025: Station 1 vollständig, Station 2 ohne August
    mockAssets({
      'monthly/2025.json': {
        year: 2025,
        codes: {
          rr: {
            1: [null, null, null, null, null, 50, 60, 70, null, null, null, null],
            2: [null, null, null, null, null, 50, 60, null, null, null, null, null],
          },
        },
      },
    })
    const r = await fetchDePeriodValues(getAtParameter('rr'), { kind: 'season', year: 2025, season: 'JJA' }, [st(1), st(2)])
    expect(r.byStation[1]).toBe(180)
    expect(r.byStation[2]).toBeNull()
    expect(r.coverage?.complete).toBe(true)
  })

  it('laufender Monat kommt als Teilwert mit seiner Tageszahl', async () => {
    mockAssets({
      'running.json': { year: 2030, month: 3, days: 7, daysInMonth: 31, codes: { tl_mittel: { 1: 5.5 } } },
    })
    const r = await fetchDePeriodValues(getAtParameter('tl_mittel'), { kind: 'month', year: 2030, month: 3 }, [st(1)])
    expect(r.byStation[1]).toBe(5.5)
    expect(r.coverage?.partial).toEqual({ year: 2030, month: 3, days: 7, daysInMonth: 31 })
    expect(r.coverage?.complete).toBe(false)
  })

  it('ein fehlender Tag ist eine leere Karte, kein Fehler', async () => {
    mockAssets({})
    const r = await fetchDePeriodValues(getAtParameter('tl_mittel'), { kind: 'day', day: '1999-01-01' }, [st(1)])
    expect(r.byStation[1]).toBeNull()
  })
})

describe('loadDeSeries', () => {
  it('liefert den Ausschnitt Monat für Monat, außerhalb der Reihe null', async () => {
    // Reihe ab 2020: Januar 2020 = 1, Februar 2020 = 2 …
    mockAssets({ 'series/7.json': { from: 2020, codes: { rr: Array.from({ length: 24 }, (_, i) => i + 1) } } })
    const s = await loadDeSeries('rr', '2019-11-01', '2020-02-01', 7)
    expect(s.timestamps).toEqual(['2019-11-01T00:00', '2019-12-01T00:00', '2020-01-01T00:00', '2020-02-01T00:00'])
    expect(s.values).toEqual([null, null, 1, 2])
  })
})
