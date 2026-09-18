// Satellitenbilder (AppView `satellite`) — eigener Bereich, dasselbe schlanke
// Gerüst wie das Radar.
//
// Woher die Bilder kommen, welche Fläche gezeigt wird und warum genau diese
// vier Produkte, steht in `config/satellite.ts`; der Abruf in
// `api/eumetsat.ts`. Hier ist nur die Bedienung: Karte, Zeitschieber über die
// 10- bzw. 15-Minuten-Bilder, Schleife.
//
// GETEILT MIT DEM RADAR ist die ganze Zeit- und Bildmechanik
// (`config/wmsTime.ts`: Dimension parsen, Zeitraster bilden, Mercator-Fläche,
// Bildecken) — zwei Bereiche, ein Kern. Verschieden sind nur drei Dinge, und
// jedes davon aus einem Grund:
//
//   1. Die FLÄCHE gibt hier die Seite vor, nicht der Dienst: ein
//      Satellitenlayer meldet die ganze sichtbare Halbkugel.
//   2. Kein Canvas: am Satellitenbild ist nichts zu korrigieren, die Bilder
//      kommen als Blob-URL auf die Karte (und werden wieder freigegeben).
//   3. Kein Vorhersageteil am Ende der Zeitdimension — gezeigt wird ohnehin
//      nur Gemessenes.
//
// **DER BEREICH RÜCKT VON SELBST NACH**, wie das Radar: jede Minute wird die
// Zeitdimension nachgefragt; steht der Zeiger auf dem neuesten Bild (oder
// läuft die Schleife), wird der neue Stand sofort übernommen — das kostet
// genau ein Bild, weil die übrigen über ihre ZEIT weiter gültig sind. Deshalb
// liegen die Bilder in einer Map über den Zeitstempel und nicht in einem Array
// über den Index. Wer ein älteres Bild ansieht, wird nicht weggerissen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchSatelliteExtent, loadSatelliteImages } from '../api/eumetsat'
import { CITIES } from '../config/cities'
import {
  DEFAULT_SATELLITE_PRODUCT,
  MAX_CACHED,
  SATELLITE_AREA,
  SATELLITE_PRODUCTS,
  getSatelliteProduct,
  productImageWidth,
  satelliteImageCoordinates,
  satelliteImageHeight,
  satelliteTimes,
  wantedTimes,
} from '../config/satellite'
import { nearestFrame, type TimeExtent } from '../config/wmsTime'
import {
  BASE_STYLE,
  buildGraticuleBox,
  EMPTY_FC,
  loadBasemap,
  OVERLAY_INSERT_BEFORE,
} from '../render/basemap'

const SAT_SOURCE_ID = 'satellite'
const SAT_LAYER_ID = 'satellite'

/** Ansichten, auf die man beim Satelliten wirklich springt. */
const VIEWS: { id: string; label: string; bounds: [[number, number], [number, number]] }[] = [
  { id: 'dach', label: 'D-A-CH', bounds: [[5.4, 45.8], [17.4, 55.3]] },
  { id: 'alpen', label: 'Alpen', bounds: [[5.8, 44.8], [17.2, 49.3]] },
  {
    id: 'gesamt',
    label: 'ganzer Ausschnitt',
    bounds: [
      [SATELLITE_AREA.west, SATELLITE_AREA.south],
      [SATELLITE_AREA.east, SATELLITE_AREA.north],
    ],
  },
]

/**
 * Die Ziehleiste umfasst IMMER 24 Stunden — keine Auswahl davor. Eine
 * Wetterlage liest man über einen Tag, nicht über zwei Stunden, und jede
 * Auswahl davor ist ein Handgriff, bevor man etwas sieht.
 *
 * Das geht aber nur mit einer anderen Ladestrategie: 24 h sind bei MTG
 * 145 Bilder à ~180 KB, also 26 MB — die kann man nicht vorladen. Geholt wird
 * deshalb NUR, was gebraucht wird (siehe `wantedTimes`): der neueste Stand,
 * die jüngste Vergangenheit und ein Fenster um den Zeiger. Der Rest kommt,
 * wenn man hinzieht oder die Schleife dorthin läuft.
 */
const HISTORY_MS = 24 * 3_600_000

