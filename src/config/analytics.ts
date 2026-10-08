// Besucherzählung über GoatCounter (goatcounter.com) — nur für den Betreiber,
// auf der Seite selbst erscheint keine Zahl.
//
// WARUM GOATCOUNTER: die Seite hat keinen eigenen Server (GitHub Pages), ein
// Zähler braucht also einen fremden Dienst. GoatCounter setzt KEINE Cookies und
// nichts im localStorage, speichert weder IP-Adresse noch User-Agent (nur
// Summen je Tag/Stunde; ein Besuch wird über einen Schlüssel aus Seite + IP +
// User-Agent erkannt, der höchstens acht Stunden im ARBEITSspeicher liegt) und
// hostet bei Hetzner in Deutschland und Finnland. Damit braucht es kein Banner
// (§ 25 TDDDG greift nicht, es wird nichts auf dem Endgerät gespeichert oder
// ausgelesen); genannt werden muss der Dienst trotzdem — siehe Impressum.
//
// Der Site-Code kommt wie der CARTO-Schlüssel aus der BUILD-Konfiguration
// (`VITE_GOATCOUNTER_CODE`, im Deploy die Repository-Variable
// `GOATCOUNTER_CODE`). Fehlt er, wird NICHTS geladen und die
// Datenschutzerklärung sagt „kein Analysedienst" — sie beschreibt immer den
// tatsächlich gebauten Stand.

/** Nur Kleinbuchstaben, Ziffern und Bindestrich — der Code wird Teil einer URL. */
export function goatCounterCode(raw: string | undefined): string | null {
  const v = raw?.trim().toLowerCase() ?? ''
  return /^[a-z0-9][a-z0-9-]{1,48}$/.test(v) ? v : null
}

export const GOATCOUNTER_CODE = goatCounterCode(import.meta.env.VITE_GOATCOUNTER_CODE)

/**
 * Gezählt wird nur in der AUSGELIEFERTEN Seite: im Dev-Server filtert
 * GoatCounter localhost ohnehin heraus, das Skript zu laden wäre dort nur ein
 * Fremdabruf ohne Wirkung.
 */
export const ANALYTICS_ENABLED = GOATCOUNTER_CODE != null && import.meta.env.PROD

export const GOATCOUNTER_HOST = 'gc.zgo.at'
