// Der Schlüssel muss sich GENAU DANN ändern, wenn sich die Daten geändert
// haben — nicht öfter (sonst rechnet jeder Memo bei jedem Render neu) und
// nicht seltener (sonst bleibt ein Diagramm auf den Daten des vorigen Orts
// stehen, und genau das war der Fehler).

import { describe, expect, it } from 'vitest'
import { refId, seriesKey } from './dataKey'

describe('refId', () => {
  it('gibt derselben Referenz dieselbe Kennung', () => {
    const a = { x: 1 }
    expect(refId(a)).toBe(refId(a))
  })

  // Der Kern: INHALTSGLEICH ist nicht dasselbe wie IDENTISCH. TanStack teilt
  // Strukturen — ein unveränderter Abruf liefert dieselbe Referenz, ein
  // geänderter eine neue. Über den Inhalt zu vergleichen wäre teuer und
  // würde eine echte Änderung mit gleichen Zahlen verschlucken.
  it('unterscheidet inhaltsgleiche, aber verschiedene Objekte', () => {
    expect(refId({ x: 1 })).not.toBe(refId({ x: 1 }))
  })

  it('fasst „noch nicht geladen" zu einem eigenen Zeichen zusammen', () => {
    expect(refId(undefined)).toBe('-')
    expect(refId(null)).toBe('-')
  })
})

describe('seriesKey', () => {
  const a = { v: [1] }
  const b = { v: [2] }

  it('bleibt gleich, solange dieselben Serien anliegen', () => {
    expect(seriesKey([a, b])).toBe(seriesKey([a, b]))
  })

  /**
   * DER FEHLERFALL, den es zu verhindern gilt. Vorher stand hier
   * „geladen ja/nein": Wien → Sonnblick → Wien ergab dreimal `11`, der Memo
   * rechnete beim dritten Klick nicht neu, und auf dem Schirm blieb der
   * Sonnblick stehen.
   */
  it('ändert sich beim Wechsel zwischen zwei GELADENEN Serien', () => {
    const wien = { v: [1] }
    const sonnblick = { v: [2] }
    const geladen = (x: unknown) => (x ? '1' : '0')
    // So sah es vorher aus — nicht unterscheidbar:
    expect([wien].map(geladen).join()).toBe([sonnblick].map(geladen).join())
    // Und so jetzt:
    expect(seriesKey([wien])).not.toBe(seriesKey([sonnblick]))
  })

  it('merkt eine einzelne getauschte Serie in einer Liste', () => {
    const c = { v: [3] }
    expect(seriesKey([a, b])).not.toBe(seriesKey([a, c]))
  })

  it('unterscheidet „lädt noch" von „geladen"', () => {
    expect(seriesKey([undefined, b])).not.toBe(seriesKey([a, b]))
    expect(seriesKey([undefined, undefined])).toBe('-,-')
  })

  // Die Modellauswahl eines Panels ändert die LÄNGE — ein
  // Abhängigkeits-Array könnte das nicht, ein Schlüssel schon.
  it('verträgt wechselnde Länge', () => {
    expect(seriesKey([a])).not.toBe(seriesKey([a, b]))
    expect(seriesKey([])).toBe('')
  })

  // Die Reihenfolge IST Information: Serie 1 und 2 zu tauschen heißt, zwei
  // Kurven zu vertauschen.
  it('achtet auf die Reihenfolge', () => {
    expect(seriesKey([a, b])).not.toBe(seriesKey([b, a]))
  })
})
