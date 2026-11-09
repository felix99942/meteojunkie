// Föhn-Querschnitt: Modellflächen von ICON-D2 entlang der Föhnachse. Farbe = Vertikalwind
// oder Wind längs der Achse, Linien = potentielle Temperatur, Pfeile = Strömung in der
// Schnittebene. Absinken im Lee sieht man am Abtauchen der Linien.

import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForValue } from '../config/colorscales'
import {
  displayValue,
  FREE_SECTION,
  isoLevels,
  isoSegments,
  meridianId,
  nearestLevel,
  nearestSectionStep,
  SECTION_SCALES,
  SECTION_TOP_M,
  THETA_STEP_K,
  type SectionData,
  type SectionMeta,
  type SectionMode,
} from '../config/foehnSection'
import { globalKeyAllowed } from '../lib/globalKeys'
import { SectionLocator, type LocatorBounds } from './SectionLocator'

const BASE = `${import.meta.env.BASE_URL}nwp/icon-d2-section/`
const M = { left: 52, right: 16, top: 30, bottom: 30 }
const INK = '#c3c2b7'
const ISO = 'rgba(255,255,255,0.5)'
const ISO_BOLD = 'rgba(255,255,255,0.95)'
const TERRAIN = '#0d0e10'
const TERRAIN_EDGE = '#6f6e68'

const DEFAULT_LON = 11.4
/** Die Alpen zum Ziehen der Linie, die ganze DACH-Fläche zur Orientierung. */
const ALPS_BOUNDS: LocatorBounds = { lonMin: 5.5, lonMax: 17.5, latMin: 44.6, latMax: 49.2 }
const DACH_BOUNDS: LocatorBounds = { lonMin: 5.5, lonMax: 17.5, latMin: 45.0, latMax: 55.2 }
/** Geladene Schnitte (je Linie ~20 MB als Objekte): beim Durchziehen nur die letzten behalten. */
const SECTION_LRU = 10

const sections = new Map<string, Promise<SectionData>>()

