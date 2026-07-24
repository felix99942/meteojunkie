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
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const geomRef = useRef<MapGeometry | null>(null)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [hover, setHover] = useState<{ station: MapStation; idx: number; x: number; y: number } | null>(null)
  const hoverIdxRef = useRef<number>(-1)

  // Basiskarte laden (bei Wechsel der URL neu).
  useEffect(() => {
    let cancelled = false
    setBasemap(null)
    fetch(basemapUrl)
      .then((r) => r.json())
      .then((d: Basemap) => {
        if (!cancelled) setBasemap(d)
      })
      .catch(() => {})
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

      const g = makeMapGeometry(6, 6, w - 12, h - 12, view)
      geomRef.current = g

      if (basemap) {
        if (basemap.admin1) drawBorderLines(ctx, g, basemap.admin1.features, COLORS.admin1, 1)
        if (basemap.coast) drawBorderLines(ctx, g, basemap.coast.features, COLORS.coast, 1)
        if (basemap.borders) drawBorderLines(ctx, g, basemap.borders.features, COLORS.borders, 1.2)
      }
      // Punkte bei dichten Netzen (DACH) kleiner, damit die Karte nicht zuläuft.
      const pointR = labelMinGap > 0 ? 3 : 5
      drawStationPoints(ctx, g, stations, {
        radius: pointR,
        fill: COLORS.pointFill,
        stroke: COLORS.pointStroke,
        highlightIdx: hoverIdxRef.current,
        highlightFill: COLORS.highlight,
        colors,
        noDataFill: COLORS.noData,
      })
      // Werte direkt in die Karte schreiben (ersetzt die Legende), in der Wertfarbe.
      if (values)
        drawStationLabels(ctx, g, stations, values, formatValue, colors, hoverIdxRef.current, labelMinGap)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [basemap, stations, colors, values, hover, view, labelMinGap])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geomRef.current
    const canvas = canvasRef.current
    if (!g || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const idx = nearestStation(g, stations, px, py, 10)
    hoverIdxRef.current = idx
    setHover(idx >= 0 ? { station: stations[idx], idx, x: px, y: py } : null)
  }

  const onLeave = () => {
    hoverIdxRef.current = -1
    setHover(null)
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geomRef.current
    const canvas = canvasRef.current
    if (!g || !canvas || !onSelect) return
    const rect = canvas.getBoundingClientRect()
    const idx = nearestStation(g, stations, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (idx >= 0) onSelect(idx)
  }

  return (
    <div ref={containerRef} className="atmap">
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick} />
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
    </div>
  )
}
