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
  modelFamily,
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
  // Innerhalb EINER Familie gilt weiter fein → grob. Über Familien hinweg
  // nicht mehr: dort ordnet der Familienname (siehe compareModelsByScale), und
  // die Auflösung steht sichtbar an jedem Eintrag.
  it('sortiert innerhalb einer Familie von fein nach grob', () => {
    const icon = [m('meteoswiss_icon_ch2'), m('meteoswiss_icon_ch1'), m('icon_d2')]
    const order = [...icon].sort(compareModelsByScale).map((x) => x.resolutionKm)
    expect(order).toEqual([1, 2.1, 2.2])
  })

  it('stellt Modelle DERSELBEN Familie zusammen', () => {
    const local = groupModelsByScale([...SELECTABLE_MODELS]).find((g) => g.scale === 'local')
    const families = local!.models.map(modelFamily)
    // Jede Familie darf nur EINEN zusammenhängenden Block bilden.
    const blocks = families.filter((f, i) => f !== families[i - 1])
    expect(new Set(blocks).size).toBe(blocks.length)
    // Und konkret: die drei ICON-Lokalmodelle hintereinander.
    const ids = local!.models.map((x) => x.id)
    const icon = ['meteoswiss_icon_ch1', 'meteoswiss_icon_ch2', 'icon_d2'].map((id) =>
      ids.indexOf(id),
    )
    expect(icon).toEqual([icon[0], icon[0] + 1, icon[0] + 2])
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

describe('ICON-CH1/CH2', () => {
  const ch = ['meteoswiss_icon_ch1', 'meteoswiss_icon_ch2']

  // Sie waren abgeschaltet, solange nur die Föhn-Größen geprüft waren. Live
  // verifiziert (2026-09-16, Innsbruck): beide liefern alle 19 Größen des
  // klassischen Meteogramms vollständig. Der Test hält das fest, damit ein
  // Aufräumen sie nicht still wieder versteckt.
  it('stehen in der Auswahlliste', () => {
    const ids = SELECTABLE_MODELS.map((m) => m.id)
    for (const id of ch) expect(ids, id).toContain(id)
  })

  it('führen alle Größen, die das klassische Meteogramm braucht', () => {
    // Genau die Zeilen des Stapels: Symbole, Achtel, Temperatur/Taupunkt,
    // Niederschlag samt Wahrscheinlichkeit, Wind, Druck, Tag/Nacht.
    const needed = [
      'weather_code',
      'is_day',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'temperature_2m',
      'dew_point_2m',
      'apparent_temperature',
      'precipitation',
      'snowfall',
      'precipitation_probability',
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
      'pressure_msl',
    ]
    for (const id of ch) {
      const m = getModel(id)
      for (const v of needed) expect(m.availableVariables, `${id} / ${v}`).toContain(v)
    }
  })

  // Sie stehen als ICON-Block in den Lokalmodellen, CH1 (1 km) vor CH2
  // (2,1 km) — nicht mehr an der Spitze der Gruppe, weil dort die FAMILIE
  // ordnet und „AROME" alphabetisch vor „ICON" kommt.
  it('stehen als ICON-Block unter den Lokalmodellen', () => {
    const local = groupModelsByScale([...SELECTABLE_MODELS]).find((g) => g.scale === 'local')
    const ids = local!.models.map((x) => x.id)
    expect(ids.indexOf('meteoswiss_icon_ch2')).toBe(ids.indexOf('meteoswiss_icon_ch1') + 1)
  })

  // Drucklevel haben sie NICHT — das gatet levels.ts unabhängig von
  // `selectable`, und das muss so bleiben, sonst zeigt das Vertikalprofil
  // leere Diagramme.
  it('gelten weiter als nicht drucklevelfähig', async () => {
    const { supportsPressureLevels } = await import('./levels')
    for (const id of ch) expect(supportsPressureLevels(id), id).toBe(false)
  })
})
