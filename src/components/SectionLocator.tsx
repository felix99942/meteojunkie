// Karte zur Nord-Süd-Linie des Föhn-Querschnitts: groß zum Ziehen, klein als Orientierung
// oben rechts im Diagramm. Eigenes Canvas ohne MapLibre, es sind nur Linien.

import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection, Position } from 'geojson'
import { CITIES } from '../config/cities'
import { snapLon, type SectionMeridians } from '../config/foehnSection'
import { loadBasemap } from '../render/basemap'

export interface LocatorBounds {
  lonMin: number
  lonMax: number
  latMin: number
  latMax: number
}

interface Lines {
  coast: Position[][]
  borders: Position[][]
  admin1: Position[][]
}

function lines(fc: FeatureCollection | undefined): Position[][] {
  const out: Position[][] = []
  for (const f of fc?.features ?? []) {
    if (f.geometry.type === 'LineString') out.push(f.geometry.coordinates)
    else if (f.geometry.type === 'MultiLineString') out.push(...f.geometry.coordinates)
  }
  return out
}

let shared: Promise<Lines> | null = null
function loadLines(): Promise<Lines> {
  shared ??= Promise.all([loadBasemap('europe'), loadBasemap('dach')]).then(([eu, dach]) => ({
    coast: lines(eu.coast),
    borders: lines(eu.borders),
    admin1: lines(dach.admin1),
  }))
  return shared
}

interface Props {
  lon: number
  meridians: SectionMeridians
  bounds: LocatorBounds
  width: number
  height: number
  /** Ohne bleibt die Karte eine reine Anzeige */
  onChange?: (lon: number) => void
  labels?: boolean
  /** Breite unter dem Mauszeiger im Diagramm, als Punkt auf der Linie */
  markLat?: number | null
}

export function SectionLocator({ lon, meridians, bounds, width, height, onChange, labels, markLat }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<Lines | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    let live = true
    loadLines().then((l) => live && setData(l))
    return () => {
      live = false
    }
  }, [])

  // Gleicher Maßstab in beiden Richtungen, zentriert, mit der Längenkorrektur der Mitte
  const midLat = (bounds.latMin + bounds.latMax) / 2
  const k = Math.cos((midLat * Math.PI) / 180)
  const scale = Math.min(width / ((bounds.lonMax - bounds.lonMin) * k), height / (bounds.latMax - bounds.latMin))
  const offX = (width - (bounds.lonMax - bounds.lonMin) * k * scale) / 2
  const offY = (height - (bounds.latMax - bounds.latMin) * scale) / 2
  const sx = (x: number) => offX + (x - bounds.lonMin) * k * scale
  const sy = (y: number) => offY + (bounds.latMax - y) * scale

  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#15171a'
    g.fillRect(0, 0, width, height)
    const stroke = (ls: Position[][], color: string, w: number) => {
      g.strokeStyle = color
      g.lineWidth = w
      g.beginPath()
      for (const l of ls) {
        l.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))))
      }
      g.stroke()
    }
    if (data) {
      if (labels) stroke(data.admin1, 'rgba(255,255,255,0.13)', 0.7)
      stroke(data.coast, 'rgba(255,255,255,0.45)', 0.8)
      stroke(data.borders, 'rgba(255,255,255,0.55)', labels ? 1.1 : 0.8)
    }
    if (labels) {
      g.font = '12px system-ui, sans-serif'
      g.textBaseline = 'middle'
      for (const city of CITIES) {
        if (!city.domains.includes('imagery') || city.priority > 2) continue
        if (city.lon < bounds.lonMin || city.lon > bounds.lonMax || city.lat < bounds.latMin || city.lat > bounds.latMax) continue
        g.fillStyle = 'rgba(242,242,239,0.85)'
        g.beginPath()
        g.arc(sx(city.lon), sy(city.lat), 2, 0, 2 * Math.PI)
        g.fill()
        g.fillStyle = 'rgba(242,242,239,0.75)'
        g.fillText(city.name, sx(city.lon) + 5, sy(city.lat))
      }
    }
    const x = sx(lon)
    g.strokeStyle = '#ff3b30'
    g.lineWidth = labels ? 3 : 2
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x, sy(meridians.latNorth))
    g.lineTo(x, sy(meridians.latSouth))
    g.stroke()
    g.lineCap = 'butt'
    if (markLat != null) {
      g.beginPath()
      g.arc(x, sy(markLat), labels ? 6 : 4.5, 0, 2 * Math.PI)
      g.fillStyle = '#fff'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = '#ff3b30'
      g.stroke()
    }
  })

  const pick = (clientX: number) => {
    const c = ref.current
    if (!c || !onChange) return
    const x = clientX - c.getBoundingClientRect().left
    onChange(snapLon(bounds.lonMin + (x - offX) / (k * scale), meridians))
  }

  return (
    <canvas
      ref={ref}
      className={onChange ? 'section-locator is-draggable' : 'section-locator'}
      onPointerDown={(e) => {
        if (!onChange) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e.clientX)
      }}
      onPointerMove={(e) => dragging.current && pick(e.clientX)}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    />
  )
}
