import { describe, expect, it } from 'vitest'
import { applyTawesSeries, mergeTawesStores, newTawesStore, packTawesStore, TAWES_NT, TAWES_STEP_MS, unpackTawesStore } from './tawesStore'
import { getTawesParam, PRECIP_WINDOWS, TAWES_PARAMS, codesFor, displayOf, precipScaleFor, synopticPeriods, synopticWindow } from './tawesParameters'
import { formatTawes, minPresent, stationValue, tawesValues } from './tawesValues'

const END = Date.UTC(2026, 10, 12, 12, 0)
const iso = (ms: number) => new Date(ms).toISOString()
const times = (n: number) => Array.from({ length: n }, (_, i) => iso(END - (n - 1 - i) * TAWES_STEP_MS))

describe('stationValue', () => {
  it('summiert genau das Fenster bis einschließlich des Termins', () => {
    const s = [1, 1, 1, 2, 3, null]
    expect(stationValue(s, 4, 'sum', 2)).toBe(5)
    expect(stationValue(s, 4, 'sum', 5)).toBe(8)
  })

  it('gibt keine Summe, wenn mehr als ein Viertel fehlt — auch über eine Stunde', () => {
    const s = [0.1, null, 0.2, 0.1, null, 0.3]
    expect(minPresent(6, 'sum')).toBe(5)
    expect(stationValue(s, 5, 'sum', 6)).toBeNull()
    // bei Maxima über eine Stunde reicht die Hälfte
    expect(stationValue(s, 5, 'max', 6)).toBe(0.3)
  })

  it('verlangt beim 10-Minuten-Fenster den Wert genau zum Termin', () => {
    expect(stationValue([0.4, null], 1, 'sum', 1)).toBeNull()
    expect(stationValue([0.4, 0], 1, 'sum', 1)).toBe(0)
  })

  it('reicht das Fenster vor den Anfang, gibt es keinen Wert', () => {
    expect(stationValue([1, 1, 1], 2, 'sum', 4)).toBeNull()
  })

  it('verwirft einen zu alten letzten Wert', () => {
    const s: (number | null)[] = [5, ...Array(7).fill(null)]
    expect(stationValue(s, 6, 'last', 1)).toBe(5)
    expect(stationValue(s, 7, 'last', 1)).toBeNull()
    expect(stationValue(s, 7, 'last', 1, 18)).toBe(5)
  })

  it('rechnet Änderungen mit einem Termin Spielraum', () => {
    const s = [1000, null, null, 1003.5]
    expect(stationValue(s, 3, 'change', 3)).toBeCloseTo(3.5)
    expect(stationValue([null, null, null, 1003], 3, 'change', 3)).toBeNull()
  })
})

describe('Registry', () => {
  it('hat eindeutige Schlüssel und für jedes Niederschlagsfenster eine eigene Skala', () => {
    expect(new Set(TAWES_PARAMS.map((p) => p.key)).size).toBe(TAWES_PARAMS.length)
    const scales = PRECIP_WINDOWS.map((w) => precipScaleFor(w.steps))
    expect(new Set(scales).size).toBe(PRECIP_WINDOWS.length)
  })

  it('setzt Rot und Lila auf die DWD-Schwellen markant/Unwetter', () => {
    const at = (steps: number, i: number) => precipScaleFor(steps).stops[i].value
    expect([at(6, 14), at(6, 16)]).toEqual([15, 25])
    expect([at(72, 14), at(72, 16)]).toEqual([25, 40])
    expect([at(144, 14), at(144, 16)]).toEqual([30, 50])
    expect([at(288, 14), at(288, 16)]).toEqual([40, 60])
  })

  it('nur der Niederschlag hat ein wählbares Fenster', () => {
    expect(TAWES_PARAMS.filter((p) => p.windowed).every((p) => p.group === 'Niederschlag')).toBe(true)
  })

  it('stellt die Regendauer ab 3 h in Stunden dar', () => {
    const p = getTawesParam('rrm')
    expect(displayOf(p, 6).unit).toBe('min')
    expect(displayOf(p, 18).unit).toBe('h')
  })

  it('kennt die Rohgrößen der gerechneten Größen', () => {
    expect(codesFor(getTawesParam('td'))).toEqual(['tl', 'rf'])
    expect(codesFor(getTawesParam('ff'), true)).toEqual(['ff', 'dd'])
  })
})

