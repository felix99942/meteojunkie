// Build-Kennung für die Oberfläche. Die Werte setzt `vite.config.ts` zur
// Bauzeit ein (`define`), hier steht nur die Aufbereitung — getrennt, damit
// sie prüfbar ist und die Komponenten keine globalen Bezeichner kennen müssen.

export interface BuildInfo {
  /** Kurzer Commit-Hash, oder „unbekannt" wenn Git nicht verfügbar war. */
  commit: string
  /** Commit-Datum (ISO). */
  date: string
  /** Aus einem geänderten Arbeitsbaum gebaut — gehört zu keinem Commit. */
  dirty: boolean
}

export const BUILD: BuildInfo = {
  commit: __BUILD_COMMIT__,
  date: __BUILD_DATE__,
  dirty: __BUILD_DIRTY__,
}

/**
 * Kurzform für die Anzeige: `4a5b4ea · 16.09.2026`, bei einem geänderten
 * Baum mit angehängtem `+`.
 *
 * Datum UND Commit, weil beide eine andere Frage beantworten: das Datum sagt
 * „wie alt ist das", der Commit „welcher Stand genau" — und nur er lässt sich
 * gegen `git log` halten.
 */
export function buildLabel(b: BuildInfo = BUILD): string {
  const d = new Date(b.date)
  const date = Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('de-AT', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d)
  return `${b.commit}${b.dirty ? '+' : ''} · ${date}`
}

/** Langform für den Tooltip — nennt die Uhrzeit und erklärt das `+`. */
export function buildTitle(b: BuildInfo = BUILD): string {
  const d = new Date(b.date)
  const stamp = Number.isNaN(d.getTime())
    ? b.date
    : new Intl.DateTimeFormat('de-AT', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d) + ' UTC'
  return (
    `Stand dieser Seite: Commit ${b.commit}, ${stamp}. ` +
    (b.dirty
      ? 'Das „+" heißt: aus einem geänderten Arbeitsbaum gebaut, dieser Stand gehört zu keinem Commit.'
      : 'Damit lässt sich prüfen, ob ein Deploy angekommen ist — die Angabe kommt aus Git, nicht aus einer gepflegten Versionsnummer.')
  )
}
