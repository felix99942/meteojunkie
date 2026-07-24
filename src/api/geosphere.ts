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

import { cacheGet, cacheSet } from './atcache'

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

// --- Werte-Bulk-Abruf (Schritt 3) ---------------------------------------

const GEOSPHERE_BASE = 'https://dataset.api.hub.geosphere.at/v1'
export const DATASET_DAILY = 'station/historical/klima-v2-1d'
export const DATASET_MONTHLY = 'station/historical/klima-v2-1m'

/** Zeitreihe eines Parameters je Station: stationId → tägliche Werte (null-Lücken). */
export interface StationSeries {
  timestamps: string[]
  /** stationId → Werte, ausgerichtet an timestamps. */
  byStation: Record<number, (number | null)[]>
  unit: string
}

/**
 * EINEN Parameter für einen Zeitraum über beliebig viele Stationen holen — ein
 * einziger Bulk-Request an GeoSphere (nicht pro Punkt). CORS ist offen, kein Key.
 * Ergebnis wird persistent gecacht (historische Daten sind statisch → für immer
 * gültig); ein wiederholter Abruf derselben Auswahl kostet 0 Requests.
 *
 * `start`/`end` als ISO-Datum (YYYY-MM-DD). `stationIds` bestimmt den Cache-Key
 * mit — für stabile Keys sortiert übergeben.
 */
export async function fetchStationSeries(
  parameter: string,
  start: string,
  end: string,
  stationIds: number[],
  dataset: string = DATASET_DAILY,
): Promise<StationSeries> {
  const ids = [...stationIds].sort((a, b) => a - b)
  const key = `${dataset}|${parameter}|${start}|${end}|${ids.join(',')}`
  const cached = await cacheGet<StationSeries>(key)
  if (cached) return cached

  const url =
    `${GEOSPHERE_BASE}/${dataset}?parameters=${encodeURIComponent(parameter)}` +
    `&start=${start}&end=${end}&station_ids=${ids.join(',')}&output_format=geojson`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GeoSphere-Abruf fehlgeschlagen: HTTP ${res.status}`)
  const geo = (await res.json()) as {
    timestamps?: string[]
    features?: {
      properties: { station: number; parameters: Record<string, { unit?: string; data: (number | null)[] }> }
    }[]
  }

  const byStation: Record<number, (number | null)[]> = {}
  let unit = ''
  for (const f of geo.features ?? []) {
    const p = f.properties.parameters?.[parameter]
    if (!p) continue
    byStation[f.properties.station] = p.data
    if (!unit && p.unit) unit = p.unit
  }
  const result: StationSeries = { timestamps: geo.timestamps ?? [], byStation, unit }
  await cacheSet(key, result)
  return result
}