/**
 * Zeitraum, in dem die SCHLEIFE kreist, nachdem sie am neuesten Bild
 * angekommen ist. Bewusst kürzer als die Ziehleiste: ein Tag im Zeitraffer
 * wären 145 Abrufe bei einem fremden Dienst, bei jedem Durchlauf. Wer weiter
 * zurück will, zieht dorthin — und die Schleife spielt von dort aus vorwärts,
 * bevor sie sich in diesen Abschnitt einpendelt.
 */
const LOOP_SPAN_MS = 3 * 3_600_000

/** Bildwechsel der Schleife und Standzeit am letzten (neuesten) Bild. */
const FRAME_MS = 320
const END_DWELL_MS = 1400
/** Wartezeit, wenn das nächste Bild noch nicht geladen ist. */
const WAIT_MS = 250
/** Ruhe am Zeiger, bevor nachgeladen wird (siehe `settledIdx`). */
const SETTLE_MS = 220
/** Takt, in dem die Zeitdimension nachgefragt wird (Quelle: 10 bzw. 15 min). */
const POLL_MS = 60_000

const fmtClock = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const fmtTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
})

function frameLabel(time: number, latest: number): string {
  const clock = `${fmtClock.format(new Date(time))} UTC`
  const offMin = Math.round((latest - time) / 60_000)
  if (offMin <= 0) return `${clock} · neuester Stand`
  const rel =
    offMin >= 60
      ? `${Math.floor(offMin / 60)} h ${String(offMin % 60).padStart(2, '0')} min`
      : `${offMin} min`
  return `${clock} · −${rel}`
}

