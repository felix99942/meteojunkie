// Registry-Eigenschaften des Ensemble-Bereichs, die leicht kaputtgehen.

import { describe, expect, it } from 'vitest'
import { DEFAULT_ENSEMBLE_MODEL, ENSEMBLE_MODELS, ENSEMBLE_VARIABLES } from './ensemble'

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

  // Die CH-Ensembles liefern Drucklevel durchgehend null (live geprüft) und
  // haben deshalb hier NICHTS zu suchen, solange es keine Größen-Beschränkung
  // je Modell gibt — der Startparameter ist temperature_850hPa.
  it('enthält die CH-Ensembles NICHT', () => {
    const ids = ENSEMBLE_MODELS.map((m) => m.id)
    expect(ids).not.toContain('meteoswiss_icon_ch1_ensemble')
    expect(ids).not.toContain('meteoswiss_icon_ch2_ensemble')
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
