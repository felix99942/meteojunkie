// Upstream-Konfiguration des Grid-Proxys (SPEC §5). Default ist die öffentliche
// Free-API. Swap-bereit: per Env umschaltbar, OHNE den Rest des Proxys zu
// ändern —
//   OPENMETEO_BASE_URL  → self-hosted Open-Meteo (eigener Host, kein Limit)
//   OPENMETEO_API_KEY   → Professional-Tarif (bezahlter Key, höheres Budget)
// Erst mit einem dieser Upstreams werden native Vollflächenfelder budgettauglich
// (die Free-API deckelt bei 10.000 gewichteten Locations/Tag; ein natives
// AROME-Österreich-Feld kostet allein ~66.000 — siehe Machbarkeitsanalyse).

export interface Upstream {
  forecastUrl: string
  /** Professional-Key; wird als &apikey= angehängt, wenn gesetzt. */
  apiKey?: string
  /** Nur zur Anzeige/Logs. */
  label: string
}

export function getUpstream(): Upstream {
  const base = process.env.OPENMETEO_BASE_URL ?? 'https://api.open-meteo.com'
  const apiKey = process.env.OPENMETEO_API_KEY || undefined
  const label = apiKey
    ? 'Professional'
    : base.includes('api.open-meteo.com')
      ? 'Free-API'
      : `self-hosted (${base})`
  return { forecastUrl: `${base}/v1/forecast`, apiKey, label }
}
