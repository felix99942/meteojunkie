// Typen der eigenen Vite-Umgebungsvariablen. `vite/client` deklariert
// `ImportMetaEnv` mit Index-Signatur, eigene Variablen wären damit `any` —
// hier stehen sie namentlich, damit ein Tippfehler im Variablennamen auffällt
// statt still `undefined` zu liefern.
//
// Die Impressum-Angaben stehen BEWUSST nicht im Quellcode: das Repository ist
// öffentlich, und KEINE Postadresse des Anbieters soll darin auftauchen — auch
// nicht die einer Impressumsvertretung. Sie gehört auf die ausgelieferte Seite
// (§ 18 Abs 1 MStV), aber nicht in einen öffentlichen Git-Verlauf, aus dem man
// sie nur mit einem History-Rewrite wieder herausbekommt.
//
// Gesetzt werden sie lokal in `.env.local` (gitignored über `*.local`) und im
// Deploy aus GitHub-Actions-Secrets. Fehlen sie, zeigt die Impressum-Seite eine
// sichtbare Warnung statt stillschweigend eine Lücke.

interface ImportMetaEnv {
  readonly VITE_IMPRESSUM_NAME?: string
  /** Zustellzusatz einer Impressumsvertretung, z. B. „c/o Dienst #12345". Optional. */
  readonly VITE_IMPRESSUM_CAREOF?: string
  readonly VITE_IMPRESSUM_STREET?: string
  readonly VITE_IMPRESSUM_CITY?: string
  readonly VITE_IMPRESSUM_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Build-Kennung, von `vite.config.ts` zur Bauzeit eingesetzt (`define`).
 * Beantwortet „welcher Stand ist das hier" ohne Bundle-Suche.
 */
declare const __BUILD_COMMIT__: string
declare const __BUILD_DATE__: string
/** Build aus einem geänderten Arbeitsbaum — nur lokal je wahr. */
declare const __BUILD_DIRTY__: boolean
