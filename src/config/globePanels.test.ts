import { describe, expect, it } from 'vitest'
import {
  coarsestTimes,
  defaultPanels,
  effectivePanel,
  frozenStepIndex,
  stepAround,
  makePreset,
  parsePresets,
  upsertPreset,
  PANEL_REGIONS,
  releaseCoupling,
  stepTime,
  unionTimes,
  validTimes,
} from './globePanels'
import type { GlobeMeta } from './globe'

describe('Kopplung', () => {
  const panels = defaultPanels()

  it('PARSYNC: alle zeigen die Größe des Quellpanels, behalten aber ihr Modell', () => {
    const c = { kind: 'var' as const, source: 0 }
    for (let i = 0; i < 6; i++) {
      expect(effectivePanel(panels, i, c).varId).toBe(panels[0].varId)
      expect(effectivePanel(panels, i, c).model).toBe(panels[i].model)
    }
  })

  it('MODSYNC: alle zeigen das Modell des Quellpanels, behalten aber ihre Größe', () => {
    const c = { kind: 'model' as const, source: 2 }
    for (let i = 0; i < 6; i++) {
      expect(effectivePanel(panels, i, c).model).toBe(panels[2].model)
      expect(effectivePanel(panels, i, c).varId).toBe(panels[i].varId)
    }
  })

  it('beim Lösen bleibt der gespiegelte Wert stehen', () => {
    const out = releaseCoupling(panels, { kind: 'var', source: 1 })
    expect(out.every((p) => p.varId === panels[1].varId)).toBe(true)
    expect(out.map((p) => p.model)).toEqual(panels.map((p) => p.model))
  })

  it('die Vorgabe vergleicht fünf verschiedene Modelle in den ersten fünf Panels', () => {
    expect(new Set(panels.slice(0, 5).map((p) => p.model)).size).toBe(5)
  })
})

describe('Zeit', () => {
  const meta = (steps: number[]): GlobeMeta => ({
    model: 'icon-eu',
    runId: '2026110200',
    run: '2026-11-02T00:00:00Z',
    generated: '',
    grid: { ni: 1, nj: 1, lon0: 0, lat0: 0, dlon: 1, dlat: 1, global: false },
    variables: { t2m: { lo: 0, step: 1, unit: '°C', steps } },
  })
  const H = 3_600_000
  const t0 = Date.parse('2026-11-02T00:00:00Z')

  it('Gültigkeitszeiten aus den Schritten', () => {
    expect(validTimes(meta([0, 3]), 't2m')).toEqual([t0, t0 + 3 * H])
    expect(validTimes(meta([0]), 'precip')).toEqual([])
  })

  it('Vereinigung: stündlich und dreistündlich ergibt jede Stunde einmal', () => {
    const u = unionTimes([[0, 1, 2, 3].map((h) => t0 + h * H), [0, 3, 6].map((h) => t0 + h * H)])
    expect(u.map((t) => (t - t0) / H)).toEqual([0, 1, 2, 3, 6])
  })

  it('ein 3-h-Modell bleibt zwischen seinen Terminen beim letzten STEHEN', () => {
    const times = [0, 3, 6].map((h) => t0 + h * H)
    expect(frozenStepIndex(times, t0 + 4 * H)).toBe(1) // 13 UTC → 12 UTC, nicht 15
    expect(frozenStepIndex(times, t0 + 3 * H)).toBe(1)
    expect(frozenStepIndex(times, t0 - H)).toBe(-1)
    expect(frozenStepIndex(times, t0 + 99 * H)).toBe(2)
  })

  it('Regler folgt dem gröbsten Takt, ein kurzes Modell bremst nur in seiner Reichweite', () => {
    const hourly = Array.from({ length: 10 }, (_, h) => t0 + h * H) // 0…9 h, stündlich (endet bei 9)
    const ifs = [0, 3, 6, 9, 12, 18].map((h) => t0 + h * H) // 3 h, dann 6 h
    const got = coarsestTimes([hourly, ifs]).map((t) => (t - t0) / H)
    expect(got).toEqual([0, 3, 6, 9, 12, 18])
    // ohne IFS: wieder stündlich
    expect(coarsestTimes([hourly]).length).toBe(10)
  })

  it('Schrittweite um eine Zeit', () => {
    const t = [0, 1, 2, 3, 6, 9].map((h) => t0 + h * H)
    expect(stepAround(t, t0 + H)).toBe(H)
    expect(stepAround(t, t0 + 6 * H)).toBe(3 * H)
    expect(stepAround([t0], t0)).toBe(Infinity)
  })

  it('Schritt vor und zurück, am Rand stehen bleiben', () => {
    const times = [0, 3, 6].map((h) => t0 + h * H)
    expect(stepTime(times, t0 + 3 * H, 1)).toBe(t0 + 6 * H)
    expect(stepTime(times, t0 + 4 * H, -1)).toBe(t0)
    expect(stepTime(times, t0 + 6 * H, 4)).toBe(t0 + 6 * H)
    expect(stepTime([], 123, 1)).toBe(123)
  })
})

