// Modellkarten: ECMWF IFS, DWD ICON-EU und ICON-D2 als drehbarer Globus oder
// als flache Karte (Europa, Alpen) — MapLibre, Projektion je Ansicht.
//
// Daten direkt von ECMWF und vom DWD, im Deploy zu Wertebildern verarbeitet
// (`scripts/ecmwf-ingest.py`, `scripts/icon-ingest.py`; Kodierung, Modelle und
// Ansichten in `config/globe.ts`). Der Browser holt je Zeitschritt EIN Bild
// (~0,05–0,3 MB) und rechnet daraus die Kacheln selbst (`render/globeTiles.ts`)
// — warum Kacheln und nicht ein Bild über die Erde, steht dort (Pole).
// Kein Open-Meteo-Budget, und die Kosten hängen nicht an der Nutzerzahl.
//
// Bedienung wie Radar und Satellit: Auswahl, Abspielen, Zeitschieber; ←/→
// über `globalKeyAllowed`. Der Wert am Zeiger kommt aus dem geladenen Feld,
// nicht aus der Farbe. Gewählt wird eine GÜLTIGKEITSZEIT, kein Index — beim
// Wechsel auf ein Modell mit anderen Schritten bleibt der Termin stehen.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASE_STYLE, buildGraticuleBox, EMPTY_FC, loadBasemap, OVERLAY_INSERT_BEFORE } from '../render/basemap'
import { CLOUD_LAYER_RAMPS, globeTileUrl, GLOBE_TILE_SIZE, toOcta } from '../render/globeTiles'
import { globeIsoUrl, registerGlobeProtocol } from '../render/globeProtocol'
import { addWorldLabels } from '../render/worldLabels'
import { WindParticles } from '../render/windParticles'
import { starTileDataUrl } from '../render/starfield'
import { loadGlobeField, loadGlobeMeta, setGlobeMeta } from '../api/globeData'
import {
  CONTOURS,
  DEFAULT_GLOBE_MODEL,
  DEFAULT_GLOBE_VARIABLE,
  getGlobeModel,
  getGlobeVariable,
  globeFreshness,
  GLOBE_MODELS,
  GLOBE_VARIABLES,
  GLOBE_VIEWS,
  intervalHours,
  nearestStepIndex,
  runMs,
  sampleField,
  sampleRgb3,
  sampleWind,
  validMs,
  WAVE_VARIABLES,
  type ContourId,
  type GlobeField,
  type GlobeMeta,
  type GlobeModelId,
  type GlobeVarId,
  type GlobeViewId,
} from '../config/globe'
import { globalKeyAllowed } from '../lib/globalKeys'

const FIELD_SOURCE = 'globe-field'
const FIELD_LAYER = 'globe-field'
const isoId = (c: ContourId) => `globe-iso-${c}`
/**
 * Isolinien werden zwei Zoomstufen ÜBER der Feldgrenze noch neu gerechnet:
 * eine gestreckte Linie wird breit und unscharf, eine gestreckte Farbfläche
 * fällt dagegen nicht auf.
 */
const ISO_EXTRA_ZOOM = 2
/** Abspieltempo: so lange steht ein Schritt, NACHDEM sein Feld geladen ist. */
const PLAY_MS = 450
/** Vorladen: so viele Schritte voraus (beim Abspielen und beim Ziehen). */
const PREFETCH_AHEAD = 3
/** Gradnetz je Ansicht: grob auf der Kugel, fein über den Alpen. */
const GRATICULE_STEP: Record<GlobeViewId, number> = { globe: 30, europe: 10, alps: 2, thailand: 5 }

/** Kantenlänge der Sternkachel in CSS-Pixeln (muss zur Parallaxe passen). */
const STAR_TILE = 768

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const pad = (n: number) => String(n).padStart(2, '0')

/** „Mo 05.10. 12 UTC" — von Hand statt über Intl: de-DE schreibt eine reine Stunde als „12 Uhr". */
function validLabel(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCHours())} UTC`
}

function runLabel(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCHours())} UTC`
}

type MetaState = { meta: GlobeMeta } | { error: string }

