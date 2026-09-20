// Quellenangabe der Vorhersagebereiche.
//
// Open-Meteo stellt seine Daten unter CC BY 4.0 — die Namensnennung ist
// LIZENZBEDINGUNG, nicht Höflichkeit (SPEC §13 führte das als offenen Punkt).
// Genannt wird beides: Open-Meteo als Aggregator UND die Wetterdienste, deren
// Modelle dahinterstehen. Für eine Seite, die Modelle nebeneinanderstellt, ist
// das nicht nur Pflicht, sondern die Information selbst — wer ICON gegen IFS
// vergleicht, sollte wissen, dass da DWD gegen ECMWF steht.
//
// Die Anbieterliste wird aus der Registry ABGELEITET (`ModelDef.provider`),
// nicht gepflegt: ein neues Modell bringt seinen Anbieter automatisch mit.

import { MODELS } from '../config/models'

/** Anbieter aus der Modell-Registry, ohne Open-Meteo selbst (steht schon davor). */
const PROVIDERS = [...new Set(Object.values(MODELS).map((m) => m.provider))]
  .filter((p) => p !== 'Open-Meteo')
  .sort()

export function OpenMeteoAttribution({ className = '' }: { className?: string }) {
  return (
    <span className={`attribution ${className}`.trim()}>
      Datenquelle:{' '}
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        Open-Meteo
      </a>
      {' '}(
      <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noreferrer">
        CC BY 4.0
      </a>
      ) — Modelldaten von {PROVIDERS.join(', ')}.{' '}
      <span title="Open-Meteo bündelt die offenen Modelldaten der nationalen Wetterdienste und stellt sie über eine gemeinsame API bereit. Die Vorhersagen selbst stammen von den genannten Diensten; Ensembles laufen über den eigenen Ensemble-Endpunkt derselben API.">
        Ortssuche über Open-Meteo Geocoding.
      </span>
    </span>
  )
}

/**
 * Quellenangabe des Geländereliefs der Ortswahl-Karte.
 *
 * Getrennt von der Modell-Attribution, weil es eine ganz andere Quelle ist:
 * kein Vorhersagedienst, sondern ein einmalig erzeugtes statisches Asset
 * (`scripts/build-relief.mjs`). Die Terrain-Kacheln von Tilezen/AWS Open Data
 * setzen sich aus mehreren staatlichen Höhenmodellen zusammen, und deren
 * Nennung ist Bedingung der Nutzung — dieselbe Regel wie bei Open-Meteo,
 * GeoSphere und dem DWD.
 */
export function ReliefAttribution({ className = '' }: { className?: string }) {
  return (
    <span className={`attribution ${className}`.trim()}>
      Geländerelief:{' '}
      <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">
        Terrain Tiles
      </a>{' '}
      (AWS Open Data) —{' '}
      <a
        href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
        target="_blank"
        rel="noreferrer"
        title="Zusammengesetzt aus SRTM (NASA), GMTED2010 und ETOPO1 (USGS/NOAA), EU-DEM und weiteren staatlichen Höhenmodellen — die vollständige Liste steht beim Anbieter."
      >
        SRTM, GMTED2010, ETOPO1 u. a.
      </a>
      , einmalig vorgerendert.
    </span>
  )
}
