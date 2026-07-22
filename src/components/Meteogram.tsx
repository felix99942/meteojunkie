// Meteogramm-Modus (SPEC §4): Zeitreihe am Location-Lock-Punkt, mehrere
// Modelle überlagert — der Kern des Modellvergleichs. uPlot rendert die
// Serien, ein Draw-Hook zeichnet die Linie des globalen Zeit-Cursors,
// Klick in den Plot setzt den Cursor.

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useMeteogramSeries } from '../api/queries'
import type { HourlySeries } from '../api/openmeteo'
import { SERIES_COLORS } from '../config/colors'
import { getModel, modelHorizonEnd } from '../config/models'
import { getVariable } from '../config/variables'
import { timeGridMs, timeToIndex } from '../config/time'
import { useWorkbench, type PanelConfig } from '../state/workbench'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'

const fmtDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short' })

/** Serie auf das gemeinsame Zeitraster legen (Zeitstempel-Abgleich statt Index-Annahme). */
function alignToGrid(gridMs: number[], series: HourlySeries): (number | null)[] {
  const byTime = new Map<number, number | null>()
  for (let i = 0; i < series.times.length; i++) byTime.set(series.times[i], series.values[i])
  return gridMs.map((t) => byTime.get(t) ?? null)
}

export function Meteogram({ panel }: { panel: PanelConfig }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const cursorTime = useWorkbench((s) => s.cursorTime)

  const results = useMeteogramSeries(location, panel.models, panel.variable)
  const variable = getVariable(panel.variable)

  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const gridMs = useMemo(() => timeGridMs(), [])
  const xsSec = useMemo(() => gridMs.map((t) => t / 1000), [gridMs])

  const loadedKey = results.map((r) => (r.data ? '1' : '0')).join('')
  const data = useMemo<uPlot.AlignedData>(
    () => [
      xsSec,
      ...results.map((r, i) => {
        if (!r.data) return new Array<number | null>(gridMs.length).fill(null)
        const aligned = alignToGrid(gridMs, r.data)
        // Serie endet am Registry-Horizont — keine Extrapolation darüber hinaus
        const horizon = modelHorizonEnd(getModel(panel.models[i]))
        for (let t = 0; t < aligned.length; t++) {
          if (gridMs[t] > horizon) aligned[t] = null
        }
        return aligned
      }),
    ],
    // results ist jede Renderrunde ein neues Array — auf geladene Daten keyen
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedKey, gridMs, xsSec, panel.models.join(), panel.variable],
  )

  // Cursor-Linie: Ref statt Prop, damit der Draw-Hook ohne Chart-Neuaufbau
  // an den aktuellen Wert kommt
  const cursorLineRef = useRef<number | null>(null)
  cursorLineRef.current = panel.sync ? cursorTime : null

  const dataRef = useRef(data)
  dataRef.current = data

  const modelsKey = panel.models.join()

  // Chart-Lebenszyklus: Neuaufbau nur bei Serien-/Variablenwechsel
  useEffect(() => {
    const el = containerRef.current
    if (!el || panel.models.length === 0) return

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 80),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      legend: { show: false },
      cursor: {
        y: false,
        points: { size: 6 },
        drag: { x: false, y: false, setScale: false },
      },
      scales: variable.nonNegative
        ? { y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] } }
        : {},
      series: [
        {},
        ...panel.models.map((id) => ({
          label: getModel(id).label,
          stroke: SERIES_COLORS[panel.modelSlots[id] ?? 0],
          width: 2,
          points: { show: false },
        })),
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 48,
          values: (_u, ticks) =>
            ticks.map((t) => {
              const d = new Date(t * 1000)
              return d.getUTCHours() === 0
                ? `${fmtDay.format(d)} ${d.getUTCDate()}.`
                : `${d.getUTCHours()}h`
            }),
        },
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 44,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
      ],
      hooks: {
        setCursor: [
          (u) => {
            setHoverIdx(u.cursor.idx ?? null)
          },
        ],
        draw: [
          // Modellhorizonte kennzeichnen: Bereich jenseits des längsten
          // Horizonts abdunkeln, pro Modell eine gestrichelte Endlinie in
          // Serienfarbe (Registry-forecastHours, keine Extrapolation)
          (u) => {
            const ctx = u.ctx
            const dpr = devicePixelRatio
            const horizons = panel.models.map((id) => ({
              sec: modelHorizonEnd(getModel(id)) / 1000,
              color: SERIES_COLORS[panel.modelSlots[id] ?? 0],
            }))
            const right = u.bbox.left + u.bbox.width
            const maxSec = Math.max(...horizons.map((h) => h.sec))
            const maxX = u.valToPos(maxSec, 'x', true)
            if (maxX < right) {
              ctx.save()
              ctx.fillStyle = 'rgba(0,0,0,0.35)'
              ctx.fillRect(
                Math.max(maxX, u.bbox.left),
                u.bbox.top,
                right - Math.max(maxX, u.bbox.left),
                u.bbox.height,
              )
              ctx.restore()
            }
            ctx.save()
            ctx.lineWidth = dpr
            ctx.setLineDash([2 * dpr, 3 * dpr])
            ctx.globalAlpha = 0.7
            for (const h of horizons) {
              const x = u.valToPos(h.sec, 'x', true)
              if (x < u.bbox.left || x > right) continue
              ctx.strokeStyle = h.color
              ctx.beginPath()
              ctx.moveTo(x, u.bbox.top)
              ctx.lineTo(x, u.bbox.top + u.bbox.height)
              ctx.stroke()
            }
            ctx.restore()
          },
          (u) => {
            const t = cursorLineRef.current
            if (t == null) return
            const x = u.valToPos(t / 1000, 'x', true)
            if (x < u.bbox.left - 1 || x > u.bbox.left + u.bbox.width + 1) return
            const ctx = u.ctx
            ctx.save()
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'
            ctx.lineWidth = devicePixelRatio
            ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio])
            ctx.beginPath()
            ctx.moveTo(x, u.bbox.top)
            ctx.lineTo(x, u.bbox.top + u.bbox.height)
            ctx.stroke()
            ctx.restore()
          },
        ],
      },
    }

    const u = new uPlot(opts, dataRef.current, el)
    plotRef.current = u

    const onClick = () => {
      const idx = u.cursor.idx
      if (idx != null) useWorkbench.getState().setCursorTime(gridMs[idx])
    }
    u.over.addEventListener('click', onClick)

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        u.setSize({ width: el.clientWidth, height: el.clientHeight })
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      u.over.removeEventListener('click', onClick)
      u.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey, panel.variable, panel.modelSlots, gridMs, variable.nonNegative])

  // Daten nachschieben, sobald Queries eintreffen
  useEffect(() => {
    plotRef.current?.setData(data)
  }, [data])

  // Cursor-Linie nachzeichnen, wenn der globale Zeit-Cursor wandert
  useEffect(() => {
    plotRef.current?.redraw(false)
  }, [cursorTime, panel.sync])

  if (!location) {
    return <div className="panel-placeholder">Kein Standort gewählt — oben Ort suchen</div>
  }
  if (panel.models.length === 0) {
    return <div className="panel-placeholder">Keine Modelle gewählt</div>
  }
  // klare Meldung statt leerem Chart — Modellauswahl bleibt unangetastet
  // (kein automatischer Modellwechsel, um den Parameter verfügbar zu machen)
  if (!panel.models.some((id) => getModel(id).availableVariables.includes(panel.variable))) {
    return (
      <div className="panel-placeholder">
        Parameter „{variable.label}“ in den gewählten Modellen nicht verfügbar
      </div>
    )
  }

  // gültige Panel-Zeit: global bei Sync an, lokal bei Sync aus
  const panelTime = panel.sync ? cursorTime : panel.localTime
  const legendIdx = hoverIdx ?? timeToIndex(panelTime)
  const legendTime = gridMs[legendIdx]

  return (
    <div className="meteogram">
      <div ref={containerRef} className="meteogram-plot" />
      <div className="meteogram-legend">
        {panel.models.map((id, i) => {
          const r = results[i]
          const supported = getModel(id).availableVariables.includes(panel.variable)
          const value = r.data ? (data[i + 1] as (number | null)[])[legendIdx] : null
          const beyondHorizon = legendTime > modelHorizonEnd(getModel(id))
          return (
            <span key={id} className="legend-item">
              <span
                className="legend-chip"
                style={{ background: SERIES_COLORS[panel.modelSlots[id] ?? 0] }}
              />
              <span className="legend-label">{getModel(id).label}</span>
              <span className="legend-value">
                {!supported && 'n. v.'}
                {supported && r.isPending && '…'}
                {supported && r.isError && '✕'}
                {supported &&
                  r.data &&
                  (value != null
                    ? `${value.toFixed(1)} ${variable.unit}`
                    : beyondHorizon
                      ? '—'
                      : '–')}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