function loadSection(runId: string, id: string): Promise<SectionData> {
  const key = `${runId}/${id}`
  let p = sections.get(key)
  if (p) {
    sections.delete(key)
  } else {
    p = fetch(`${BASE}${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<SectionData>
    })
    p.catch(() => sections.delete(key))
  }
  sections.set(key, p)
  if (sections.size > SECTION_LRU) sections.delete(sections.keys().next().value as string)
  return p
}

const whenFmt = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })
const when = (ms: number) => `${whenFmt.format(new Date(ms))} ${String(new Date(ms).getUTCHours()).padStart(2, '0')} UTC`
const de = (v: number, digits: number) => v.toFixed(digits).replace('.', ',').replace(/^-/, '−')

interface Hover {
  x: number
  y: number
  text: string
}

export function FoehnSection({ axisId }: { axisId: string }) {
  const [meta, setMeta] = useState<SectionMeta | null>(null)
  const [state, setState] = useState<'loading' | 'empty' | 'ready'>('loading')
  const [loaded, setLoaded] = useState<{ key: string; data: SectionData } | null>(null)
  const [mode, setMode] = useState<SectionMode>('w')
  const [idx, setIdx] = useState<number | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lon, setLon] = useState(DEFAULT_LON)
  const [settledLon, setSettledLon] = useState(DEFAULT_LON)
  const [mapOpen, setMapOpen] = useState(true)
  const free = axisId === FREE_SECTION

  // Beim Ziehen erst laden, wenn die Linie kurz steht: sonst holte jede Zwischenstellung
  // eine Datei von rund einem MB
  useEffect(() => {
    const t = setTimeout(() => setSettledLon(lon), 140)
    return () => clearTimeout(t)
  }, [lon])

  useEffect(() => {
    let live = true
    // no-cache: die Datei wechselt mit jedem Lauf unter derselben Adresse
    fetch(`${BASE}meta.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<SectionMeta>) : null))
      .catch(() => null)
      .then((m) => {
        if (!live) return
        setMeta(m)
        setState(m ? 'ready' : 'empty')
      })
    return () => {
      live = false
    }
  }, [])

  const meridians = meta?.meridians
  const missingLines = free && meta != null && !meridians
  const fileId = free ? meridianId(settledLon) : axisId
  const key = meta ? `${meta.runId}/${fileId}` : null
  useEffect(() => {
    if (!meta || missingLines) return
    let live = true
    const k = `${meta.runId}/${fileId}`
    loadSection(meta.runId, fileId)
      .then((d) => {
        if (!live) return
        setLoaded({ key: k, data: d })
        if (free && meridians) {
          // Die Nachbarn gleich mit: so ist der nächste Schritt der Linie sofort da
          for (const n of [settledLon - meridians.step, settledLon + meridians.step]) {
            if (n >= meridians.min && n <= meridians.max) void loadSection(meta.runId, meridianId(n)).catch(() => {})
          }
        }
      })
      .catch(() => live && setState('empty'))
    return () => {
      live = false
    }
  }, [meta, fileId, free, meridians, missingLines, settledLon])
  // Beim Achsenwechsel keine Runde mit den Daten der vorigen Achse. Beim Ziehen der Linie
  // bleibt der vorige Schnitt stehen, bis der neue da ist; Beschriftung und Mini-Karte
  // nennen dabei immer den Schnitt, der wirklich zu sehen ist
  const data =
    loaded && (loaded.key === key || (free && loaded.data.id.startsWith('lon-'))) ? loaded.data : null
  const shownLon = data?.id.startsWith('lon-') ? Number(data.id.slice(4)) / 10 : lon
  const busy = free && !!key && loaded?.key !== key

  const runMs = meta ? Date.parse(meta.run) : NaN
  const [now] = useState(() => Date.now())
  const stepIdx = meta ? (idx ?? nearestSectionStep(runMs, meta.steps, now)) : 0
  const stepCount = meta?.steps.length ?? 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !stepCount) return
      e.preventDefault()
      setIdx(Math.max(0, Math.min(stepCount - 1, stepIdx + (e.key === 'ArrowLeft' ? -1 : 1))))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepCount, stepIdx])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const w = Math.round(el.clientWidth)
        const h = Math.round(el.clientHeight)
        setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const geometry = useMemo(() => {
    if (!data || !size.w || !size.h) return null
    const px = size.w - M.left - M.right
    const py = size.h - M.top - M.bottom
    const xMax = data.km[data.km.length - 1]
    return {
      px,
      py,
      sx: (km: number) => M.left + (km / xMax) * px,
      sy: (z: number) => M.top + (1 - z / SECTION_TOP_M) * py,
      invX: (x: number) => ((x - M.left) / px) * xMax,
      invY: (y: number) => (1 - (y - M.top) / py) * SECTION_TOP_M,
    }
  }, [data, size])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !data || !geometry) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    c.style.width = `${size.w}px`
    c.style.height = `${size.h}px`
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size.w, size.h)
    drawSection(g, data, stepIdx, mode, geometry, size)
  }, [data, geometry, size, stepIdx, mode])

  const onMove = (e: React.MouseEvent) => {
    if (!data || !geometry) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const km = geometry.invX(x)
    const h = geometry.invY(y)
    const xMax = data.km[data.km.length - 1]
    if (km < 0 || km > xMax || h < 0 || h > SECTION_TOP_M) return setHover(null)
    let col = 0
    data.km.forEach((v, i) => {
      if (Math.abs(v - km) < Math.abs(data.km[col] - km)) col = i
    })
    if (h < data.terrain[col]) {
      return setHover({ x, y, text: `Gelände ${Math.round(data.terrain[col])} m · km ${Math.round(km)}` })
    }
    const k = nearestLevel(data.z, col, h)
    const th = data.theta[stepIdx][k][col]
    const al = data.along[stepIdx][k][col]
    const w = data.w[stepIdx][k][col]
    if (th == null || al == null || w == null) return setHover(null)
    setHover({
      x,
      y,
      text: `${Math.round(data.z[k][col])} m · θ ${de(th / 10, 1)} K · w ${de(w / 100, 2)} m/s · längs ${de(displayValue('along', al), 0)} km/h`,
    })
  }

  const info = SECTION_SCALES[mode]
  const legend = info.scale.stops.map((s, i) => ({
    color: s.color,
    label: i % 2 === 0 ? de(s.value, Math.abs(s.value) < 1 && mode === 'w' ? 1 : 0) : '',
  }))
  const stepH = meta?.steps[stepIdx]
  const validMs = stepH != null ? runMs + stepH * 3_600_000 : NaN

  return (
    <div className="foehn-section">
      <div className="atclima-bar foehn-bar">
        <label className="atclima-ctrl">
          <span className="label-muted">Farbe</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as SectionMode)}>
            <option value="w">Vertikalwind</option>
            <option value="along">Wind längs der Achse</option>
          </select>
        </label>
        {meta && (
          <>
            <input
              className="foehn-section-range"
              type="range"
              min={0}
              max={stepCount - 1}
              value={stepIdx}
              aria-label="Vorhersagezeit"
              onChange={(e) => setIdx(Number(e.target.value))}
            />
            <strong className="foehn-section-time">
              {when(validMs)} <span className="label-muted">+{stepH} h</span>
            </strong>
            <span className="foehn-section-run">ICON-D2 · Lauf {when(runMs)}</span>
          </>
        )}
        {free && meridians && (
          <>
            <strong className="foehn-section-lon">
              {data?.label ?? '…'}
              {busy && <span className="label-muted"> lädt …</span>}
            </strong>
            <button type="button" className="foehn-section-maptoggle" onClick={() => setMapOpen((v) => !v)}>
              Karte {mapOpen ? '▴' : '▾'}
            </button>
          </>
        )}
        <span className="foehn-section-legend" title={`${info.label} in ${info.unit}`}>
          <span className="label-muted">{info.unit}</span>
          {legend.map((l, i) => (
            <span key={i} className="foehn-section-chip" style={{ background: l.color }}>
              <em>{l.label}</em>
            </span>
          ))}
        </span>
      </div>
      {free && meridians && mapOpen && (
        <div className="foehn-section-map">
          <SectionLocator
            lon={lon}
            meridians={meridians}
            bounds={ALPS_BOUNDS}
            width={520}
            height={210}
            onChange={setLon}
            labels
          />
          <p className="label-muted">
            Rote Linie mit der Maus nach Westen oder Osten ziehen, sie läuft von Nord nach Süd und rastet alle 0,1° ein.
          </p>
        </div>
      )}
      <div
        ref={wrapRef}
        className="foehn-section-plot"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} />
        {free && meridians && data && (
          <div className="foehn-section-mini">
            <SectionLocator lon={shownLon} meridians={meridians} bounds={DACH_BOUNDS} width={120} height={160} />
          </div>
        )}
        {(state === 'empty' || missingLines) && (
          <div className="panel-placeholder atdetail-overlay">
            {missingLines
              ? 'Dieser Lauf hat noch keine frei wählbaren Linien, sie kommen mit dem nächsten Lauf.'
              : 'Noch keine Querschnitte vorhanden (lokal: npm run ingest:icon-d2-section).'}
          </div>
        )}
        {hover && (
          <div
            className="foehn-section-hover"
            style={{ left: Math.min(hover.x + 12, size.w - 300), top: Math.max(hover.y - 28, 4) }}
          >
            {hover.text}
          </div>
        )}
      </div>
      <div className="foehn-section-note label-muted">
        Linien: potentielle Temperatur alle {THETA_STEP_K} K. Sinken sie im Lee ab, sinkt dort die Luft. Pfeile: Strömung
        in der Schnittebene, die Höhe ist stark überhöht. Links Süden, rechts Norden. Nur Modell, keine Messung.
      </div>
    </div>
  )
}

