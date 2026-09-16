// Niederschlagsradar (AppView `radar`) — eigener Bereich, eigenes schlankes
// Gerüst wie das klassische Meteogramm und die Klimakarte.
//
// Woher die Bilder kommen, was sie zeigen und wo die Abdeckung endet, steht in
// `config/radar.ts`; der Abruf in `api/dwdRadar.ts`. Hier ist nur die
// Bedienung: Karte, Zeitschieber über die 5-Minuten-Bilder, Schleife.
//
// AUFBAU der Karte (unten → oben): lokaler Kartenhintergrund → RADARBILD →
// Gradnetz/Grenzen → Städte als DOM-Marker. Das Radarbild liegt also UNTER den
// Grenzlinien: ein Echo über der Grenze soll die Grenze nicht verschlucken
// (dieselbe Reihenfolge wie beim Feld in `MapPanel`).
//
// Das Bild ist eine MapLibre-image-Source über die ganze Produktfläche, in
// **Web-Mercator angefordert** — MapLibre spannt eine image-Source linear im
// Mercator-Raum auf, deshalb braucht es hier KEINE Vorverzerrung wie in
// `render/fieldImage.ts`: das Bild kommt schon in der Projektion, in der es
// gezeichnet wird.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchRadarMeta, loadRadarImages } from '../api/dwdRadar'
import { CITIES } from '../config/cities'
import {
  analysisTime,
  DEFAULT_RADAR_PRODUCT,
  nearestFrame,
  RADAR_IMAGE_WIDTH,
  RADAR_LEGEND,
  RADAR_PRODUCTS,
  radarFrames,
  radarImageCoordinates,
  radarImageHeight,
  type RadarFrame,
  type RadarMeta,
} from '../config/radar'
import { BASE_STYLE, buildGraticuleBox, EMPTY_FC, loadBasemap, OVERLAY_INSERT_BEFORE } from '../render/basemap'

const RADAR_SOURCE_ID = 'radar'
const RADAR_LAYER_ID = 'radar'
/** Kräftig, aber nicht deckend — Grenzen und Städte bleiben lesbar. */
const RADAR_OPACITY = 0.82

/** Ansichten, auf die man beim Radar wirklich springt. */
const VIEWS: { id: string; label: string; bounds: [[number, number], [number, number]] }[] = [
  { id: 'dach', label: 'D-A-CH', bounds: [[5.4, 45.8], [17.4, 55.3]] },
  { id: 'de', label: 'Deutschland', bounds: [[5.6, 47.1], [15.3, 55.2]] },
  { id: 'alpen', label: 'Alpen', bounds: [[8.8, 45.8], [17.2, 49.3]] },
]

/** Fensterlängen der Schleife. Jedes Bild ist ein Abruf — deshalb wählbar. */
const HISTORY_OPTIONS = [
  { min: 30, label: '30 min' },
  { min: 60, label: '1 h' },
  { min: 120, label: '2 h' },
  { min: 180, label: '3 h' },
]

/** Bildwechsel der Schleife und Standzeit am letzten Bild. */
const FRAME_MS = 280
const END_DWELL_MS = 1400
/** Wartezeit, wenn das nächste Bild noch nicht geladen ist. */
const WAIT_MS = 250

const fmtClock = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function frameLabel(frame: RadarFrame, analysis: number): string {
  const clock = `${fmtClock.format(new Date(frame.time))} UTC`
  const offMin = Math.round((frame.time - analysis) / 60_000)
  if (offMin === 0) return `${clock} · jetzt`
  const sign = offMin > 0 ? '+' : '−'
  const abs = Math.abs(offMin)
  const rel = abs >= 60 ? `${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, '0')} min` : `${abs} min`
  return `${clock} · ${sign}${rel}${frame.forecast ? ' (Vorhersage)' : ''}`
}

