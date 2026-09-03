// Ordnung der Modell-Liste. Die Reihenfolge IST hier eine Aussage — sie
// bestimmt, welche Modelle im Vergleich nebeneinanderstehen.

import { describe, expect, it } from 'vitest'
import {
  compareModelsByScale,
  groupModelsByScale,
  modelScale,
  resolutionLabel,
  SELECTABLE_MODELS,
  getModel,
  type ModelInfo,
} from './models'

const m = (id: string) => getModel(id) as ModelInfo

describe('modelScale', () => {
  it('trennt nach Gitterweite und Abdeckung, nicht nach Anbieter', () => {
    expect(modelScale(m('geosphere_arome_austria'))).toBe('local') // 2,5 km regional
    expect(modelScale(m('icon_d2'))).toBe('local') // 2,2 km regional
    expect(modelScale(m('icon_eu'))).toBe('regional') // 7 km regional
    expect(modelScale(m('ecmwf_ifs025'))).toBe('global') // 25 km global
    // 10 km, aber global — die Abdeckung entscheidet, sonst stuende ein
    // Globalmodell zwischen den Lokalmodellen.
    expect(modelScale(m('ukmo_global_deterministic_10km'))).toBe('global')
  })

  it('Mischungen sind eine eigene Gruppe, keine Auflösung', () => {
    // resolutionKm = 0 heisst „variabel": Blends schalten je Vorlaufzeit
    // zwischen Modellen um und gehoeren an keine Stelle der Skala.
    expect(modelScale(m('best_match'))).toBe('blend')
    expect(modelScale(m('icon_seamless'))).toBe('blend')
    expect(resolutionLabel(m('best_match'))).toBe('variabel')
  })
})

describe('Reihenfolge im Modellvergleich', () => {
  it('sortiert von fein nach grob', () => {
    const global = [m('ecmwf_ifs025'), m('ukmo_global_deterministic_10km'), m('icon_global')]
    const order = [...global].sort(compareModelsByScale).map((x) => x.resolutionKm)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('stellt IFS und AIFS NEBENEINANDER', () => {
    // Beide 25 km von ECMWF — GFS hat dieselbe Gitterweite und duerfte nicht
    // dazwischenrutschen. Genau dafuer gibt es den Anbieter als Stichentscheid.
    const sorted = [...SELECTABLE_MODELS].sort(compareModelsByScale).map((x) => x.id)
    const i = sorted.indexOf('ecmwf_ifs025')
    const j = sorted.indexOf('ecmwf_aifs025_single')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(Math.abs(i - j)).toBe(1)
  })

  it('gruppiert vollständig und ohne Dubletten', () => {
    const groups = groupModelsByScale([...SELECTABLE_MODELS])
    const ids = groups.flatMap((g) => g.models.map((x) => x.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(SELECTABLE_MODELS.length)
    // Lokalmodelle stehen vorn — der Vergleich beginnt beim feinsten Gitter.
    expect(groups[0].scale).toBe('local')
    expect(groups[groups.length - 1].scale).toBe('blend')
  })

  it('lässt leere Gruppen weg statt sie leer zu zeigen', () => {
    const groups = groupModelsByScale([m('ecmwf_ifs025'), m('ecmwf_aifs025_single')])
    expect(groups).toHaveLength(1)
    expect(groups[0].scale).toBe('global')
  })
})

describe('resolutionLabel', () => {
  it('schreibt das Dezimalkomma deutsch', () => {
    expect(resolutionLabel(m('geosphere_arome_austria'))).toBe('2,5 km')
    expect(resolutionLabel(m('icon_eu'))).toBe('7 km')
  })
})
