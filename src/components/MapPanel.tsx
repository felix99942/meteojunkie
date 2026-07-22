// Karten-Modus (SPEC §9): Feld des gewählten Parameters zum aktuellen
// Zeitschritt als vorgerendertes Bild (image-Source) auf MapLibre —
// Pan/Zoom übernimmt MapLibre, der Datenabruf hängt an der globalen Domain.
// Klick auf die Karte setzt den Location-Lock für die Meteogramm-Panels.
//
// Basemap ist komplett lokal — kein externer Tile-Dienst, kein API-Key, kein
// zusätzliches Rate-Limit. Unter einem eingefärbten Feld wäre eine volle
// Basemap ohnehin visuelles Rauschen. Layer von unten nach oben:
// Hintergrund → Feldraster → Küsten/Grenzen (Natural Earth 1:50m, auf die
// Domains zugeschnitten, gebündelt) → Gradnetz → Städte (DOM-Marker, Labels
// mit Halo zuoberst; bei kleinen Panels werden Labels nach Priorität
// ausgedünnt, die Punkte bleiben).

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import { useGridField } from '../api/queries'
import { CITIES } from '../config/cities'
import { getColorScale, type ColorScale } from '../config/colorscales'
import type { DomainPreset } from '../config/domains'
import { getModel, isDomainInCoverage, modelHorizonEnd } from '../config/models'
import { formatCursorTime, MAP_FORECAST_DAYS, STEP_MS, TIME_RANGE } from '../config/time'
import { getVariable } from '../config/variables'
import { renderFieldToCanvas } from '../render/fieldImage'
import { useWorkbench, type PanelConfig } from '../state/workbench'
import europeBasemapUrl from '../mapdata/europe.basemap.json?url'
import austriaBasemapUrl from '../mapdata/austria.basemap.json?url'

const FIELD_SOURCE_ID = 'field'
const FIELD_LAYER_ID = 'field'
const FIELD_OPACITY = 0.78

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// Lokaler Style: nur Hintergrund + GeoJSON-Linien, keine externen Ressourcen.
//
// Grenzen als CASING-Paare (breite dunkle Linie unten, schmaler heller Kern
// darüber): eine einzelne Linienfarbe funktioniert gegen eine divergierende
// Farbskala nie überall — mit dunkler UND heller Kante bleibt jede Grenze
// über hellen wie dunklen Feldbereichen lesbar (gleiches Prinzip wie der
// Label-Halo). Hierarchie über STRICHART, nicht über Helligkeit:
// Staatsgrenzen/Küsten durchgezogen, Bundeslandgrenzen gestrichelt.
//
// Achtung: line-dasharray skaliert mit line-width — Casing und Kern brauchen
// unterschiedliche dasharray-Werte, damit die Strichelung physisch deckungs-
// gleich bleibt (Ziel ~3 px Strich / 2 px Lücke).
//
// Reihenfolge bottom→top: Hintergrund → Feld (vor 'graticule' eingefügt) →
// Gradnetz → Bundeslandgrenzen → Küsten → Staatsgrenzen; Städte/Labels sind
// DOM-Marker und liegen immer zuoberst.
const CASING_COLOR = '#0c0d0f'
const CORE_COLOR = '#b4b9c2'

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    coast: { type: 'geojson', data: EMPTY_FC },
    borders: { type: 'geojson', data: EMPTY_FC },
    admin1: { type: 'geojson', data: EMPTY_FC },
    graticule: { type: 'geojson', data: EMPTY_FC },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#131418' } },
    {
      id: 'graticule',
      type: 'line',
      source: 'graticule',
      paint: { 'line-color': '#585c66', 'line-width': 0.6, 'line-opacity': 0.35 },
    },
    // Bundeslandgrenzen: gestrichelt, Casing ~2 px / Kern ~0.8 px
    {
      id: 'admin1-casing',
      type: 'line',
      source: 'admin1',
      paint: {
        'line-color': CASING_COLOR,
        'line-width': 2,
        'line-opacity': 0.85,
        'line-dasharray': [1.5, 1], // ×2 px = 3 px Strich / 2 px Lücke
      },
    },
    {
      id: 'admin1',
      type: 'line',
      source: 'admin1',
      paint: {
        'line-color': CORE_COLOR,
        'line-width': 0.8,
        'line-opacity': 0.9,
        'line-dasharray': [3.75, 2.5], // ×0.8 px = 3 px Strich / 2 px Lücke
      },
    },
    // Küsten und Staatsgrenzen: durchgezogen, Casing ~3 px / Kern ~1.5 px
    {
      id: 'coast-casing',
      type: 'line',
      source: 'coast',
      paint: { 'line-color': CASING_COLOR, 'line-width': 3, 'line-opacity': 0.85 },
    },
    {
      id: 'coast',
      type: 'line',
      source: 'coast',
      paint: { 'line-color': CORE_COLOR, 'line-width': 1.5 },
    },
    {
      id: 'borders-casing',
      type: 'line',
      source: 'borders',
      paint: { 'line-color': CASING_COLOR, 'line-width': 3, 'line-opacity': 0.85 },
    },
    {
      id: 'borders',
      type: 'line',
      source: 'borders',
      paint: { 'line-color': CORE_COLOR, 'line-width': 1.5 },
    },
  ],
}

