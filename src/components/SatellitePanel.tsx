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
import { fetchSatelliteExtent, loadSatelliteImage } from '../api/eumetsat'
import { CITIES } from '../config/cities'
import {
  DEFAULT_SATELLITE_PRODUCT,
  HI_MAX,
  LOOP_SPAN_MS,
  SAT_CONCURRENCY,
  SATELLITE_AREA,
  SATELLITE_CENTER,
  SATELLITE_GROUPS,
  getSatelliteProduct,
  hiEvictions,
  loadPlan,
  productArea,
  resamplingSwitchZoom,
  retryAt,
  satelliteImageCoordinates,
  satelliteTimes,
  type ImageTier,
  type SatelliteProduct,
} from '../config/satellite'
import { nearestFrame, type TimeExtent } from '../config/wmsTime'
import { hasDaylight, solarElevationDeg } from '../lib/solar'
import {
  BASE_STYLE,
  buildGraticuleBox,
  EMPTY_FC,
  loadBasemap,
  OVERLAY_INSERT_BEFORE,
} from '../render/basemap'
import { GroundAttribution } from './Attribution'

const SAT_SOURCE_ID = 'satellite'
const SAT_LAYER_ID = 'satellite'

interface View {
  id: string
  label: string
  bounds: [[number, number], [number, number]]
}

/**
 * Ansichten, auf die man beim Satelliten wirklich springt. Die beiden festen
 * liegen in JEDER Produktfläche (ein Test hält das fest) — „ganzer Ausschnitt"
 * dagegen meint das BILD und wechselt deshalb mit dem Produkt: die beiden
 * HRFI-Kanäle zeigen die engere Fläche (`SATELLITE_DETAIL_AREA`), und auf die
 * Vollfläche zu springen hieße, auf leere Ränder zu zoomen.
 */
const FIXED_VIEWS: View[] = [
  { id: 'dach', label: 'D-A-CH', bounds: [[5.4, 45.8], [17.4, 55.3]] },
  { id: 'alpen', label: 'Alpen', bounds: [[5.8, 44.8], [17.2, 49.3]] },
]

function viewsFor(product: SatelliteProduct): View[] {
  const area = productArea(product)
  return [
    ...FIXED_VIEWS,
    {
      id: 'gesamt',
      label: 'ganzer Ausschnitt',
      bounds: [
        [area.west, area.south],
        [area.east, area.north],
      ],
    },
  ]
}

/**
 * Die Ziehleiste umfasst IMMER 24 Stunden — keine Auswahl davor. Eine
 * Wetterlage liest man über einen Tag, nicht über zwei Stunden, und jede
 * Auswahl davor ist ein Handgriff, bevor man etwas sieht.
 *
 * Das geht nur mit ZWEI STUFEN (siehe `loadPlan`): der ganze Tag als
 * Vorschau (~160 KB je Bild) und das scharfe Bild (~530 KB) nur dort, wo man
 * hinsieht. Scharf für den ganzen Tag wären 77 MB je Produkt.
 */
const HISTORY_MS = 24 * 3_600_000

// Die SCHLEIFE kreist über `LOOP_SPAN_MS` (3 h, in `config/satellite.ts`,
// weil `loadPlan` sie kennen muss). Bewusst kürzer als die Ziehleiste: wer
// weiter zurück will, zieht dorthin — die Schleife spielt von dort vorwärts,
// bevor sie sich in diesen Abschnitt einpendelt.

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

