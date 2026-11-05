// Eine Karte der Panel-Ansicht der Modellkarten (`GlobeMultiPanel`): flach,
// Europa oder Österreich, ein Modell und eine Größe, mit ZAHLEN im Farbfeld
// (Niederschlag: örtliche Höchstwerte, sonst Werte im festen Raster), Ortsnamen
// und kleiner Legende. KEINE Isolinien — auf Wunsch: in kleinen Karten sagen
// die Zahlen mehr als ein zweites Liniennetz. Gerechnet wird über dasselbe Kachelprotokoll wie die
// Einzelkarte (`globe://`) — Kacheln, die dort schon gerechnet sind, kommen
// hier aus dem Speicher und umgekehrt.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASE_STYLE, buildGraticuleBox, EMPTY_FC, loadBasemap, OVERLAY_INSERT_BEFORE } from '../render/basemap'
import { globeTileUrl, GLOBE_TILE_SIZE } from '../render/globeTiles'
import { globeBandUrl, registerGlobeProtocol } from '../render/globeProtocol'
import { addWorldLabels } from '../render/worldLabels'
import { addFieldMaxima } from '../render/fieldMaxima'
import { addTopoLayer, GLOBE_TOPO_LAYER } from '../render/globeTopo'
import { createTileQueue, type TileQueue } from '../render/tileQueue'
import { WindBarbs } from '../render/windBarbs'
import { globeFieldSource, loadGlobeField, prefetchGlobeField } from '../api/globeData'
import {
  BARB_VARS,
  formatReadout,
  precipReadout,
  nearestStepIndex,
  particleSource,
  runMs,
  sampleWind,
  getGlobeModel,
  getGlobeVariable,
  globeFreshness,
  intervalHours,
  sampleField,
  validMs,
  type GlobeField,
  type GlobeMeta,
} from '../config/globe'
import { MAXIMA_OPTIONS } from '../config/globeMaxima'
import {
  frozenStepIndex,
  PANEL_BAND_LINES,
  PANEL_FREEZE_MAX_MS,
  stepAround,
  validTimes,
  type MapPanelConfig,
  type PanelRegion,
  type PanelView,
} from '../config/globePanels'
import { validLabel } from '../config/globeFormat'
import { formatRunLong } from '../config/runs'

const FIELD = 'gmp-field'
const BAND = 'gmp-band'
/** Kantenlinien zwei Stufen über der Feldgrenze neu rechnen, wie die Isolinien der Einzelkarte */
const BAND_EXTRA_ZOOM = 2
const GRATICULE_STEP: Record<PanelRegion['id'], number> = { europe: 10, austria: 1 }
/** Zeichendichte gedeckelt wie in der Einzelkarte — bei sechs Karten erst recht */
const MAX_PIXEL_RATIO = 1.5

export interface Props {
  index: number
  cfg: MapPanelConfig
  meta: GlobeMeta | null
  metaError: string | null
  /** Gültigkeitszeit dieses Panels (gemeinsam oder eigen) */
  targetMs: number
  region: PanelRegion
  /** wird erhöht, wenn alle Karten den Ausschnitt neu anfahren sollen */
  fitKey: number
  /** Ausschnitt aus einem geladenen Preset statt des Standardausschnitts der Region */
  presetView?: PanelView | null
  /** Zahlen im Farbfeld (Höchstwerte bzw. Werte im Raster) */
  numbersOn: boolean
  hover: { lat: number; lon: number } | null
  onHover: (p: { lat: number; lon: number } | null) => void
  /** Karte an- und abmelden (Kopplung des Ausschnitts) */
  onMap: (index: number, map: maplibregl.Map | null) => void
  /** vom Nutzer bewegt — die Ansicht liest das für die Kopplung */
  onUserMove: (index: number) => void
  /** Klick (ohne Ziehen) in die Karte — macht das Panel zum Taktgeber */
  onPick: (index: number) => void
  /** dieses Panel gibt den Takt des Reglers vor */
  pacing: boolean
  header: ReactNode
}

