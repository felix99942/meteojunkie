// Registry-Eigenschaften des Ensemble-Bereichs, die leicht kaputtgehen.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENSEMBLE_MODEL,
  DEFAULT_ENSEMBLE_VARIABLE,
  ENSEMBLE_MODELS,
  ENSEMBLE_VARIABLES,
  ensembleHasVariable,
  ensembleVariableFor,
  ensembleVariableOptions,
} from './ensemble'

describe('ENSEMBLE_MODELS', () => {
  // `DEFAULT_ENSEMBLE_MODEL` ist ENSEMBLE_MODELS[0] — wer ein Modell vorn
  // einfügt, ändert damit die Voreinstellung des ganzen Bereichs. Ein
  // Lokalensemble mit ~48 h wäre dort falsch: eine Plume lebt von der
  // Auffächerung über Tage.
  it('hat IFS als Voreinstellung und keinen Kurzläufer vorn', () => {
    expect(DEFAULT_ENSEMBLE_MODEL).toBe('ecmwf_ifs025')
    expect(ENSEMBLE_MODELS[0].forecastDays).toBeGreaterThanOrEqual(15)
  })

  it('führt ICON-D2-EPS als Lokalensemble', () => {
    const m = ENSEMBLE_MODELS.find((x) => x.id === 'icon_d2_eps')
    expect(m).toBeDefined()
    expect(m!.members).toBe(20)
    expect(m!.resolutionKm).toBe(2.2)
    // Der Hauptlauf-Abruf darf den 16-Tage-Deckel der Forecast-API nicht
    // reißen (siehe deterministicDays).
    expect(m!.deterministicDays).toBeLessThanOrEqual(16)
  })

  // Seit der Größen-Beschränkung je Modell stehen auch die ICON-Ensembles
  // drin, die keine Drucklevel haben.
  it('führt alle live geprüften Ensembles', () => {
    const ids = ENSEMBLE_MODELS.map((m) => m.id)
    for (const id of [
      'ecmwf_ifs025',
      'ecmwf_aifs025',
      'gfs_seamless',
      'icon_d2_eps',
      'icon_eu',
      'icon_seamless',
      'meteoswiss_icon_ch1_ensemble',
      'meteoswiss_icon_ch2_ensemble',
    ]) {
      expect(ids, id).toContain(id)
    }
  })

  // `icon_global` liefert bei gleichem Horizont wie Seamless weder Böen noch
  // Drucklevel — es brächte nichts Eigenes und bleibt draußen.
  it('führt icon_global NICHT', () => {
    expect(ENSEMBLE_MODELS.map((m) => m.id)).not.toContain('icon_global')
  })

  it('hat eindeutige IDs und je Modell einen Hauptlauf', () => {
    const ids = ENSEMBLE_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of ENSEMBLE_MODELS) {
      expect(m.deterministicModel, m.id).toBeTruthy()
      expect(m.members, m.id).toBeGreaterThan(1)
    }
  })

  it('kennt den Startparameter', () => {
    expect(ENSEMBLE_VARIABLES.some((v) => v.id === 'temperature_850hPa')).toBe(true)
  })
})

describe('Größen je Ensemble (alle live gemessen)', () => {
  const LEVELS = ['temperature_850hPa', 'geopotential_height_500hPa']

  // Die API meldet fehlende Größen NICHT: HTTP 200 mit lauter null (SPEC §6).
  // Deshalb steht je Modell, was es wirklich liefert.
  it('gibt den ICON-Ensembles ausser D2 KEINE Drucklevel', () => {
    for (const id of [
      'icon_eu',
      'icon_seamless',
      'meteoswiss_icon_ch1_ensemble',
      'meteoswiss_icon_ch2_ensemble',
    ]) {
      for (const v of LEVELS) expect(ensembleHasVariable(id, v), `${id}/${v}`).toBe(false)
    }
    // D2-EPS ist das einzige ICON-Ensemble MIT Druckleveln.
    for (const v of LEVELS) expect(ensembleHasVariable('icon_d2_eps', v)).toBe(true)
  })

  // Derselbe Befund wie beim deterministischen AIFS (config/models.ts).
  it('nimmt AIFS Böen und CAPE', () => {
    expect(ensembleHasVariable('ecmwf_aifs025', 'wind_gusts_10m')).toBe(false)
    expect(ensembleHasVariable('ecmwf_aifs025', 'cape')).toBe(false)
    expect(ensembleHasVariable('ecmwf_ifs025', 'wind_gusts_10m')).toBe(true)
  })

  it('bietet im Dropdown nur an, was das Modell liefert', () => {
    const ids = (m: string) => ensembleVariableOptions(m).map((o) => o.variable)
    expect(ids('icon_eu')).not.toContain('temperature_850hPa')
    expect(ids('ecmwf_ifs025')).toContain('temperature_850hPa')
    expect(ids('ecmwf_aifs025')).not.toContain('cape')
    // Ohne Modell bleibt alles drin (Aufrufer ohne Kontext).
    expect(ensembleVariableOptions().length).toBeGreaterThan(ensembleVariableOptions('icon_eu').length)
  })

  // Der Startparameter ist 850 hPa — genau den haben die ICON-Ensembles
  // nicht. Ohne Rückfall wechselt man das Modell und sieht ein leeres
  // Diagramm, ohne zu erfahren warum.
  it('fällt beim Modellwechsel auf eine verfügbare Größe zurück', () => {
    expect(ensembleVariableFor('icon_eu', DEFAULT_ENSEMBLE_VARIABLE)).not.toBe(
      DEFAULT_ENSEMBLE_VARIABLE,
    )
    expect(ensembleHasVariable('icon_eu', ensembleVariableFor('icon_eu', DEFAULT_ENSEMBLE_VARIABLE)))
      .toBe(true)
    // Vorhandene Größe bleibt stehen.
    expect(ensembleVariableFor('icon_eu', 'precipitation')).toBe('precipitation')
    expect(ensembleVariableFor('ecmwf_ifs025', DEFAULT_ENSEMBLE_VARIABLE)).toBe(
      DEFAULT_ENSEMBLE_VARIABLE,
    )
  })

  it('führt bei jedem Modell nur Größen, die es in der Registry gibt', () => {
    const known = new Set(ENSEMBLE_VARIABLES.map((v) => v.id))
    for (const m of ENSEMBLE_MODELS) {
      const extra = m.availableVariables.filter((v) => !known.has(v) && v !== 'dew_point_2m')
      expect(extra, m.id).toEqual([])
      expect(m.availableVariables.length, m.id).toBeGreaterThan(3)
    }
  })
})
