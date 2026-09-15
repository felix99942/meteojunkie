// Laufanzeige: die Zeitangabe muss den TAG mitnennen, sonst ist „18 UTC" um
// 01 UTC zweideutig — und genau dann fragt man nach dem Alter.

import { describe, expect, it } from 'vitest'
import { formatRun, formatRunLong, latestRun } from './runs'

const utc = (iso: string) => Date.parse(iso)

describe('latestRun', () => {
  // ICON-D2: alle 3 h, Bereitstellung ~3 h nach Init.
  const d2 = { id: 'icon_d2', updateIntervalHours: 3 }

  it('nimmt den jüngsten Lauf, dessen Verzögerung schon abgelaufen ist', () => {
    // 12:30 UTC minus 3 h Verzögerung = 09:30 → jüngster 3-h-Takt: 09 UTC.
    expect(latestRun(d2, utc('2026-09-15T12:30:00Z')).initHourUtc).toBe(9)
  })

  it('springt nicht auf einen Lauf, der noch nicht online sein kann', () => {
    // 12:00 UTC minus 3 h = 09:00 → genau der 09-UTC-Lauf, nicht 12.
    expect(latestRun(d2, utc('2026-09-15T12:00:00Z')).initHourUtc).toBe(9)
  })

  it('geht über die Tagesgrenze zurück', () => {
    const run = latestRun(d2, utc('2026-09-15T01:00:00Z'))
    expect(run.initHourUtc).toBe(21)
    expect(run.initTime).toBe(utc('2026-09-14T21:00:00Z'))
  })
})

describe('formatRunLong', () => {
  const at = (iso: string) => ({ initTime: utc(iso), initHourUtc: new Date(utc(iso)).getUTCHours() })

  it('nennt den heutigen Lauf „heute"', () => {
    expect(formatRunLong(at('2026-09-15T06:00:00Z'), utc('2026-09-15T12:00:00Z'))).toBe(
      'heute 06 UTC',
    )
  })

  // Der Fall, um den es geht: nachts ist der neueste Lauf von gestern.
  it('nennt den Lauf von gestern „gestern"', () => {
    expect(formatRunLong(at('2026-09-14T18:00:00Z'), utc('2026-09-15T01:00:00Z'))).toBe(
      'gestern 18 UTC',
    )
  })

  it('nennt ältere Läufe mit Datum', () => {
    expect(formatRunLong(at('2026-09-13T12:00:00Z'), utc('2026-09-15T01:00:00Z'))).toBe(
      '13.09. 12 UTC',
    )
  })

  it('bleibt in der kompakten Form bei der reinen Stunde', () => {
    expect(formatRun(at('2026-09-15T06:00:00Z'))).toBe('06 UTC')
  })
})
