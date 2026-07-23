// Vertikalprofil-/Skew-T-Panel (SPEC §13, Phase 3): Drucklevel-Sondierung am
// Location-Lock-Punkt, mehrere Modelle überlagert. Custom-Canvas (kein uPlot):
// Hintergrund aus skewt.ts, darüber T-/Td-Kurve pro Modell, Windbarben und —
// fürs Bezugsmodell — der gehobene Parzellenweg mit CAPE (rot) / CIN (blau).
// Darunter eine Vergleichstabelle der Kennzahlen (Parameter × Modell).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles } from '../api/queries'
import type { Profile } from '../api/openmeteo'
import { SERIES_COLORS } from '../config/colors'
import { getModel } from '../config/models'
import { supportsPressureLevels } from '../config/levels'
import { formatCursorTime, timeToIndex } from '../config/time'
import { columnFromProfile, computeSounding, type SoundingParams } from '../lib/sounding'
import {
  DEFAULT_SKEWT_THEME,
  drawHodograph,
  drawParcel,
  drawSkewTBackground,
  drawWindBarb,
  makeGeometry,
  xFromTP,
  yFromP,
  type HodoPoint,
  type SkewTGeometry,
} from '../render/skewt'
import { useWorkbench, type PanelConfig } from '../state/workbench'

const KMH_TO_KT = 1 / 1.852
const MS_TO_KT = 1.94384
/** Mindest-Pixelabstand zwischen Windbarben (verhindert Überlappung, thint adaptiv). */
const BARB_MIN_GAP = 13

const dash = (v: string | number | null | undefined): string =>
  v == null ? '–' : typeof v === 'number' ? String(v) : v

// Tabellenzeilen: Parameter × Modell. SB-Paket ist das Bezugspaket im Diagramm.
const TABLE_ROWS: { label: string; get: (s: SoundingParams) => string }[] = [
  { label: 'PWAT', get: (s) => `${s.pwat.toFixed(1)} mm` },
  { label: 'SB-CAPE', get: (s) => `${Math.round(s.sb.cape)}` },
  { label: 'ML-CAPE', get: (s) => `${Math.round(s.ml.cape)}` },
  { label: 'MU-CAPE', get: (s) => `${Math.round(s.mu.cape)}` },
  { label: 'CIN (SB)', get: (s) => `${Math.round(s.sb.cin)}` },
  { label: 'LCL', get: (s) => dash(s.sb.lclP != null ? `${Math.round(s.sb.lclP)} hPa` : null) },
  { label: 'LFC', get: (s) => dash(s.sb.lfcP != null ? `${Math.round(s.sb.lfcP)} hPa` : null) },
  { label: 'EL', get: (s) => dash(s.sb.elP != null ? `${Math.round(s.sb.elP)} hPa` : null) },
  { label: 'LI', get: (s) => dash(s.li != null ? s.li.toFixed(1) : null) },
  { label: 'K-Index', get: (s) => dash(s.kIndex != null ? `${Math.round(s.kIndex)}` : null) },
  { label: 'Total Totals', get: (s) => dash(s.totalTotals != null ? `${Math.round(s.totalTotals)}` : null) },
  { label: '0 °C', get: (s) => dash(s.freezingLevelP != null ? `${Math.round(s.freezingLevelP)} hPa` : null) },
  { label: 'Shear 0–6 km', get: (s) => dash(s.shear06 != null ? `${Math.round(s.shear06 * MS_TO_KT)} kt` : null) },
]

