// θe wird gegen IDENTITÄTEN geprüft, nicht gegen eigene Ausgaben: eine
// Formel, die man gegen sich selbst testet, ist nur konsistent, nicht richtig.
// Beide Prüfsteine kommen aus der Physik und benutzen unabhängig
// implementierte Funktionen dieses Moduls.

import { describe, expect, it } from 'vitest'
import { moistAdiabatTemp, potentialTemperature, thetaE, wetBulb } from './thermo'

describe('thetaE', () => {
  /**
   * TROCKENE LUFT: ohne Wasserdampf gibt es keine latente Wärme, θe geht in
   * die potentielle Temperatur über. Bei Td = −40 °C sind noch 0,08 g/kg
   * übrig, deshalb bleibt ein halbes Kelvin Rest — das IST die Feuchte, kein
   * Fehler.
   */
  it('geht bei trockener Luft in θ über', () => {
    const te = thetaE(20, -40, 1000)
    const th = potentialTemperature(20, 1000)
    expect(te - th).toBeGreaterThan(0)
    expect(te - th).toBeLessThan(1)
  })

  /**
   * DER EIGENTLICHE PRÜFSTEIN: θe ist entlang einer Feuchtadiabate erhalten.
   * Der Weg dorthin kommt aus `moistAdiabatTemp` (RK4 über die
   * pseudoadiabatische ODE) und hat mit der θe-Formel nichts gemeinsam —
   * stimmen beide überein, stimmt die Formel.
   */
  it('bleibt entlang einer Feuchtadiabate erhalten', () => {
    const tStart = 15
    for (const pEnd of [700, 500, 400]) {
      const tEnd = moistAdiabatTemp(tStart, 900, pEnd)
      // gesättigt heißt Td = T
      const a = thetaE(tStart, tStart, 900)
      const b = thetaE(tEnd, tEnd, pEnd)
      expect(Math.abs(b - a), `${pEnd} hPa`).toBeLessThan(1)
    }
  })

  it('wächst mit der Feuchte', () => {
    expect(thetaE(20, 15, 1000)).toBeGreaterThan(thetaE(20, 0, 1000))
    expect(thetaE(20, 0, 1000)).toBeGreaterThan(thetaE(20, -40, 1000))
    // GRÖSSENORDNUNG: 15 °C Taupunkt bei 20 °C sind ~10,7 g/kg, und rund
    // 2,5 K je g/kg ergeben knapp 30 K über der trockenen Luft. Daran fiele
    // ein Einheitenfehler (g/kg ↔ kg/kg) sofort auf — er verschöbe das
    // Ergebnis um Größenordnungen.
    const latent = thetaE(20, 15, 1000) - thetaE(20, -40, 1000)
    expect(latent).toBeGreaterThan(20)
    expect(latent).toBeLessThan(40)
  })
})

describe('wetBulb', () => {
  /**
   * DIE ORDNUNG IST DIE PROBE: die Feuchtkugeltemperatur liegt zwischen
   * Taupunkt und Temperatur — immer. Dreht sich das um, stimmt entweder die
   * Richtung der Feuchtadiabate oder das LCL nicht.
   */
  it('liegt zwischen Taupunkt und Temperatur', () => {
    for (const [t, td, p] of [
      [30, 5, 1000],
      [20, 10, 1000],
      [0, -10, 850],
      [-5, -12, 700],
      [35, 30, 1013],
    ]) {
      const tw = wetBulb(t, td, p)
      expect(tw, `${t}/${td}@${p}`).toBeLessThanOrEqual(t)
      expect(tw, `${t}/${td}@${p}`).toBeGreaterThanOrEqual(td)
    }
  })

  it('fällt bei gesättigter Luft mit beiden zusammen', () => {
    expect(wetBulb(15, 15, 1000)).toBeCloseTo(15, 6)
    expect(wetBulb(-3, -3, 700)).toBeCloseTo(-3, 6)
  })

  /**
   * Gegen die PSYCHROMETERTAFEL: 20 °C bei 10 °C Taupunkt und 1000 hPa
   * ergeben rund 14 °C Feuchtkugeltemperatur. Die Rechnung kommt auf 13,98 —
   * eine unabhängige Zahl, die ein Vorzeichen- oder Druckfehler sofort
   * zerstörte.
   */
  it('trifft den Tafelwert', () => {
    expect(wetBulb(20, 10, 1000)).toBeGreaterThan(13.5)
    expect(wetBulb(20, 10, 1000)).toBeLessThan(14.5)
  })

  // Je trockener, desto größer der Abstand — die Verdunstungskühlung.
  it('kühlt umso stärker, je trockener die Luft ist', () => {
    const feucht = 25 - wetBulb(25, 20, 1000)
    const trocken = 25 - wetBulb(25, 0, 1000)
    expect(trocken).toBeGreaterThan(feucht * 3)
  })
})
