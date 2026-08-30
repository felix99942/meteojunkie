import { useEffect, useRef, useState } from 'react'
import { searchLocations, type GeoResult } from '../api/openmeteo'
import { useWorkbench } from '../state/workbench'

// "52.5, 13.4" oder "52.5 13.4" → direkte Koordinateneingabe
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)[,;\s]+(-?\d+(?:\.\d+)?)\s*$/
// Sieht die Eingabe nach Koordinaten AUS (auch halb getippt), wird nicht
// geokodiert — "48.2, 1" ist kein Ortsname und liefert nur Unsinn.
const COORD_LIKE = /^\s*-?\d/
/** Erst ab zwei Zeichen suchen — ein Buchstabe trifft die halbe Welt. */
const MIN_QUERY = 2
/**
 * Wartezeit nach dem letzten Tastendruck. Ohne sie ginge für „Salzburg" acht
 * Mal ein Request raus; mit ihr genau einer, und die Liste steht trotzdem
 * gefühlt sofort.
 */
const DEBOUNCE_MS = 250

export function LocationPicker() {
  const lockedLocation = useWorkbench((s) => s.lockedLocation)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Laufende Nummer der Suche: eine langsame ältere Antwort darf die Liste
  // einer neueren Eingabe nicht überschreiben — beim Tippen überholen sich
  // Requests regelmäßig.
  const seqRef = useRef(0)

  // Suche BEIM TIPPEN, nicht erst auf Enter.
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY || COORD_LIKE.test(q)) {
      seqRef.current++
      setResults(null)
      setPending(false)
      return
    }
    const seq = ++seqRef.current
    setPending(true)
    const timer = setTimeout(async () => {
      try {
        const found = await searchLocations(q)
        if (seq !== seqRef.current) return
        setResults(found)
        setError(found.length === 0 ? 'Nichts gefunden' : null)
      } catch {
        if (seq !== seqRef.current) return
        setError('Suche fehlgeschlagen')
      } finally {
        if (seq === seqRef.current) setPending(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    const coords = COORD_RE.exec(q)
    if (coords) {
      const lat = Number(coords[1])
      const lon = Number(coords[2])
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        setError(null)
        pick({ name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, latitude: lat, longitude: lon })
        return
      }
      setError('Koordinaten außerhalb des gültigen Bereichs')
      return
    }
    // Enter übernimmt den obersten Treffer — die Liste steht beim Tippen ja
    // schon da, ein zweiter Handgriff mit der Maus wäre nur Umweg.
    if (results && results.length > 0) pick(results[0])
  }

  function pick(r: GeoResult) {
    setLockedLocation({ lat: r.latitude, lon: r.longitude, label: r.name })
    seqRef.current++
    setResults(null)
    setPending(false)
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
            if (e.key === 'Escape') {
              seqRef.current++
              setResults(null)
            }
          }}
        />
      </form>
      {pending && !results && <span className="label-muted">sucht …</span>}
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