/** Das Feld liegt unter Gradnetz und allen Grenz-Layern. */
const FIELD_INSERT_BEFORE = 'graticule'

// --- Basemap-Daten (gebündelt, lazy geladen und gecacht) -------------------

interface BasemapData {
  coast: FeatureCollection
  borders: FeatureCollection
  /** Bundesland-/Regionsgrenzen — nur in der Österreich-Domain gebündelt. */
  admin1?: FeatureCollection
}

const BASEMAP_URLS: Record<string, string> = {
  europe: europeBasemapUrl,
  austria: austriaBasemapUrl,
}

const basemapCache = new Map<string, Promise<BasemapData>>()

function loadBasemap(domainId: string): Promise<BasemapData> {
  let cached = basemapCache.get(domainId)
  if (!cached) {
    cached = fetch(BASEMAP_URLS[domainId]).then((r) => {
      if (!r.ok) throw new Error(`Basemap ${domainId}: HTTP ${r.status}`)
      return r.json() as Promise<BasemapData>
    })
    basemapCache.set(domainId, cached)
  }
  return cached
}

/** Gradnetz über die Domain-BBox (+ Rand), Abstand pro Domain konfiguriert. */
function buildGraticule(domain: DomainPreset): FeatureCollection {
  const step = domain.graticuleDeg
  const ext = 2 * step
  const { latMin, latMax, lonMin, lonMax } = domain.bbox
  const features: FeatureCollection['features'] = []
  for (let lon = Math.ceil((lonMin - ext) / step) * step; lon <= lonMax + ext; lon += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, Math.max(latMin - ext, -85)],
          [lon, Math.min(latMax + ext, 85)],
        ],
      },
    })
  }
  for (let lat = Math.ceil((latMin - ext) / step) * step; lat <= latMax + ext; lat += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [lonMin - ext, lat],
          [lonMax + ext, lat],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

function domainBounds(d: DomainPreset): [[number, number], [number, number]] {
  return [
    [d.bbox.lonMin, d.bbox.latMin],
    [d.bbox.lonMax, d.bbox.latMax],
  ]
}

function imageCoordinates(d: DomainPreset): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [d.bbox.lonMin, d.bbox.latMax],
    [d.bbox.lonMax, d.bbox.latMax],
    [d.bbox.lonMax, d.bbox.latMin],
    [d.bbox.lonMin, d.bbox.latMin],
  ]
}

