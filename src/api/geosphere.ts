// GeoSphere-Zugriffsschicht der Österreich-Klimakarte (Schritt 1).
//
// Architektur „statisch-direkt" (siehe AT-KLIMAKARTE-PLAN.md): Produktion ist
// eine statische GitHub-Pages-Seite ohne Backend. Stammdaten kommen daher als
// vorgeneriertes Asset (public/at/*.json, erzeugt von scripts/at-ingest-stations.mjs);
// tages-/monatsaktuelle Werte werden später (Schritt 3/4) client-seitig DIREKT
// von GeoSphere geholt (CORS offen, kein Key) und in IndexedDB gecacht.
//
// Diese Datei ersetzt die in der Spec skizzierten Server-Endpunkte
// `/api/at/stations` und `/api/at/parameters` durch statisch-direkte Loader.

/** Eine TAWES-/Klima-Station aus dem GeoSphere-Datensatz `klima-v2-1d`. */
export interface AtStation {
  id: number
  name: string
  state: string | null
  /** Grad Nord. */
  lat: number
  /** Grad Ost. */
  lon: number
  /** Seehöhe in Metern (null, falls unbekannt). */
  altitude: number | null
  validFrom: string | null
  validTo: string | null
  isActive: boolean
  hasSunshine: boolean
  hasRadiation: boolean
}

/** Eine verfügbare Messgröße (Qualitätsflags sind beim Ingest bereits entfernt). */
export interface AtParameter {
  code: string
  label: string
  unit: string
}

/** Basis-Pfad-bewusste URL eines statischen Assets unter public/. */
function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

// Einmal geladen, prozessweit geteilt — die Stammdaten sind statisch.
let stationsPromise: Promise<AtStation[]> | null = null
let parametersPromise: Promise<AtParameter[]> | null = null

/** Alle Stationen (aktiv und historisch) laden. Ergebnis wird gecacht. */
export function loadStations(): Promise<AtStation[]> {
  if (!stationsPromise) {
    stationsPromise = fetch(assetUrl('at/stations.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`Stationsliste nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { stations: AtStation[] }) => d.stations)
      .catch((err) => {
        stationsPromise = null // erneuten Versuch erlauben
        throw err
      })
  }
  return stationsPromise
}

/** Verfügbare Parameter (ohne Qualitätsflags) laden. Ergebnis wird gecacht. */
export function loadParameters(): Promise<AtParameter[]> {
  if (!parametersPromise) {
    parametersPromise = fetch(assetUrl('at/parameters.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`Parameterliste nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { parameters: AtParameter[] }) => d.parameters)
      .catch((err) => {
        parametersPromise = null
        throw err
      })
  }
  return parametersPromise
}

/** Nur die derzeit aktiven Stationen (Default-Kartenumfang). */
export const activeStations = (stations: AtStation[]): AtStation[] =>
  stations.filter((s) => s.isActive)
