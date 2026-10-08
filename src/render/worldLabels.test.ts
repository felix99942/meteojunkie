import { describe, expect, it } from 'vitest'
import { compareCandidates, curatedCities, displayMinZoom, mergeCandidates, type LabelCandidate } from './worldLabels'
import labels from '../mapdata/world.labels.json'

const all = (labels as { labels: [string, number, number, number, number][] }).labels

describe('world.labels.json', () => {
  it('führt Länder, Meere und Städte mit deutschen Namen', () => {
    const names = new Set(all.map((l) => l[0]))
    for (const n of ['Österreich', 'Deutschland', 'Thailand', 'Mittelmeer', 'Wien', 'Bangkok', 'München']) {
      expect(names, n).toContain(n)
    }
  })
  it('liegt vollständig im Mercator-Bereich', () => {
    expect(all.every((l) => Math.abs(l[2]) <= 85 && Math.abs(l[1]) <= 180)).toBe(true)
  })
})

describe('Rangfolge', () => {
  const c = (name: string, minZoom: number, kind: LabelCandidate['kind']): LabelCandidate =>
    ({ name, lon: 0, lat: 0, minZoom, kind })
  it('früherer Zoom gewinnt, bei Gleichstand Land vor Meer vor Hauptstadt vor Stadt', () => {
    const sorted = [c('Stadt', 1, 0), c('Haupt', 1, 1), c('Meer', 1, 3), c('Land', 1, 2), c('Früh', 0.5, 0)]
      .sort(compareCandidates)
      .map((x) => x.name)
    expect(sorted).toEqual(['Früh', 'Land', 'Meer', 'Haupt', 'Stadt'])
  })
})

describe('kuratierte Orte', () => {
  it('kein kuratierter Ort drängt sich vor Zoom 2 ins Bild', () => {
    // Köln (Bildkarten-Priorität 1) stand sonst ab Zoom 0 auf dem Globus und
    // verdrängte „Deutschland" und Berlin
    expect(Math.min(...curatedCities().map((x) => x.minZoom))).toBeGreaterThanOrEqual(2)
  })
  it('derselbe Ort zählt einmal, mit dem früheren Zoom', () => {
    const base: LabelCandidate[] = [{ name: 'Innsbruck', lon: 11.4, lat: 47.27, minZoom: 6, kind: 0 }]
    const merged = mergeCandidates(base, [{ name: 'Innsbruck', lon: 11.39, lat: 47.26, minZoom: 4.8, kind: 0 }])
    expect(merged).toHaveLength(1)
    expect(merged[0].minZoom).toBe(4.8)
  })
  it('gleicher Name an anderem Ort bleibt getrennt', () => {
    const base: LabelCandidate[] = [{ name: 'London', lon: -81.25, lat: 42.97, minZoom: 4, kind: 0 }]
    expect(mergeCandidates(base, [{ name: 'London', lon: -0.12, lat: 51.5, minZoom: 2, kind: 0 }])).toHaveLength(2)
  })
})

describe('Flächennamen kommen später', () => {
  it('Länder erst ab Zoom 3 und anderthalb Stufen nach Natural Earth, Meere eine Stufe', () => {
    expect(displayMinZoom(2, 0.7)).toBe(3)
    expect(displayMinZoom(2, 3)).toBe(4.5)
    expect(displayMinZoom(3, 0)).toBe(1)
    expect(displayMinZoom(0, 2)).toBe(2)
  })
})