/** T- oder Td-Kurve eines Profils zum Zeitindex zeichnen (Lücken bei null). */
function strokeProfileLine(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  profile: Profile,
  values: (number | null)[][],
  timeIdx: number,
  color: string,
  linedash: number[],
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(linedash)
  ctx.beginPath()
  let pen = false
  for (let i = 0; i < profile.levels.length; i++) {
    const p = profile.levels[i]
    const v = values[i]?.[timeIdx]
    if (p < g.pMin || p > g.pMax || v == null) {
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
  const hodoContainerRef = useRef<HTMLDivElement>(null)
  const hodoCanvasRef = useRef<HTMLCanvasElement>(null)
  const [showParams, setShowParams] = useState(false)
  const [showHodo, setShowHodo] = useState(false)

  const panelTime = panel.sync ? cursorTime : panel.localTime
  const loadedKey = results.map((r) => (r.data ? '1' : '0')).join('')
  const modelsKey = panel.models.join()

  // Kennzahlen je Modell zum aktuellen Zeitpunkt (memoisiert; auf geladene Daten
  // + Zeit keyen, results ist jede Runde ein neues Array).
  const soundings = useMemo(
    () =>
      panel.models.map((_id, i) => {
        const p = results[i]?.data
        if (!p) return null
        const ti = Math.min(timeToIndex(panelTime), p.times.length - 1)
        const col = columnFromProfile(
          p.levels,
          p.temperature,
          p.dewpoint,
          p.windSpeed,
          p.windDirection,
          p.height,
          ti,
        )
        return col ? computeSounding(col) : null
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedKey, panelTime, modelsKey],
  )
  const soundingsRef = useRef(soundings)
  soundingsRef.current = soundings

  // Hodograf-Daten des Bezugsmodells (erstes mit Daten): u/v (kt) je Level,
  // Höhe über Grund, Boden zuerst.
  const hodoData = useMemo<HodoPoint[] | null>(() => {
    const idx = panel.models.findIndex((_id, k) => results[k]?.data)
    if (idx < 0) return null
    const p = results[idx].data as Profile
    const ti = Math.min(timeToIndex(panelTime), p.times.length - 1)
    const pts: HodoPoint[] = []
    let surfaceZ: number | null = null
    for (let l = 0; l < p.levels.length; l++) {
      const ws = p.windSpeed[l]?.[ti]
      const wd = p.windDirection[l]?.[ti]
      const z = p.height[l]?.[ti]
      if (ws == null || wd == null || z == null) continue
      if (surfaceZ == null) surfaceZ = z
      const spd = ws * KMH_TO_KT
      const rad = (wd * Math.PI) / 180
      pts.push({ zAgl: z - surfaceZ, u: -spd * Math.sin(rad), v: -spd * Math.cos(rad) })
    }
    return pts.length >= 2 ? pts : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, panelTime, modelsKey])

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
      const sounds = soundingsRef.current
      let barb: { profile: Profile; color: string } | null = null
      let refParcelDrawn = false

      panel.models.forEach((id, i) => {
        const profile = results[i]?.data
        if (!profile) return
        const ti = Math.min(timeIdx, profile.times.length - 1)
        const color = SERIES_COLORS[panel.modelSlots[id] ?? 0]
        // Bezugsmodell = erstes mit Sondierung: Parzelle + CAPE/CIN zuerst (unten)
        if (!refParcelDrawn && sounds[i]) {
          drawParcel(ctx, g, sounds[i]!.sb)
          refParcelDrawn = true
        }
        strokeProfileLine(ctx, g, profile, profile.temperature, ti, color, [])
        strokeProfileLine(ctx, g, profile, profile.dewpoint, ti, color, [4, 3])
        if (!barb) barb = { profile, color }
      })

      if (barb) {
        const { profile, color } = barb as { profile: Profile; color: string }
        const ti = Math.min(timeIdx, profile.times.length - 1)
        const bx = g.left + g.width + 20
        // So viele Level wie ohne Überlappung passen (adaptiv statt fester Liste)
        let lastBarbY = Infinity
        for (let i = 0; i < profile.levels.length; i++) {
          const y = yFromP(g, profile.levels[i])
          if (Math.abs(y - lastBarbY) < BARB_MIN_GAP) continue
          const ws = profile.windSpeed[i]?.[ti]
          const wd = profile.windDirection[i]?.[ti]
          if (ws == null || wd == null) continue
          drawWindBarb(ctx, bx, y, ws * KMH_TO_KT, wd, color)
          lastBarbY = y
        }
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, panelTime, modelsKey, panel.modelSlots])

  // Hodograf in sein Overlay zeichnen (nur wenn geöffnet)
  useEffect(() => {
    if (!showHodo) return
    const canvas = hodoCanvasRef.current
    const container = hodoContainerRef.current
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
      if (hodoData) drawHodograph(ctx, w, h, hodoData)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [showHodo, hodoData])

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
      <span className="skewt-time">{formatCursorTime(panelTime)}</span>
      <div className="skewt-toggles">
        <button
          type="button"
          className="skewt-params-toggle"
          onClick={() => setShowHodo((v) => !v)}
          title="Hodograf ein-/ausblenden"
        >
          Hodograf {showHodo ? '✕' : '▾'}
        </button>
        <button
          type="button"
          className="skewt-params-toggle"
          onClick={() => setShowParams((v) => !v)}
          title="Kennzahlentabelle ein-/ausblenden — das Diagramm bleibt in voller Größe"
        >
          Kennzahlen {showParams ? '✕' : '▾'}
        </button>
      </div>
      {showHodo && (
        <div ref={hodoContainerRef} className="skewt-hodo">
          <canvas ref={hodoCanvasRef} />
          {!hodoData && <span className="skewt-hodo-empty">Kein Wind-/Höhenprofil</span>}
        </div>
      )}
      {showParams && (
        <div className="skewt-params">
          <span className="skewt-hint">
            — T · - - Td · ⋯ Paket · <span style={{ color: '#d63a2b' }}>▉ CAPE</span>{' '}
            <span style={{ color: '#4a93e8' }}>▉ CIN</span> · CAPE/CIN in J/kg · SB-Paket im Diagramm
          </span>
          <table className="skewt-table">
            <thead>
              <tr>
                <th />
                {panel.models.map((id) => (
                  <th key={id}>
                    <span
                      className="legend-chip"
                      style={{ background: SERIES_COLORS[panel.modelSlots[id] ?? 0] }}
                    />
                    {getModel(id).label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {panel.models.map((id, i) => {
                    const s = soundings[i]
                    const r = results[i]
                    return (
                      <td key={id}>
                        {!supportsPressureLevels(id)
                          ? 'n. v.'
                          : s
                            ? row.get(s)
                            : r?.isPending
                              ? '…'
                              : r?.isError
                                ? '✕'
                                : '–'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
