// Statische Österreich-Klimakarte (Schritt 2): Canvas mit Landesgrenzen und
// allen Stationen als Punkte, Hover-Tooltip mit Name/Höhe. Noch ohne Werte —
// die Einfärbung nach gewähltem Parameter kommt in Schritt 3.
//
// Basiskarte (Natural-Earth-Linien, auf die AT-Domain zugeschnitten) wird als
// URL-Asset geladen statt in den JS-Bundle gezogen — wie in MapPanel.

import { useEffect, useRef, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import austriaBasemapUrl from '../mapdata/austria.basemap.json?url'
import {
  drawBorderLines,
  drawStationPoints,
  makeMapGeometry,
  nearestStation,
  type MapGeometry,
} from '../render/atmap'

interface BorderFeature {
  geometry: { type: string; coordinates: number[][] }
}
interface Basemap {
  coast: { features: BorderFeature[] }
  borders: { features: BorderFeature[] }
  admin1: { features: BorderFeature[] }
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
}: {
  stations: AtStation[]
  /** Per-Station-Farben (parallel zu stations); null = kein Wert. */
  colors?: (string | null)[]
  /** Per-Station-Werte (parallel zu stations) — für den Tooltip. */
  values?: (number | null)[]
  unit?: string
  onSelect?: (station: AtStation) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const geomRef = useRef<MapGeometry | null>(null)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [hover, setHover] = useState<{ station: AtStation; idx: number; x: number; y: number } | null>(null)
  const hoverIdxRef = useRef<number>(-1)

  // Basiskarte einmal laden.
  useEffect(() => {
    let cancelled = false
    fetch(austriaBasemapUrl)
      .then((r) => r.json())
      .then((d: Basemap) => {
        if (!cancelled) setBasemap(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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

      const g = makeMapGeometry(6, 6, w - 12, h - 12)
      geomRef.current = g

      if (basemap) {
        drawBorderLines(ctx, g, basemap.admin1.features, COLORS.admin1, 1)
        drawBorderLines(ctx, g, basemap.coast.features, COLORS.coast, 1)
        drawBorderLines(ctx, g, basemap.borders.features, COLORS.borders, 1.2)
      }
      drawStationPoints(ctx, g, stations, {
        radius: 3,
        fill: COLORS.pointFill,
        stroke: COLORS.pointStroke,
        highlightIdx: hoverIdxRef.current,
        highlightFill: COLORS.highlight,
        colors,
        noDataFill: COLORS.noData,
      })
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [basemap, stations, colors, hover])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geomRef.current
    const canvas = canvasRef.current
    if (!g || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const idx = nearestStation(g, stations, px, py, 7)
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
    const idx = nearestStation(g, stations, e.clientX - rect.left, e.clientY - rect.top, 7)
    if (idx >= 0) onSelect(stations[idx])
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
