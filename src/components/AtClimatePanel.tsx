// Österreich-Klimakarte — Bereichs-Container (Schritt 3). Lädt Stammdaten, bietet
// Parameter- und Datumswahl, holt die Werte in EINEM Bulk-Request über alle
// gezeigten Stationen (gecacht) und färbt die Karte samt Colorbar ein.
// Stationsdetail (Klick) folgt in Schritt 4, Normale/Anomalien in Schritt 5.

import { useEffect, useMemo, useState } from 'react'
import {
  activeStations,
  fetchStationSeries,
  loadStations,
  type AtStation,
  type StationSeries,
} from '../api/geosphere'
import { AT_PARAMETERS, aggregate, getAtParameter } from '../config/atParameters'
import { colorForValue } from '../config/colorscales'
import { AtClimateMap } from './AtClimateMap'
import { AtStationDetail } from './AtStationDetail'
import { Colorbar } from './Colorbar'

/** Datum als YYYY-MM-DD (UTC). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}
/** Default: ein sicher verfügbarer historischer Tag (Klima-Daten haben Vorlauf). */
function defaultDay(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 5)
  return isoDay(d)
}

export function AtClimatePanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [stationsError, setStationsError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [paramCode, setParamCode] = useState('tl_mittel')
  const [day, setDay] = useState(defaultDay)
  const [selected, setSelected] = useState<AtStation | null>(null)

  const [series, setSeries] = useState<StationSeries | null>(null)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [valuesError, setValuesError] = useState<string | null>(null)

  const spec = getAtParameter(paramCode)

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setStationsError(err?.message ?? 'Fehler beim Laden'))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = useMemo(
    () => (stations ? (showAll ? stations : activeStations(stations)) : []),
    [stations, showAll],
  )
  const idsKey = useMemo(() => shown.map((s) => s.id).join(','), [shown])

  // Werte holen: ein Bulk-Request über alle gezeigten Stationen (gecacht).
  useEffect(() => {
    if (shown.length === 0) return
    let cancelled = false
    setValuesLoading(true)
    setValuesError(null)
    const ids = shown.map((s) => s.id)
    fetchStationSeries(paramCode, day, day, ids)
      .then((s) => {
        if (!cancelled) setSeries(s)
      })
      .catch((err) => {
        if (!cancelled) {
          setSeries(null)
          setValuesError(err?.message ?? 'Werte nicht ladbar')
        }
      })
      .finally(() => !cancelled && setValuesLoading(false))
    return () => {
      cancelled = true
    }
    // shown wird über idsKey (stabiler String) gekeyed — das Array selbst ist jede Runde neu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramCode, day, idsKey])

  // Aggregierte Werte + Farben je gezeigter Station (parallel zu `shown`).
  const { values, colors, covered } = useMemo(() => {
    const values: (number | null)[] = new Array(shown.length).fill(null)
    const colors: (string | null)[] = new Array(shown.length).fill(null)
    let covered = 0
    if (series) {
      for (let i = 0; i < shown.length; i++) {
        const data = series.byStation[shown[i].id]
        if (!data) continue
        const v = aggregate(data, spec.agg)
        values[i] = v
        if (v != null) {
          colors[i] = colorForValue(spec.scale, v)
          covered++
        }
      }
    }
    return { values, colors, covered }
  }, [series, shown, spec])

  return (
    <div className="atclima">
      <div className="atclima-bar">
        <span className="atclima-title">Österreich-Klimakarte</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Parameter</span>
          <select value={paramCode} onChange={(e) => setParamCode(e.target.value)}>
            {AT_PARAMETERS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.category} – {p.label} ({p.unit})
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Tag</span>
          <input type="date" value={day} max={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} />
        </label>
        <span className="atclima-sub">
          {valuesLoading
            ? 'lädt Werte …'
            : valuesError
              ? `⚠ ${valuesError}`
              : `${covered}/${shown.length} Stationen mit Wert`}
        </span>
        <label className="atclima-toggle" title="Auch stillgelegte historische Stationen zeigen">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Historische
        </label>
      </div>
      <div className="atclima-body">
        {stationsError ? (
          <div className="panel-placeholder">Stationsdaten nicht ladbar: {stationsError}</div>
        ) : !stations ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <>
            <AtClimateMap
              stations={shown}
              colors={colors}
              values={values}
              unit={spec.unit}
              onSelect={setSelected}
            />
            <div className="atclima-legend">
              <Colorbar scale={spec.scale} unit={spec.unit} />
            </div>
            {selected && (
              <AtStationDetail
                station={selected}
                paramCode={paramCode}
                day={day}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
      <span className="atclima-attribution">
        Datenquelle: GeoSphere Austria, Datensatz klima-v2-1d (CC BY 4.0)
      </span>
    </div>
  )
}
