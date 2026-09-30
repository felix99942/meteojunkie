// Wann darf eine GLOBALE Tastensteuerung zugreifen?
//
// Mehrere Bereiche hören auf ←/→ am `window`, um den Zeitschieber zu
// bewegen (Zeit-Scrubber der Panel-Bereiche, MOS-Vorhersage). Dabei sind
// genau zwei Fälle auszunehmen, und beide waren schon falsch:
//
// **(1) Ein lokaler Handler hat die Taste bereits verbraucht.** Der
// Trenner zwischen Karte und Skew-T (`ProfileSplit`) verschiebt sich mit
// den Pfeiltasten. Sein React-Handler ruft `preventDefault()`, das Ereignis
// steigt aber weiter bis zum `window` — und dort rückte zusätzlich der
// Zeit-Cursor vor. Ein Tastendruck, zwei Wirkungen. `defaultPrevented` ist
// der allgemeine Riegel dagegen: wer die Taste beansprucht, hat sie
// unterbunden, und das gilt dann auch für jeden künftigen lokalen Handler.
//
// **(2) Der Fokus steht in einem Eingabefeld.** In einem Textfeld bewegen
// die Pfeile den Cursor, in einer Auswahlliste die Auswahl, und ein
// Schieberegler (`input[type=range]`) rückt von sich aus um seinen `step`
// weiter — in allen drei Fällen ist die native Wirkung die richtige.
//
// **Ein BUTTON gehört ausdrücklich NICHT dazu**, und das war der Fehler:
// die Liste hat ihn ausgenommen, obwohl Pfeiltasten auf einem Knopf gar
// nichts tun. Wer im Soundings-Bereich eine Stadt aus der Schnellwahl
// anklickt, lässt den Fokus auf diesem Knopf stehen — und danach war die
// Zeitsteuerung per Tastatur tot, ohne dass man sah, warum.

/** Darf eine globale Tastensteuerung auf dieses Ereignis reagieren? */
export function globalKeyAllowed(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false
  const el = e.target as HTMLElement | null
  if (!el) return true
  if (el.isContentEditable) return false
  const tag = el.tagName
  return tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA'
}
