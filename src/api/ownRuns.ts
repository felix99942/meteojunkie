// Vergangene Läufe der EIGENEN Modelle (Varda, C-LAEF) aus dem Archiv in R2
// (verify/<modell>/<station>.json, siehe config/ownVerify.ts) — in derselben
// Form wie `fetchPastRuns` sie von Open-Meteo liefert. Plain `fetch`, nicht
// `apiGet`: das ist unser eigener Speicher, kein Open-Meteo-Budget.
//
// Fehlt die Datei (Station außerhalb des Modellgebiets, oder das Archiv hat
// noch keinen Lauf), kommt eine LEERE Reihe zurück — die Spalte bleibt dann
// „—", statt die ganze Verifikation mit einem Fehler abzubrechen.

import { archiveKey, archiveSeries, heightCorrection, ownVerifyModel, type StationArchive } from '../config/ownVerify'
import heights from '../config/ownVerifyHeights.json'
import { sliceRuns, type PastRunSeries } from './pastRuns'

export async function fetchOwnPastRuns(
  model: string,
  stationId: number,
  variable: 'temperature_2m' | 'precipitation',
  startDate: string,
  endDate: string,
  /** Stationshöhe: die Temperatur wird von der Modellzelle auf sie umgerechnet. */
  stationAltitude?: number | null,
): Promise<PastRunSeries> {
  const leads = ownVerifyModel(model)?.leads ?? []
  const res = await fetch(`${import.meta.env.BASE_URL}${archiveKey(model, stationId)}`, { cache: 'no-cache' })
  // Nur echtes JSON zählt: der Vite-Dev-Server beantwortet eine fehlende
  // Datei mit der App-Seite (HTML, Status 200) statt mit 404
  const archive: StationArchive | null =
    res.ok && (res.headers.get('content-type') ?? '').includes('json')
      ? ((await res.json().catch(() => null)) as StationArchive | null)
      : null
  const { timeMs, byLead } = archive
    ? archiveSeries(archive, variable, leads)
    : { timeMs: [] as number[], byLead: new Map(leads.map((n) => [n, [] as (number | null)[]])) }
  // Höhenumrechnung NUR für die Temperatur (siehe heightCorrection)
  const cell = (heights.models as Record<string, Record<string, number>>)[model]?.[String(stationId)]
  const dT = variable === 'temperature_2m' ? heightCorrection(cell, stationAltitude) : 0
  if (dT !== 0)
    for (const [n, arr] of byLead) byLead.set(n, arr.map((v) => (v == null ? null : Math.round((v + dT) * 10) / 10)))
  return sliceRuns(
    { elevation: dT !== 0 ? (stationAltitude ?? null) : null, timeMs, best: byLead.get(1) ?? timeMs.map(() => null), byLead },
    startDate,
    endDate,
  )
}
