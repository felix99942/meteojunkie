// Angaben des Anbieters für das Impressum — GETRENNT von der Komponente,
// damit sie prüfbar sind: `Impressum.tsx` darf für React Fast Refresh nur
// Komponenten exportieren (dieselbe Trennung wie chartDef.ts ↔ ChartStack.tsx).
//
// KEINE Postadresse im Quellcode: das Repository ist öffentlich, und das gilt
// auch für die Anschrift einer Impressumsvertretung. Die Werte kommen erst
// beim BAUEN herein — lokal aus `.env.local`, im Deploy aus
// GitHub-Actions-Secrets (siehe .github/workflows/deploy.yml).

/**
 * Ein LEERER Wert zählt als FEHLEND, nicht als Angabe.
 *
 * Der Unterschied zu `??` hat live geschadet: ein NICHT GESETZTES
 * GitHub-Secret wird als LEERER STRING übergeben (`${{ secrets.FOO }}`
 * expandiert zu ''), nicht als `undefined`. `??` greift darauf nicht — das
 * Impressum rendert dann ein leeres Adressfeld UND unterdrückt die Warnung,
 * weil `''.includes('⟨')` falsch ist. Die Selbstdiagnose war damit
 * ausgerechnet in dem Fall blind, für den sie gebaut wurde: Deploy ohne
 * Secrets. Genau so ging es am 2026-09-16 auf meteojunkie.com live.
 */
export function given(v: string | undefined, fallback: string): string {
  const t = v?.trim()
  return t ? t : fallback
}

/** Platzhalter sind an den spitzen Klammern erkennbar. */
export const isPlaceholder = (s: string): boolean => s.includes('⟨')

export interface Owner {
  name: string
  /** Zustellzusatz einer Impressumsvertretung; leer = keine. */
  careOf: string
  street: string
  city: string
  country: string
  email: string
}

/** Aus Umgebungsvariablen gebaute Angaben; Platzhalter, wo etwas fehlt. */
export function buildOwner(env: {
  VITE_IMPRESSUM_NAME?: string
  VITE_IMPRESSUM_CAREOF?: string
  VITE_IMPRESSUM_STREET?: string
  VITE_IMPRESSUM_CITY?: string
  VITE_IMPRESSUM_EMAIL?: string
}): Owner {
  return {
    name: given(env.VITE_IMPRESSUM_NAME, '⟨Name⟩'),
    // Echt optional: leer heißt „keine Vertretung", kein Platzhalter.
    careOf: env.VITE_IMPRESSUM_CAREOF?.trim() ?? '',
    street: given(env.VITE_IMPRESSUM_STREET, '⟨Straße und Hausnummer⟩'),
    city: given(env.VITE_IMPRESSUM_CITY, '⟨PLZ und Ort⟩'),
    country: 'Deutschland',
    email: given(env.VITE_IMPRESSUM_EMAIL, '⟨E-Mail-Adresse⟩'),
  }
}

/**
 * Fehlt eine PFLICHTangabe? `careOf` zählt nicht mit (optional).
 * § 18 Abs 1 MStV verlangt Name und Anschrift.
 */
export function detailsMissing(o: Owner): boolean {
  return [o.name, o.street, o.city, o.email].some(isPlaceholder)
}

export const OWNER: Owner = buildOwner(import.meta.env)
export const DETAILS_MISSING: boolean = detailsMissing(OWNER)
