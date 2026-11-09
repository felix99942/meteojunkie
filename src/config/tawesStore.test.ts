import { describe, expect, it } from 'vitest'
import {
  applyTawesSeries,
  newTawesStore,
  packTawesStore,
  tawesSeries,
  tawesStepMs,
  TAWES_NT,
  TAWES_STEP_MS,
  unpackTawesStore,
} from './tawesStore'

const END = Date.UTC(2026, 10, 9, 20, 0)
const iso = (ms: number) => new Date(ms).toISOString()

describe('TAWES-Speicher', () => {
  it('trägt Werte am richtigen Termin ein und rechnet in die Einheit zurück', () => {
    const s = newTawesStore(END, [11, 22])
    const n = applyTawesSeries(s, 'tl', [iso(END - TAWES_STEP_MS), iso(END)], { 22: [3.4, null] })
    expect(n).toBe(1)
    const v = tawesSeries(s, 'tl').get(22)!
    expect(v[TAWES_NT - 2]).toBeCloseTo(3.4)
    expect(v[TAWES_NT - 1]).toBeNull()
    expect(tawesSeries(s, 'tl').get(11)![TAWES_NT - 2]).toBeNull()
  })

  it('verschiebt beim Fortschreiben und übernimmt nur bekannte Stationen', () => {
    const a = newTawesStore(END, [1, 2])
    applyTawesSeries(a, 'ff', [iso(END)], { 1: [5], 2: [7] })
    const b = newTawesStore(END + 2 * TAWES_STEP_MS, [2, 3], a)
    expect(tawesSeries(b, 'ff').get(2)![TAWES_NT - 3]).toBe(7)
    expect(tawesSeries(b, 'ff').get(3)![TAWES_NT - 3]).toBeNull()
  })

  it('lässt vorhandene Werte stehen, wenn die Antwort null bringt', () => {
    const s = newTawesStore(END, [1])
    applyTawesSeries(s, 'tl', [iso(END)], { 1: [2] })
    applyTawesSeries(s, 'tl', [iso(END)], { 1: [null] })
    expect(tawesSeries(s, 'tl').get(1)![TAWES_NT - 1]).toBe(2)
  })

  it('kennt die Zeit jedes Termins', () => {
    const s = newTawesStore(END, [1])
    expect(tawesStepMs(s, TAWES_NT - 1)).toBe(END)
    expect(tawesStepMs(s, 0)).toBe(END - (TAWES_NT - 1) * TAWES_STEP_MS)
  })

  it('übersteht Packen und Entpacken', async () => {
    const s = newTawesStore(END, [1, 2, 3])
    applyTawesSeries(s, 'dd', [iso(END)], { 3: [271] })
    applyTawesSeries(s, 'tl', [iso(END)], { 1: [-12.3] })
    const back = (await unpackTawesStore(await packTawesStore(s)))!
    expect(back.endMs).toBe(END)
    expect(back.ids).toEqual([1, 2, 3])
    expect(tawesSeries(back, 'dd').get(3)![TAWES_NT - 1]).toBe(271)
    expect(tawesSeries(back, 'tl').get(1)![TAWES_NT - 1]).toBeCloseTo(-12.3)
  })

  it('gibt null für eine fremde Datei', async () => {
    expect(await unpackTawesStore(new TextEncoder().encode('<!doctype html>').buffer as ArrayBuffer)).toBeNull()
  })
})
