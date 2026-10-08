// Die Regel, wer die Pfeiltasten bekommt. Beide Ausnahmen standen vorher
// falsch im Code und haben sich im Browser als „die Tastatur geht nicht"
// bzw. „ein Tastendruck, zwei Wirkungen" gezeigt.

import { describe, expect, it } from 'vitest'
import { globalKeyAllowed } from './globalKeys'

const evt = (o: { tag?: string; prevented?: boolean; editable?: boolean; type?: string }) =>
  ({
    defaultPrevented: o.prevented ?? false,
    target: o.tag
      ? ({ tagName: o.tag, isContentEditable: o.editable ?? false, type: o.type ?? 'text' } as unknown as HTMLElement)
      : null,
  }) as unknown as KeyboardEvent

describe('globalKeyAllowed', () => {
  it('lässt die Taste durch, wenn nichts dagegen spricht', () => {
    expect(globalKeyAllowed(evt({ tag: 'DIV' }))).toBe(true)
    expect(globalKeyAllowed(evt({}))).toBe(true)
  })

  /**
   * DER FALL, WEGEN DEM ES DIE FUNKTION GIBT. Die alte Liste nahm BUTTON
   * aus — Pfeiltasten tun auf einem Knopf aber gar nichts. Wer eine Stadt
   * aus der Schnellwahl anklickt, lässt den Fokus dort stehen, und danach
   * war die Zeitsteuerung tot, ohne dass man sah, warum.
   */
  it('lässt einen fokussierten KNOPF die Zeitsteuerung nicht blockieren', () => {
    expect(globalKeyAllowed(evt({ tag: 'BUTTON' }))).toBe(true)
  })

  /**
   * Dasselbe Muster mit einem HÄKCHEN: in den Modellkarten blieb der Fokus
   * nach dem Umschalten der Isobaren im Häkchen, und zehn Pfeiltastendrücke
   * schalteten keinen Schritt weiter (gemessen). Ein Optionsfeld dagegen
   * wechselt mit den Pfeilen seine Auswahl und bleibt ausgenommen.
   */
  it('lässt ein fokussiertes HÄKCHEN die Zeitsteuerung nicht blockieren', () => {
    expect(globalKeyAllowed(evt({ tag: 'INPUT', type: 'checkbox' }))).toBe(true)
    expect(globalKeyAllowed(evt({ tag: 'INPUT', type: 'radio' }))).toBe(false)
    expect(globalKeyAllowed(evt({ tag: 'INPUT', type: 'range' }))).toBe(false)
  })

  // In Textfeld, Auswahlliste und Schieberegler ist die native Wirkung die
  // richtige (Cursor, Auswahl, ein `step` weiter).
  it('hält sich aus Eingabefeldern heraus', () => {
    for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
      expect(globalKeyAllowed(evt({ tag })), tag).toBe(false)
    }
    expect(globalKeyAllowed(evt({ tag: 'DIV', editable: true }))).toBe(false)
  })

  /**
   * Der Trenner im Soundings-Bereich verschiebt sich mit den Pfeiltasten und
   * ruft `preventDefault()`; sein Ereignis steigt trotzdem bis zum `window`.
   * Ohne diesen Riegel rückte zusätzlich der Zeit-Cursor vor — ein
   * Tastendruck, zwei Wirkungen.
   */
  it('tritt zurück, wenn ein lokaler Handler die Taste schon verbraucht hat', () => {
    expect(globalKeyAllowed(evt({ tag: 'DIV', prevented: true }))).toBe(false)
  })
})
