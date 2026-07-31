import { describe, expect, it } from 'vitest'
import { parseEnsembleBody, type EnsembleBody } from './ensembleParse'

/** Ausschnitt in der EXAKTEN Form der echten Antwort (live geprüft). */
const body: EnsembleBody = {
  hourly: {
    time: [1_754_006_400, 1_754_010_000],
    temperature_2m: [26.5, 25.6],
    temperature_2m_member01: [26.1, 25.2],
    temperature_2m_member02: [27.0, 26.4],
    temperature_2m_member10: [24.8, 24.1],
  },
  hourly_units: { time: 'unixtime', temperature_2m: '°C' },
}

describe('parseEnsembleBody', () => {
  it('setzt den Kontrolllauf an Position 0, dann die Mitglieder', () => {
    const p = parseEnsembleBody(body, 'temperature_2m')
    expect(p.members.length).toBe(4)
    expect(p.members[0]).toEqual([26.5, 25.6])
    expect(p.members[1]).toEqual([26.1, 25.2])
  })

  it('rechnet unixtime-Sekunden in Epoch-ms um', () => {
    const p = parseEnsembleBody(body, 'temperature_2m')
    expect(p.times).toEqual([1_754_006_400_000, 1_754_010_000_000])
  })

  it('übernimmt die Einheit der Variablen', () => {
    expect(parseEnsembleBody(body, 'temperature_2m').unit).toBe('°C')
  })

  it('sortiert Mitglieder numerisch, nicht nach Objekt-Reihenfolge', () => {
    const scrambled: EnsembleBody = {
      hourly: {
        time: [0],
        temperature_2m: [0],
        temperature_2m_member10: [10],
        temperature_2m_member02: [2],
        temperature_2m_member01: [1],
      },
    }
    const p = parseEnsembleBody(scrambled, 'temperature_2m')
    expect(p.members.map((m) => m[0])).toEqual([0, 1, 2, 10])
  })

  it('verwechselt Variablen nicht (Präfix-Kollision)', () => {
    const mixed: EnsembleBody = {
      hourly: {
        time: [0],
        temperature_2m: [1],
        temperature_2m_member01: [2],
        temperature_850hPa: [3],
        temperature_850hPa_member01: [4],
      },
    }
    expect(parseEnsembleBody(mixed, 'temperature_850hPa').members.map((m) => m[0])).toEqual([3, 4])
  })

  it('kommt ohne Kontrolllauf und ohne Einheiten zurecht', () => {
    const p = parseEnsembleBody(
      { hourly: { time: [0], precipitation_member01: [0.4] } },
      'precipitation',
    )
    expect(p.members).toEqual([[0.4]])
    expect(p.unit).toBe('')
  })

  it('liefert bei leerer Antwort leere Reihen statt zu werfen', () => {
    const p = parseEnsembleBody({ hourly: {} }, 'temperature_2m')
    expect(p.times).toEqual([])
    expect(p.members).toEqual([])
  })
})
