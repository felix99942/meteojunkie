import { describe, expect, it } from 'vitest'
import { POLE_ROWS } from '../config/globe'
import { cleanTopoTile, RELIEF_PRELOAD_ZOOM, reliefTiles, retryTopo, topoTile, upsampleTopoTile } from './globeTopo'

const SIZE = 64

/** Kachel aus einer Höhenfunktion (Meter) in Terrarium-Kodierung. */
function tile(height: (col: number, row: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const v = height(col, row) + 32768
      const i = (row * SIZE + col) * 4
      px[i] = Math.floor(v / 256)
      px[i + 1] = Math.floor(v) % 256
      px[i + 2] = Math.floor((v % 1) * 256)
      px[i + 3] = 255
    }
  }
  return px
}

const metres = (px: Uint8ClampedArray, col: number, row: number) => {
  const i = (row * SIZE + col) * 4
  return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768
}

describe('cleanTopoTile', () => {
  it('setzt den Meeresboden auf null und lässt Land unverändert', () => {
    const px = tile((col) => (col < 32 ? -3200 : 1234.5))
    cleanTopoTile(px, SIZE, 6, 20)
    expect(metres(px, 0, 30)).toBe(0)
    expect(metres(px, 31, 30)).toBe(0)
    expect(metres(px, 32, 30)).toBe(1234.5)
  })

  it('macht nur den Polrand flach, und zwar auf die mittlere Höhe der Zeile darunter', () => {
    const north = tile((col, row) => (row === POLE_ROWS ? 1000 + col : 500 + row * col))
    const before = metres(north, 7, POLE_ROWS + 1)
    cleanTopoTile(north, SIZE, 2, 0)
    const expected = 1000 + (SIZE - 1) / 2
    expect(metres(north, 0, 0)).toBeCloseTo(expected, 1)
    expect(metres(north, SIZE - 1, POLE_ROWS - 1)).toBeCloseTo(expected, 1)
    expect(metres(north, 7, POLE_ROWS + 1)).toBe(before)

    const south = tile((col, row) => (row === SIZE - POLE_ROWS - 1 ? 3000 : 2000 + col))
    cleanTopoTile(south, SIZE, 2, 3)
    expect(metres(south, 9, SIZE - 1)).toBe(3000)
    expect(metres(south, 9, SIZE - POLE_ROWS)).toBe(3000)
    expect(metres(south, 9, 5)).toBe(2009)
  })

  it('lässt Kacheln abseits der Pole oben und unten stehen', () => {
    const px = tile((col) => 800 + col)
    cleanTopoTile(px, SIZE, 2, 1)
    expect(metres(px, 5, 0)).toBe(805)
    expect(metres(px, 5, SIZE - 1)).toBe(805)
  })
})

