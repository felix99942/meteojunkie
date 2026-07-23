// Vertikalprofil-/Skew-T-Panel (SPEC §13, Phase 3): Drucklevel-Sondierung am
// Location-Lock-Punkt, mehrere Modelle überlagert. Custom-Canvas (kein uPlot) —
// Hintergrund aus skewt.ts, darüber Temperatur- und Taupunktkurve pro Modell
// plus Windbarben. Folgt dem globalen Zeit-Cursor.

import { useEffect, useRef } from 'react'
import { useProfiles } from '../api/queries'
import type { Profile } from '../api/openmeteo'
import { SERIES_COLORS } from '../config/colors'
import { getModel } from '../config/models'
import { supportsPressureLevels } from '../config/levels'
import { formatCursorTime, timeToIndex } from '../config/time'
import {
  DEFAULT_SKEWT_THEME,
  drawSkewTBackground,
  drawWindBarb,
  makeGeometry,
  xFromTP,
  yFromP,
  type SkewTGeometry,
} from '../render/skewt'
import { useWorkbench, type PanelConfig } from '../state/workbench'

const KMH_TO_KT = 1 / 1.852
// Level, an denen Windbarben gezeichnet werden (sonst überlappen sie)
const BARB_LEVELS = new Set([1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100])

/** T- oder Td-Kurve eines Profils zum Zeitindex zeichnen (Lücken bei null). */
function strokeProfileLine(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  profile: Profile,
  values: (number | null)[][],
  timeIdx: number,
  color: string,
  dash: number[],
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(dash)
  ctx.beginPath()
  let pen = false
  for (let i = 0; i < profile.levels.length; i++) {
    const p = profile.levels[i]
    if (p < g.pMin || p > g.pMax) {
      pen = false
      continue
    }
    const v = values[i]?.[timeIdx]
    if (v == null) {
      pen = false
      continue
    }
    const x = xFromTP(g, v, p)
    const y = yFromP(g, p)
    if (pen) ctx.lineTo(x, y)
    else {
      ctx.moveTo(x, y)
      pen = true
    }
  }
  ctx.stroke()
  ctx.restore()
}

export function SkewTPanel({ panel }: { panel: PanelConfig }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const cursorTime = useWorkbench((s) => s.cursorTime)
  const results = useProfiles(location, panel.models)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const panelTime = panel.sync ? cursorTime : panel.localTime
  const loadedKey = results.map((r) => (r.data ? '1' : '0')).join('')

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
      ctx.clearRect(0, 0, w, h)

      const g = makeGeometry(38, 8, w - 38 - 44, h - 8 - 22)
      drawSkewTBackground(ctx, g, DEFAULT_SKEWT_THEME)

      const timeIdx = timeToIndex(panelTime)
      let barbModel: { profile: Profile; color: string } | null = null

      panel.models.forEach((id, i) => {
        const profile = results[i]?.data
        if (!profile) return
        const ti = Math.min(timeIdx, profile.times.length - 1)
        const color = SERIES_COLORS[panel.modelSlots[id] ?? 0]
        strokeProfileLine(ctx, g, profile, profile.temperature, ti, color, [])
        strokeProfileLine(ctx, g, profile, profile.dewpoint, ti, color, [4, 3])
        if (!barbModel) barbModel = { profile, color }
      })

      // Windbarben für das erste Modell mit Daten, am rechten Rand
      if (barbModel) {
        const { profile, color } = barbModel as { profile: Profile; color: string }
        const ti = Math.min(timeIdx, profile.times.length - 1)
        const bx = g.left + g.width + 20
        for (let i = 0; i < profile.levels.length; i++) {
          const p = profile.levels[i]
          if (!BARB_LEVELS.has(p)) continue
          const ws = profile.windSpeed[i]?.[ti]
          const wd = profile.windDirection[i]?.[ti]
          if (ws == null || wd == null) continue
          drawWindBarb(ctx, bx, yFromP(g, p), ws * KMH_TO_KT, wd, color)
        }
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
    // results ist jede Renderrunde ein neues Array — auf geladene Daten keyen,
    // sonst baut der ResizeObserver bei jedem Render neu auf
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, panelTime, panel.models.join(), panel.modelSlots])

  if (!location) {
    return <div className="panel-placeholder">Kein Standort gewählt — oben Ort suchen oder Karte klicken</div>
  }
  if (panel.models.length === 0) {
    return <div className="panel-placeholder">Keine Modelle gewählt</div>
  }
  if (!panel.models.some((id) => supportsPressureLevels(id))) {
    return (
      <div className="panel-placeholder">Keines der gewählten Modelle liefert Drucklevel-Daten</div>
    )
  }

  return (
    <div className="skewt">
      <div ref={containerRef} className="skewt-canvas">
        <canvas ref={canvasRef} />
      </div>
      <div className="skewt-legend">
        <span className="skewt-time">{formatCursorTime(panelTime)}</span>
        {panel.models.map((id, i) => {
          const supported = supportsPressureLevels(id)
          const r = results[i]
          return (
            <span key={id} className="legend-item">
              <span
                className="legend-chip"
                style={{ background: SERIES_COLORS[panel.modelSlots[id] ?? 0] }}
              />
              <span className="legend-label">{getModel(id).label}</span>
              <span className="legend-value">
                {!supported && 'n. v.'}
                {supported && r?.isPending && '…'}
                {supported && r?.isError && '✕'}
              </span>
            </span>
          )
        })}
        <span className="skewt-hint">— T · - - Td</span>
      </div>
    </div>
  )
}
