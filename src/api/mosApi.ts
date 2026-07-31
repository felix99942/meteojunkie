// Lade-Schicht für den MOS-Vorhersagemodus. Die Forecast-JSONs sind statische
// Assets (public/mos/), erzeugt vom geplanten Ingest (scripts/mos-ingest-*).
// Der Browser lädt sie same-origin — kein Live-Server, kein CORS.

/** Eine MOSMIX-Station (DACH). id ist der DWD/WMO-Stationscode (String). */
export interface MosStation {
  id: string
  name: string
  lat: number
  lon: number
  altitude: number | null
}

/** Vorhersage eines Parameters: stündlich (timeSteps) oder täglich (days). */
export interface ForecastData {
  meta: { run: string; generated: string; source: string }
  param: string
  unit: string
  kind: 'hourly' | 'daily'
  timeSteps?: string[]
  days?: string[]
  byStation: Record<string, (number | null)[]>
}

/**
 * Werte EINER Station auf eine Referenz-Zeitachse legen — über die Termine,
 * nicht über den Index: MOSMIX liefert nicht für jeden Parameter zwingend
 * dieselben Zeitschritte, stumpfes Index-Matching würde Kurven verschieben.
 * Fehlende Termine (und eine fehlende Datei) ergeben Lücken, keine Fehler.
 */
export function alignSeries(
  ref: string[],
  data: ForecastData | null,
  stationId: string,
): (number | null)[] {
  if (!data) return ref.map(() => null)
  const own = data.timeSteps ?? data.days ?? []
  const vals = data.byStation[stationId] ?? []
  const pos = new Map(own.map((t, i) => [t, i]))
  return ref.map((t) => {
    const i = pos.get(t)
    return i == null ? null : (vals[i] ?? null)
  })
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

let stationsPromise: Promise<MosStation[]> | null = null

export function loadMosStations(): Promise<MosStation[]> {
  if (!stationsPromise) {
    stationsPromise = fetch(assetUrl('mos/stations.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`MOS-Stationen nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .then((d: { stations: MosStation[] }) => d.stations)
      .catch((err) => {
        stationsPromise = null
        throw err
      })
  }
  return stationsPromise
}

const forecastCache = new Map<string, Promise<ForecastData>>()

/** Vorhersage-JSON eines Parameters laden (je Parameter gecacht). */
export function loadForecast(key: string): Promise<ForecastData> {
  let p = forecastCache.get(key)
  if (!p) {
    p = fetch(assetUrl(`mos/forecast/${key}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`Vorhersage „${key}" nicht ladbar: HTTP ${r.status}`)
        return r.json()
      })
      .catch((err) => {
        forecastCache.delete(key)
        throw err
      })
    forecastCache.set(key, p)
  }
  return p
}
