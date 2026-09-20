// Die Drucklevel-Registry ist eine MESSUNG (siehe Kopf von levels.ts), kein
// Auszug aus der Doku. Diese Tests halten sie gegen die Modell-Registry und
// gegen sich selbst konsistent — eine ID, die es nicht gibt, oder ein Level
// ausserhalb von PRESSURE_LEVELS wäre still wirkungslos.

import { describe, expect, it } from 'vitest'
import { MODELS } from './models'
import {
  PRESSURE_LEVELS,
  pressureLevelModelIds,
  pressureLevelSupport,
  supportsPressureLevels,
} from './levels'

describe('Drucklevel-Registry', () => {
  it('nennt nur Modelle, die es in der Registry gibt', () => {
    const known = new Set(MODELS.map((m) => m.id))
    for (const id of pressureLevelModelIds()) expect(known).toContain(id)
  })

  it('gibt für jedes Modell ein Level aus PRESSURE_LEVELS als Obergrenze an', () => {
    for (const id of pressureLevelModelIds()) {
      const s = pressureLevelSupport(id)!
      expect(PRESSURE_LEVELS).toContain(s.topHpa as (typeof PRESSURE_LEVELS)[number])
      expect(s.levels).toBeGreaterThan(0)
      expect(s.levels).toBeLessThanOrEqual(PRESSURE_LEVELS.length)
    }
  })

  it('hält die gemessenen Nicht-Lieferanten draussen', () => {
    // Alle drei live geprüft (2026-09-20): HTTP 200, alle 19 Level null.
    // Bei ICON-CH1/CH2 deckt sich das mit dem Ensemble-Befund.
    expect(supportsPressureLevels('geosphere_arome_austria')).toBe(false)
    expect(supportsPressureLevels('meteoswiss_icon_ch1')).toBe(false)
    expect(supportsPressureLevels('meteoswiss_icon_ch2')).toBe(false)
  })

  it('führt die beiden LOKALmodelle, an denen die Abdeckungsgrenze hängt', () => {
    // Der Grund, warum die Ortswahl-Karte überhaupt eine Maske braucht: nur
    // diese beiden decken deutlich weniger ab als die Karte zeigt. Fallen sie
    // heraus, ist die Maske faktisch tot — dann ist das hier das Signal.
    expect(supportsPressureLevels('icon_d2')).toBe(true)
    expect(supportsPressureLevels('meteofrance_arome_france')).toBe(true)
  })

  it('kennt ICON-D2 als oben begrenzt', () => {
    // Ein Profil, das bei 200 hPa aufhört, ist bei diesem Modell richtig und
    // kein Datenfehler — die Skew-T-Achse reicht bis 100 hPa.
    expect(pressureLevelSupport('icon_d2')!.topHpa).toBe(200)
    expect(pressureLevelSupport('ecmwf_ifs025')!.levels).toBeLessThan(PRESSURE_LEVELS.length)
  })
})
