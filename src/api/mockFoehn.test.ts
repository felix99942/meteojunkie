// Prüft das Mock-Szenario „Föhnorkan" mit den ECHTEN Föhnkriterien: ein
// Testdatensatz, der die Kriterien nicht erfüllt, ist als Testdatensatz
// wertlos — und das sieht man an den Zahlen nicht, sondern erst, wenn die
// Kriterienleiste im Browser grau bleibt.
//
// Geprüft wird auf BEIDEN Achsen, weil das Szenario geografisch am
// Alpenhauptkamm aufgebaut ist und nicht pro Punkt: hielte die Kammlinie nur
// für Tirol, zeigte die Schweizer Achse stillschweigend Unsinn.

import { describe, expect, it } from 'vitest'
import { crestLat, episodeStrength, FOEHN_EPISODE, foehnOverride } from './mockFoehn'
import { directed, foehnCriteria, inSector, thetaDifference } from '../components/foehn'
import { CREST_SECTORS, FOEHN_AXES, FOEHN_LIMITS } from '../config/foehn'

const PEAK = FOEHN_EPISODE.peakH
/** Grundfeldwert, über den das Szenario blendet — für Druck überall gleich. */
const P_BASE = 1005

/** Szenario-Wert an einem Punkt; fällt auf `base` zurück, wenn nicht überschrieben. */
const at = (v: string, p: { lat: number; lon: number }, t: number, base: number) =>
  foehnOverride(v, p.lat, p.lon, t, base) ?? base

describe('Kammlinie', () => {
  it('legt beide Achsen richtig um den Kamm', () => {
    for (const axis of FOEHN_AXES) {
      // Südpunkt südlich, Nordpunkt nördlich der Kammbreite auf SEINEM
      // Längengrad — der Kamm steigt nach Osten, eine Konstante hätte Lugano
      // und Bozen auf dieselbe Seite gelegt.
      expect(axis.south.lat).toBeLessThan(crestLat(axis.south.lon))
      expect(axis.north.lat).toBeGreaterThan(crestLat(axis.north.lon))
    }
  })
})

describe('Episode', () => {
  it('ist davor und danach aus, dazwischen an', () => {
    expect(episodeStrength(FOEHN_EPISODE.startH)).toBe(0)
    expect(episodeStrength(FOEHN_EPISODE.endH)).toBe(0)
    expect(episodeStrength(PEAK)).toBeCloseTo(1, 5)
    expect(episodeStrength(6)).toBe(0)
  })

  it('lässt das Grundfeld außerhalb der Episode unangetastet', () => {
    const p = FOEHN_AXES[0].north
    expect(foehnOverride('pressure_msl', p.lat, p.lon, 6, P_BASE)).toBeNull()
    expect(foehnOverride('relative_humidity_2m', p.lat, p.lon, 6, 80)).toBeNull()
  })

  it('lässt Punkte außerhalb des Alpenraums unangetastet', () => {
    // Hamburg — weit nördlich der Region.
    expect(foehnOverride('pressure_msl', 53.55, 9.99, PEAK, P_BASE)).toBeNull()
  })
})

describe.each(FOEHN_AXES)('Föhnorkan auf der Achse $label', (axis) => {
  const lee = axis.leeSouthFoehn

  it('treibt ΔP Süd − Nord über die Starkföhn-Schwelle', () => {
    const dp = at('pressure_msl', axis.south, PEAK, P_BASE) - at('pressure_msl', axis.north, PEAK, P_BASE)
    expect(dp).toBeGreaterThan(axis.strong)
    // „Orkan" heißt auch im Druckfeld deutlich mehr als die Schwelle.
    expect(dp).toBeGreaterThan(12)
  })

  it('erfüllt das Kammkriterium in Richtung UND Stärke', () => {
    const speed = at('wind_speed_700hPa', axis.crest, PEAK, 20)
    const dir = at('wind_direction_700hPa', axis.crest, PEAK, 0)
    expect(speed).toBeGreaterThanOrEqual(FOEHN_LIMITS.crestMinSpeedKmh)
    expect(inSector(dir, CREST_SECTORS.south)).toBe(true)
  })

  it('trocknet das Lee unter die Schwelle', () => {
    // Auch von einem sehr feuchten Grundfeld aus.
    expect(at('relative_humidity_2m', lee, PEAK, 95)).toBeLessThanOrEqual(FOEHN_LIMITS.leeMaxRh)
  })

  it('bringt Orkanböen ins Lee (≥ 118 km/h)', () => {
    expect(at('wind_gusts_10m', lee, PEAK, 15)).toBeGreaterThanOrEqual(118)
  })

  // Δθ hängt an drei Größen aus zwei Punkten. Über die ganze Spannweite des
  // Grundfelds geprüft, nicht an einer Stützstelle: sonst hielte der Test bei
  // 15 °C und die Leiste bliebe an einem kalten Mock-Tag grau.
  it.each([0, 10, 20, 30])('mischt bis zum Talboden durch (Grundfeld %i °C)', (base) => {
    const t2m = at('temperature_2m', lee, PEAK, base)
    const sp = at('surface_pressure', lee, PEAK, P_BASE)
    const t700 = at('temperature_700hPa', axis.crest, PEAK, base - 19.6)
    const dTheta = thetaDifference([t2m], [sp], [t700])[0]!
    expect(dTheta).toBeGreaterThanOrEqual(FOEHN_LIMITS.minThetaDiff)
  })

  it('erfüllt am Höhepunkt ALLE vier Kriterien', () => {
    const dp = at('pressure_msl', axis.south, PEAK, P_BASE) - at('pressure_msl', axis.north, PEAK, P_BASE)
    const crit = foehnCriteria(
      {
        dp: [dp],
        crestSpeed: [at('wind_speed_700hPa', axis.crest, PEAK, 20)],
        crestDir: [at('wind_direction_700hPa', axis.crest, PEAK, 0)],
        leeRh: [at('relative_humidity_2m', lee, PEAK, 90)],
        dTheta: thetaDifference(
          [at('temperature_2m', lee, PEAK, 15)],
          [at('surface_pressure', lee, PEAK, P_BASE)],
          [at('temperature_700hPa', axis.crest, PEAK, -4.6)],
        ),
      },
      'south',
      axis.threshold,
    )
    expect(crit.scoreText[0]).toBe('4/4')
    expect(crit.signal[0]).toBe(1)
  })

  // Das Szenario ist SÜDföhn. Dass Nordföhn damit nichts anzeigt, ist die
  // richtige Antwort und ein eigener Testfall — nicht ein Mangel des Mocks.
  it('zeigt für Nordföhn KEINEN Druckgradienten in Föhnrichtung', () => {
    const dp = at('pressure_msl', axis.south, PEAK, P_BASE) - at('pressure_msl', axis.north, PEAK, P_BASE)
    expect(directed(dp, 'north')).toBeLessThan(0)
  })
})