/** Ein Zeitschritt in bis zu zwei Stufen (siehe `loadPlan`). */
interface Frame {
  lo?: string
  hi?: string
}

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
  const views = useMemo(() => viewsFor(product), [product])

  const [extent, setExtent] = useState<TimeExtent | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Neuerer Stand, den der Nutzer noch nicht sehen wollte (er sieht Älteres an). */
  const [pending, setPending] = useState<TimeExtent | null>(null)

  /**
   * Blob-URLs über ihren ZEITSTEMPEL (siehe Kopfkommentar), je Zeitschritt
   * bis zu zwei: Vorschau und scharf. Angezeigt wird das schärfste, das da ist.
   */
  const [images, setImages] = useState<Record<number, Frame>>({})
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
  const currentUrl = current ? (images[current]?.hi ?? images[current]?.lo) : undefined
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
  /** Laufende Abrufe (Schlüssel `tier|time`) — nur ein Produktwechsel bricht sie ab. */
  const inFlightRef = useRef<Map<string, AbortController>>(new Map())
  /** Was schon da ist, SYNCHRON geführt (der State kommt erst mit dem nächsten Render). */
  const haveRef = useRef<Set<string>>(new Set())
  /** Fehlschläge je Schlüssel: Anzahl und frühester nächster Versuch. */
  const failsRef = useRef<Map<string, { n: number; at: number }>>(new Map())
  const dropImages = useCallback(() => {
    for (const ac of inFlightRef.current.values()) ac.abort()
    inFlightRef.current = new Map()
    haveRef.current = new Set()
    failsRef.current = new Map()
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current = []
    setImages({})
    setFailed(0)
  }, [])

  // Produktwechsel verwirft alles: zwei Darstellungen dürfen nie in einer
  // Schleife stehen.
  //
  // **Erst die Ebene von der Karte nehmen, DANN die Blob-URLs freigeben.**
  // In der anderen Reihenfolge zeigt die image-Source für einen Moment auf
  // einen Blob, den es nicht mehr gibt.
  //
  // ACHTUNG, das behebt NICHT die `ERR_FILE_NOT_FOUND`/`AJAXError`-Meldungen
  // auf blob-URLs, die beim schnellen Durchschalten in der Konsole stehen —
  // gegengeprüft (2026-09-29): sie treten mit den ursprünglichen fünf
  // Produkten genauso auf, die Ursache liegt woanders (vermutlich ein Rennen
  // zwischen `updateImage` und der Verdrängung, MapLibre fordert das Bild
  // asynchron nach). Die Anzeige bleibt dabei richtig. Diese Reihenfolge ist
  // trotzdem die richtige und bleibt.
  useEffect(() => {
    const map = mapRef.current
    if (map) {
      if (map.getLayer(SAT_LAYER_ID)) map.removeLayer(SAT_LAYER_ID)
      if (map.getSource(SAT_SOURCE_ID)) map.removeSource(SAT_SOURCE_ID)
    }
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

  /**
   * WARTESCHLANGE statt Ladefenster mit Abbruch.
   *
   * Vorher hing das Laden an einem Effekt über den Zeiger, dessen Aufräumen
   * `abort()` rief: jedes Weiterziehen verwarf alle halbfertigen Bilder — bei
   * 1–3 s Renderzeit des Dienstes je Bild kam beim Durchziehen fast nichts
   * an, und 24 Stunden bekam man nie zusammen. Jetzt ORDNET eine Bewegung nur
   * neu (`loadPlan`), was als Nächstes geholt wird; was läuft, läuft zu Ende.
   * Abgebrochen wird allein beim Produktwechsel (`dropImages`).
   *
   * Gescheiterte Abrufe werden nach 10 s und 60 s erneut versucht
   * (`retryAt`) — EUMETView antwortet unter Last sporadisch mit HTTP 500/502,
   * und die frühere Regel „einmal gescheitert, für die Sitzung gemerkt" liess
   * diese Stellen als dauerhafte Lücken stehen. Danach bleibt es dabei, sonst
   * liefe eine Dauerschleife gegen einen fremden Dienst.
   */
  const plan = useMemo(
    () => loadPlan(times, settledIdx < 0 ? -1 : settledIdx, playing),
    [times, settledIdx, playing],
  )
  const planRef = useRef(plan)
  planRef.current = plan
  const productRef = useRef(product)
  productRef.current = product
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pump = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    const now = Date.now()
    let nextRetry = Infinity
    for (const job of planRef.current) {
      if (inFlightRef.current.size >= SAT_CONCURRENCY) break
      const key = `${job.tier}|${job.time}`
      if (haveRef.current.has(key) || inFlightRef.current.has(key)) continue
      const fail = failsRef.current.get(key)
      if (fail && fail.at > now) {
        nextRetry = Math.min(nextRetry, fail.at)
        continue
      }
      startJob(job.time, job.tier, key)
    }
    if (Number.isFinite(nextRetry)) {
      retryTimerRef.current = setTimeout(() => pumpRef.current(), nextRetry - now + 50)
    }
    // Bewusst ohne Abhängigkeiten: `startJob` liest nur Refs, und ein
    // stabiles `pump` hält den Effekt unten auf „Plan hat sich geändert".
  }, [])
  const pumpRef = useRef(pump)

  const startJob = (time: number, tier: ImageTier, key: string) => {
    const p = productRef.current
    const ac = new AbortController()
    inFlightRef.current.set(key, ac)
    loadSatelliteImage(p, time, tier, ac.signal)
      .then((url) => {
        if (ac.signal.aborted || productRef.current !== p) {
          URL.revokeObjectURL(url)
          return
        }
        urlsRef.current.push(url)
        haveRef.current.add(key)
        failsRef.current.delete(key)
        setImages((prev) => ({ ...prev, [time]: { ...prev[time], [tier]: url } }))
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return
        const n = (failsRef.current.get(key)?.n ?? 0) + 1
        const at = retryAt(n, Date.now())
        failsRef.current.set(key, { n, at })
        console.error('[satellit]', tier, new Date(time).toISOString(), err)
        if (!Number.isFinite(at)) setFailed((f) => f + 1)
      })
      .finally(() => {
        if (inFlightRef.current.get(key) !== ac) return
        inFlightRef.current.delete(key)
        pumpRef.current()
      })
  }

  // Neuer Plan (Zeiger, Schleife, neuer Stand) → Reihenfolge neu, nichts abbrechen.
  useEffect(() => {
    if (!extent) return
    pump()
  }, [plan, extent, pump])
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    },
    [],
  )

  /**
   * VERDRÄNGUNG nur der SCHARFEN Bilder (Vorschauen bleiben für den ganzen
   * Tag). Nie eines, das der Plan gerade will — sonst Laden und Wegwerfen im
   * Kreis; die Regel und ihr Test stehen in `hiEvictions`. Freigegebene
   * scharfe Bilder kommen beim nächsten Mal aus dem HTTP-Cache (7 Tage).
   */
  useEffect(() => {
    const hiTimes = Object.keys(images)
      .map(Number)
      .filter((t) => images[t]?.hi)
    const drop = hiEvictions(hiTimes, plan, current ?? times[times.length - 1] ?? 0)
    if (drop.length === 0) return
    for (const t of drop) {
      const dead = images[t]?.hi
      haveRef.current.delete(`hi|${t}`)
      if (!dead) continue
      URL.revokeObjectURL(dead)
      urlsRef.current = urlsRef.current.filter((u) => u !== dead)
    }
    setImages((prev) => {
      const next = { ...prev }
      for (const t of drop) next[t] = { lo: prev[t]?.lo }
      return next
    })
  }, [images, plan, current, times])

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

  const loadedLo = times.filter((t) => images[t]?.lo || images[t]?.hi).length
  const loadedHi = times.filter((t) => images[t]?.hi).length

  /**
   * TAGESLICHT über der Fläche. Der sichtbare Kanal misst reflektiertes
   * Sonnenlicht — nachts ist sein Bild schwarz, und zwar zu Recht. Ohne diese
   * Rechnung sieht das aus wie ein Fehler (so wurde es auch gemeldet): die
   * Karte zeigt nur noch Grenzlinien, und niemand kommt darauf, dass das Bild
   * in Ordnung ist. Jetzt sagt der Bereich es und bietet den Sprung zum
   * letzten Tageslicht an.
   */
  const daylight = useMemo(
    () => times.map((t) => hasDaylight(t, SATELLITE_CENTER.lat, SATELLITE_CENTER.lon)),
    [times],
  )
  const darkNow = product.dayOnly && current != null && daylight[Math.min(idx, times.length - 1)] === false
  const lastDaylightIdx = useMemo(() => daylight.lastIndexOf(true), [daylight])
  /** Wie tief die Sonne gerade steht — die Zahl macht aus „schwarz" eine Aussage. */
  const solarDepth = current == null ? 0 : solarElevationDeg(current, SATELLITE_CENTER.lat, SATELLITE_CENTER.lon)

  // --- Schleife -------------------------------------------------------------
  useEffect(() => {
    if (!playing || times.length === 0) return
    const atEnd = idx >= times.length - 1
    // Zurück an den Anfang des SCHLEIFENabschnitts, nicht an den Anfang der
    // Ziehleiste (siehe LOOP_SPAN_MS).
    const loopStart = nearestFrame(times, times[times.length - 1] - LOOP_SPAN_MS)
    const nextIdx = atEnd ? loopStart : idx + 1
    const next = images[times[nextIdx]]
    const ready = next?.lo !== undefined || next?.hi !== undefined
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
      bounds: FIXED_VIEWS[0].bounds,
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
    // KEIN Untergrund neben dem Satellitenbild — auf Wunsch, seit 2026-09-30.
    // Bis dahin lag hier das Blue-Marble-Bild als Kartenhintergrund, weil das
    // Satellitenbild damals nur Mitteleuropa abdeckte und in einer leeren
    // Fläche zu schweben schien. Seit es GANZ EUROPA zeigt, ist der Rand
    // schmal, und ausserhalb der Satellitenfläche soll nichts stehen, was man
    // für Bildinhalt halten könnte — dort ist schlicht nichts gemessen.
    // Das Bild selbst gibt es weiter: als Untergrund UNTER den Wolken IM
    // Komposit (`render/cloudComposite.ts`, `config/ground.ts`).
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
    // Die Ecken hängen am PRODUKT — ein Wechsel zwischen den beiden Flächen
    // muss sie mit umsetzen, sonst spannt die Karte das neue Bild über die
    // alte Fläche und alles liegt verschoben.
    const coordinates = satelliteImageCoordinates(product)
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
          paint: {
            'raster-opacity': 1,
            'raster-fade-duration': 0,
            // GESTUFT STATT WEICHGEZEICHNET, sobald vergrössert wird: das
            // Bild ist im nativen Raster des Produkts angefordert (siehe
            // `config/satellite.ts`), mehr Bildinhalt gibt es nicht — jede
            // weitere Vergrösserung ist Erfindung. Bilinear macht daraus
            // Matsch, nearest zeigt die Messpixel; genau der Unterschied, den
            // man gegen sat24 & Co. sieht. Unterhalb der Grenze bleibt es bei
            // linear, sonst flimmert das stark verkleinerte Bild beim
            // Verschieben (Grenze und Begründung: `resamplingSwitchZoom`).
            // Der Geräte-Pixelfaktor steckt in der Grenze und wird beim
            // Anlegen der Ebene gelesen; zieht jemand das Fenster auf einen
            // Schirm mit anderer Dichte, stimmt sie bis zum nächsten
            // Produktwechsel eine Zoomstufe daneben — das ist der Preis
            // dafür, ihn nicht bei jedem Frame nachzufragen.
            'raster-resampling': [
              'step',
              ['zoom'],
              'linear',
              resamplingSwitchZoom(product, window.devicePixelRatio || 1),
              'nearest',
            ],
          },
        },
        OVERLAY_INSERT_BEFORE,
      )
    }
  }, [currentUrl, product, mapReady])

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
          {/* Nach Satellit gruppiert: bei fünfzehn Einträgen ist eine flache
              Liste eine Liste, die man jedes Mal neu liest. Die Mission steht
              damit in der Gruppenüberschrift und nicht mehr an jedem Eintrag. */}
          {SATELLITE_GROUPS.map((g) => (
            <optgroup key={g.mission} label={g.label}>
              {g.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.dayOnly ? ' (Tag)' : ''}
                </option>
              ))}
            </optgroup>
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
                className={`radar-tick${images[t]?.lo || images[t]?.hi ? ' is-loaded' : ''}${
                  i === idx ? ' is-current' : ''
                }${product.dayOnly && !daylight[i] ? ' is-night' : ''}`}
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
              : `MTG liefert alle 10 Minuten, MSG alle 15; das fertige Bild steht unter 10 Minuten nach der Aufnahme bereit (gemessen). Der Bereich fragt jede Minute nach und rückt selbst nach, solange der Zeiger auf dem neuesten Bild steht.\n\nGeladen wird in zwei Stufen: der ganze Tag als Vorschau (Übersicht), scharf nur das Bild unter dem Zeiger, seine Nachbarn und die Schleife der letzten 3 Stunden — höchstens ${HI_MAX} scharfe Bilder gleichzeitig. Scharf heisst hier: in voller Auflösung, nicht verlustfrei. Gescheiterte Bilder werden nach 10 s und 60 s erneut versucht.${
                  failed ? `\n\n${failed} Bild(er) konnten auch nach zwei Versuchen nicht geladen werden.` : ''
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
              <span className="radar-num">{loadedLo}</span> Übersicht ·{' '}
              <span className="radar-num">{loadedHi}</span> scharf · Stand {stand}
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
        {/* Nacht ist kein Fehler, sieht aber wie einer aus — deshalb steht es
            MITTEN im Bild und nicht klein in der Legende. */}
        {darkNow && (
          <div className="satellite-night">
            <strong>Nacht über dem Gebiet</strong>
            <span>
              {product.label} misst reflektiertes Sonnenlicht — um{' '}
              {fmtTime.format(new Date(current))} UTC steht die Sonne hier{' '}
              {Math.round(-solarDepth)}° unter dem Horizont, das Bild ist deshalb schwarz.
            </span>
            <span className="satellite-night-actions">
              {lastDaylightIdx >= 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false)
                    setIdx(lastDaylightIdx)
                  }}
                >
                  ↦ letztes Tageslicht ({fmtTime.format(new Date(times[lastDaylightIdx]))} UTC)
                </button>
              )}
              <button type="button" onClick={() => setProductId(DEFAULT_SATELLITE_PRODUCT.id)}>
                ↦ Geocolour (zeigt die Nacht)
              </button>
            </span>
          </div>
        )}
        <div className="radar-views">
          {views.map((v) => (
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
        {/* Das geschärfte Produkt stammt aus ZWEI Satelliten — Farbe von
            MSG, Struktur von MTG. Beide gehören EUMETSAT, die Lizenz ist
            also so oder so erfüllt; genannt gehören sie trotzdem, sonst
            steht unter einem Bild aus zwei Quellen nur eine. */}
        — {product.sharpen
          ? 'Meteosat Second Generation (SEVIRI, Farbe) und Third Generation (FCI, Schärfe)'
          : product.mission === 'MTG'
            ? 'Meteosat Third Generation (FCI)'
            : 'Meteosat Second Generation (SEVIRI)'} über{' '}
        <a
          href="https://view.eumetsat.int/productviewer"
          target="_blank"
          rel="noreferrer"
        >
          EUMETView
        </a>
        . Kartenlinien: Natural Earth.{' '}
        {/* Der Untergrund liegt seit 2026-09-30 nur noch UNTER den Wolken im
            Komposit, also bei den beiden Graustufen-Kanälen — genannt wird er
            deshalb auch nur dort. Attribution ist Lizenzbedingung, aber eine
            Nennung für ein Bild, das gar nicht gezeigt wird, ist keine
            Auskunft, sondern Rauschen. */}
        {product.cloudMask && <GroundAttribution />}
      </span>
    </div>
  )
}