describe('topoTile', () => {
  // Innsbruck (11,4° O, 47,27° N), Stufe z
  const inn = (z: number) => {
    const n = 2 ** z
    const r = (47.27 * Math.PI) / 180
    return [Math.floor(((11.4 + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)]
  }

  it('nimmt über den Alpen die feinste Stufe selbst', () => {
    const [x, y] = inn(12)
    expect(topoTile(12, x, y)).toMatchObject({ z: 12, x, y, factor: 1 })
  })

  it('geht in Berlin bei Stufe 12 auf die DACH-Stufe 11 zurück', () => {
    const n = 2 ** 12
    const x = Math.floor(((13.4 + 180) / 360) * n)
    const r = (52.5 * Math.PI) / 180
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
    expect(topoTile(12, x, y)).toMatchObject({ z: 11, x: x >> 1, y: y >> 1, factor: 2, col: x % 2, row: y % 2 })
  })

  it('geht außerhalb auf die weltweite Stufe zurück und lässt gröbere Stufen unverändert', () => {
    // Himalaya
    const x = Math.floor(((85 + 180) / 360) * 2 ** 11)
    const t = topoTile(11, x, 800)
    expect(t).toMatchObject({ z: 8, x: x >> 3, y: 100, factor: 8 })
    expect(topoTile(8, 200, 100)).toMatchObject({ z: 8, x: 200, y: 100, factor: 1 })
  })
})

describe('upsampleTopoTile', () => {
  it('trifft auf einer schiefen Ebene die Höhen des Ausschnitts, auch über den Rot-Übertrag', () => {
    // 200 m je Pixel: läuft mehrfach über die 256-m-Grenze zwischen Grün und Rot
    const px = tile((col) => 1000 + col * 200)
    const out = upsampleTopoTile(px, SIZE, 2, 1, 0)
    // rechte Hälfte der Kachel: Spalte c zeigt Quelle (32 + (c + 0.5) / 2 − 0.5)
    const expected = (c: number) => 1000 + (32 + (c + 0.5) / 2 - 0.5) * 200
    expect(metres(out, 0, 10)).toBeCloseTo(expected(0), 1)
    expect(metres(out, 20, 10)).toBeCloseTo(expected(20), 1)
    expect(metres(out, 40, 10)).toBeCloseTo(expected(40), 1)
  })

  it('hat auch über Zellgrenzen eine stetige Steigung — sonst zeigt die Schummerung ein Karomuster', () => {
    // Kein Hang, sondern Knicke: 300 m auf und ab, je Quellzelle eine andere Steigung
    const px = tile((col, row) => 1500 + 300 * Math.sin(col * 0.9) + 200 * Math.cos(row * 0.7))
    const out = upsampleTopoTile(px, SIZE, 16, 5, 5)
    let maxJump = 0
    for (let c = 1; c < SIZE - 1; c++) {
      const curve = metres(out, c + 1, 30) - 2 * metres(out, c, 30) + metres(out, c - 1, 30)
      maxJump = Math.max(maxJump, Math.abs(curve))
    }
    // Bilinear läge der Sprung bei einer Zellgrenze in der Größe der Steigung selbst
    const slope = Math.abs(metres(out, 21, 30) - metres(out, 20, 30))
    expect(maxJump).toBeLessThan(Math.max(1, slope))
  })

  it('bleibt am Rand der Kachel im Wertebereich', () => {
    const px = tile(() => 500)
    const out = upsampleTopoTile(px, SIZE, 4, 3, 3)
    expect(metres(out, SIZE - 1, SIZE - 1)).toBe(500)
  })
})

describe('retryTopo', () => {
  const failing = (times: number) => {
    let calls = 0
    const run = async () => {
      if (++calls <= times) throw new Error('Netz weg')
      return 'kachel'
    }
    return { run, calls: () => calls }
  }

  it('wiederholt nach einem Netzfehler, bis die Kachel kommt', async () => {
    const f = failing(2)
    await expect(retryTopo(f.run, new AbortController().signal, [0, 0, 0])).resolves.toBe('kachel')
    expect(f.calls()).toBe(3)
  })

  it('gibt nach dem letzten Versuch den Fehler weiter', async () => {
    const f = failing(9)
    await expect(retryTopo(f.run, new AbortController().signal, [0, 0])).rejects.toThrow('Netz weg')
    expect(f.calls()).toBe(3)
  })

  it('wiederholt einen Abbruch nicht', async () => {
    let calls = 0
    const run = async () => {
      calls++
      throw new DOMException('weg', 'AbortError')
    }
    await expect(retryTopo(run, new AbortController().signal, [0, 0])).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('bricht die Pause zwischen zwei Versuchen sofort ab', async () => {
    const ac = new AbortController()
    const f = failing(9)
    const pending = retryTopo(f.run, ac.signal, [60_000])
    await Promise.resolve()
    await Promise.resolve()
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.calls()).toBe(1)
  })
})

describe('Alpen 3D', () => {
  it('lädt grob vor fein und endet an der feinsten Stufe, in begrenzter Menge', () => {
    const t = reliefTiles()
    expect(t[0][0]).toBe(4)
    expect(t[t.length - 1][0]).toBe(RELIEF_PRELOAD_ZOOM)
    expect(t.every((a, i) => i === 0 || a[0] >= t[i - 1][0])).toBe(true)
    expect(t.length).toBeGreaterThan(100)
    expect(t.length).toBeLessThan(600)
  })
  it('deckt Mitte und Ränder des erlaubten Bereichs ab', () => {
    const fine = new Set(reliefTiles().filter((a) => a[0] === 9).map((a) => `${a[1]}/${a[2]}`))
    expect(fine.has('272/179')).toBe(true) // Innsbruck-Umgebung, gegen die Kachelformel gerechnet
    expect(fine.size).toBeGreaterThan(200)
  })
})
