import { describe, expect, it } from 'vitest'
import { goatCounterCode } from './analytics'

describe('goatCounterCode', () => {
  it('nimmt einen gültigen Code, getrimmt und klein', () => {
    expect(goatCounterCode(' MeteoJunkie ')).toBe('meteojunkie')
    expect(goatCounterCode('meteo-1')).toBe('meteo-1')
  })
  it('leer, fehlend oder URL-artig zählt als nicht gesetzt', () => {
    // Ein nicht gesetztes GitHub-Secret kommt als LEERER String an
    expect(goatCounterCode('')).toBeNull()
    expect(goatCounterCode(undefined)).toBeNull()
    // Wer die ganze Adresse einträgt, bekäme sonst eine kaputte URL
    expect(goatCounterCode('https://x.goatcounter.com/count')).toBeNull()
    expect(goatCounterCode('a.b')).toBeNull()
  })
})
