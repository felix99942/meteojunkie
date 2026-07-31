// Ensemble-Modus (SPEC §9 Phase 3): Plume-Diagramm am Location-Lock-Punkt.
//
// Bewusst PUNKTbasiert und nicht als Karte — 51 Mitglieder mal Gitterpunkte
// sprengen das Free-Tier-Budget um Größenordnungen (Rechnung in
// config/ensemble.ts). Ein Punkt kostet dagegen ~5 gewichtete Locations.
//
// Eigene Zeitachse über den vollen Ensemble-Horizont (15 Tage) statt des
// 7-Tage-Session-Rasters: die Streuung wird erst ab Tag 5 interessant, das ist
// der Grund, warum man ein Ensemble überhaupt anschaut. Der globale Zeit-Cursor
// wird als Markerlinie eingezeichnet, damit der Bezug zu den übrigen Panels
// erhalten bleibt; ein Klick in den Plot setzt ihn (soweit er im Raster liegt).

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useDeterministicSeries, useEnsembleSeries } from '../api/queries'
import {
  ENSEMBLE_QUICK_POINTS,
  getEnsembleModel,
  getEnsembleVariable,
} from '../config/ensemble'
import { TIME_RANGE } from '../config/time'
import { accumulateMembers, plumeStats, readoutAt } from '../render/plume'
import { useWorkbench, type PanelConfig } from '../state/workbench'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'

// Farben aus dem validierten Bestand (config/colors.ts): Hauptlauf orange,
// Kontrolllauf magenta gestrichelt, Median blau — drei klar trennbare Linien,
// die Mitglieder dahinter blass.
const MEMBER_LINE = 'rgba(120,170,230,0.22)'
const BAND_FILL = 'rgba(57,135,229,0.16)'
const BAND_LINE = 'rgba(57,135,229,0.45)'
const MEDIAN_LINE = '#3987e5'
const CONTROL_LINE = '#d55181'
const HRES_LINE = '#d95926'
const CURSOR_LINE = '#e8b23a'

/** Kleinster Zeitausschnitt beim Zoomen (6 h) — darunter wird es sinnlos fein. */
const MIN_ZOOM_RANGE_SEC = 6 * 3600

const fmtDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
const fmtFull = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
})