describe('Regionen', () => {
  it('Österreich liegt ganz im Ausschnitt', () => {
    const [[w, s], [e, n]] = PANEL_REGIONS.find((r) => r.id === 'austria')!.bounds
    // Bregenz (West), Wien (Ost), Karnische Alpen (Süd), Haugschlag (Nord)
    for (const [lon, lat] of [[9.55, 47.5], [16.37, 48.2], [13.0, 46.4], [15.0, 49.02]]) {
      expect(lon > w && lon < e && lat > s && lat < n).toBe(true)
    }
  })
})

describe('Presets', () => {
  const models = ['ecmwf-ifs', 'ecmwf-hres', 'icon-eu', 'icon-d2', 'varda']
  const vars = ['precip', 't850', 'reltop', 'wind10', 'tcc', 'wind300', 't2m']

  it('speichern und wieder lesen ergibt dasselbe', () => {
    const panels = defaultPanels()
    panels[3] = { ...panels[3], varId: 't2m', sync: false }
    const views = [{ center: [11.4, 47.26] as [number, number], zoom: 7.5 }, null]
    const p = makePreset('  Föhn Tirol ', 6, 'austria', { kind: 'model', source: 4 }, panels, views)
    const [back] = parsePresets(JSON.stringify([p]), models, vars)
    expect(back.name).toBe('Föhn Tirol')
    expect(back).toEqual(p)
    expect(back.views?.[0]).toEqual({ center: [11.4, 47.26], zoom: 7.5 })
    expect(back.views?.[1]).toBeNull()
  })

  it('kaputte Ausschnitte fallen weg, ältere Presets ohne Ausschnitt bleiben ohne', () => {
    const base = makePreset('X', 4, 'europe', null, defaultPanels())
    const raw = JSON.stringify([{ ...base, views: [{ center: [10, 99], zoom: 5 }, { center: 'x' }, { center: [10, 47], zoom: 6 }] }])
    const [p] = parsePresets(raw, models, vars)
    expect(p.views?.slice(0, 3)).toEqual([null, null, { center: [10, 47], zoom: 6 }])
    const { views: _drop, ...old } = base
    expect(parsePresets(JSON.stringify([old]), models, vars)[0].views).toBeUndefined()
  })

  it('Unbekanntes fällt auf die Vorgabe zurück, Kaputtes heraus', () => {
    const raw = JSON.stringify([
      { name: 'alt', count: 4, region: 'mars', coupling: { kind: 'var', source: 5 }, panels: [{ model: 'gibtsnicht', varId: 'quatsch', sync: true }] },
      { panels: [] },
      'kaputt',
    ])
    const out = parsePresets(raw, models, vars)
    expect(out).toHaveLength(1)
    expect(out[0].region).toBe('europe')
    expect(out[0].coupling).toBeNull() // Quellpanel 6 gibt es bei 4 Panels nicht
    expect(out[0].panels[0].model).toBe('ecmwf-ifs')
    expect(parsePresets('{nicht json', models, vars)).toEqual([])
  })

  it('gleicher Name überschreibt', () => {
    const a = makePreset('A', 4, 'europe', null, defaultPanels())
    const b = { ...a, region: 'austria' as const }
    expect(upsertPreset([a], b)).toEqual([b])
  })
})
