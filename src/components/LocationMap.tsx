// Ortswahl auf der Karte — für die Soundings (SPEC §4: Karte ist die
// Übersichtsebene, der Punkt das Präzisionswerkzeug).
//
// WARUM EINE KARTE UND NICHT DIE ORTSSUCHE: ein Vertikalprofil wählt man
// GEOGRAFISCH aus — Luv oder Lee, vor oder hinter der Front, Alpennordseite
// gegen Südseite. Man weiss bei einer Lage, WO man hinsehen will, aber nicht,
// wie der Ort dort heisst; die Textsuche in `LocationPicker` und die acht
// Schnellwahl-Knöpfe sind dafür das falsche Werkzeug.
//
// Der Ort ist GLOBALER Zustand (`lockedLocation`, geteilt mit klassischem
// Meteogramm, Ensemble und Punktprognosen) — die Komponente ist deshalb von
// Anfang an allgemein gehalten und nicht in den Profil-Bereich eingebaut.
//
// KOSTEN: ein Klick löst den Profilabruf aus, und der ist teuer — 19 Level ×
// 5 Grössen = 95 Variablen, also rund 10 gewichtete Calls JE MODELL (siehe
// `estimateWeight` in api/openmeteo.ts). Deshalb löst der KLICK aus und nicht
// das Überfahren, und deshalb gibt es kein Nachladen beim Ziehen.
//
// Layer von unten nach oben: Hintergrund → Relief → Abdeckungsmaske →
// Gradnetz → Küsten/Grenzen → Marker und Städte (DOM, zuoberst).

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import { CITIES } from '../config/cities'
import {
  coverageIntersection,
  getModel,
  isEmptyCoverage,
  isInCoverage,
  type BBox,
} from '../config/models'
import { RELIEF_COORDINATES, RELIEF_STEPS, RELIEF_URL } from '../config/relief'
import {
  BASE_STYLE,
  buildGraticuleBox,
  EMPTY_FC,
  loadBasemap,
  OVERLAY_INSERT_BEFORE,
} from '../render/basemap'
import { useWorkbench } from '../state/workbench'

const RELIEF_SOURCE = 'relief'
const MASK_SOURCE = 'coverage-mask'

/**
 * Startausschnitt: der Alpenbogen. Bewusst ENG gewählt, weil die Spalte hoch
 * und schmal ist — `fitBounds` bindet dann die LÄNGE und zeigt in der Breite
 * ein Vielfaches davon. Mit einem Mitteleuropa-Rechteck stand beim Öffnen
 * halb Europa in der Spalte, und die Alpen waren daumennagelgross.
 */
const START_BOUNDS: [[number, number], [number, number]] = [
  [5, 45.2],
  [17, 48.6],
]

/**
 * Fläche AUSSERHALB der Abdeckung als Polygon mit Loch: äusserer Ring die
 * ganze Kartenfläche, innerer Ring die Abdeckung. MapLibre füllt damit genau
 * das, was NICHT klickbar ist.
 */
function buildMask(box: BBox | null): FeatureCollection {
  if (!box) return EMPTY_FC
  const outer: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]
  const hole: [number, number][] = isEmptyCoverage(box)
    ? []
    : [
        [box.lonMin, box.latMin],
        [box.lonMin, box.latMax],
        [box.lonMax, box.latMax],
        [box.lonMax, box.latMin],
        [box.lonMin, box.latMin],
      ]
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: hole.length ? [outer, hole] : [outer] },
      },
    ],
  }
}

