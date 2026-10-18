// Abruf der GEMESSENEN Luftgüte in Österreich (EEA-Download-Dienst, „Up To
// Date"). Quelle, Fallen und die gemessene Zeitzone stehen in
// `config/airMeasured.ts`.
//
// Bewusst nicht über `apiGet`: das ist kein Open-Meteo-Abruf und zählt nicht
// ins Budget (dieselbe Trennung wie Geocoding und die fertigen Karten).
// ZIP- und Parquet-Leser (fflate, hyparquet) werden erst hier dynamisch
// geladen — nur wer den Bereich mit einem Ort in Österreich öffnet, zahlt sie.

import {
  AT_STATIONS_URL,
  EEA_DOWNLOAD_URL,
  MEASURED_POLLUTANTS,
  pollutantUri,
  viennaWallToUtc,
  type AirStation,
  type MeasuredRow,
} from '../config/airMeasured'
import { MOCK_MODE } from './mock'

let stationsPromise: Promise<AirStation[]> | null = null

/** Messstellen samt Lage (statisches Asset, einmal je Sitzung). */
export function loadAtStations(): Promise<AirStation[]> {
  stationsPromise ??= fetch(`${import.meta.env.BASE_URL}${AT_STATIONS_URL}`)
    .then((r) => {
      if (!r.ok) throw new Error(`Messstellen: HTTP ${r.status}`)
      return r.json() as Promise<{ stations: AirStation[] }>
    })
    .then((d) => d.stations)
    .catch((e: unknown) => {
      stationsPromise = null
      throw e
    })
  return stationsPromise
}

/**
 * Alle gültigen Stundenmittel ganz Österreichs ab `fromDay` (YYYY-MM-DD,
 * Wiener Ortszeit — so filtert der Dienst) für NO₂, O₃, PM10 und PM2,5.
 * Ein Abruf, ~140 KB je Tag.
 */
export async function fetchMeasuredAt(fromDay: string): Promise<MeasuredRow[]> {
  // Im Mock-Modus kein Netz — die Seite zeigt dann eben keine Messung
  if (MOCK_MODE !== 'off') return []
  const end = new Date(Date.parse(`${fromDay}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10)
  const res = await fetch(EEA_DOWNLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      countries: ['AT'],
      cities: [],
      pollutants: MEASURED_POLLUTANTS.map((p) => pollutantUri(p.code)),
      dataset: 1, // Up To Date (E2a), ungeprüft
      source: 'API',
      dateTimeStart: `${fromDay}T00:00:00Z`,
      dateTimeEnd: `${end}T00:00:00Z`,
      aggregationType: 'hour',
    }),
  })
  if (!res.ok) throw new Error(`EEA-Messdaten: HTTP ${res.status}`)
  const [{ unzipSync }, { parquetReadObjects }] = await Promise.all([import('fflate'), import('hyparquet')])
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const rows: MeasuredRow[] = []
  for (const [name, buf] of Object.entries(zip)) {
    if (!name.endsWith('.parquet')) continue
    const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const recs = (await parquetReadObjects({
      file,
      columns: ['Samplingpoint', 'Start', 'Value', 'Validity'],
    })) as { Samplingpoint: string; Start: Date; Value: number | null; Validity: number }[]
    for (const r of recs) {
      // Validity −1 = ungültig (u. a. die laufende, noch unvollständige Stunde)
      if (r.Validity < 1 || r.Value == null || !Number.isFinite(r.Value)) continue
      rows.push({ sp: r.Samplingpoint, t: viennaWallToUtc(r.Start.getTime()) + 3_600_000, v: r.Value })
    }
  }
  return rows
}