export function MapPanel({ panel }: { panel: PanelConfig }) {
  const domain = useWorkbench((s) => s.domain)
  const cursorTime = useWorkbench((s) => s.cursorTime)
  const lockedLocation = useWorkbench((s) => s.lockedLocation)
  const sharedView = useWorkbench((s) => s.sharedView)

  const model = getModel(panel.mapModel)
  const variable = getVariable(panel.variable)
  const scale = getColorScale(panel.variable)
  const covered = isDomainInCoverage(model, domain.bbox)
  // Liefert das Modell den Parameter überhaupt? (z.B. via parsync gespiegelt)
  // Wenn nicht: Meldung statt stiller Transparenz, und kein Fetch (Budget!)
  const available = model.availableVariables.includes(panel.variable)
  const displayTime = panel.sync ? cursorTime : panel.localTime

  const query = useGridField(
    domain,
    panel.mapModel,
    panel.variable,
    covered && available && scale !== undefined,
  )
  const field = query.data

  // Vorhersagehorizont aus der Registry (forecastHours) gegen die gültige
  // Panel-Zeit: dahinter kein eingefrorenes Feld und keine Extrapolation,
  // sondern eine klare Meldung. Zweite Grenze: Karten holen nur
  // MAP_FORECAST_DAYS Tage (Rate-Limit-Budget).
  const horizonEnd = modelHorizonEnd(model)
  const mapDataEnd = field
    ? field.times[field.times.length - 1]
    : TIME_RANGE.start + (MAP_FORECAST_DAYS * 24 - 1) * STEP_MS
  const effectiveEnd = Math.min(horizonEnd, mapDataEnd)
  const beyondHorizon = displayTime > effectiveEnd
  const modelBinds = horizonEnd <= mapDataEnd

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mapReady, setMapReady] = useState(false)

  // Kamera-Sync: Bewegungen sync-aktiver Karten landen in sharedView, andere
  // Sync-Karten folgen. Refs statt Effekt-Neuaufbau; applyingRef verhindert,
  // dass das Anwenden der gemeinsamen Ansicht als neue Bewegung zurückfeuert.
  const syncRef = useRef(panel.sync)
  syncRef.current = panel.sync
  const applyingViewRef = useRef(false)

  // Karte einmal aufbauen — Style ist komplett lokal, 'load' feuert sofort
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = new maplibregl.Map({
      container: el,
      style: BASE_STYLE,
      bounds: domainBounds(useWorkbench.getState().domain),
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
    })
    map.on('load', () => setMapReady(true))
    map.on('click', (e) => {
      useWorkbench.getState().setLockedLocation({
        lat: e.lngLat.lat,
        lon: e.lngLat.wrap().lng,
      })
    })
    // Kamerabewegung dieses Panels in die gemeinsame Ansicht schreiben
    map.on('move', () => {
      if (!syncRef.current || applyingViewRef.current) return
      const c = map.getCenter()
      useWorkbench.getState().setSharedView({ center: [c.lng, c.lat], zoom: map.getZoom() })
    })
    if (import.meta.env.DEV) {
      // Debug-Handle für Headless-Tests
      ;(el as HTMLDivElement & { __map?: maplibregl.Map }).__map = map
    }
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      setMapReady(false)
    }
  }, [])

  // Domain-Wechsel: Ansicht, Basemap-Linien und Gradnetz aktualisieren
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.fitBounds(domainBounds(domain), { padding: 8, duration: 0 })
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(buildGraticule(domain))
    let cancelled = false
    loadBasemap(domain.id)
      .then((bm) => {
        if (cancelled || mapRef.current !== map) return
        ;(map.getSource('coast') as maplibregl.GeoJSONSource).setData(bm.coast)
        ;(map.getSource('borders') as maplibregl.GeoJSONSource).setData(bm.borders)
        ;(map.getSource('admin1') as maplibregl.GeoJSONSource).setData(bm.admin1 ?? EMPTY_FC)
      })
      .catch((err: unknown) => console.error('[basemap]', err))
    return () => {
      cancelled = true
    }
  }, [domain, mapReady])

  // Städte als DOM-Marker: Punkt + Label mit Halo, Labels zuoberst.
  // Bei kleinen Panels werden Labels nach Priorität ausgedünnt.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const cities = CITIES.filter((c) => c.domains.includes(domain.id))
    const markers = cities.map((c) => {
      const el = document.createElement('div')
      el.className = 'city-marker'
      const dot = document.createElement('span')
      dot.className = 'city-dot'
      const label = document.createElement('span')
      label.className = 'city-label'
      label.textContent = c.name
      el.append(dot, label)
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-3, 0] })
        .setLngLat([c.lon, c.lat])
        .addTo(map)
    })
    const thinLabels = () => {
      const w = containerRef.current?.clientWidth ?? 0
      const maxPriority = w < 360 ? 1 : w < 520 ? 2 : 3
      markers.forEach((m, i) => {
        m.getElement().classList.toggle('city-label-hidden', cities[i].priority > maxPriority)
      })
    }
    thinLabels()
    map.on('resize', thinLabels)
    return () => {
      map.off('resize', thinLabels)
      markers.forEach((m) => m.remove())
    }
  }, [domain, mapReady])

  // Gemeinsame Kartenansicht anwenden (nur sync-aktive Panels)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !panel.sync || !sharedView) return
    const c = map.getCenter()
    const drift =
      Math.abs(map.getZoom() - sharedView.zoom) +
      Math.abs(c.lng - sharedView.center[0]) +
      Math.abs(c.lat - sharedView.center[1])
    if (drift < 1e-6) return // schon dort — sonst Echo-Schleife über 'move'
    applyingViewRef.current = true
    map.jumpTo({ center: sharedView.center, zoom: sharedView.zoom })
    applyingViewRef.current = false
  }, [sharedView, panel.sync, mapReady])

  // Location-Lock als Marker zeigen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!lockedLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([lockedLocation.lon, lockedLocation.lat])
    } else {
      markerRef.current = new maplibregl.Marker({ color: '#3987e5', scale: 0.7 })
        .setLngLat([lockedLocation.lon, lockedLocation.lat])
        .addTo(map)
    }
  }, [lockedLocation, mapReady])

  // Feld zum aktuellen Zeitschritt rendern und als image-Source einhängen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!field || !scale || beyondHorizon) {
      // kein gültiges Feld bzw. Panel-Zeit hinter dem Horizont →
      // Overlay entfernen statt ein veraltetes Feld stehen zu lassen
      if (map.getLayer(FIELD_LAYER_ID)) map.removeLayer(FIELD_LAYER_ID)
      if (map.getSource(FIELD_SOURCE_ID)) map.removeSource(FIELD_SOURCE_ID)
      return
    }

    const tIndex = Math.min(
      field.times.length - 1,
      Math.max(0, Math.round((displayTime - field.times[0]) / STEP_MS)),
    )
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    if (!renderFieldToCanvas(field, tIndex, scale, canvasRef.current)) return

    const url = canvasRef.current.toDataURL()
    const coordinates = imageCoordinates(domain)
    const source = map.getSource(FIELD_SOURCE_ID) as maplibregl.ImageSource | undefined
    if (source) {
      source.updateImage({ url, coordinates })
    } else {
      map.addSource(FIELD_SOURCE_ID, { type: 'image', url, coordinates })
      // unter allen Linien-Layern einfügen — Linien bleiben lesbar
      map.addLayer(
        {
          id: FIELD_LAYER_ID,
          type: 'raster',
          source: FIELD_SOURCE_ID,
          paint: { 'raster-opacity': FIELD_OPACITY, 'raster-fade-duration': 0 },
        },
        FIELD_INSERT_BEFORE,
      )
    }
  }, [field, scale, displayTime, domain, mapReady, beyondHorizon])

  return (
    <div className="map-panel">
      <div ref={containerRef} className="map-container" />
      <span className="map-time">
        {formatCursorTime(displayTime)}
        {!panel.sync && ' · lokal'}
      </span>
      {!covered && (
        <div className="map-hint">
          Domain „{domain.label}“ liegt außerhalb der Abdeckung von {model.label}.
          <br />
          Anderes Modell oder kleinere Domain wählen.
        </div>
      )}
      {covered && !available && (
        <div className="map-hint">
          Parameter „{variable.label}“ in {model.label} nicht verfügbar.
          <br />
          <span className="label-muted">Modellauswahl bleibt unverändert — anderes Modell wählen.</span>
        </div>
      )}
      {covered && available && !scale && (
        <div className="map-hint">Für {variable.label} ist keine Kartendarstellung definiert.</div>
      )}
      {covered && available && scale && beyondHorizon && (
        <div className="map-hint">
          {modelBinds
            ? `${model.label} endet bei +${model.forecastHours} h`
            : `Kartenhorizont endet bei +${MAP_FORECAST_DAYS * 24} h`}
          <br />
          <span className="label-muted">
            letzte Karte: {formatCursorTime(effectiveEnd)} — Modell oder Parameter oben wechseln
          </span>
        </div>
      )}
      {covered && available && scale && query.isPending && (
        <span className="map-status">Lade Gitter…</span>
      )}
      {covered && available && scale && query.isError && (
        <span className="map-status map-error">{(query.error as Error).message}</span>
      )}
      {covered && available && scale && (
        <ScaleLegend scale={scale} label={`${variable.label} (${variable.unit})`} />
      )}
    </div>
  )
}

// Kompakte Legende: Verlaufsbalken (linear) bzw. Stufen mit Schwellenwerten
function ScaleLegend({ scale, label }: { scale: ColorScale; label: string }) {
  const min = scale.stops[0].value
  const max = scale.stops[scale.stops.length - 1].value

  if (scale.kind === 'linear') {
    const gradient = `linear-gradient(to right, ${scale.stops
      .map((s) => `${s.color} ${(((s.value - min) / (max - min)) * 100).toFixed(1)}%`)
      .join(', ')})`
    return (
      <div className="map-legend">
        <div className="legend-title">{label}</div>
        <div className="legend-gradient" style={{ background: gradient }} />
        <div className="legend-labels">
          <span>{min}</span>
          <span>{(min + max) / 2}</span>
          <span>{max}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="map-legend">
      <div className="legend-title">{label}</div>
      <div className="legend-steps">
        {scale.stops.map((s) => (
          <span key={s.value} style={{ background: s.color }} />
        ))}
      </div>
      <div className="legend-step-labels">
        {scale.stops.map((s) => (
          <span key={s.value}>{s.value}</span>
        ))}
      </div>
    </div>
  )
}