export function SatellitePanel() {
  const [productId, setProductId] = useState(DEFAULT_SATELLITE_PRODUCT.id)
  const product = getSatelliteProduct(productId)

  const [extent, setExtent] = useState<TimeExtent | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Neuerer Stand, den der Nutzer noch nicht sehen wollte (er sieht Älteres an). */
  const [pending, setPending] = useState<TimeExtent | null>(null)

  /** Blob-URLs über ihren ZEITSTEMPEL (siehe Kopfkommentar). */
  const [images, setImages] = useState<Record<number, string>>({})
  const [failed, setFailed] = useState(0)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [waitTick, setWaitTick] = useState(0)

  const times = useMemo(
    () => (extent ? satelliteTimes(extent, HISTORY_MS) : []),
    [extent],
  )
  const latest = times.length ? times[times.length - 1] : 0
  const current = times[Math.min(idx, times.length - 1)]
  const currentUrl = current ? images[current] : undefined
  /** Steht der Zeiger auf dem neuesten Bild? Dann darf automatisch nachgerückt werden. */
  const atLiveEdge = times.length === 0 || idx >= times.length - 1

  // --- Zeitdimension --------------------------------------------------------
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    fetchSatelliteExtent(product, { signal: ac.signal })
      .then((e) => {
        if (!alive) return
        setExtent(e)
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

  const followRef = useRef(true)
  followRef.current = atLiveEdge || playing
  useEffect(() => {
    if (!extent) return
    const id = setInterval(() => {
      fetchSatelliteExtent(product, { force: true })
        .then((e) => {
          if (e.end <= extent.end) return
          if (followRef.current) setExtent(e)
          else setPending(e)
        })
        .catch(() => {
          /* Aussetzer beim Nachsehen ist kein Fehlerzustand des Bereichs */
        })
    }, POLL_MS)
    return () => clearInterval(id)
  }, [extent, product])

  // --- Bilder ---------------------------------------------------------------
  //
  // Blob-URLs müssen freigegeben werden, sonst hält jeder Produktwechsel seine
  // alte Schleife im Speicher fest (13 Bilder à bis zu 210 KB). Der Ref führt die
  // Liste mit, weil das Aufräumen außerhalb des Renderzyklus passiert.
  const urlsRef = useRef<string[]>([])
  const dropImages = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current = []
    setImages({})
    setFailed(0)
  }, [])

  // Produktwechsel verwirft alles: zwei Darstellungen dürfen nie in einer
  // Schleife stehen.
  useEffect(() => {
    dropImages()
  }, [product, dropImages])
  useEffect(() => dropImages, [dropImages])

  /**
   * Beim ZIEHEN läuft der Zeiger über Dutzende Stellungen. Ohne Bremse würde
   * jede davon ihr eigenes Ladefenster anfordern und das vorherige abbrechen —
   * eine Salve halbfertiger Abrufe bei einem fremden Dienst, und die Anzeige
   * flackert zwischen „lädt" und „da". Geladen wird deshalb erst, wenn der
   * Zeiger kurz steht; beim Abspielen sofort, dort ist jede Stellung gewollt.
   */
  const [settledIdx, setSettledIdx] = useState(-1)
  useEffect(() => {
    if (playing) {
      setSettledIdx(idx)
      return
    }
    const t = setTimeout(() => setSettledIdx(idx), SETTLE_MS)
    return () => clearTimeout(t)
  }, [idx, playing])

  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => {
    if (!extent || times.length === 0) return
    const wanted = wantedTimes(times, settledIdx < 0 ? -1 : Math.min(settledIdx, times.length - 1), playing)
    const missing = wanted.filter((t) => imagesRef.current[t] === undefined)
    if (missing.length === 0) return
    const ac = new AbortController()
    // Breite kommt vom PRODUKT: der hochaufgelöste sichtbare Kanal fordert
    // mehr an als die übrigen, sonst läge sein Vorteil unter dem Zielraster.
    const width = productImageWidth(product)
    loadSatelliteImages(product, missing, {
      width,
      height: satelliteImageHeight(width),
      signal: ac.signal,
      onLoaded: (time, url) => {
        urlsRef.current.push(url)
        setImages((prev) => {
          const next = { ...prev, [time]: url }
          // Verdrängung: das am weitesten vom Zeiger entfernte Bild fliegt
          // zuerst, der neueste Stand bleibt immer. Freigegeben wird die
          // Blob-URL sofort — sonst hält der Browser sie bis zum Neuladen.
          const keys = Object.keys(next).map(Number)
          if (keys.length > MAX_CACHED) {
            const cursor = times[Math.max(0, Math.min(settledIdx, times.length - 1))] ?? time
            const newest = times[times.length - 1]
            keys
              .filter((t) => t !== newest)
              .sort((a, b) => Math.abs(b - cursor) - Math.abs(a - cursor))
              .slice(0, keys.length - MAX_CACHED)
              .forEach((t) => {
                const dead = next[t]
                if (dead) URL.revokeObjectURL(dead)
                urlsRef.current = urlsRef.current.filter((u) => u !== dead)
                delete next[t]
              })
          }
          return next
        })
      },
      onError: (time, err) => {
        console.error('[satellit]', new Date(time).toISOString(), err)
        setFailed((n) => n + 1)
      },
    }).catch((err: unknown) => console.error('[satellit]', err))
    return () => ac.abort()
  }, [extent, product, times, settledIdx, playing])

  // Zeiger auf dem neuesten Bild halten, solange er dort war. Beim ersten
  // Laden und nach jedem Nachrücken springt er mit, sonst bleibt seine ZEIT.
  const wantTimeRef = useRef<number | null>(null)
  useEffect(() => {
    if (times.length === 0) return
    const want = followRef.current ? times[times.length - 1] : wantTimeRef.current
    setIdx(want == null ? times.length - 1 : nearestFrame(times, want))
  }, [times])
  useEffect(() => {
    if (current) wantTimeRef.current = current
  }, [current])

  const loaded = times.filter((t) => images[t] !== undefined).length

  // --- Schleife -------------------------------------------------------------
  useEffect(() => {
    if (!playing || times.length === 0) return
    const atEnd = idx >= times.length - 1
    // Zurück an den Anfang des SCHLEIFENabschnitts, nicht an den Anfang der
    // Ziehleiste (siehe LOOP_SPAN_MS).
    const loopStart = nearestFrame(times, times[times.length - 1] - LOOP_SPAN_MS)
    const nextIdx = atEnd ? loopStart : idx + 1
    const ready = images[times[nextIdx]] !== undefined
    const delay = !ready ? WAIT_MS : atEnd ? END_DWELL_MS : FRAME_MS
    const t = setTimeout(() => {
      if (ready) setIdx(nextIdx)
      else setWaitTick((n) => n + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [playing, idx, images, times, waitTick])

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
      // Über ~1,5 km je Pixel hinaus zeigt das Bild keine Details mehr —
      // weiter hineinzoomen darf man, es wird nur weich.
      maxZoom: 10,
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

  // Kartenhintergrund: wie beim Radar aus ZWEI Bündeln — Küsten und
  // Staatsgrenzen aus `europe`, die Bundesländer/Kantone aus `dach`.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ;(map.getSource('graticule') as maplibregl.GeoJSONSource).setData(
      buildGraticuleBox(
        {
          latMin: SATELLITE_AREA.south,
          latMax: SATELLITE_AREA.north,
          lonMin: SATELLITE_AREA.west,
          lonMax: SATELLITE_AREA.east,
        },
        5,
      ),
    )
    let cancelled = false
    loadBasemap('europe')
      .then((bm) => {
        if (cancelled || mapRef.current !== map) return
        ;(map.getSource('coast') as maplibregl.GeoJSONSource).setData(bm.coast ?? EMPTY_FC)
        ;(map.getSource('borders') as maplibregl.GeoJSONSource).setData(bm.borders ?? EMPTY_FC)
      })
      .catch((err: unknown) => console.error('[basemap]', err))
    loadBasemap('dach')
      .then((bm) => {
        if (cancelled || mapRef.current !== map) return
        ;(map.getSource('admin1') as maplibregl.GeoJSONSource).setData(bm.admin1 ?? EMPTY_FC)
      })
      .catch((err: unknown) => console.error('[basemap dach]', err))
    return () => {
      cancelled = true
    }
  }, [mapReady])

  // Städte als DOM-Marker — dieselbe Pseudo-Domain `'imagery'` wie beim Radar
  // (`config/cities.ts`): die Flächen überschneiden sich weitgehend, und ein
  // zweites Städteverzeichnis wäre schlechter als eine geteilte Liste. Ein
  // paar Einträge liegen außerhalb der Radarfläche (Mailand, Venedig, Turin)
  // und tragen nur hier.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const cities = CITIES.filter((c) => c.domains.includes('imagery'))
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
    // Ausdünnung nach ZOOM. Zwei Dinge sind hier anders als in den
    // Panel-Karten: es verschwindet der GANZE Marker (ein Punkt ohne Namen ist
    // über einem Bild nur ein Fleck mehr, kein Hinweis), und die Leiter reicht
    // bis Stufe 5 — beim Hineinzoomen sollen mehr Orte kommen, nicht immer
    // dieselben vierzig. Die Schwellen sind an der Kartenbreite nachgestellt:
    // in der D-A-CH-Übersicht (z ≈ 5) stehen die Großstädte, ab z 7 die
    // Regionalzentren, ab z 8 Alpenorte und Grenzstädte.
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

  // Satellitenbild einhängen bzw. austauschen
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SAT_SOURCE_ID) as maplibregl.ImageSource | undefined
    if (!currentUrl) {
      // Noch kein Bild für diesen Zeitschritt: das VORHERIGE stehen zu lassen
      // wäre eine falsche Zeitangabe — lieber nichts zeigen.
      if (map.getLayer(SAT_LAYER_ID)) map.removeLayer(SAT_LAYER_ID)
      if (source) map.removeSource(SAT_SOURCE_ID)
      return
    }
    const coordinates = satelliteImageCoordinates()
    if (source) {
      source.updateImage({ url: currentUrl, coordinates })
    } else {
      map.addSource(SAT_SOURCE_ID, { type: 'image', url: currentUrl, coordinates })
      map.addLayer(
        {
          id: SAT_LAYER_ID,
          type: 'raster',
          source: SAT_SOURCE_ID,
          // Deckend: das Bild IST die Karte. Grenzen, Gradnetz und Städte
          // liegen darüber (`OVERLAY_INSERT_BEFORE`).
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
        },
        OVERLAY_INSERT_BEFORE,
      )
    }
  }, [currentUrl, mapReady])

  const applyPending = useCallback(() => {
    if (!pending) return
    setExtent(pending)
    setPending(null)
  }, [pending])

  const jumpToView = useCallback((bounds: [[number, number], [number, number]]) => {
    mapRef.current?.fitBounds(bounds, { padding: 8, duration: 400 })
  }, [])

  const stepMin = extent ? Math.round(extent.stepMs / 60_000) : 0
  /**
   * Die Statuszeile hat ein FESTES Skelett, und das ist kein Stil, sondern ein
   * Fehler von vorher: sie wechselte beim Ziehen zwischen „lädt Bild …" und
   * dem langen Text, und weil sie mit dem Schieber in derselben
   * umbruchfähigen Zeile steht, änderte sich dabei dessen Breite — die Leiste
   * zuckte und die Angaben rechts sprangen in die nächste Zeile. Jetzt steht
   * immer derselbe Satz; der Ladezustand ist ein Punkt in einem Platz, der
   * auch dann reserviert bleibt, wenn nichts lädt, und die Zahl der geladenen
   * Bilder sitzt in einem Feld fester Breite.
   */
  const loading = currentUrl === undefined
  const stand = extent ? `${fmtTime.format(new Date(latest))} UTC` : '—'

  return (
    <div className="radar satellite">
      <div className="radar-bar">
        <span className="radar-title">Satellit</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          title={product.note}
        >
          {SATELLITE_PRODUCTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.mission}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="radar-play"
          onClick={() => setPlaying((p) => !p)}
          disabled={times.length === 0}
          title={playing ? 'Schleife anhalten' : 'Schleife abspielen'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="radar-slider">
          <input
            type="range"
            min={0}
            max={Math.max(0, times.length - 1)}
            value={Math.min(idx, Math.max(0, times.length - 1))}
            onChange={(e) => {
              setPlaying(false)
              setIdx(Number(e.target.value))
            }}
            disabled={times.length === 0}
          />
          {/* 145 Marken statt 13: dichter gesetzt, und die aktuelle bekommt
              eine Mindestbreite, sonst ist sie bei ~1 px nicht zu finden. */}
          <div className="radar-ticks is-dense" aria-hidden="true">
            {times.map((t, i) => (
              <span
                key={t}
                className={`radar-tick${images[t] ? ' is-loaded' : ''}${i === idx ? ' is-current' : ''}`}
              />
            ))}
          </div>
        </div>
        <span className="radar-step">{current ? frameLabel(current, latest) : '—'}</span>
        <span
          className={`radar-sub${error ? ' is-error' : ''}`}
          title={
            error
              ? error
              : `MTG liefert alle 10 Minuten, MSG alle 15; das fertige Bild steht unter 10 Minuten nach der Aufnahme bereit (gemessen). Der Bereich fragt jede Minute nach und rückt selbst nach, solange der Zeiger auf dem neuesten Bild steht.\n\nGeladen wird nach Bedarf: die jüngsten Bilder und ein Fenster um den Zeiger, höchstens ${MAX_CACHED} gleichzeitig.${
                  failed ? `\n\n${failed} Bild(er) konnten nicht geladen werden.` : ''
                }`
          }
        >
          {error ? (
            `⚠ ${error}`
          ) : !extent ? (
            'lädt Zeitschritte …'
          ) : (
            <>
              {/* Platz bleibt reserviert, auch wenn nichts lädt — sonst
                  wandert bei jedem Bildwechsel die halbe Leiste. */}
              <span className="radar-load" data-on={loading || failed > 0}>
                {failed > 0 && !loading ? '⚠' : '●'}
              </span>
              24 h · {times.length} Bilder à {stepMin} min ·{' '}
              <span className="radar-num">{loaded}</span> geladen · Stand {stand}
            </>
          )}
        </span>
        {pending && (
          <button
            type="button"
            className="radar-fresh"
            onClick={applyPending}
            title="Der Dienst hat ein neueres Bild. Anzeige nachrücken."
          >
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
        <div className="radar-legend satellite-legend">
          <span className="radar-legend-cap">
            {product.mission}
            {product.dayOnly && <span className="satellite-dayonly"> · nur tagsüber</span>}
          </span>
          <span className="satellite-note">{product.note}</span>
          {/* Ein schwarzes Bild sieht nach einem Fehler aus und ist keiner —
              der sichtbare Kanal misst Sonnenlicht. Das gehört in die
              Legende, nicht in einen Tooltip. */}
          {product.dayOnly && (
            <span className="satellite-note">
              Nachts bleibt das Bild schwarz: dieser Kanal misst reflektiertes Sonnenlicht.
              Für die Nacht taugen Geocolour oder Infrarot.
            </span>
          )}
        </div>
      </div>

      <span className="attribution radar-attribution">
        Datenquelle:{' '}
        <a
          href="https://www.eumetsat.int/"
          target="_blank"
          rel="noreferrer"
          title={product.note}
        >
          EUMETSAT
        </a>{' '}
        — {product.mission === 'MTG' ? 'Meteosat Third Generation (FCI)' : 'Meteosat Second Generation (SEVIRI)'} über{' '}
        <a
          href="https://view.eumetsat.int/productviewer"
          target="_blank"
          rel="noreferrer"
        >
          EUMETView
        </a>
        . Kartenhintergrund: Natural Earth.
      </span>
    </div>
  )
}