export function GlobePanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** Sternkachel einmal je Sitzung, in der Auflösung des Schirms */
  const stars = useMemo(() => starTileDataUrl(STAR_TILE, 900, Math.min(2, window.devicePixelRatio || 1)), [])
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const [modelId, setModelId] = useState<GlobeModelId>(DEFAULT_GLOBE_MODEL)
  const [viewId, setViewId] = useState<GlobeViewId>('globe')
  const [metas, setMetas] = useState<Partial<Record<GlobeModelId, MetaState>>>({})
  const [varId, setVarId] = useState<GlobeVarId>(DEFAULT_GLOBE_VARIABLE)
  /** Gewählte GÜLTIGKEITSZEIT, nicht der Index — überlebt Modell- und Größenwechsel. */
  const [targetMs, setTargetMs] = useState<number>(() => Date.now())
  const [playing, setPlaying] = useState(false)
  /**
   * Feld MIT seinem Schlüssel: beim Modell- oder Größenwechsel rechnete die
   * Werteanzeige sonst bis zum Eintreffen des neuen Felds mit dem alten — eine
   * Zahl, die zu etwas anderem gehört (dasselbe Muster wie `dataKey` in der
   * Verifikation).
   */
  const [loaded, setLoaded] = useState<{ key: string; field: GlobeField } | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [readout, setReadout] = useState<{ lat: number; lon: number } | null>(null)
  /** Isolinien als eigene Ebenen über JEDER Größe — Isobaren sind die Vorgabe. */
  const [contours, setContours] = useState<Record<ContourId, boolean>>({ msl: true, gh500: false })
  /**
   * Partikel (Strömung als Bewegung) — eingeschaltet, sobald eine Wind- oder
   * Wellengröße gewählt wird. Über Wellenhöhe und -periode zeigen sie den
   * WELLENLAUF (`wavedir`), sonst den Wind (`uv10`).
   */
  const [particles, setParticles] = useState(false)

  const model = getGlobeModel(modelId)
  const view = GLOBE_VIEWS.find((v) => v.id === viewId) ?? GLOBE_VIEWS[0]
  const metaState = metas[modelId]
  const meta = metaState && 'meta' in metaState ? metaState.meta : null
  const metaError = metaState && 'error' in metaState ? metaState.error : null
  const variable = getGlobeVariable(varId)
  const vm = meta?.variables[varId]
  const steps = useMemo(() => vm?.steps ?? [], [vm])
  const run = meta ? runMs(meta) : NaN
  const idx = steps.length ? nearestStepIndex(steps, run, targetMs) : 0
  const step = steps[idx]
  const fieldKey = meta && step != null ? `${modelId}/${meta.runId}/${varId}/${step}` : ''
  const field = loaded?.key === fieldKey ? loaded.field : null

  // --- Meta des gewählten Modells (einmal je Modell und Sitzung) ----------
  useEffect(() => {
    if (metas[modelId]) return
    let cancelled = false
    loadGlobeMeta(modelId)
      .then((m) => {
        if (cancelled) return
        setGlobeMeta(m)
        setMetas((prev) => ({ ...prev, [modelId]: { meta: m } }))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setMetas((prev) => ({ ...prev, [modelId]: { error: e instanceof Error ? e.message : String(e) } }))
      })
    return () => {
      cancelled = true
    }
  }, [modelId, metas])

  // Wer Bodendruck oder 500 hPa wählt, will die Linien dazu — einmal beim
  // Wechsel eingeschaltet, abschalten bleibt danach möglich
  useEffect(() => {
    if (varId === 'msl' || varId === 'gh500') setContours((c) => (c[varId] ? c : { ...c, [varId]: true }))
  }, [varId])

  // Wer Wind oder Böen wählt, will die Strömung sehen — einmal beim Wechsel
  // eingeschaltet, abschalten bleibt danach möglich
  useEffect(() => {
    if (varId === 'wind10' || varId === 'gust' || WAVE_VARIABLES.has(varId)) setParticles(true)
  }, [varId])

  // Hat das Modell die gewählte Größe nicht, auf die Vorgabe zurück
  useEffect(() => {
    if (meta && !meta.variables[varId]) setVarId(DEFAULT_GLOBE_VARIABLE)
  }, [meta, varId])

  // --- Karte -------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    registerGlobeProtocol(loadGlobeField)
    const map = new maplibregl.Map({
      container: el,
      style: {
        ...BASE_STYLE,
        projection: { type: 'globe' },
        // Atmosphärenschein am Kugelrand — auf der ganzen Kugel voll, beim
        // Hineinzoomen ausgeblendet (in den flachen Ansichten stört er nur)
        sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.8, 6, 0] },
      },
      center: [11, 38],
      zoom: 2,
      attributionControl: false,
      // Darüber werden die Kacheln nur noch gestreckt (`GlobeModel.maxzoom`)
      maxZoom: 10,
      // Die Pfeiltasten gehören der ZEIT. MapLibre verschiebt mit ihnen sonst
      // die Karte, sobald sie den Fokus hat, und verbraucht das Ereignis
      // (`preventDefault`) — gemessen: nach einem Klick in die Karte schalteten
      // zehn Tastendrücke keinen einzigen Zeitschritt weiter.
      keyboard: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Ansicht: Projektion umstellen und den Ausschnitt anfahren
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setProjection({ type: view.projection })
    if (view.bounds) map.fitBounds(view.bounds, { padding: 16, duration: 0 })
    else map.jumpTo({ center: [11, 38], zoom: 2 })
  }, [mapReady, view])

  // Hintergrund: Landflächen, Weltküsten und Staatsgrenzen; Bundesländer/Kantone nur in
  // den flachen Ansichten (auf der Kugel wären sie bei Zoom 2 nur ein Fleck)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(
      buildGraticuleBox({ latMin: -80, latMax: 80, lonMin: -180, lonMax: 180 }, GRATICULE_STEP[view.id]),
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
    const admin1 = map.getSource('admin1') as maplibregl.GeoJSONSource
    // Bundesländer/Kantone gibt es nur für D-A-CH — auf der Kugel und über
    // Thailand blieben sie unsichtbar bzw. außer Sicht
    if (view.id !== 'europe' && view.id !== 'alps') admin1.setData(EMPTY_FC)
    else
      loadBasemap('dach')
        .then((bm) => !cancelled && mapRef.current === map && admin1.setData(bm.admin1 ?? EMPTY_FC))
        .catch((err: unknown) => console.error('[basemap dach]', err))
    return () => {
      cancelled = true
    }
  }, [mapReady, view])

  // Sterne ziehen beim Drehen der Kugel leicht mit (Parallaxe) — weit
  // langsamer als die Kugel, so wirkt der Himmel unendlich weit weg. Direkt am
  // Element gesetzt, nicht über React: das läuft bei jeder Kamerabewegung.
  useEffect(() => {
    const map = mapRef.current
    const body = bodyRef.current
    if (!map || !mapReady || !body || view.id !== 'globe') return
    const move = () => {
      const c = map.getCenter()
      const x = (-c.lng / 360) * STAR_TILE * 0.6
      const y = (c.lat / 180) * STAR_TILE * 0.6
      body.style.setProperty('--star-x', `${x.toFixed(1)}px`)
      body.style.setProperty('--star-y', `${y.toFixed(1)}px`)
    }
    move()
    map.on('move', move)
    return () => {
      map.off('move', move)
    }
  }, [mapReady, view.id])

  // Beschriftung (Städte, Länder, Meere) in allen Ansichten — ausgedünnt nach
  // Zoom und Platz, auf der Kugel nur die zugewandte Seite
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    return addWorldLabels(map, '.globe-arrows, .globe-legend, .globe-readout, .maplibregl-ctrl-top-right')
  }, [mapReady])

  // NEUESTER STAND GEWINNT: solange die Kacheln eines Schritts noch laden,
  // wird der nächste nur VORGEMERKT; ist die Karte fertig („idle"), springt sie
  // direkt auf den zuletzt gewählten. Vorher bekam jeder Tastendruck ein
  // eigenes `setTiles`, und beim schnellen Durchblättern liefen die
  // Zwischenschritte als Rückstau nach. Das Zeitlabel folgt sofort, nur die
  // Karte überspringt, was sie nicht rechtzeitig zeigen könnte.
  const wantTiles = useRef(new Map<string, string>())
  const shownTiles = useRef(new Map<string, string>())
  const tilesBusy = useRef(0)
  const flushTiles = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    // Sicherheitsnetz: meldet die Karte nie „idle" (z. B. keine sichtbare
    // Kachel), hängt die Anzeige nicht fest
    if (tilesBusy.current && performance.now() - tilesBusy.current < 1500) return
    let changed = false
    for (const [id, url] of wantTiles.current) {
      if (shownTiles.current.get(id) === url) continue
      const src = map.getSource(id) as maplibregl.RasterTileSource | undefined
      if (!src) continue
      src.setTiles([url])
      shownTiles.current.set(id, url)
      changed = true
    }
    tilesBusy.current = changed ? performance.now() : 0
  }, [])
  const queueTiles = useCallback(
    (id: string, url: string) => {
      wantTiles.current.set(id, url)
      flushTiles()
    },
    [flushTiles],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const onIdle = () => {
      tilesBusy.current = 0
      flushTiles()
    }
    map.on('idle', onIdle)
    return () => {
      map.off('idle', onIdle)
    }
  }, [mapReady, flushTiles])

  // Feld-Ebene: je Modell eine eigene Quelle (die Zoomgrenze der Kacheln hängt
  // am Modell und lässt sich an einer bestehenden Quelle nicht ändern), ein
  // Zeitschritt ist danach nur noch ein `setTiles`.
  const sourceModelRef = useRef<GlobeModelId | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !meta || step == null) return
    const url = globeTileUrl(modelId, meta.runId, varId, step)
    const src = map.getSource(FIELD_SOURCE) as maplibregl.RasterTileSource | undefined
    if (src && sourceModelRef.current === modelId) {
      queueTiles(FIELD_SOURCE, url)
      return
    }
    if (map.getLayer(FIELD_LAYER)) map.removeLayer(FIELD_LAYER)
    if (src) map.removeSource(FIELD_SOURCE)
    map.addSource(FIELD_SOURCE, { type: 'raster', tiles: [url], tileSize: GLOBE_TILE_SIZE, maxzoom: model.maxzoom })
    map.addLayer(
      {
        id: FIELD_LAYER,
        type: 'raster',
        source: FIELD_SOURCE,
        paint: { 'raster-fade-duration': 0, 'raster-opacity': 0.92 },
      },
      OVERLAY_INSERT_BEFORE,
    )
    sourceModelRef.current = modelId
    wantTiles.current.set(FIELD_SOURCE, url)
    shownTiles.current.set(FIELD_SOURCE, url)
  }, [mapReady, meta, modelId, model.maxzoom, varId, step, queueTiles])

  // Isolinien-Ebenen: je Linienart eine Quelle über allem (auch über den
  // Grenzen — die Linien sind der Inhalt, die Grenzen nur Orientierung).
  // Der Schritt ist der zur selben Gültigkeitszeit, nicht derselbe Index.
  const isoModelRef = useRef<GlobeModelId | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const rebuild = isoModelRef.current !== modelId
    for (const c of CONTOURS) {
      const id = isoId(c.id)
      const cvm = meta?.variables[c.id]
      const on = contours[c.id] && meta && cvm && cvm.steps.length > 0 && step != null
      const src = map.getSource(id) as maplibregl.RasterTileSource | undefined
      if (!on || rebuild) {
        if (map.getLayer(id)) map.removeLayer(id)
        if (src) map.removeSource(id)
        wantTiles.current.delete(id)
        shownTiles.current.delete(id)
      }
      if (!on) continue
      const cstep = cvm.steps[nearestStepIndex(cvm.steps, run, validMs(meta, step))]
      const url = globeIsoUrl(modelId, meta.runId, c.id, cstep)
      const existing = map.getSource(id) as maplibregl.RasterTileSource | undefined
      if (existing) queueTiles(id, url)
      else {
        map.addSource(id, { type: 'raster', tiles: [url], tileSize: GLOBE_TILE_SIZE, maxzoom: model.maxzoom + ISO_EXTRA_ZOOM })
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0 } })
        wantTiles.current.set(id, url)
        shownTiles.current.set(id, url)
      }
    }
    isoModelRef.current = modelId
  }, [mapReady, meta, modelId, model.maxzoom, contours, step, run, queueTiles])

  // Windpartikel: eine Animation über der Karte, gespeist aus den
  // Windkomponenten (`uv10`) zur selben Gültigkeitszeit wie das Feld
  const particlesRef = useRef<WindParticles | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const wp = new WindParticles(map)
    particlesRef.current = wp
    return () => {
      wp.destroy()
      particlesRef.current = null
    }
  }, [mapReady])
  const particleVar: GlobeVarId = WAVE_VARIABLES.has(varId) ? 'wavedir' : 'uv10'
  const waves = particleVar === 'wavedir'
  const uvMeta = meta?.variables[particleVar]
  const uvStep = meta && uvMeta && step != null ? uvMeta.steps[nearestStepIndex(uvMeta.steps, run, validMs(meta, step))] : undefined
  useEffect(() => {
    const wp = particlesRef.current
    if (!wp) return
    if (!particles || !meta || uvStep == null) {
      wp.setSampler(null)
      return
    }
    let cancelled = false
    loadGlobeField(modelId, meta.runId, particleVar, uvStep)
      .then((f) => !cancelled && wp.setSampler((lat, lon) => sampleWind(f, lat, lon)))
      .catch(() => !cancelled && wp.setSampler(null))
    return () => {
      cancelled = true
    }
  }, [mapReady, particles, meta, modelId, particleVar, uvStep])

  // Aktuelles Feld für die Werteanzeige + Vorladen der nächsten Schritte
  useEffect(() => {
    if (!meta || step == null) return
    let cancelled = false
    setFieldError(null)
    const key = `${modelId}/${meta.runId}/${varId}/${step}`
    loadGlobeField(modelId, meta.runId, varId, step)
      .then((f) => !cancelled && setLoaded({ key, field: f }))
      .catch((e: unknown) => {
        if (cancelled) return
        setFieldError(e instanceof Error ? e.message : String(e))
      })
    // Vorladen: die nächsten Schritte vorwärts, einen rückwärts — und die
    // Felder der eingeschalteten Isolinien gleich mit, die laden sonst erst,
    // wenn ihre Kacheln gefragt werden
    const ahead = [1, 2, 3, -1].slice(0, PREFETCH_AHEAD + 1)
    const vars: GlobeVarId[] = [varId, ...CONTOURS.filter((c) => contours[c.id] && meta.variables[c.id]).map((c) => c.id)]
    const pv: GlobeVarId = WAVE_VARIABLES.has(varId) ? 'wavedir' : 'uv10'
    if (particles && meta.variables[pv]) vars.push(pv)
    for (const v of vars) {
      const vsteps = meta.variables[v]?.steps ?? []
      const base = nearestStepIndex(vsteps, run, validMs(meta, step))
      for (const k of ahead) {
        const s = vsteps[base + k]
        if (s != null && !(v === varId && k === 0)) loadGlobeField(modelId, meta.runId, v, s).catch(() => {})
      }
    }
    return () => {
      cancelled = true
    }
  }, [meta, modelId, varId, step, idx, steps, contours, particles, run])

  // Abspielen: weiter, sobald das AKTUELLE Feld da ist — so überholt die
  // Schleife nie die Daten, und bei langsamem Netz wird sie langsamer statt leer.
  useEffect(() => {
    if (!playing || !meta || step == null || field == null) return
    const t = window.setTimeout(() => {
      const next = steps[(idx + 1) % steps.length]
      setTargetMs(validMs(meta, next))
    }, PLAY_MS)
    return () => window.clearTimeout(t)
  }, [playing, meta, field, idx, step, steps])

  const goTo = useCallback(
    (i: number) => {
      if (!meta || !steps.length) return
      const j = Math.max(0, Math.min(steps.length - 1, i))
      setTargetMs(validMs(meta, steps[j]))
    },
    [meta, steps],
  )

  // Sichtbare Rückmeldung der Pfeiltasten: der passende Pfeil unten in der
  // Karte leuchtet kurz grün — man sieht, dass die Tasten ankommen
  const [flash, setFlash] = useState<'left' | 'right' | null>(null)
  const flashTimer = useRef(0)
  const pulse = useCallback((dir: 'left' | 'right') => {
    setFlash(dir)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 220)
  }, [])
  const stepBy = useCallback(
    (d: number) => {
      setPlaying(false)
      goTo(idx + d)
      pulse(d > 0 ? 'right' : 'left')
    },
    [goTo, idx, pulse],
  )

  // ←/→ ein Schritt, mit Shift vier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const dir = e.key === 'ArrowRight' ? 1 : -1
      // Auf dem Zeitschieber selbst bewegt der Browser ihn nativ — dort nur
      // die Rückmeldung, sonst wäre es ein Tastendruck mit zwei Schritten
      const t = e.target as HTMLInputElement | null
      if (t?.tagName === 'INPUT' && t.type === 'range' && t.closest('.globe')) {
        pulse(dir > 0 ? 'right' : 'left')
        return
      }
      if (!globalKeyAllowed(e)) return
      e.preventDefault()
      stepBy(dir * (e.shiftKey ? 4 : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepBy, pulse])

  // Wert am Zeiger
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const move = (e: maplibregl.MapMouseEvent) => setReadout({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    const leave = () => setReadout(null)
    map.on('mousemove', move)
    map.getCanvas().addEventListener('mouseleave', leave)
    return () => {
      map.off('mousemove', move)
      map.getCanvas().removeEventListener('mouseleave', leave)
    }
  }, [mapReady])

  const readValue = readout && field && !field.rgb ? sampleField(field, readout.lat, readout.lon) : NaN
  const readLayers = readout && field?.rgb ? sampleRgb3(field, readout.lat, readout.lon) : null
  const lastValid = meta && steps.length ? validMs(meta, steps[steps.length - 1]) : NaN
  const freshness = meta ? globeFreshness(run, lastValid, Date.now(), model.staleHours) : 'ok'
  const interval = step != null ? intervalHours(vm, step) : undefined
  // Termin weicht deutlich von der Wahl ab — das Modell reicht nicht so weit
  const offTarget = meta && step != null && Math.abs(validMs(meta, step) - targetMs) > 3 * 3_600_000

  const legend = useMemo(() => {
    const stops = variable.scale.stops
    return stops.map((s, i) => ({
      color: s.color,
      label: i % variable.legendEvery === 0 ? String(s.value) : '',
    }))
  }, [variable])

  const intervalText =
    interval == null
      ? null
      : varId === 'gust'
        ? `höchste Böe der ${interval === 1 ? 'letzten Stunde' : `letzten ${interval} h`} vor dem Termin`
        : `Mittel der ${interval === 1 ? 'letzten Stunde' : `letzten ${interval} h`} vor dem Termin`

  return (
    <div className="radar globe">
      <div className="radar-bar">
        <span className="radar-title">Modellkarten</span>
        <span className="globe-seg" role="group" aria-label="Ansicht">
          {GLOBE_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={v.id === viewId ? 'is-active' : ''}
              aria-pressed={v.id === viewId}
              onClick={() => {
                setViewId(v.id)
                // ICON-EU/-D2 sind europäisch — über Thailand bliebe die Karte leer
                if (v.id === 'thailand' && modelId !== 'ecmwf-ifs') setModelId('ecmwf-ifs')
              }}
            >
              {v.label}
            </button>
          ))}
        </span>
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value as GlobeModelId)
            // Fokus abgeben: sonst blättern die Pfeiltasten danach in der Liste statt in der Zeit
            e.currentTarget.blur()
          }}
          title={model.title}
        >
          {GLOBE_MODELS.map((m) => (
            <option key={m.id} value={m.id} title={m.title}>
              {m.label} · {m.resolution}
            </option>
          ))}
        </select>
        <select
          value={varId}
          onChange={(e) => {
            setVarId(e.target.value as GlobeVarId)
            e.currentTarget.blur()
          }}
          title={variable.title}
        >
          {GLOBE_VARIABLES.map((v) => (
            <option key={v.id} value={v.id} disabled={!meta?.variables[v.id]} title={v.title}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="radar-overlays">
          {CONTOURS.map((c) => (
            <label key={c.id} className="radar-opt" title={c.title}>
              <input
                type="checkbox"
                checked={contours[c.id]}
                disabled={!meta?.variables[c.id]}
                onChange={(e) => setContours((prev) => ({ ...prev, [c.id]: e.target.checked }))}
              />{' '}
              {c.label}
            </label>
          ))}
          <label
            className="radar-opt"
            title={
              meta && !uvMeta
                ? waves
                  ? 'Dieses Modell rechnet keine Wellen — Wellenlauf gibt es nur beim ECMWF IFS.'
                  : 'Dieser Lauf enthält noch keine Windkomponenten — ab dem nächsten Ingest verfügbar.'
                : waves
                  ? 'Wellenlauf: die Spuren laufen in Ausbreitungsrichtung mit der Gruppengeschwindigkeit im tiefen Wasser (c = g·T/4π aus der Peak-Periode) — lange Dünung zieht sichtbar schneller als kurze Windsee.'
                  : 'Strömung des 10-m-Winds als bewegte Spuren über jeder Größe. Richtung und Tempo-VERHÄLTNIS sind maßstäblich, das Tempo auf dem Schirm ist nicht maßstäblich (auf der ganzen Kugel ruhiger) — den Betrag zeigt die Größe „Wind 10 m".'
            }
          >
            <input
              type="checkbox"
              checked={particles}
              disabled={!uvMeta}
              onChange={(e) => setParticles(e.target.checked)}
            />{' '}
            {waves ? 'Wellenlauf' : 'Windpartikel'}
          </label>
        </span>
        <button
          type="button"
          className="radar-play"
          onClick={() => setPlaying((p) => !p)}
          disabled={!steps.length}
          title={playing ? 'Anhalten' : 'Abspielen'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="radar-slider">
          <input
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={idx}
            onChange={(e) => {
              setPlaying(false)
              goTo(Number(e.target.value))
            }}
            disabled={!steps.length}
          />
        </div>
        <span
          className="radar-step globe-step"
          title={offTarget ? `${model.label} reicht nicht bis zum gewählten Termin — gezeigt ist der nächstgelegene.` : undefined}
        >
          {meta && step != null ? (
            <>
              {validLabel(validMs(meta, step))} <em>+{step} h</em>
              {offTarget && <span className="globe-warn"> ⚠</span>}
            </>
          ) : (
            '—'
          )}
        </span>
        {meta && (
          <span
            className="radar-sub"
            title={`Init-Zeit des Laufs — anders als in den Open-Meteo-Bereichen GEMELDET, nicht geschätzt (sie steht im Dateinamen beim Anbieter). Warnung ab ${model.staleHours} h Laufalter.`}
          >
            Lauf {runLabel(run)}
            {freshness === 'old' && <span className="globe-warn"> ⚠ alter Lauf</span>}
            {freshness === 'spent' && <span className="globe-warn"> ⚠ Stand verbraucht</span>}
          </span>
        )}
      </div>

      <div
        className={`radar-body${view.id === 'globe' ? ' globe-space' : ''}`}
        ref={bodyRef}
        style={{ '--stars': `url(${stars})`, '--star-tile': `${STAR_TILE}px` } as CSSProperties}
      >
        <div className="radar-container" ref={containerRef} />
        {(metaError || fieldError) && (
          <div className="globe-msg">
            {metaError
              ? import.meta.env.DEV
                ? `Keine Daten für ${model.label} (${metaError}). Lokal erzeugen mit „npm run ingest:${modelId === 'ecmwf-ifs' ? 'ecmwf' : modelId}" (braucht Python mit scripts/requirements-nwp.txt).`
                : `Die Daten für ${model.label} sind gerade nicht verfügbar.`
              : `Feld nicht ladbar: ${fieldError}`}
          </div>
        )}
        <div className="globe-arrows">
          <button
            type="button"
            className={flash === 'left' ? 'is-on' : ''}
            onClick={() => stepBy(-1)}
            disabled={!steps.length || idx <= 0}
            aria-label="Einen Zeitschritt zurück (Pfeiltaste links)"
            title="Einen Zeitschritt zurück — Pfeiltaste ←, mit Umschalt vier"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
          </button>
          <button
            type="button"
            className={flash === 'right' ? 'is-on' : ''}
            onClick={() => stepBy(1)}
            disabled={!steps.length || idx >= steps.length - 1}
            aria-label="Einen Zeitschritt vor (Pfeiltaste rechts)"
            title="Einen Zeitschritt vor — Pfeiltaste →, mit Umschalt vier"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="globe-readout" aria-live="polite">
          {readout ? (
            <>
              <span className="globe-readout-pos">
                {Math.abs(readout.lat).toFixed(2)}° {readout.lat >= 0 ? 'N' : 'S'} ·{' '}
                {Math.abs(((readout.lon + 540) % 360) - 180).toFixed(2)}° {((readout.lon + 540) % 360) - 180 >= 0 ? 'O' : 'W'}
              </span>
              <strong>
                {variable.kind === 'rgb3'
                  ? readLayers
                    ? `hoch ${toOcta(readLayers.high)}/8 · mittel ${toOcta(readLayers.mid)}/8 · tief ${toOcta(readLayers.low)}/8`
                    : field ? `außerhalb ${model.label}` : '—'
                  : Number.isFinite(readValue)
                  ? `${readValue.toLocaleString('de-DE', { minimumFractionDigits: variable.decimals, maximumFractionDigits: variable.decimals })} ${vm?.unit ?? ''}`
                  : field && !field.grid.global
                    ? `außerhalb ${model.label}`
                    : '—'}
              </strong>
            </>
          ) : (
            <span className="globe-readout-pos">Zeiger auf die Karte: Wert ablesen</span>
          )}
        </div>
        <div className="radar-legend globe-legend" title={variable.title}>
          <span className="radar-legend-cap">
            {model.label} · {variable.label} · {variable.kind === 'rgb3' ? 'Achtel' : (vm?.unit ?? '')}
            {intervalText && ` · ${intervalText}`}
          </span>
          {variable.kind === 'rgb3' ? (
            <div className="globe-legend-octas">
              {([
                ['high', 'hoch'],
                ['mid', 'mittel'],
                ['low', 'tief'],
              ] as const).map(([k, t]) => (
                <div key={k} className="globe-legend-octa-row">
                  <span className="globe-legend-octa-name">{t}</span>
                  {CLOUD_LAYER_RAMPS[k].map((c, i) => (
                    <i key={i} style={{ background: `rgb(${c.join(',')})` }} title={`${i + 1}/8`} />
                  ))}
                </div>
              ))}
              <div className="globe-legend-octa-row globe-legend-octa-scale">
                <span className="globe-legend-octa-name">Achtel</span>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <em key={n}>{n}</em>
                ))}
              </div>
            </div>
          ) : (
            <div className="globe-legend-bar">
              {legend.map((s, i) => (
                <span key={i} className="globe-legend-step">
                  <i style={{ background: s.color }} />
                  <em>{s.label}</em>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <span className="attribution radar-attribution">
        Datenquelle:{' '}
        {model.provider === 'ECMWF' ? (
          <>
            <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data" target="_blank" rel="noreferrer">
              ECMWF Open Data
            </a>{' '}
            (IFS 0,25°,{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            )
          </>
        ) : (
          <>
            <a href="https://www.dwd.de/DE/leistungen/opendata/opendata.html" target="_blank" rel="noreferrer">
              Deutscher Wetterdienst
            </a>{' '}
            ({model.label}, Nutzung nach{' '}
            <a
              href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html"
              target="_blank"
              rel="noreferrer"
            >
              GeoNutzV
            </a>
            )
          </>
        )}
        , beim Bauen der Seite übernommen · Küsten, Grenzen und Namen: Natural Earth. Rohe Modellausgabe, kein Warndienst. Zeiten in UTC.
      </span>
    </div>
  )
}
