import { describe, expect, it } from 'vitest'
import { applyRun, archiveSeries, emptyArchive, heightCorrection, rebaseArchive, type PointRun } from './ownVerify'
import heights from './ownVerifyHeights.json'

const H = 3_600_000
const T0 = Date.UTC(2026, 10, 20, 0)

/** Lauf mit Init `init`, stündlich 0…max h, T2m = Init-Stunde·10 + Schritt (zum Wiedererkennen), 1 mm/h. */
function run(initH: number, max: number, every = 1): PointRun {
  const steps: number[] = []
  for (let h = 0; h <= max; h += every) steps.push(h)
  return {
    model: 'x',
    runId: String(initH),
    initMs: T0 + initH * H,
    steps,
    stations: [7],
    t2m: [steps.map((h) => initH * 10 + h)],
    tp: [steps.map((h) => h * 10)],
  }
}

describe('Verifikationsarchiv der eigenen Modelle', () => {
  it('nimmt je Vorlauf den JÜNGSTEN Lauf mit Init ≤ t − n·24 h (wie previous_dayN)', () => {
    const a = emptyArchive(T0)
    for (const init of [0, 3, 6, 9, 12]) applyRun(a, run(init, 60), 0, [1, 2])
    const s = archiveSeries(a, 'temperature_2m', [1, 2])
    const at = (n: number, tH: number) => s.byLead.get(n)![tH]
    // t = 34 h: n=1 → jüngster Lauf mit Init ≤ 10 h ist der von 9 h, Schritt 25
    expect(at(1, 34)).toBeCloseTo((9 * 10 + 25) / 10)
    // n=2 → Init ≤ −14 h gibt es nicht; t = 50 h: Init ≤ 2 → Lauf 0, Schritt 50
    expect(at(2, 34)).toBeNull()
    expect(at(2, 50)).toBeCloseTo(50 / 10)
    // vor +24 h gibt es für n=1 nichts
    expect(at(1, 20)).toBeNull()
  })

  it('rechnet Stundenniederschlag aus der Summe und verteilt Lücken gleichmäßig', () => {
    const a = emptyArchive(T0)
    applyRun(a, run(0, 60, 3), 0, [1]) // 3-stündlich, 1 mm/h
    const p = archiveSeries(a, 'precipitation', [1]).byLead.get(1)!
    expect(p[25]).toBeCloseTo(1)
    expect(p[26]).toBeCloseTo(1)
    expect(p[27]).toBeCloseTo(1)
    // die Stunden des Intervalls, das +24 h überspannt (22–24], fallen nur ab +24 h an
    expect(p[23]).toBeNull()
    expect(p[24]).toBeCloseTo(1)
  })

  it('verwirft einen zu spät gekommenen ÄLTEREN Lauf', () => {
    const a = emptyArchive(T0)
    expect(applyRun(a, run(6, 60), 0, [1])).toBe(true)
    expect(applyRun(a, run(3, 60), 0, [1])).toBe(false)
    expect(archiveSeries(a, 'temperature_2m', [1]).byLead.get(1)![40]).toBeCloseTo((6 * 10 + 34) / 10)
  })

  it('schiebt das Archiv beim Neubeginn, ohne Werte zu verrutschen', () => {
    const a = emptyArchive(T0)
    applyRun(a, run(0, 60), 0, [1])
    const b = rebaseArchive(a, T0 + 10 * H)
    const s = archiveSeries(b, 'temperature_2m', [1])
    expect(s.timeMs[20]).toBe(T0 + 30 * H)
    expect(s.byLead.get(1)![20]).toBeCloseTo(30 / 10)
  })

  it('rechnet die Temperatur auf die Stationshöhe um (0,65 K/100 m)', () => {
    // Station 351 m ÜBER der Zelle (Sonnblick) → 2,3 K kälter
    expect(heightCorrection(2758, 3109)).toBeCloseTo(-2.28, 2)
    // Station unter der Zelle (Tal) → wärmer
    expect(heightCorrection(1688, 1454)).toBeCloseTo(1.52, 2)
    expect(heightCorrection(undefined, 500)).toBe(0)
    expect(heightCorrection(500, null)).toBe(0)
  })

  it('führt für beide Modelle eine Zellhöhe je aktiver Station', () => {
    for (const m of ['arome-at', 'varda']) {
      const h = (heights.models as Record<string, Record<string, number>>)[m]
      expect(Object.keys(h).length).toBeGreaterThanOrEqual(290)
      // Wien Hohe Warte (198 m): die Zelle liegt in derselben Größenordnung
      expect(Math.abs(h['105'] - 198)).toBeLessThan(80)
    }
  })
})
