// Stationsdetail der Österreich-Klimakarte (Schritt 4): Klick auf eine Station
// öffnet dieses Panel mit der Tages-Zeitreihe des gewählten Parameters über das
// letzte Jahr (ein Bulk-Request je Station, gecacht) plus Min/Mittel/Max.
// uPlot-Setup im Stil von Meteogram.tsx.

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { fetchStationSeries, type AtStation } from '../api/geosphere'
import { loadRecords, type RecordsData } from '../api/atValues'
import { getAtParameter } from '../config/atParameters'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'
const LINE = '#3987e5'

const fmtMonth = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', month: 'short' })

/** YYYY-MM-DD (UTC) n Tage vor `iso`. */
function daysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function AtStationDetail({
  station,
  paramCode,
  day,
  onClose,
}: {
  station: AtStation
  paramCode: string
  day: string
  onClose: () => void
}) {
  const spec = getAtParameter(paramCode)
  const start = useMemo(() => daysBefore(day, 365), [day])
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  const [data, setData] = useState<{ xs: number[]; ys: (number | null)[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [records, setRecords] = useState<RecordsData | null>(null)

  useEffect(() => {
    let cancelled = false
    loadRecords()
      .then((r) => !cancelled && setRecords(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchStationSeries(paramCode, start, day, [station.id])
      .then((s) => {
        if (cancelled) return
        const xs = s.timestamps.map((t) => Date.parse(t) / 1000)
        const raw = s.byStation[station.id] ?? []
        // GeoSphere nutzt bei rr/sh -1 (o.ä. < 0) als Fehlwert → als Lücke behandeln
        const nonNeg = spec.category === 'Niederschlag' || spec.category === 'Schnee'
        const ys = raw.map((v) => (v == null || (nonNeg && v < 0) ? null : v))
        setData({ xs, ys })
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Zeitreihe nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [station.id, paramCode, start, day, spec.category])

  // Kennzahlen über das Fenster.
  const stats = useMemo(() => {
    if (!data) return null
    const nums = data.ys.filter((v): v is number => v != null && Number.isFinite(v))
    if (nums.length === 0) return null
    const sum = nums.reduce((a, b) => a + b, 0)
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
      mean: sum / nums.length,
      sum,
      n: nums.length,
    }
  }, [data])

  // uPlot-Lebenszyklus.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !data) return
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 80),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      scales:
        spec.category === 'Niederschlag' || spec.category === 'Sonne' || spec.category === 'Schnee'
          ? { y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] } }
          : {},
      series: [
        {},
        { label: spec.label, stroke: LINE, width: 1.5, points: { show: false } },
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 54,
          values: (_u, ticks) =>
            ticks.map((t) => fmtMonth.format(new Date(t * 1000))),
        },
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 44,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
      ],
    }
    const u = new uPlot(opts, [data.xs, data.ys] as uPlot.AlignedData, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
  }, [data, spec.label, spec.category])

  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

  // Rekorde (Monatsextreme) für diesen Parameter — nur für die vorberechneten Codes.
  const REC_CODES = new Set(['tl_mittel', 'tlmax', 'tlmin', 'rr', 'so_h'])
  const recCode = spec.monthlyCode && REC_CODES.has(spec.monthlyCode) ? spec.monthlyCode : null
  const stationRec = recCode ? records?.byStation[station.id]?.[recCode] : undefined
  const nationalRec = recCode ? records?.national[recCode] : undefined

  return (
    <div className="atdetail">
      <div className="atdetail-head">
        <div>
          <strong>{station.name}</strong>
          {station.altitude != null && <span className="label-muted"> · {Math.round(station.altitude)} m</span>}
          {station.state && <span className="label-muted"> · {station.state}</span>}
        </div>
        <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>
      <div className="atdetail-sub">
        {spec.label} ({spec.unit}) · letzte 12 Monate bis {day}
      </div>
      {stats && (
        <div className="atdetail-stats">
          <span>Min <strong>{fmt(stats.min)}</strong></span>
          <span>Mittel <strong>{fmt(stats.mean)}</strong></span>
          <span>Max <strong>{fmt(stats.max)}</strong></span>
          {(spec.agg === 'sum') && <span>Summe <strong>{fmt(stats.sum)}</strong></span>}
          <span className="label-muted">{stats.n} Tage</span>
        </div>
      )}
      {stationRec && (
        <div className="atdetail-records">
          <span>
            Rekord ▲ <strong>{fmt(stationRec.max.value)} {spec.unit}</strong>{' '}
            <span className="label-muted">{stationRec.max.date}</span>
          </span>
          <span>
            ▼ <strong>{fmt(stationRec.min.value)} {spec.unit}</strong>{' '}
            <span className="label-muted">{stationRec.min.date}</span>
          </span>
          {nationalRec && (
            <span className="label-muted" title="Österreichweiter Monatsrekord">
              AT ▲ {fmt(nationalRec.max.value)} ({nationalRec.max.name}, {nationalRec.max.date})
            </span>
          )}
        </div>
      )}
      <div className="atdetail-chart">
        <div className="atdetail-plot" ref={containerRef} />
        {loading && <div className="panel-placeholder atdetail-overlay">Lade Zeitreihe …</div>}
        {error && <div className="panel-placeholder atdetail-overlay">{error}</div>}
        {!loading && !error && !stats && (
          <div className="panel-placeholder atdetail-overlay">Keine Daten im Zeitraum</div>
        )}
      </div>
    </div>
  )
}