export function LocationMap({
  models,
  width,
  className,
}: {
  models: string[]
  /** Vom ziehbaren Trenner gesetzt (px). null = Fallback über CSS. */
  width?: number | null
  className?: string
}) {
  const lockedLocation = useWorkbench((s) => s.lockedLocation)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const modelsKey = models.join(',')
  const box = useMemo(() => coverageIntersection(models), [modelsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const empty = models.length === 0 || isEmptyCoverage(box)

  // Der Klick-Handler hängt an der Abdeckung, die Karte selbst nicht — sonst
  // würde die Karte bei jedem Modellwechsel neu aufgebaut und spränge auf den
  // Startausschnitt zurück.
  const gateRef = useRef<{ models: string[]; empty: boolean }>({ models, empty })
  gateRef.current = { models, empty }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = new maplibregl.Map({
      container: el,
      style: BASE_STYLE,
      bounds: START_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      attributionControl: false,
      // Das Relief löst ~1,5 km je Pixel auf; weiter hineinzoomen darf man,
      // es wird nur weich. Mehr als das braucht die Ortswahl auch nicht — die
      // Modelle selbst lösen 7–25 km auf.
      maxZoom: 10,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      setMapReady(false)
    }
  }, [])

  // Relief, Maske, Gradnetz und Basemap-Bündel einhängen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    map.addSource(RELIEF_SOURCE, { type: 'image', url: RELIEF_URL, coordinates: RELIEF_COORDINATES })
    map.addLayer(
      {
        id: RELIEF_SOURCE,
        type: 'raster',
        source: RELIEF_SOURCE,
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
      },
      OVERLAY_INSERT_BEFORE,
    )
    map.addSource(MASK_SOURCE, { type: 'geojson', data: EMPTY_FC })
    map.addLayer(
      {
        id: MASK_SOURCE,
        type: 'fill',
        source: MASK_SOURCE,
        // Deckend genug, dass „hier nicht" sofort lesbar ist, aber nicht so
        // deckend, dass die Küstenlinie verschwindet — man muss noch erkennen,
        // WO die Abdeckung endet.
        paint: { 'fill-color': '#0a0b0d', 'fill-opacity': 0.72 },
      },
      OVERLAY_INSERT_BEFORE,
    )
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(
      buildGraticuleBox({ latMin: 30, latMax: 72, lonMin: -18, lonMax: 46 }, 5),
    )

    let cancelled = false
    loadBasemap('europe')
      .then((data) => {
        if (cancelled || !mapRef.current) return
        if (data.coast) (map.getSource('coast') as maplibregl.GeoJSONSource).setData(data.coast)
        if (data.borders) (map.getSource('borders') as maplibregl.GeoJSONSource).setData(data.borders)
      })
      .catch(() => {
        // Ohne Küstenlinien bleibt die Karte benutzbar (das Relief trägt die
        // Orientierung) — kein Grund, den Bereich scheitern zu lassen.
      })
    return () => {
      cancelled = true
    }
  }, [mapReady])

  // Abdeckungsmaske nachführen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource(MASK_SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(buildMask(models.length === 0 ? { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 } : box))
  }, [mapReady, box, models.length])

  // Klick setzt den Ort — aber nur innerhalb der Abdeckung
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { lat, lng } = e.lngLat
      const gate = gateRef.current
      if (gate.empty) {
        setRejected('Die gewählten Modelle haben keine gemeinsame Fläche.')
        return
      }
      const missing = gate.models.filter((id) => !isInCoverage(getModel(id), lat, lng))
      if (missing.length) {
        setRejected(
          `Ausserhalb der Abdeckung von ${missing.map((id) => getModel(id).label).join(', ')}.`,
        )
        return
      }
      setRejected(null)
      setLockedLocation({
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lng * 10000) / 10000,
        label: `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`,
      })
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [mapReady, setLockedLocation])

  // Marker am gewählten Ort
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!lockedLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!markerRef.current) {
      const el = document.createElement('div')
      el.className = 'locmap-pin'
      markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([
        lockedLocation.lon,
        lockedLocation.lat,
      ])
      markerRef.current.addTo(map)
    } else {
      markerRef.current.setLngLat([lockedLocation.lon, lockedLocation.lat])
    }
  }, [mapReady, lockedLocation])

  // Städte als DOM-Marker. VEREINIGUNG von 'europe' und 'imagery': die
  // Hauptstädte tragen die Orientierung über den ganzen Kontinent, die dichte
  // imagery-Liste den Alpenraum — also genau dort, wo die Soundings
  // interessant sind. Ein drittes Städteverzeichnis dafür wäre schlechter.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const cities = CITIES.filter(
      (c) => c.domains.includes('europe') || c.domains.includes('imagery'),
    )
    const markers = cities.map((c) => {
      const el = document.createElement('div')
      el.className = 'city-marker'
      const dot = document.createElement('span')
      dot.className = 'city-dot'
      const label = document.createElement('span')
      label.className = 'city-label'
      label.textContent = c.name
      el.append(dot, label)
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-4, 0] })
        .setLngLat([c.lon, c.lat])
        .addTo(map)
    })
    // Dieselbe Zoomleiter wie in den Bildkarten (Radar/Satellit): beim
    // Hineinzoomen sollen MEHR Orte kommen, nicht immer dieselben vierzig.
    const thin = () => {
      const z = map.getZoom()
      const maxPriority = z < 4.8 ? 1 : z < 6 ? 2 : z < 7 ? 3 : z < 8 ? 4 : 5
      markers.forEach((m, i) => {
        m.getElement().classList.toggle('city-hidden', cities[i].priority > maxPriority)
      })
    }
    thin()
    map.on('zoom', thin)
    return () => {
      map.off('zoom', thin)
      markers.forEach((m) => m.remove())
    }
  }, [mapReady])

  return (
    <div
      className={`locmap ${className ?? ''}`}
      style={width != null ? { flexBasis: width, width } : undefined}
    >
      <div className="locmap-map map-container" ref={containerRef} />
      <div className="locmap-foot">
        <div className="locmap-legend" title="Geländehöhe in Metern — qualitativ, zur Orientierung">
          <span className="locmap-legend-label">Höhe</span>
          {RELIEF_STEPS.map((s) => (
            <i key={s.label} style={{ background: s.color }} title={`${s.label} m`} />
          ))}
          <span className="locmap-legend-label">hoch</span>
        </div>
        <div className="locmap-hint">
          {rejected ? (
            <span className="locmap-warn">{rejected}</span>
          ) : empty ? (
            <span className="locmap-warn">Kein drucklevelfähiges Modell gewählt.</span>
          ) : (
            <>Klick wählt den Punkt{box ? ' — ausserhalb der Modellabdeckung abgeblendet' : ''}</>
          )}
        </div>
      </div>
    </div>
  )
}
