// Karten-Modus (SPEC §9): Feld des gewählten Parameters zum aktuellen
// Zeitschritt als vorgerendertes Bild (image-Source) auf MapLibre —
// Pan/Zoom übernimmt MapLibre, der Datenabruf hängt an der globalen Domain.
// Klick auf die Karte setzt den Location-Lock für die Meteogramm-Panels.
//
// Basemap ist komplett lokal — kein externer Tile-Dienst, kein API-Key, kein
// zusätzliches Rate-Limit. Unter einem eingefärbten Feld wäre eine volle
// Basemap ohnehin visuelles Rauschen. Style und Bündel-Laden stehen in
// `render/basemap.ts`, weil die Radarkarte denselben Hintergrund benutzt.
// Layer von unten nach oben:
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
import { formatRun, latestRun, RUN_TITLE } from '../config/runs'
import { formatCursorTime, MAP_FORECAST_DAYS, STEP_MS, TIME_RANGE } from '../config/time'
import { getVariable } from '../config/variables'
import { renderFieldToCanvas } from '../render/fieldImage'
import { useWorkbench, type PanelConfig } from '../state/workbench'
import {
  BASE_STYLE,
  buildGraticuleBox,
  EMPTY_FC,
  loadBasemap,
  OVERLAY_INSERT_BEFORE,
} from '../render/basemap'

const FIELD_SOURCE_ID = 'field'
const FIELD_LAYER_ID = 'field'
const FIELD_OPACITY = 0.78

/** Gradnetz über die Domain-BBox, Abstand pro Domain konfiguriert. */
function buildGraticule(domain: DomainPreset): FeatureCollection {
  return buildGraticuleBox(domain.bbox, domain.graticuleDeg)
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
        OVERLAY_INSERT_BEFORE,
      )
    }
  }, [field, scale, displayTime, domain, mapReady, beyondHorizon])

  return (
    <div className="map-panel">
      <div ref={containerRef} className="map-container" />
      <div className="map-topright">
        <span className="map-time">
          {formatCursorTime(displayTime)}
          {!panel.sync && ' · lokal'}
        </span>
        {covered && available && (
          // Geschätzter neuester verfügbarer Lauf (SPEC §13) — Laufauswahl folgt.
          <span className="map-run" title={`${model.label} · ${RUN_TITLE}`}>
            Lauf {formatRun(latestRun(model, Date.now()))}
          </span>
        )}
      </div>
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

  // Viele Bänder → nicht jede Stufe beschriften (sonst Zahlensalat): nur jede
  // k-te Schwelle zeigen, damit ~6 Labels bleiben. Leere Spans halten die
  // Ausrichtung unter den Farbkästen.
  const labelEvery = Math.max(1, Math.round(scale.stops.length / 6))
  return (
    <div className="map-legend">
      <div className="legend-title">{label}</div>
      <div className="legend-steps">
        {scale.stops.map((s) => (
          <span key={s.value} style={{ background: s.color }} />
        ))}
      </div>
      <div className="legend-step-labels">
        {scale.stops.map((s, i) => (
          <span key={s.value}>{i % labelEvery === 0 ? s.value : ''}</span>
        ))}
      </div>
    </div>
  )
}
