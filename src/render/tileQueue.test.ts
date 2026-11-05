import { describe, expect, it } from 'vitest'
import { createTileQueue, type TileQueueMap } from './tileQueue'

function fakeMap(ids: string[]) {
  const calls: [string, string][] = []
  const loaded = new Map(ids.map((id) => [id, true]))
  const listeners = new Map<string, () => void>()
  const sources = new Map<string, { tiles: string[]; setTiles(t: string[]): unknown }>()
  const map: TileQueueMap = {
    getSource: (id) => {
      if (!loaded.has(id)) return undefined
      const src = sources.get(id) ?? { tiles: [] as string[], setTiles: ([url]: string[]) => calls.push([id, url]) }
      sources.set(id, src)
      return src
    },
    isSourceLoaded: (id) => loaded.get(id) ?? false,
    on: (t, fn) => listeners.set(t, fn),
    off: (t) => listeners.delete(t),
  }
  return {
    map,
    calls,
    setLoaded: (id: string, v: boolean) => loaded.set(id, v),
    fire: (t = 'sourcedata') => listeners.get(t)?.(),
    listenerCount: () => listeners.size,
    sources,
  }
}

describe('createTileQueue', () => {
  it('schaltet noch in derselben Runde um, wenn die Quelle nichts lädt', async () => {
    const m = fakeMap(['a'])
    createTileQueue(m.map).queue('a', 'u1')
    await Promise.resolve()
    expect(m.calls).toEqual([['a', 'u1']])
  })

  it('setzt die Adresse sofort an der Quelle — `setTiles` übernimmt sie erst verzögert', async () => {
    const m = fakeMap(['a'])
    createTileQueue(m.map).queue('a', 'u1')
    await Promise.resolve()
    expect(m.sources.get('a')?.tiles).toEqual(['u1'])
  })

  it('wartet, solange Kacheln laden, und nimmt dann nur den jüngsten Wunsch', () => {
    const m = fakeMap(['a'])
    const q = createTileQueue(m.map)
    m.setLoaded('a', false)
    q.queue('a', 'u1')
    q.queue('a', 'u2')
    m.fire()
    expect(m.calls).toEqual([])
    m.setLoaded('a', true)
    m.fire()
    expect(m.calls).toEqual([['a', 'u2']])
  })

  it('wechselt mehrere Quellen gemeinsam, damit Fläche und Linien denselben Termin zeigen', async () => {
    const m = fakeMap(['field', 'lines'])
    const q = createTileQueue(m.map)
    m.setLoaded('lines', false)
    q.queue('field', 'f2')
    q.queue('lines', 'l2')
    await Promise.resolve()
    expect(m.calls).toEqual([])
    m.setLoaded('lines', true)
    m.fire()
    expect(m.calls).toEqual([['field', 'f2'], ['lines', 'l2']])
  })

  it('holt den Wechsel beim Leerlauf nach, wenn die letzte Kachel abgebrochen wurde', () => {
    const m = fakeMap(['a'])
    const q = createTileQueue(m.map)
    m.setLoaded('a', false)
    q.queue('a', 'u1')
    m.setLoaded('a', true)
    m.fire('idle')
    expect(m.calls).toEqual([['a', 'u1']])
  })

  it('setzt einen Stand nicht doppelt und meldet die frisch angelegte Quelle nicht nochmal', async () => {
    const m = fakeMap(['a'])
    const q = createTileQueue(m.map)
    q.init('a', 'u1')
    q.queue('a', 'u1')
    await Promise.resolve()
    m.fire()
    expect(m.calls).toEqual([])
  })

  it('vergisst entfernte Quellen und hängt sich beim Aufräumen ab', () => {
    const m = fakeMap(['a'])
    const q = createTileQueue(m.map)
    m.setLoaded('a', false)
    q.queue('a', 'u1')
    q.forget('a')
    m.setLoaded('a', true)
    m.fire()
    expect(m.calls).toEqual([])
    q.destroy()
    expect(m.listenerCount()).toBe(0)
  })
})
