// Der Fall, der live geschadet hat: ein NICHT GESETZTES GitHub-Secret kommt als
// LEERER STRING an, nicht als undefined. Mit `??` blieb das Adressfeld leer UND
// die Warnung aus — die Selbstdiagnose war blind für genau ihren Anwendungsfall.

import { describe, expect, it } from 'vitest'
import { buildOwner, detailsMissing, given } from './impressum'

const full = {
  VITE_IMPRESSUM_NAME: 'Felix Wagenhäuser',
  VITE_IMPRESSUM_CAREOF: 'c/o Autorenglück #91443',
  VITE_IMPRESSUM_STREET: 'Albert-Einstein-Straße 47',
  VITE_IMPRESSUM_CITY: '02977 Hoyerswerda',
  VITE_IMPRESSUM_EMAIL: 'felix.wagenhaeuser@gmail.com',
}

describe('given', () => {
  it('nimmt einen LEEREN String als fehlend — der Unterschied zu ??', () => {
    expect(given('', 'X')).toBe('X')
    expect(given(undefined, 'X')).toBe('X')
    // Nur-Leerzeichen ist auch keine Angabe (ein versehentlich mit Leerschlag
    // gesetztes Secret sieht im GitHub-UI wie „gesetzt" aus).
    expect(given('   ', 'X')).toBe('X')
  })

  it('übernimmt echte Werte und schneidet Ränder ab', () => {
    expect(given(' Musterstadt ', 'X')).toBe('Musterstadt')
  })
})

describe('buildOwner / detailsMissing', () => {
  it('baut die vollen Angaben und meldet nichts Fehlendes', () => {
    const o = buildOwner(full)
    expect(o.street).toBe('Albert-Einstein-Straße 47')
    expect(o.careOf).toBe('c/o Autorenglück #91443')
    expect(detailsMissing(o)).toBe(false)
  })

  // DAS ist der Regressionstest: leere Secrets → Platzhalter UND Warnung.
  it('erkennt LEERE Secrets als fehlende Pflichtangaben', () => {
    const o = buildOwner({
      VITE_IMPRESSUM_NAME: '',
      VITE_IMPRESSUM_CAREOF: '',
      VITE_IMPRESSUM_STREET: '',
      VITE_IMPRESSUM_CITY: '',
      VITE_IMPRESSUM_EMAIL: '',
    })
    expect(o.street).toContain('⟨')
    expect(detailsMissing(o)).toBe(true)
  })

  it('erkennt fehlende Variablen als fehlende Pflichtangaben', () => {
    expect(detailsMissing(buildOwner({}))).toBe(true)
  })

  // `careOf` ist echt optional: ohne Vertretung darf KEINE Warnung kommen und
  // kein Platzhalter stehen — die c/o-Zeile entfällt dann einfach.
  it('zählt eine fehlende Vertretung NICHT als Mangel', () => {
    const o = buildOwner({ ...full, VITE_IMPRESSUM_CAREOF: '' })
    expect(o.careOf).toBe('')
    expect(detailsMissing(o)).toBe(false)
  })
})
