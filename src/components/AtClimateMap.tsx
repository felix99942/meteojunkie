// Statische Österreich-Klimakarte (Schritt 2): Canvas mit Landesgrenzen und
// allen Stationen als Punkte, Hover-Tooltip mit Name/Höhe. Noch ohne Werte —
// die Einfärbung nach gewähltem Parameter kommt in Schritt 3.
//
// Basiskarte (Natural-Earth-Linien, auf die AT-Domain zugeschnitten) wird als
// URL-Asset geladen statt in den JS-Bundle gezogen — wie in MapPanel.

import { useEffect, useRef, useState } from 'react'
import austriaBasemapUrl from '../mapdata/austria.basemap.json?url'
import {
  AT_VIEW,
  drawBorderLines,
  drawStationLabels,
  drawStationPoints,
  makeMapGeometry,
  nearestStation,
  type MapGeometry,
  type MapStation,
} from '../render/atmap'

interface BorderFeature {
  geometry: { type: string; coordinates: number[][] }
}
interface Basemap {
  coast?: { features: BorderFeature[] }
  borders?: { features: BorderFeature[] }
  admin1?: { features: BorderFeature[] }
}

interface MapView {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

// Basiskarten modulweit cachen: einmal erfolgreich geladen, bleiben sie für die
// ganze Session verfügbar — beim Zurückschalten (z.B. Vorhersage→Klima) sind die
// Grenzen sofort da, kein erneutes Fetch-Fenster. FEHLSCHLÄGE werden NICHT
// gecacht (das war der Bug: ein stilles catch ließ die Grenzen verschwinden),
// sodass der nächste Versuch die Karte erneut lädt.
const basemapCache = new Map<string, Promise<Basemap>>()

function loadBasemap(url: string): Promise<Basemap> {
  let p = basemapCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Basiskarte HTTP ${r.status}`)
        return r.json()
      })
      .catch((err) => {
        basemapCache.delete(url) // Fehler nicht cachen → nächster Mount lädt neu
        throw err
      })
    basemapCache.set(url, p)
  }
  return p
}

/** Wert kompakt formatieren (max. 1 Nachkommastelle). */
const formatValue = (v: number): string =>
  Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)

const COLORS = {
  bg: '#0f1012',
  admin1: 'rgba(150,150,150,0.14)',
  borders: 'rgba(180,180,180,0.45)',
  coast: 'rgba(120,160,200,0.5)',
  pointFill: 'rgba(232,228,220,0.85)',
  pointStroke: 'rgba(30,30,30,0.9)',
  noData: 'rgba(140,135,129,0.5)',
  highlight: '#e8b23a',
}

export function AtClimateMap({
  stations,
  colors,
  values,
  unit,
  onSelect,
  view = AT_VIEW,
  basemapUrl = austriaBasemapUrl,
  labelMinGap = 0,
  highlightIdx = null,
}: {
  stations: MapStation[]
  /** Per-Station-Farben (parallel zu stations); null = kein Wert. */
  colors?: (string | null)[]
  /** Per-Station-Werte (parallel zu stations) — für den Tooltip. */
  values?: (number | null)[]
  unit?: string
  /** Klick auf eine Station → Index in `stations`. */
  onSelect?: (idx: number) => void
  /** Kartenausschnitt (Default Österreich). */
  view?: MapView
  /** URL der Basiskarte (Default Österreich). */
  basemapUrl?: string
  /** Label-Ausdünnung (px) für dichte Netze; 0 = alle Zahlen zeigen. */
  labelMinGap?: number
  /**
   * Von außen hervorgehobene Station (z.B. Hover in der Rangliste). Der eigene
   * Maus-Hover hat Vorrang, und die Markierung setzt sich über die
   * Label-Ausdünnung hinweg — sonst bliebe sie im dichten Netz unsichtbar.
   */
  highlightIdx?: number | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const geomRef = useRef<MapGeometry | null>(null)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [hover, setHover] = useState<{ station: MapStation; idx: number; x: number; y: number } | null>(null)
  const hoverIdxRef = useRef<number>(-1)
  // Zoom/Pan-Transform im Bildschirmraum: screen = basisProjektion·zoom + offset.
  // Als Ref (kein Re-Render pro Rad/Zug); Neuzeichnen über drawRef.
  const tfRef = useRef({ zoom: 1, ox: 0, oy: 0 })
  const drawRef = useRef<() => void>(() => {})
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  // Basiskarte laden (aus dem Modul-Cache, bei Wechsel der URL neu).
  useEffect(() => {
    let cancelled = false
    let retried = false
    const attempt = () => {
      loadBasemap(basemapUrl)
        .then((d) => {
          if (!cancelled) setBasemap(d)
        })
        .catch(() => {
          // einmal automatisch nachfassen (transienter Fehler) statt still stumm zu bleiben
          if (!cancelled && !retried) {
            retried = true
            setTimeout(attempt, 600)
          }
        })
    }
    attempt()
    return () => {
      cancelled = true
    }
  }, [basemapUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 10 || h < 10) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, w, h)

      const base = makeMapGeometry(6, 6, w - 12, h - 12, view)
      // Zoom/Pan auf die Basisgeometrie falten → project() liefert direkt den
      // Bildschirmpunkt (Text bleibt dabei konstant groß, nur Positionen skalieren).
      const { zoom, ox, oy } = tfRef.current
      const g = { ...base, left: base.left * zoom + ox, top: base.top * zoom + oy, scale: base.scale * zoom }
      geomRef.current = g

      if (basemap) {
        if (basemap.admin1) drawBorderLines(ctx, g, basemap.admin1.features, COLORS.admin1, 1)
        if (basemap.coast) drawBorderLines(ctx, g, basemap.coast.features, COLORS.coast, 1)
        if (basemap.borders) drawBorderLines(ctx, g, basemap.borders.features, COLORS.borders, 1.2)
      }
      // Punkte bei dichten Netzen (DACH) kleiner, damit die Karte nicht zuläuft.
      const pointR = labelMinGap > 0 ? 3 : 5
      const hi = hoverIdxRef.current >= 0 ? hoverIdxRef.current : (highlightIdx ?? -1)
      drawStationPoints(ctx, g, stations, {
        radius: pointR,
        fill: COLORS.pointFill,
        stroke: COLORS.pointStroke,
        highlightIdx: hi,
        highlightFill: COLORS.highlight,
        colors,
        noDataFill: COLORS.noData,
      })
      // Werte direkt in die Karte schreiben (ersetzt die Legende), in der Wertfarbe.
      if (values) drawStationLabels(ctx, g, stations, values, formatValue, colors, hi, labelMinGap)
    }

    drawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [basemap, stations, colors, values, hover, view, labelMinGap, highlightIdx])

  // Zoom per Mausrad (um den Cursor). Nativer Listener mit passive:false, damit
  // preventDefault das Seiten-Scrollen zuverlässig unterbindet.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const { zoom, ox, oy } = tfRef.current
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
      let nz = Math.min(20, Math.max(1, zoom * factor))
      if (nz <= 1.0001) {
        tfRef.current = { zoom: 1, ox: 0, oy: 0 } // ganz raus = wieder eingepasst
      } else {
        // Geo-Punkt unter der Maus fixieren: noffset = m − (m − offset)/zoom · nz
        tfRef.current = {
          zoom: nz,
          ox: mx - ((mx - ox) / zoom) * nz,
          oy: my - ((my - oy) / zoom) * nz,
        }
      }
      drawRef.current()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, moved: false }
  }

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geomRef.current
    const canvas = canvasRef.current
    if (!g || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // Ziehen → Karte verschieben (Pan).
    if (dragRef.current) {
      const dx = px - dragRef.current.x
      const dy = py - dragRef.current.y
      if (Math.abs(dx) + Math.abs(dy) > 2) dragRef.current.moved = true
      dragRef.current.x = px
      dragRef.current.y = py
      tfRef.current = { ...tfRef.current, ox: tfRef.current.ox + dx, oy: tfRef.current.oy + dy }
      if (hoverIdxRef.current !== -1) {
        hoverIdxRef.current = -1
        setHover(null)
      }
      drawRef.current()
      return
    }
    const idx = nearestStation(g, stations, px, py, 10)
    hoverIdxRef.current = idx
    setHover(idx >= 0 ? { station: stations[idx], idx, x: px, y: py } : null)
  }

  const onUp = () => {
    dragRef.current = null
  }

  const onLeave = () => {
    dragRef.current = null
    hoverIdxRef.current = -1
    setHover(null)
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geomRef.current
    const canvas = canvasRef.current
    if (!g || !canvas || !onSelect) return
    if (dragRef.current?.moved) return // war ein Pan, keine Auswahl
    const rect = canvas.getBoundingClientRect()
    const idx = nearestStation(g, stations, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (idx >= 0) onSelect(idx)
  }

  const onDoubleClick = () => {
    tfRef.current = { zoom: 1, ox: 0, oy: 0 } // zurück auf eingepassten Ausschnitt
    drawRef.current()
  }

  return (
    <div ref={containerRef} className="atmap">
      <canvas
        ref={canvasRef}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />
      {hover && (
        <div
          className="atmap-tooltip"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <strong>{hover.station.name}</strong>
          {values && values[hover.idx] != null && (
            <span className="atmap-tt-value">
              {' '}
              {formatValue(values[hover.idx] as number)}
              {unit ? ` ${unit}` : ''}
            </span>
          )}
          {hover.station.altitude != null && <span> · {Math.round(hover.station.altitude)} m</span>}
          {hover.station.state && <span className="atmap-tt-state"> · {hover.station.state}</span>}
        </div>
      )}
      <span className="atmap-help">Rad = Zoom · Ziehen = Verschieben · Doppelklick = Reset</span>
    </div>
  )
}