export function RadarPanel() {
  const [productId, setProductId] = useState(DEFAULT_RADAR_PRODUCT.id)
  const product = RADAR_PRODUCTS.find((p) => p.id === productId) ?? DEFAULT_RADAR_PRODUCT

  const [meta, setMeta] = useState<RadarMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Neuer Stand am Dienst, aber bewusst NICHT automatisch geladen (Bandbreite). */
  const [fresher, setFresher] = useState<RadarMeta | null>(null)

  const [historyMin, setHistoryMin] = useState(60)
  const [withForecast, setWithForecast] = useState(true)

  const [urls, setUrls] = useState<(string | undefined)[]>([])
  const [failed, setFailed] = useState(0)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [waitTick, setWaitTick] = useState(0)

  // --- Zeitdimension: einmal holen, dann jede Minute nur noch nachsehen -----
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    fetchRadarMeta(product, { signal: ac.signal })
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!alive || ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
      ac.abort()
    }
  }, [product])

  useEffect(() => {
    if (!meta) return
    const id = setInterval(() => {
      fetchRadarMeta(product, { force: true })
        .then((m) => setFresher(m.extent.end > meta.extent.end ? m : null))
        .catch(() => {
          /* Aussetzer beim Nachsehen ist kein Fehlerzustand des Bereichs */
        })
    }, 60_000)
    return () => clearInterval(id)
  }, [meta, product])

  // --- Bildfolge ------------------------------------------------------------
  const frames = useMemo(
    () => (meta ? radarFrames(meta, product, historyMin * 60_000, withForecast) : []),
    [meta, product, historyMin, withForecast],
  )
  const analysis = meta ? analysisTime(meta, product) : 0
  const startIdx = useMemo(
    () => (frames.length ? nearestFrame(frames, analysis) : 0),
    [frames, analysis],
  )

  // Bilder laden, sobald die Folge steht. Ein Wechsel von Produkt, Fenster
  // oder Stand verwirft ALLES: ein halb ausgetauschter Satz Bilder wäre eine
  // Schleife über zwei verschiedene Läufe.
  useEffect(() => {
    if (!meta || frames.length === 0) return
    const ac = new AbortController()
    setUrls(new Array<string | undefined>(frames.length).fill(undefined))
    setFailed(0)
    setIdx(startIdx)
    loadRadarImages(product, meta, frames, {
      width: RADAR_IMAGE_WIDTH,
      height: radarImageHeight(meta),
      startIndex: startIdx,
      signal: ac.signal,
      onLoaded: (i, url) => {
        setUrls((prev) => {
          const next = prev.slice()
          next[i] = url
          return next
        })
      },
      onError: (i, err) => {
        console.error('[radar] Bild', i, err)
        setFailed((n) => n + 1)
      },
    }).catch((err: unknown) => console.error('[radar]', err))
    return () => ac.abort()
  }, [meta, product, frames, startIdx])

  const loaded = urls.filter(Boolean).length
  const current = frames[idx]
  const currentUrl = urls[idx]

  // --- Schleife -------------------------------------------------------------
  useEffect(() => {
    if (!playing || frames.length === 0) return
    const atEnd = idx >= frames.length - 1
    const next = atEnd ? 0 : idx + 1
    const ready = urls[next] !== undefined
    const delay = !ready ? WAIT_MS : atEnd ? END_DWELL_MS : FRAME_MS
    const t = setTimeout(() => {
      if (ready) setIdx(next)
      else setWaitTick((n) => n + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [playing, idx, urls, frames.length, waitTick])

  // --- Karte ----------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = new maplibregl.Map({
      container: el,
      style: BASE_STYLE,
      bounds: VIEWS[0].bounds,
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
      // Über ~1,1 km je Pixel hinaus zeigt das Bild keine Details mehr —
      // weiter hineinzoomen darf man, es wird nur weich.
      maxZoom: 11,
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

  // Kartenhintergrund: Europa-Bündel plus Gradnetz über die Produktfläche
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !meta) return
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(
      buildGraticuleBox(
        { latMin: meta.geo.south, latMax: meta.geo.north, lonMin: meta.geo.west, lonMax: meta.geo.east },
        2,
      ),
    )
    let cancelled = false
    loadBasemap('europe')
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
  }, [mapReady, meta])

  // Städte als DOM-Marker (Pseudo-Domain 'radar' in config/cities.ts)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const cities = CITIES.filter((c) => c.domains.includes('radar'))
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
    // Beim Hineinzoomen werden die kleineren Orte wieder eingeblendet: aus der
    // D-A-CH-Übersicht wäre jede Kreisstadt ein Labelteppich.
    const thin = () => {
      const z = map.getZoom()
      const maxPriority = z < 4.8 ? 1 : z < 6 ? 2 : 3
      markers.forEach((m, i) => {
        m.getElement().classList.toggle('city-label-hidden', cities[i].priority > maxPriority)
      })
    }
    thin()
    map.on('zoom', thin)
    return () => {
      map.off('zoom', thin)
      markers.forEach((m) => m.remove())
    }
  }, [mapReady])

  // Radarbild einhängen bzw. austauschen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !meta) return
    const source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | undefined
    if (!currentUrl) {
      // Noch kein Bild für diesen Zeitschritt: das VORHERIGE stehen zu lassen
      // wäre eine falsche Zeitangabe — lieber nichts zeigen.
      if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID)
      if (source) map.removeSource(RADAR_SOURCE_ID)
      return
    }
    const coordinates = radarImageCoordinates(meta)
    if (source) {
      source.updateImage({ url: currentUrl, coordinates })
    } else {
      map.addSource(RADAR_SOURCE_ID, { type: 'image', url: currentUrl, coordinates })
      map.addLayer(
        {
          id: RADAR_LAYER_ID,
          type: 'raster',
          source: RADAR_SOURCE_ID,
          paint: { 'raster-opacity': RADAR_OPACITY, 'raster-fade-duration': 0 },
        },
        OVERLAY_INSERT_BEFORE,
      )
    }
  }, [currentUrl, mapReady, meta])

  const applyFresher = useCallback(() => {
    if (!fresher) return
    setMeta(fresher)
    setFresher(null)
  }, [fresher])

  const jumpToView = useCallback((bounds: [[number, number], [number, number]]) => {
    mapRef.current?.fitBounds(bounds, { padding: 8, duration: 400 })
  }, [])

  const status = error
    ? `⚠ ${error}`
    : !meta
      ? 'lädt Zeitschritte …'
      : loaded < frames.length
        ? `lädt Bilder ${loaded}/${frames.length}${failed ? ` · ${failed} fehlgeschlagen` : ''}`
        : `${frames.length} Bilder · Stand ${fmtClock.format(new Date(analysis))} UTC`

  return (
    <div className="radar">
      <div className="radar-bar">
        <span className="radar-title">Niederschlagsradar</span>
        {RADAR_PRODUCTS.length > 1 && (
          <select value={productId} onChange={(e) => setProductId(e.target.value)} title={product.note}>
            {RADAR_PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <label className="radar-opt" title="Wie weit die Schleife zurückreicht. Jedes Bild ist ein eigener Abruf beim DWD.">
          Rückblick{' '}
          <select value={historyMin} onChange={(e) => setHistoryMin(Number(e.target.value))}>
            {HISTORY_OPTIONS.map((o) => (
              <option key={o.min} value={o.min}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="radar-opt"
          title="Der RV-Nowcast rechnet die Echos 2 Stunden voraus — reine Verlagerung, kein Modell. Er ist im Diagramm hell abgesetzt."
        >
          <input
            type="checkbox"
            checked={withForecast}
            onChange={(e) => setWithForecast(e.target.checked)}
          />{' '}
          Nowcast +2 h
        </label>
        <button
          type="button"
          className="radar-play"
          onClick={() => setPlaying((p) => !p)}
          disabled={frames.length === 0}
          title={playing ? 'Schleife anhalten' : 'Schleife abspielen'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="radar-slider">
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={idx}
            onChange={(e) => {
              setPlaying(false)
              setIdx(Number(e.target.value))
            }}
            disabled={frames.length === 0}
          />
          {/* Ladebalken UNTER dem Regler: zeigt, welcher Teil der Schleife
              schon steht — ein Prozentwert allein sagt nicht, ob das gefragte
              Bild dabei ist. */}
          <div className="radar-ticks" aria-hidden="true">
            {frames.map((f, i) => (
              <span
                key={f.time}
                className={`radar-tick${urls[i] ? ' is-loaded' : ''}${f.forecast ? ' is-forecast' : ''}${i === idx ? ' is-current' : ''}`}
              />
            ))}
          </div>
        </div>
        <span className="radar-step">
          {current ? frameLabel(current, analysis) : '—'}
        </span>
        <span className={`radar-sub${error ? ' is-error' : ''}`}>{status}</span>
        {fresher && (
          <button type="button" className="radar-fresh" onClick={applyFresher} title="Der Dienst hat neuere Bilder. Neu laden.">
            ● neuer Stand
          </button>
        )}
      </div>

      <div className="radar-body">
        <div className="radar-container" ref={containerRef} />
        <div className="radar-views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => jumpToView(v.bounds)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="radar-legend">
          <span className="radar-legend-cap">mm/h</span>
          <div className="radar-legend-scale">
            {RADAR_LEGEND.slice(1).map((s) => (
              <span key={s.color} className="radar-legend-step">
                <i style={{ background: s.color }} />
                <em>{s.label}</em>
              </span>
            ))}
          </div>
          {/* Die Maske ist die ABDECKUNGSGRENZE und braucht diesen Satz: ohne
              ihn liest man das Grau als „kein Niederschlag". */}
          <span className="radar-legend-nodata" title="Reichweite der deutschen Radare. Gemessen 2026-09-16: die Maske beginnt je nach Breite zwischen 13,2 °O (47 °N) und 14,4 °O (49 °N) — Vorarlberg, Tirol und das Land Salzburg sind erfasst, Linz, Wien, Graz und Klagenfurt nicht.">
            <i style={{ background: RADAR_LEGEND[0].color, opacity: RADAR_LEGEND[0].opacity }} />
            keine Radardaten — die Abdeckung endet im Osten Österreichs
          </span>
        </div>
      </div>

      <span className="attribution radar-attribution">
        Datenquelle:{' '}
        <a
          href="https://www.dwd.de/DE/leistungen/opendata/opendata.html"
          target="_blank"
          rel="noreferrer"
          title="Deutsches Radarkomposit RV: Analyse und 2-Stunden-Nowcast, 1 km, alle 5 Minuten — als fertig eingefärbte Karte über den WMS von maps.dwd.de"
        >
          Deutscher Wetterdienst
        </a>
        {' '}— Radarkomposit RV über{' '}
        <a href="https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetCapabilities" target="_blank" rel="noreferrer">
          maps.dwd.de
        </a>
        , Nutzung nach{' '}
        <a
          href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html"
          target="_blank"
          rel="noreferrer"
        >
          GeoNutzV
        </a>
        . Zeiten in UTC.
      </span>
    </div>
  )
}
