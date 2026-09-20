import { describe, expect, it } from 'vitest'
import { clampMapWidth, defaultMapWidth, MIN_CHART_WIDTH, MIN_MAP_WIDTH } from './splitWidth'

describe('clampMapWidth', () => {
  it('lässt Breiten im erlaubten Bereich unverändert', () => {
    expect(clampMapWidth(600, 1600)).toBe(600)
  })

  it('hält die Mindestbreiten beider Seiten ein', () => {
    expect(clampMapWidth(10, 1600)).toBe(MIN_MAP_WIDTH)
    expect(clampMapWidth(5000, 1600)).toBe(1600 - MIN_CHART_WIDTH)
  })

  it('opfert im Engpass die KARTE, nicht das Diagramm', () => {
    // Bei 600 px Gesamtbreite ist für beide Mindestbreiten kein Platz
    // (260 + 380 = 640). Dann bekommt das Diagramm seine 380 und die Karte
    // den Rest — umgekehrt wäre das Profil unlesbar, und das ist der Inhalt.
    const total = 600
    const w = clampMapWidth(400, total)
    expect(w).toBe(total - MIN_CHART_WIDTH)
    expect(total - w).toBe(MIN_CHART_WIDTH)
  })

  it('wird nie negativ, auch wenn gar kein Platz ist', () => {
    expect(clampMapWidth(300, 200)).toBe(0)
    expect(clampMapWidth(-50, 1600)).toBe(MIN_MAP_WIDTH)
  })
})

describe('defaultMapWidth', () => {
  it('gibt der Karte gut ein Drittel', () => {
    expect(defaultMapWidth(1600)).toBe(608)
  })

  it('deckelt auf breiten Schirmen', () => {
    // 38 % von 2560 wären 973 px — die Karte soll aber nicht die halbe
    // Fläche nehmen, nur weil der Schirm gross ist.
    expect(defaultMapWidth(2560)).toBe(820)
  })

  it('bleibt auf schmalen Fenstern im Erlaubten', () => {
    const total = 900
    const w = defaultMapWidth(total)
    expect(w).toBeLessThanOrEqual(total - MIN_CHART_WIDTH)
    expect(w).toBeGreaterThanOrEqual(MIN_MAP_WIDTH)
  })
})
