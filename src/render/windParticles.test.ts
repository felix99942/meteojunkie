import { describe, expect, it } from 'vitest'
import { particleCount, screenVelocity, speedStep, SPEED_STEPS } from './windParticles'

describe('Windpartikel', () => {
  it('Tempostufen steigen monoton und schließen die Grenze ein', () => {
    expect(speedStep(0)).toBe(0)
    expect(speedStep(SPEED_STEPS[0])).toBe(1)
    expect(speedStep(SPEED_STEPS[0] - 0.01)).toBe(0)
    expect(speedStep(100)).toBe(SPEED_STEPS.length)
  })
  it('Partikelzahl folgt der Fläche, mit Boden und Deckel', () => {
    expect(particleCount(10, 10)).toBe(200)
    expect(particleCount(1500, 760)).toBeGreaterThan(1500)
    expect(particleCount(10_000, 10_000)).toBe(5000)
  })
  it('Westwind läuft auf einer nordorientierten Karte nach rechts, Südwind nach oben', () => {
    // nordorientiert: Osten = +x, Norden = −y (Bildschirm-y wächst nach unten)
    const east: [number, number] = [1, 0]
    const north: [number, number] = [0, -1]
    expect(screenVelocity(10, 0, east, north, 0.1)).toEqual([1, 0])
    const [vx, vy] = screenVelocity(0, 10, east, north, 0.1)
    expect(vx).toBeCloseTo(0)
    expect(vy).toBeCloseTo(-1)
  })
  it('auf einer gedrehten Karte dreht die Bewegung mit', () => {
    // um 90° gedreht: Osten zeigt nach unten, Norden nach rechts
    const [vx, vy] = screenVelocity(10, 0, [0, 1], [1, 0], 0.1)
    expect(vx).toBeCloseTo(0)
    expect(vy).toBeCloseTo(1)
  })
})