export function EnsemblePanel({ panel }: { panel: PanelConfig }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const cursorTime = useWorkbench((s) => s.cursorTime)
  const setCursorTime = useWorkbench((s) => s.setCursorTime)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)

  const model = getEnsembleModel(panel.ensembleModel)
  const variable = getEnsembleVariable(panel.ensembleVariable)
  const query = useEnsembleSeries(location, model.id, variable.id)
  const hres = useDeterministicSeries(location, model.id, variable.id)

  const [showMembers, setShowMembers] = useState(true)
  const [zoomed, setZoomed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const cursorRef = useRef(cursorTime)

  // Summengrößen (Niederschlag/Schnee) als kumulierte Kurve — Stundenwerte als
  // 51 Spaghetti sind nicht lesbar, die Summe ist die eigentliche Frage.
  const prepared = useMemo(() => {
    if (!query.data) return null
    const members =
      variable.kind === 'accum' ? accumulateMembers(query.data.members) : query.data.members
    // Hauptlauf auf die Zeitachse des Ensembles legen (er hat eigene Stützstellen
    // und einen eigenen Horizont) — Index-Matching wäre hier schlicht falsch.
    let deterministic: (number | null)[] | null = null
    if (hres.data) {
      const byTime = new Map<number, number | null>()
      for (let i = 0; i < hres.data.times.length; i++) byTime.set(hres.data.times[i], hres.data.values[i])
      const raw = query.data.times.map((t) => byTime.get(t) ?? null)
      deterministic = variable.kind === 'accum' ? accumulateMembers([raw])[0] : raw
    }
    return {
      times: query.data.times,
      members,
      deterministic,
      unit: query.data.unit,
      stats: plumeStats(members),
    }
  }, [query.data, hres.data, variable.kind])

  // Ablesezeile am Zeit-Cursor.
  const readout = useMemo(() => {
    if (!prepared) return null
    const i = prepared.times.findIndex((t) => t >= cursorTime)
    if (i < 0) return null
    return {
      at: prepared.times[i],
      r: readoutAt(prepared.stats, i),
      hres: prepared.deterministic?.[i] ?? null,
      control: prepared.members[0]?.[i] ?? null,
    }
  }, [prepared, cursorTime])

  // Cursorlinie nur neu ZEICHNEN, nicht den Plot neu bauen.
  useEffect(() => {
    cursorRef.current = cursorTime
    plotRef.current?.redraw()
  }, [cursorTime])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !prepared || prepared.times.length === 0) return
    const xs = prepared.times.map((t) => t / 1000)
    const { stats, members } = prepared

    const fullMin = xs[0]
    const fullMax = xs[xs.length - 1]

    const cursorPlugin: uPlot.Plugin = {
      hooks: {
        // Zoomzustand mitführen, damit der Zurück-Knopf nur dann erscheint,
        // wenn wirklich ein Ausschnitt gewählt ist.
        setScale: (u, key) => {
          if (key !== 'x') return
          const sc = u.scales.x
          setZoomed((sc.min ?? fullMin) > fullMin + 1 || (sc.max ?? fullMax) < fullMax - 1)
        },
        draw: (u) => {
          const x = u.valToPos(cursorRef.current / 1000, 'x', true)
          if (!Number.isFinite(x)) return
          const ctx = u.ctx
          ctx.save()
          ctx.strokeStyle = CURSOR_LINE
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, u.bbox.top)
          ctx.lineTo(x, u.bbox.top + u.bbox.height)
          ctx.stroke()
          ctx.restore()
        },
      },
    }

    // Serienreihenfolge: p90/p10 (Band), Median, Kontrolllauf, Hauptlauf, dann
    // Mitglieder. Das Band bezieht sich über `bands` auf die Perzentil-Serien.
    const data: (number | null)[][] = [stats.p90, stats.p10, stats.median, members[0] ?? []]
    if (prepared.deterministic) data.push(prepared.deterministic)
    if (showMembers) for (let m = 1; m < members.length; m++) data.push(members[m])

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 80),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      legend: { show: false },
      // uPlots eigenes Zieh-Auswählen ist AUS: gezoomt wird mit dem Mausrad,
      // gezogen wird verschoben (wie in der Österreich-Karte). Ein Rechteck
      // aufzuziehen trifft den gewünschten Ausschnitt nie beim ersten Versuch.
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      plugins: [cursorPlugin],
      scales: variable.zeroBased
        ? { y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] } }
        : {},
      bands: [{ series: [1, 2], fill: BAND_FILL }],
      series: [
        {},
        { label: 'P90', stroke: BAND_LINE, width: 1, points: { show: false } },
        { label: 'P10', stroke: BAND_LINE, width: 1, points: { show: false } },
        { label: 'Median', stroke: MEDIAN_LINE, width: 2, points: { show: false } },
        {
          label: 'Kontrolllauf',
          stroke: CONTROL_LINE,
          width: 1.5,
          dash: [5, 3],
          points: { show: false },
        },
        ...(prepared.deterministic
          ? [{ label: 'Hauptlauf', stroke: HRES_LINE, width: 2, points: { show: false } }]
          : []),
        ...(showMembers
          ? members.slice(1).map(() => ({
              stroke: MEMBER_LINE,
              width: 1,
              points: { show: false },
            }))
          : []),
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 52,
          values: (_u, ticks) => ticks.map((t) => fmtDay.format(new Date(t * 1000))),
        },
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 46,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
      ],
    }

    const u = new uPlot(opts, [xs, ...data] as uPlot.AlignedData, el)
    plotRef.current = u
    // Klick setzt den globalen Cursor — aber nur innerhalb des Session-Rasters,
    // sonst würden die übrigen Panels auf eine Zeit zeigen, die sie nicht haben.
    // Ein Zoom-Ziehen endet ebenfalls mit einem click-Event: gezogene Klicks
    // dürfen den Cursor NICHT versetzen, sonst springt er bei jedem Zoom.
    // --- Zoom (Mausrad) und Verschieben (Ziehen) ---------------------------
    // Beides rein clientseitig: die Reihen liegen vollständig im Speicher, ein
    // Zoom kostet keinen einzigen Request. Der Ausschnitt bleibt immer in den
    // Datengrenzen — aus dem Horizont hinauszuscrollen zeigt nur leere Fläche.
    const clampRange = (min: number, max: number): { min: number; max: number } => {
      const range = Math.min(fullMax - fullMin, max - min)
      if (min < fullMin) return { min: fullMin, max: fullMin + range }
      if (max > fullMax) return { min: fullMax - range, max: fullMax }
      return { min, max }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = u.over.getBoundingClientRect()
      const px = e.clientX - rect.left
      const min = u.scales.x.min ?? fullMin
      const max = u.scales.x.max ?? fullMax
      const range = max - min
      const at = u.posToVal(px, 'x') // Zeitwert unter dem Zeiger — der bleibt stehen
      const next = Math.min(
        fullMax - fullMin,
        Math.max(MIN_ZOOM_RANGE_SEC, range * (e.deltaY < 0 ? 1 / 1.25 : 1.25)),
      )
      const pct = range > 0 ? (at - min) / range : 0.5
      u.setScale('x', clampRange(at - pct * next, at - pct * next + next))
    }

    let pan: { px: number; min: number; max: number } | null = null
    let downX = -1
    const onDown = (e: MouseEvent) => {
      downX = e.clientX
      pan = { px: e.clientX, min: u.scales.x.min ?? fullMin, max: u.scales.x.max ?? fullMax }
    }
    const onMove = (e: MouseEvent) => {
      if (!pan || (e.buttons & 1) === 0) return
      const rect = u.over.getBoundingClientRect()
      const range = pan.max - pan.min
      const dx = ((e.clientX - pan.px) / Math.max(1, rect.width)) * range
      u.setScale('x', clampRange(pan.min - dx, pan.max - dx))
    }
    const onUp = () => {
      pan = null
    }
    const onClick = (e: MouseEvent) => {
      // Ein Verschieben endet ebenfalls mit einem click-Event — sonst würde der
      // Zeit-Cursor bei jedem Ziehen mitspringen.
      if (downX >= 0 && Math.abs(e.clientX - downX) > 3) return
      const t = u.posToVal(u.cursor.left ?? -1, 'x') * 1000
      if (Number.isFinite(t) && t >= TIME_RANGE.start && t <= TIME_RANGE.end) setCursorTime(t)
    }
    const onDblClick = () => u.setScale('x', { min: fullMin, max: fullMax })

    u.over.addEventListener('wheel', onWheel, { passive: false })
    u.over.addEventListener('mousedown', onDown)
    u.over.addEventListener('mousemove', onMove)
    u.over.addEventListener('dblclick', onDblClick)
    window.addEventListener('mouseup', onUp)
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.over.removeEventListener('wheel', onWheel)
      u.over.removeEventListener('mousedown', onDown)
      u.over.removeEventListener('mousemove', onMove)
      u.over.removeEventListener('dblclick', onDblClick)
      u.over.removeEventListener('click', onClick)
      window.removeEventListener('mouseup', onUp)
      u.destroy()
      plotRef.current = null
      setZoomed(false)
    }
  }, [prepared, showMembers, variable.zeroBased, setCursorTime])

  /** Zoom aufheben — dasselbe wie Doppelklick im Plot. */
  const resetZoom = () => {
    const u = plotRef.current
    if (!u || !prepared || prepared.times.length === 0) return
    u.setScale('x', {
      min: prepared.times[0] / 1000,
      max: prepared.times[prepared.times.length - 1] / 1000,
    })
  }

  const fmtVal = (v: number) =>
    Math.abs(v) >= 100 ? String(Math.round(v)) : Number.isInteger(v) ? String(v) : v.toFixed(1)

  return (
    <div className="ens">
      <div className="ens-bar">
        <span className="ens-quickcap label-muted">Punkt</span>
        {ENSEMBLE_QUICK_POINTS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={
              location && Math.abs(location.lat - p.lat) < 0.02 && Math.abs(location.lon - p.lon) < 0.02
                ? 'ens-quick is-active'
                : 'ens-quick'
            }
            onClick={() => setLockedLocation(p)}
            title={`${p.label} — ${p.lat.toFixed(2)}°N ${p.lon.toFixed(2)}°O`}
          >
            {p.label}
          </button>
        ))}
        {zoomed && (
          <button type="button" className="ens-quick" onClick={resetZoom} title="Ganzen Horizont zeigen">
            ⤢ Zoom zurück
          </button>
        )}
        <label className="ens-toggle" title="Alle Member als Spaghetti zeigen">
          <input
            type="checkbox"
            checked={showMembers}
            onChange={(e) => setShowMembers(e.target.checked)}
          />
          Member
        </label>
      </div>

      {/* Legende: ohne sie ist nicht ablesbar, welche Linie was ist. */}
      <div className="ens-legend">
        <span title="Deterministischer ECMWF-Lauf (HRES) — höher aufgelöst, EINE Lösung ohne Störung. Eigener Abruf, das Ensemble liefert ihn nicht mit.">
          <i style={{ background: HRES_LINE }} /> Hauptlauf
        </span>
        <span title="Ungestörter Ensemble-Member in Ensemble-Auflösung — die Referenz INNERHALB der Verteilung, nicht der Hauptlauf.">
          <i className="ens-dash" style={{ background: CONTROL_LINE }} /> Kontrolllauf
        </span>
        <span title="Mittlerer Member je Zeitschritt (50. Perzentil)">
          <i style={{ background: MEDIAN_LINE, height: 3 }} /> Median
        </span>
        <span title="80 % der Member liegen in diesem Band">
          <i className="ens-bandswatch" /> P10–P90
        </span>
        {showMembers && (
          <span title="Alle gestörten Member als Spaghetti">
            <i style={{ background: 'rgba(120,170,230,0.6)' }} /> {model.members - 1} Member
          </span>
        )}
        <span className="ens-hint label-muted">
          Rad = Zoom · Ziehen = Verschieben · Doppelklick = Reset · Klick = Zeit
        </span>
      </div>

      <div className="ens-body">
        <div className="ens-plot" ref={containerRef} />
        {!location && (
          <div className="panel-placeholder ens-overlay">
            Standort wählen (oben suchen oder in die Karte klicken) — das Ensemble braucht einen Punkt
          </div>
        )}
        {location && query.isPending && (
          <div className="panel-placeholder ens-overlay">Lade {model.label} …</div>
        )}
        {location && query.isError && (
          <div className="panel-placeholder ens-overlay">
            {(query.error as Error)?.message ?? 'Ensemble nicht ladbar'}
          </div>
        )}
      </div>

      <div className="ens-foot">
        {readout?.r ? (
          <>
            <span className="ens-readcap">
              {fmtFull.format(new Date(readout.at))} UTC
            </span>
            <span style={{ color: HRES_LINE }}>
              Hauptlauf{' '}
              <strong>{readout.hres != null ? fmtVal(readout.hres) : '—'}</strong> {variable.unit}
            </span>
            <span style={{ color: CONTROL_LINE }}>
              Kontrolllauf{' '}
              <strong>{readout.control != null ? fmtVal(readout.control) : '—'}</strong>
            </span>
            <span style={{ color: MEDIAN_LINE }}>
              Median <strong>{fmtVal(readout.r.median)}</strong>
            </span>
            <span className="label-muted">
              P10–P90 {fmtVal(readout.r.p10)}…{fmtVal(readout.r.p90)} · Spanne{' '}
              {fmtVal(readout.r.min)}…{fmtVal(readout.r.max)} · Streuung{' '}
              <strong>{fmtVal(readout.r.spread)}</strong> {variable.unit}
            </span>
            <span className="label-muted">
              {readout.r.count} von {model.members} Member
            </span>
          </>
        ) : (
          <span className="label-muted">
            {model.label} · {model.members} Member · {model.forecastDays} Tage
            {variable.kind === 'accum' ? ' · Werte über die Vorhersagezeit aufsummiert' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
