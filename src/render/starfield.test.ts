import { describe, expect, it } from 'vitest'
import { generateStars, seededRandom } from './starfield'

describe('Sternenhimmel', () => {
  it('ist bei jedem Besuch derselbe (fester Startwert)', () => {
    expect(generateStars(768, 50)).toEqual(generateStars(768, 50))
    const a = seededRandom(1)
    const b = seededRandom(1)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('hat viele schwache und wenige helle Sterne, wie der echte Himmel', () => {
    const stars = generateStars(768, 900)
    const big = stars.filter((s) => s.r > 1.5).length
    const faint = stars.filter((s) => s.r < 0.6).length
    expect(faint).toBeGreaterThan(stars.length * 0.6)
    expect(big).toBeLessThan(stars.length * 0.1)
    expect(big).toBeGreaterThan(0)
  })

  it('liegt ganz in der Kachel', () => {
    for (const s of generateStars(768, 300)) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThan(768)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThan(768)
    }
  })
})
