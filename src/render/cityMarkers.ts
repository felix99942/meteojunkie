// Städte als DOM-Marker für die Modellkarten (Ansichten Europa und Alpen).
//
// Dieselbe Mechanik und dieselben CSS-Klassen wie Radar und Satellit
// (`.city-marker`, in `.radar-container` vergrößert): DOM statt Symbol-Layer,
// weil der eine externe Glyphs-Quelle bräuchte. Ausgedünnt wird nach ZOOM,
// und es verschwindet der GANZE Marker — über einem Farbfeld ist ein Punkt
// ohne Namen nur ein Fleck mehr.
//
// Zwei Listen aus `config/cities.ts`: die Hauptstädte der Domain `europe`
// (für die Europa-Übersicht, nach eigener Priorität ab Zoom 2/3,5/4,5) und
// die rund 130 Orte der Pseudo-Domain `imagery` mit der Zoomleiter der
// Bildkarten (Großstädte → Regionalzentren → Alpenorte). Doppelte Namen
// zählen einmal.

import maplibregl from 'maplibre-gl'
import { CITIES, type City } from '../config/cities'

interface Placed {
  city: City
  minZoom: number
}

/** Zoomleiter der Bildkarten (Radar/Satellit): Priorität → ab welchem Zoom sichtbar. */
const IMAGERY_MIN_ZOOM = [0, 4.8, 6, 7, 8]
/** Hauptstädte Europas: schon in der Übersicht. */
const EUROPE_MIN_ZOOM = [2, 3.5, 4.5]

export function cityPlan(): Placed[] {
  const seen = new Set<string>()
  const out: Placed[] = []
  for (const c of CITIES) {
    if (!c.domains.includes('europe') || seen.has(c.name)) continue
    seen.add(c.name)
    out.push({ city: c, minZoom: EUROPE_MIN_ZOOM[Math.min(c.priority, 3) - 1] })
  }
  for (const c of CITIES) {
    if (!c.domains.includes('imagery') || seen.has(c.name)) continue
    seen.add(c.name)
    out.push({ city: c, minZoom: IMAGERY_MIN_ZOOM[Math.min(c.priority, 5) - 1] })
  }
  return out
}

/** Marker setzen; gibt die Aufräumfunktion zurück. */
export function addCityMarkers(map: maplibregl.Map): () => void {
  const plan = cityPlan()
  const markers = plan.map(({ city }) => {
    const el = document.createElement('div')
    el.className = 'city-marker'
    const dot = document.createElement('span')
    dot.className = 'city-dot'
    const label = document.createElement('span')
    label.className = 'city-label'
    label.textContent = city.name
    el.append(dot, label)
    // Offset = halber Punktdurchmesser der vergrößerten Bildkarten-Punkte
    return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-4, 0] })
      .setLngLat([city.lon, city.lat])
      .addTo(map)
  })
  const thin = () => {
    const z = map.getZoom()
    markers.forEach((m, i) => m.getElement().classList.toggle('city-hidden', z < plan[i].minZoom))
  }
  thin()
  map.on('zoom', thin)
  return () => {
    map.off('zoom', thin)
    markers.forEach((m) => m.remove())
  }
}