describe('tawesValues', () => {
  it('summiert Niederschlag über das gewählte Fenster, im Speicher wie gemessen', async () => {
    const s = newTawesStore(END, [1, 2], null, ['rr'])
    applyTawesSeries(s, 'rr', times(6), { 1: [0.1, 0.2, 0, 0.5, 0.3, 0.1], 2: [0, 0, 0, null, null, 0] })
    const back = (await unpackTawesStore(await packTawesStore(s)))!
    const r = tawesValues(getTawesParam('rr'), 6, back, null)!
    expect(r.at).toBe(TAWES_NT - 1)
    expect(r.byStation.get(1)).toBeCloseTo(1.2)
    expect(r.byStation.get(2)).toBeNull()
    expect(tawesValues(getTawesParam('rr'), 1, back, null)!.byStation.get(1)).toBeCloseTo(0.1)
  })

  it('rechnet Wind in km/h und nimmt die Richtung mit', () => {
    const s = newTawesStore(END, [1], null, ['ff', 'dd'])
    applyTawesSeries(s, 'ff', times(1), { 1: [10] })
    applyTawesSeries(s, 'dd', times(1), { 1: [270] })
    const r = tawesValues(getTawesParam('ff'), 6, s, null, true)!
    expect(r.byStation.get(1)).toBeCloseTo(36)
    expect(r.direction?.get(1)).toBe(270)
  })

  it('verwirft den auf eine Bezugshöhe reduzierten Druck der Bergstationen', () => {
    const s = newTawesStore(END, [1, 2], null, ['pred'])
    applyTawesSeries(s, 'pred', times(1), { 1: [1012.4], 2: [830.1] })
    const r = tawesValues(getTawesParam('pred'), 6, s, null)!
    expect(r.byStation.get(1)).toBeCloseTo(1012.4)
    expect(r.byStation.get(2)).toBeNull()
  })

  it('deckelt den Termin auf den Stand des Netzes', () => {
    const s = newTawesStore(END, [1], null, ['tl'])
    applyTawesSeries(s, 'tl', [iso(END - 3 * TAWES_STEP_MS)], { 1: [4] })
    const r = tawesValues(getTawesParam('tl'), 6, s, TAWES_NT - 1)!
    expect(r.at).toBe(TAWES_NT - 4)
    expect(r.byStation.get(1)).toBe(4)
  })

  it('gibt null, wenn eine nötige Rohgröße fehlt', () => {
    const s = newTawesStore(END, [1], null, ['tl'])
    expect(tawesValues(getTawesParam('td'), 6, s, null)).toBeNull()
  })

  it('legt Einzeldateien verschiedener Läufe auf eine Zeitachse', () => {
    const a = newTawesStore(END, [1], null, ['tl'])
    applyTawesSeries(a, 'tl', [iso(END)], { 1: [3] })
    const b = newTawesStore(END + TAWES_STEP_MS, [1], null, ['rf'])
    const m = mergeTawesStores([a, b])!
    expect(m.endMs).toBe(END + TAWES_STEP_MS)
    expect(m.values.tl![TAWES_NT - 2]).toBe(30)
  })
})

describe('formatTawes', () => {
  it('schreibt kein −0', () => {
    expect(formatTawes(-0.04, 1)).toBe('0,0')
    expect(formatTawes(12.25, 1)).toBe('12,3')
  })
})

describe('synoptische Zeiträume', () => {
  const t = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m)

  it('Höchstwert: tagsüber der laufende Tag, nachts der abgelaufene', () => {
    expect(synopticWindow(t(13, 10), 'day')).toEqual({ startMs: t(13, 6), endMs: t(13, 18), running: true })
    expect(synopticWindow(t(13, 18), 'day')).toEqual({ startMs: t(13, 6), endMs: t(13, 18), running: false })
    expect(synopticWindow(t(13, 23), 'day')).toEqual({ startMs: t(13, 6), endMs: t(13, 18), running: false })
    expect(synopticWindow(t(14, 3), 'day')).toEqual({ startMs: t(13, 6), endMs: t(13, 18), running: false })
    // der Wert um 06:00 gilt für 05:50–06:00 und gehört noch nicht zum Tag
    expect(synopticWindow(t(14, 6), 'day').endMs).toBe(t(13, 18))
    expect(synopticWindow(t(14, 6, 10), 'day').endMs).toBe(t(14, 18))
  })

  it('Tiefstwert: nachts die laufende Nacht, tagsüber die vergangene', () => {
    expect(synopticWindow(t(13, 22), 'night')).toEqual({ startMs: t(13, 18), endMs: t(14, 6), running: true })
    expect(synopticWindow(t(14, 2), 'night')).toEqual({ startMs: t(13, 18), endMs: t(14, 6), running: true })
    expect(synopticWindow(t(14, 6), 'night')).toEqual({ startMs: t(13, 18), endMs: t(14, 6), running: false })
    expect(synopticWindow(t(14, 15), 'night')).toEqual({ startMs: t(13, 18), endMs: t(14, 6), running: false })
  })

  it('reiht die Tage für die Zeitleiste, soweit der Speicher reicht', () => {
    const p = synopticPeriods(t(13, 10), t(8, 12), 'day')
    expect(p.map((w) => new Date(w.endMs).getUTCDate())).toEqual([9, 10, 11, 12, 13])
    expect(p.at(-1)!.running).toBe(true)
    expect(synopticPeriods(t(13, 10), t(11, 0), 'day')).toHaveLength(3)
  })

  it('nimmt das Minimum genau über die Nacht, auch wenn die Leiste später steht', () => {
    const end = t(14, 15)
    const s = newTawesStore(end, [1], null, ['tlmin'])
    const n = (TAWES_NT - 1) - (end - t(13, 18)) / TAWES_STEP_MS
    const series: (number | null)[] = Array(TAWES_NT).fill(5)
    series[n] = -9 // 18:00 gehört zum Tag davor
    series[n + 30] = -2 // in der Nacht
    series[TAWES_NT - 5] = -20 // am Nachmittag danach
    applyTawesSeries(s, 'tlmin', Array.from({ length: TAWES_NT }, (_, i) => iso(end - (TAWES_NT - 1 - i) * TAWES_STEP_MS)), { 1: series })
    const r = tawesValues(getTawesParam('tlmin'), 6, s, null)!
    expect(r.window).toEqual({ startMs: t(13, 18), endMs: t(14, 6), running: false })
    expect(r.byStation.get(1)).toBe(-2)
  })
})
