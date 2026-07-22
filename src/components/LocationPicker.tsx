import { useRef, useState } from 'react'
import { searchLocations, type GeoResult } from '../api/openmeteo'
import { useWorkbench } from '../state/workbench'

// "52.5, 13.4" oder "52.5 13.4" → direkte Koordinateneingabe
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)[,;\s]+(-?\d+(?:\.\d+)?)\s*$/

export function LocationPicker() {
  const lockedLocation = useWorkbench((s) => s.lockedLocation)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const q = query.trim()
    if (!q) return

    const coords = COORD_RE.exec(q)
    if (coords) {
      const lat = Number(coords[1])
      const lon = Number(coords[2])
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        pick({ name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, latitude: lat, longitude: lon })
        return
      }
    }

    try {
      const found = await searchLocations(q)
      if (found.length === 0) setError('Nichts gefunden')
      else setResults(found)
    } catch {
      setError('Suche fehlgeschlagen')
    }
  }

  function pick(r: GeoResult) {
    setLockedLocation({ lat: r.latitude, lon: r.longitude, label: r.name })
    setResults(null)
    setQuery('')
    inputRef.current?.blur()
  }

  return (
    <div className="location-picker">
      <form onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Ort oder lat, lon …"
          onChange={(e) => {
            setQuery(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setResults(null)
          }}
        />
      </form>
      {error && <span className="location-error">{error}</span>}
      {lockedLocation && (
        <span className="location-current" title="Location-Lock — gemeinsamer Punkt aller Meteogramme">
          📍 {lockedLocation.label ?? ''} {lockedLocation.lat.toFixed(2)}°N{' '}
          {lockedLocation.lon.toFixed(2)}°E
        </span>
      )}
      {results && (
        <ul className="location-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(r)}>
                {r.name}
                <span className="label-muted">
                  {' '}
                  {[r.admin1, r.country].filter(Boolean).join(', ')} · {r.latitude.toFixed(2)}°,{' '}
                  {r.longitude.toFixed(2)}°
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