interface Geometry {
  px: number
  py: number
  sx: (km: number) => number
  sy: (z: number) => number
}

function drawSection(
  g: CanvasRenderingContext2D,
  d: SectionData,
  step: number,
  mode: SectionMode,
  geo: Geometry,
  size: { w: number; h: number },
) {
  const { sx, sy, px, py } = geo
  const scale = SECTION_SCALES[mode].scale
  const field = mode === 'w' ? d.w[step] : d.along[step]
  const levels = d.z.length
  const cols = d.km.length

  g.save()
  g.beginPath()
  g.rect(M.left, M.top, px, py)
  g.clip()

  // Farbfläche: je Viereck das Mittel seiner Ecken
  g.lineWidth = 1
  for (let k = 0; k < levels - 1; k++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = field[k][i]
      const b = field[k][i + 1]
      const c = field[k + 1][i + 1]
      const e = field[k + 1][i]
      if (a == null || b == null || c == null || e == null) continue
      const color = colorForValue(scale, displayValue(mode, (a + b + c + e) / 4))
      if (!color) continue
      g.fillStyle = color
      g.strokeStyle = color
      g.beginPath()
      g.moveTo(sx(d.km[i]), sy(d.z[k][i]))
      g.lineTo(sx(d.km[i + 1]), sy(d.z[k][i + 1]))
      g.lineTo(sx(d.km[i + 1]), sy(d.z[k + 1][i + 1]))
      g.lineTo(sx(d.km[i]), sy(d.z[k + 1][i]))
      g.closePath()
      g.fill()
      g.stroke()
    }
  }

  // Potentielle Temperatur
  const theta = d.theta[step]
  let min = Infinity
  let max = -Infinity
  for (let k = 0; k < levels; k++) {
    for (let i = 0; i < cols; i++) {
      const v = theta[k][i]
      if (v == null || d.z[k][i] > SECTION_TOP_M) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  const labels: { x: number; y: number; text: string }[] = []
  if (min <= max) {
    for (const lv of isoLevels(min / 10, max / 10, THETA_STEP_K)) {
      const bold = lv % 10 === 0
      const seg = isoSegments(d.km, d.z, theta, lv * 10)
      g.strokeStyle = bold ? ISO_BOLD : ISO
      g.lineWidth = bold ? 1.5 : 0.8
      g.beginPath()
      for (const [x1, z1, x2, z2] of seg) {
        g.moveTo(sx(x1), sy(z1))
        g.lineTo(sx(x2), sy(z2))
      }
      g.stroke()
      if (bold && seg.length) {
        // Beschriftung nahe am linken Rand, damit sie nicht über dem Kamm steht
        const targetKm = d.km[cols - 1] * 0.06
        let best = seg[0]
        for (const s of seg) if (Math.abs(s[0] - targetKm) < Math.abs(best[0] - targetKm)) best = s
        if (best[1] <= SECTION_TOP_M) labels.push({ x: sx(best[0]), y: sy(best[1]), text: String(lv) })
      }
    }
  }

  // Strömung in der Schnittebene. Die Richtung folgt der Überhöhung des Bilds, sonst
  // lägen alle Pfeile flach und die Hebung am Kamm wäre nicht zu sehen
  const pxPerKm = px / d.km[cols - 1]
  const pxPerM = py / SECTION_TOP_M
  const exaggeration = pxPerM / (pxPerKm / 1000)
  const dCol = Math.max(1, Math.round(42 / (pxPerKm * (d.km[1] - d.km[0]))))
  g.lineWidth = 1
  g.strokeStyle = 'rgba(255,255,255,0.8)'
  g.fillStyle = 'rgba(255,255,255,0.8)'
  for (let i = Math.floor(dCol / 2); i < cols; i += dCol) {
    for (let h = d.terrain[i] + 300; h < SECTION_TOP_M; h += 650) {
      const k = nearestLevel(d.z, i, h)
      const al = d.along[step][k][i]
      const w = d.w[step][k][i]
      if (al == null || w == null) continue
      const u = al / 10
      const v = (w / 100) * exaggeration
      const n = Math.hypot(u, v)
      if (n < 0.5) continue
      const len = Math.min(17, 5 + Math.hypot(u, w / 100) * 0.6)
      const x0 = sx(d.km[i])
      const y0 = sy(d.z[k][i])
      const dx = (u / n) * len
      const dy = -(v / n) * len
      const x1 = x0 + dx
      const y1 = y0 + dy
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()
      const a = Math.atan2(dy, dx)
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x1 - 4.5 * Math.cos(a - 0.45), y1 - 4.5 * Math.sin(a - 0.45))
      g.lineTo(x1 - 4.5 * Math.cos(a + 0.45), y1 - 4.5 * Math.sin(a + 0.45))
      g.closePath()
      g.fill()
    }
  }

  // Gelände über allem, sonst lägen Pfeile und Linien im Berg
  g.fillStyle = TERRAIN
  g.beginPath()
  g.moveTo(sx(d.km[0]), M.top + py)
  d.km.forEach((km, i) => g.lineTo(sx(km), sy(d.terrain[i])))
  g.lineTo(sx(d.km[cols - 1]), M.top + py)
  g.closePath()
  g.fill()
  g.strokeStyle = TERRAIN_EDGE
  g.lineWidth = 1.2
  g.beginPath()
  d.km.forEach((km, i) => (i ? g.lineTo(sx(km), sy(d.terrain[i])) : g.moveTo(sx(km), sy(d.terrain[i]))))
  g.stroke()

  g.font = '600 11px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const l of labels) {
    g.lineWidth = 3
    g.strokeStyle = 'rgba(0,0,0,0.75)'
    g.strokeText(l.text, l.x, l.y)
    g.fillStyle = '#fff'
    g.fillText(l.text, l.x, l.y)
  }
  g.restore()

  // Achsen
  g.font = '11px system-ui, sans-serif'
  g.fillStyle = INK
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  g.strokeStyle = 'rgba(255,255,255,0.08)'
  g.lineWidth = 1
  for (let z = 0; z <= SECTION_TOP_M; z += 1000) {
    g.fillText(`${z / 1000}`, M.left - 8, sy(z))
    g.beginPath()
    g.moveTo(M.left, sy(z))
    g.lineTo(M.left + px, sy(z))
    g.stroke()
  }
  g.save()
  g.translate(13, M.top + py / 2)
  g.rotate(-Math.PI / 2)
  g.textAlign = 'center'
  g.fillText('Höhe (km)', 0, 0)
  g.restore()

  g.textAlign = 'center'
  g.textBaseline = 'top'
  const xMax = d.km[cols - 1]
  // Die letzte Zahl nicht direkt neben die Einheit am rechten Rand
  for (let km = 0; km <= xMax - 15; km += 50) g.fillText(String(km), sx(km), size.h - M.bottom + 8)
  g.textAlign = 'right'
  g.fillText('km', size.w - 2, size.h - M.bottom + 8)

  // Orte mit Strich bis zum Boden
  g.font = '600 12px system-ui, sans-serif'
  g.textBaseline = 'alphabetic'
  for (const m of d.marks) {
    const x = sx(Math.min(m.km, xMax))
    g.strokeStyle = 'rgba(255,255,255,0.32)'
    g.setLineDash([3, 4])
    g.beginPath()
    g.moveTo(x, M.top)
    g.lineTo(x, M.top + py)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = '#f2f2ef'
    g.textAlign = m.km < 4 ? 'left' : m.km > xMax - 12 ? 'right' : 'center'
    g.fillText(m.name, x, M.top - 8)
  }
}