export function GlobeMapPanel(props: Props) {
  const { cfg, meta, metaError, targetMs, region, fitKey, numbersOn, hover } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  // Rückrufe in Refs: die Karte entsteht einmal, die Rückrufe ändern sich
  const cb = useRef(props)
  cb.current = props

  const model = getGlobeModel(cfg.model)
  const variable = getGlobeVariable(cfg.varId)
  const vm = meta?.variables[cfg.varId]
  const steps = useMemo(() => vm?.steps ?? [], [vm])
  const times = useMemo(() => validTimes(meta, cfg.varId), [meta, cfg.varId])
  // Der LETZTE Termin bis zur gewählten Zeit, nie ein späterer: ein 3-h-Modell
  // bleibt zwischen seinen Terminen stehen und wird ausgegraut, ein stündliches
  // läuft weiter (`frozenStepIndex`)
  const idx = frozenStepIndex(times, targetMs)
  const step = idx >= 0 ? steps[idx] : undefined
  const stepMs = idx >= 0 ? times[idx] : NaN
  const frozen = step != null && stepMs < targetMs
  const paceStepMs = idx >= 0 ? stepAround(times, stepMs) : 3_600_000
  // Liegt die gewählte Zeit vor dem ersten oder weit hinter dem letzten
  // Termin, KEIN Feld — das läse sich als Vorhersage für den gewählten Termin
  const offTime = step == null || targetMs - stepMs > PANEL_FREEZE_MAX_MS
  const show = meta && vm && step != null && !offTime
  const fieldKey = show ? `${cfg.model}/${meta.runId}/${cfg.varId}/${step}` : ''
  const [loaded, setLoaded] = useState<{ key: string; field: GlobeField } | null>(null)
  const field = loaded?.key === fieldKey ? loaded.field : null

  // --- Karte ---------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    registerGlobeProtocol(globeFieldSource)
    const map = new maplibregl.Map({
      container: el,
      style: { ...BASE_STYLE, projection: { type: 'mercator' } },
      bounds: cb.current.region.bounds,
      fitBoundsOptions: { padding: 4 },
      attributionControl: false,
      maxZoom: 12,
      // Die Pfeiltasten gehören der Zeit (siehe Einzelkarte)
      keyboard: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    })
    map.on('load', () => setReady(true))
    // `click` kommt nur ohne Ziehen — Verschieben macht kein Panel zum Taktgeber
    map.on('click', () => cb.current.onPick(cb.current.index))
    map.on('move', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) cb.current.onUserMove(cb.current.index)
    })
    map.on('mousemove', (e) => cb.current.onHover({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    map.getCanvas().addEventListener('mouseleave', () => cb.current.onHover(null))
    mapRef.current = map
    cb.current.onMap(cb.current.index, map)
    return () => {
      cb.current.onMap(cb.current.index, null)
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Ausschnitt anfahren: bei Regionswechsel und auf Zuruf (`fitKey`) — oder
  // den eines geladenen Presets (`presetView`), auch bei Panels, die erst mit
  // dem Wechsel auf 6 Panels entstehen
  const presetView = props.presetView
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (presetView) map.jumpTo({ center: presetView.center, zoom: presetView.zoom })
    else map.fitBounds(region.bounds, { padding: 4, duration: 0 })
  }, [ready, region, fitKey, presetView])

  // Grundkarte: Land, Küsten, Grenzen, Bundesländer/Kantone, Gradnetz
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(
      buildGraticuleBox({ latMin: 30, latMax: 75, lonMin: -30, lonMax: 50 }, GRATICULE_STEP[region.id]),
    )
    let cancelled = false
    loadBasemap('world')
      .then((bm) => {
        if (cancelled || mapRef.current !== map) return
        ;(map.getSource('coast') as maplibregl.GeoJSONSource).setData(bm.coast ?? EMPTY_FC)
        ;(map.getSource('borders') as maplibregl.GeoJSONSource).setData(bm.borders ?? EMPTY_FC)
        ;(map.getSource('land') as maplibregl.GeoJSONSource).setData(bm.land ?? EMPTY_FC)
      })
      .catch((err: unknown) => console.error('[basemap world]', err))
    loadBasemap('dach')
      .then((bm) => !cancelled && mapRef.current === map && (map.getSource('admin1') as maplibregl.GeoJSONSource).setData(bm.admin1 ?? EMPTY_FC))
      .catch((err: unknown) => console.error('[basemap dach]', err))
    return () => {
      cancelled = true
    }
  }, [ready, region.id])

  // Ortsnamen, ausgedünnt nach Platz — in einer kleinen Karte von selbst weniger
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    return addWorldLabels(map, '.gmp-run, .gmp-legend, .gmp-readout, .gmp-msg')
  }, [ready])

  // Topografie: fester Bestandteil, über dem Feld und unter Gradnetz und Grenzen
  useEffect(() => {
    const map = mapRef.current
    if (map && ready) addTopoLayer(map, OVERLAY_INSERT_BEFORE)
  }, [ready])

  // `setTiles` nie auf laufende Kacheln — sonst überschreibt eine alte die neue
  const tilesRef = useRef<TileQueue | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const q = createTileQueue(map)
    tilesRef.current = q
    return () => {
      q.destroy()
      tilesRef.current = null
    }
  }, [ready])

  // --- Farbfläche ------------------------------------------------------------
  const sourceModel = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!show) {
      if (map.getLayer(FIELD)) map.setLayoutProperty(FIELD, 'visibility', 'none')
      return
    }
    const url = globeTileUrl(cfg.model, meta.runId, cfg.varId, step)
    const src = map.getSource(FIELD) as maplibregl.RasterTileSource | undefined
    if (src && sourceModel.current === cfg.model) {
      tilesRef.current?.queue(FIELD, url)
    } else {
      // Die Zoomgrenze hängt am Modell und lässt sich an einer Quelle nicht ändern
      if (map.getLayer(FIELD)) map.removeLayer(FIELD)
      if (src) map.removeSource(FIELD)
      map.addSource(FIELD, { type: 'raster', tiles: [url], tileSize: GLOBE_TILE_SIZE, maxzoom: model.maxzoom })
      map.addLayer(
        { id: FIELD, type: 'raster', source: FIELD, paint: { 'raster-fade-duration': 0, 'raster-opacity': 1 } },
        // Unter dem Relief bleiben, auch wenn das Feld beim Modellwechsel neu entsteht
        map.getLayer(GLOBE_TOPO_LAYER) ? GLOBE_TOPO_LAYER : OVERLAY_INSERT_BEFORE,
      )
      tilesRef.current?.init(FIELD, url)
      sourceModel.current = cfg.model
    }
    map.setLayoutProperty(FIELD, 'visibility', 'visible')
  }, [ready, show, meta, cfg.model, cfg.varId, step, model.maxzoom])

  // --- Kantenlinien zwischen den Farbstufen, beschriftet ----------------------
  const band = PANEL_BAND_LINES[cfg.varId]
  const bandOn = !!(show && numbersOn && band)
  const bandModel = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!bandOn || bandModel.current !== cfg.model) {
      if (map.getLayer(BAND)) map.removeLayer(BAND)
      if (map.getSource(BAND)) map.removeSource(BAND)
      tilesRef.current?.forget(BAND)
    }
    if (!bandOn) return
    const url = globeBandUrl(cfg.model, meta!.runId, cfg.varId, step!)
    const src = map.getSource(BAND) as maplibregl.RasterTileSource | undefined
    if (src) tilesRef.current?.queue(BAND, url)
    else {
      tilesRef.current?.init(BAND, url)
      map.addSource(BAND, { type: 'raster', tiles: [url], tileSize: GLOBE_TILE_SIZE, maxzoom: model.maxzoom + BAND_EXTRA_ZOOM })
      // über der Fläche, unter Gradnetz und Grenzen
      map.addLayer({ id: BAND, type: 'raster', source: BAND, paint: { 'raster-fade-duration': 0 } }, OVERLAY_INSERT_BEFORE)
    }
    bandModel.current = cfg.model
  }, [ready, bandOn, meta, cfg.model, cfg.varId, step, model.maxzoom])

  // --- Feld für Werteanzeige und Höchstwerte, Vorladen der Nachbarschritte -----
  useEffect(() => {
    if (!show) return
    let cancelled = false
    loadGlobeField(cfg.model, meta.runId, cfg.varId, step)
      .then((f) => !cancelled && setLoaded({ key: fieldKey, field: f }))
      .catch(() => {})
    for (const d of [1, 2, -1]) {
      const s = steps[idx + d]
      if (s != null) prefetchGlobeField(cfg.model, meta.runId, cfg.varId, s)
    }
    return () => {
      cancelled = true
    }
  }, [show, meta, cfg.model, cfg.varId, step, steps, idx, fieldKey])

  // Windfiedern bei Wind, Böen und Höhenwind (auf Wunsch) — aus den
  // Windkomponenten zum selben Termin wie das Feld
  const barbsRef = useRef<WindBarbs | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const wb = new WindBarbs(map)
    barbsRef.current = wb
    return () => {
      wb.destroy()
      barbsRef.current = null
    }
  }, [ready])
  const uvVar = particleSource(cfg.varId, meta).var
  const uvMeta = meta?.variables[uvVar]
  const uvStep = show && uvMeta && uvMeta.steps.length ? uvMeta.steps[nearestStepIndex(uvMeta.steps, runMs(meta), stepMs)] : undefined
  const barbsOn = BARB_VARS.has(cfg.varId) && uvStep != null
  useEffect(() => {
    const wb = barbsRef.current
    if (!wb) return
    if (!barbsOn || !meta || uvStep == null) {
      wb.set(null)
      return
    }
    let cancelled = false
    loadGlobeField(cfg.model, meta.runId, uvVar, uvStep)
      .then((f) => !cancelled && wb.set((lat, lon) => sampleWind(f, lat, lon)))
      .catch(() => !cancelled && wb.set(null))
    return () => {
      cancelled = true
    }
  }, [ready, barbsOn, meta, cfg.model, uvVar, uvStep])

  const maximaRef = useRef<ReturnType<typeof addFieldMaxima> | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const mx = addFieldMaxima(map, '.gmp-run, .gmp-legend, .gmp-readout, .gmp-msg')
    maximaRef.current = mx
    return () => {
      mx.destroy()
      maximaRef.current = null
    }
  }, [ready])
  const maximaOpts = MAXIMA_OPTIONS[cfg.varId]
  const interval = step != null ? intervalHours(vm, step) : undefined
  // Niederschlag: Höchstwerte; jede andere Größe mit Skala: Werte im Raster;
  // Wolkenschichten (drei Kanäle) haben keinen einen Wert
  // Wo es Kantenlinien gibt, stehen die Zahlen an den Linien — kein Raster
  // (das Raster sah über den Temperaturflächen unruhig aus, gemeldet)
  const gridMode = !maximaOpts && !variable.kind && !band
  useEffect(() => {
    maximaRef.current?.set(
      numbersOn && field && (maximaOpts || gridMode) ? field : null,
      maximaOpts
        ? {
            min: maximaOpts.min,
            factor: maximaOpts.perInterval ? (interval ?? 1) : 1,
            decimals: maximaOpts.decimals,
            fillMin: maximaOpts.fillMin,
          }
        : { min: -Infinity, factor: 1, decimals: variable.decimals, fillMin: -Infinity, mode: 'grid', scale: variable.scale },
    )
  }, [ready, numbersOn, maximaOpts, gridMode, field, interval, variable])

  // --- Legende und Werte -------------------------------------------------------
  const legend = useMemo(() => {
    const stops = variable.scale.stops
    const every = Math.max(variable.legendEvery, Math.ceil(stops.length / 7))
    return stops.map((s, i) => ({
      color: s.color,
      label: (variable.legendMultiple ? Math.abs(s.value % variable.legendMultiple) < 1e-9 : i % every === 0) ? String(s.value) : '',
    }))
  }, [variable])

  const readValue = hover && field && !field.rgb ? sampleField(field, hover.lat, hover.lon) : NaN
  const lastMs = meta && steps.length ? validMs(meta, steps[steps.length - 1]) : NaN

  // Der Lauf steht IMMER im Bild: nebeneinander können Panels verschieden alte
  // Läufe zeigen, und das Modell allein sagt das nicht
  const run = meta ? runMs(meta) : NaN
  const now = Date.now()
  const freshness = meta ? globeFreshness(run, lastMs, now, model.staleHours) : 'ok'
  const leadH = show ? Math.round((stepMs - run) / 3_600_000) : null

  let msg: string | null = null
  if (metaError) msg = `${model.label}: keine Daten (${metaError})`
  else if (meta && !vm) msg = `${model.label} führt „${variable.label}" nicht`
  else if (meta && vm && step == null && times.length) msg = `${model.label} beginnt erst ${validLabel(times[0])}`
  else if (meta && vm && offTime) msg = `${model.label} reicht nur bis ${validLabel(lastMs)}`

  return (
    <div className={props.pacing ? 'panel gmp-panel is-pacing' : 'panel gmp-panel'}>
      {props.header}
      <div className="gmp-body">
        <div className="gmp-map" ref={containerRef} />
        {meta && (
          <div
            className={freshness === 'ok' ? 'gmp-run' : 'gmp-run is-stale'}
            title={`Init-Zeit des Laufs, vom Anbieter gemeldet${leadH != null ? `; das Bild zeigt den Termin ${leadH} h danach` : ''}. Warnung ab ${model.staleHours} h Laufalter.`}
          >
            Lauf {formatRunLong({ initTime: run, initHourUtc: new Date(run).getUTCHours() }, now)}
            {leadH != null && ` · +${leadH} h`}
            {freshness === 'old' && ' · ⚠ alter Lauf'}
            {freshness === 'spent' && ' · ⚠ Stand verbraucht'}
          </div>
        )}
        {show && frozen && (
          <>
            <div className="gmp-frozen" />
            <div className="gmp-frozen-badge" title="Dieses Modell hat zur gewählten Zeit keinen eigenen Termin — gezeigt wird der letzte davor, bis der nächste erreicht ist.">
              steht bei {validLabel(stepMs)}
              {idx > 0 && ` · ${Math.round((times[idx] - times[idx - 1]) / 3_600_000)}-h-Schritte`}
            </div>
          </>
        )}
        {props.pacing && (
          <div className="gmp-pace-badge" title="Klick in die Karte oder Esc: wieder im gemeinsamen Takt">
            gibt den Takt vor · {Math.round(paceStepMs / 60_000) % 60 === 0 ? `${Math.round(paceStepMs / 3_600_000)} h` : `${Math.round(paceStepMs / 60_000)} min`}
          </div>
        )}
        {msg && <div className="gmp-msg">{msg}</div>}
        {hover && (
          <div className="gmp-readout">
            {Number.isFinite(readValue)
              ? cfg.varId === 'precip'
                ? precipReadout(readValue, interval, (v) => formatReadout(v, variable.decimals))
                : `${formatReadout(readValue, variable.decimals)} ${vm?.unit ?? ''}`
              : field && !field.grid.global
                ? 'außerhalb'
                : '—'}
          </div>
        )}
        {!variable.kind && (
          <div className="gmp-legend" title={variable.title}>
            <span className="gmp-legend-cap">
              {vm?.unit ?? ''}
              {interval != null &&
                cfg.varId !== 'precipsum' &&
                cfg.varId !== 'newsnow' &&
                (cfg.varId === 'precip' ? ` · Mittel über ${interval} h` : ` · ${interval} h`)}
              {numbersOn && maximaOpts && ` · Zahlen: Höchstwerte ${cfg.varId === 'newsnow' ? 'cm' : 'mm'}`}
            </span>
            <span className="gmp-legend-bar">
              {legend.map((s, i) => (
                <span key={i} className="gmp-legend-step">
                  <i style={{ background: s.color }} />
                  <em>{s.label}</em>
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
