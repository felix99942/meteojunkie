// Österreich-Klimakarte — Bereichs-Container (Schritt 2). Lädt die
// Stationsstammdaten und zeigt die statische Karte. Umschalter aktiv/alle.
// Werte-Dropdown, Einfärbung und Stationsdetail folgen in Schritt 3/4.

import { useEffect, useMemo, useState } from 'react'
import { activeStations, loadStations, type AtStation } from '../api/geosphere'
import { AtClimateMap } from './AtClimateMap'

export function AtClimatePanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => {
        if (!cancelled) setStations(s)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Fehler beim Laden')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shown = useMemo(
    () => (stations ? (showAll ? stations : activeStations(stations)) : []),
    [stations, showAll],
  )

  const activeCount = stations ? activeStations(stations).length : 0

  return (
    <div className="atclima">
      <div className="atclima-bar">
        <span className="atclima-title">Österreich-Klimakarte</span>
        <span className="atclima-sub">
          GeoSphere Austria · {shown.length} Stationen
          {stations && ` (${activeCount} aktiv / ${stations.length} gesamt)`}
        </span>
        <label className="atclima-toggle" title="Auch stillgelegte historische Stationen zeigen">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Historische einblenden
        </label>
      </div>
      <div className="atclima-body">
        {error ? (
          <div className="panel-placeholder">Stationsdaten nicht ladbar: {error}</div>
        ) : !stations ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <AtClimateMap stations={shown} />
        )}
      </div>
      <span className="atclima-attribution">Datenquelle: GeoSphere Austria (CC BY 4.0)</span>
    </div>
  )
}
