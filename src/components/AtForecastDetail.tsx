// Punkt-Vorhersage einer MOSMIX-Station: Klick auf die DACH-Karte öffnet dieses
// Panel mit dem 72-h-Verlauf ALLER Parameter — das Gegenstück zum Stationsdetail
// der Klimakarte. Kostet kein Budget: die Parameter-JSONs liegen bereits als
// statische Assets vor, `loadForecast` cached sie modulweit; der erste Klick zieht
// die noch fehlenden Dateien einmal nach, jede weitere Station ist gratis.
//
// Die Zeitreihen der einzelnen Parameter werden über ihre EIGENEN timeSteps auf
// die Referenzachse gelegt — MOSMIX liefert nicht für jeden Parameter zwingend
// dieselben Termine, stumpfes Index-Matching würde die Kurven verschieben.

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { alignSeries, loadForecast, type ForecastData, type MosStation } from '../api/mosApi'
import { FORECAST_PARAMS } from '../config/atForecast'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'
const MARK = '#e8b23a'

const TZ = 'Europe/Berlin'
const fmtAxis = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', hour: '2-digit' })
const fmtDay = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' })
const fmtRun = new Intl.DateTimeFormat('de-DE', {
  timeZone: TZ,
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

interface Curve {
  label: string
  color: string
  type: 'line' | 'bars'
  values: (number | null)[]
}

/** Ein Diagramm des Stapels: eine gemeinsame y-Achse, 1–2 Kurven. */
interface ChartDef {
  title: string
  unit: string
  curves: Curve[]
  /** y bei 0 verankern (Niederschlag, Sonne, Bewölkung, Wind). */
  zeroBased?: boolean
  /** Feste y-Spanne (Bewölkung/Sonne in %). */
  range?: [number, number]
}

const hasData = (c: ChartDef) => c.curves.some((s) => s.values.some((v) => v != null))

export function AtForecastDetail({
  station,
  markTime,
  onClose,
}: {
  station: MosStation
  /** Zeitpunkt des Kartenschiebers (ms) — als Marker im Verlauf. */
  markTime?: number
  onClose: () => void
}) {
  const [data, setData] = useState<Record<string, ForecastData | null> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all(
      // Ein fehlender Parameter darf das Panel nicht kippen — dann fehlt eben
      // sein Diagramm, der Rest steht.
      FORECAST_PARAMS.map((p) => loadForecast(p.key).catch(() => null)),
    )
      .then((res) => {
        if (cancelled) return
        const map: Record<string, ForecastData | null> = {}
        FORECAST_PARAMS.forEach((p, i) => (map[p.key] = res[i]))
        if (Object.values(map).every((d) => d == null)) setError('Vorhersagedaten nicht ladbar')
        setData(map)
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Vorhersage nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [])

  const { xs, charts, days, run } = useMemo(() => {
    const empty = { xs: [] as number[], charts: [] as ChartDef[], days: [] as { day: string; min: number | null; max: number | null }[], run: '' }
    if (!data) return empty
    const ref = data.t2m?.timeSteps ?? []
    const id = station.id
    const get = (key: string) => alignSeries(ref, data[key] ?? null, id)

    const sunPct = get('sun').map((v) => (v == null ? null : (v / 60) * 100))
    const charts: ChartDef[] = [
      {
        title: 'Temperatur 2 m',
        unit: '°C',
        curves: [{ label: 'T2m', color: '#d95926', type: 'line', values: get('t2m') }],
      },
      {
        title: 'Niederschlag',
        unit: 'mm/h',
        zeroBased: true,
        curves: [{ label: 'RR', color: '#3987e5', type: 'bars', values: get('precip') }],
      },
      {
        title: 'Bewölkung / Sonne',
        unit: '%',
        range: [0, 100],
        curves: [
          { label: 'Bewölkung', color: '#8e9aa6', type: 'line', values: get('cloud') },
          { label: 'Sonne (% der Stunde)', color: '#c98500', type: 'line', values: sunPct },
        ],
      },
      {
        title: 'Wind',
        unit: 'km/h',
        zeroBased: true,
        curves: [{ label: 'Wind', color: '#199e70', type: 'line', values: get('wind') }],
      },
    ]

    // Tagesextreme aus den täglichen Dateien (eigene Achse: Tage, nicht Termine).
    const dayList = data.tmax?.days ?? data.tmin?.days ?? []
    const tmax = alignSeries(dayList, data.tmax ?? null, id)
    const tmin = alignSeries(dayList, data.tmin ?? null, id)

    return {
      xs: ref.map((t) => Date.parse(t) / 1000),
      charts: charts.filter(hasData),
      days: dayList.map((day, i) => ({ day, min: tmin[i] ?? null, max: tmax[i] ?? null })),
      run: data.t2m?.meta.run ?? '',
    }
  }, [data, station.id])

  return (
    <div className="atdetail">
      <div className="atdetail-head">
        <div>
          <strong>{station.name}</strong>
          {station.altitude != null && <span className="label-muted"> · {Math.round(station.altitude)} m</span>}
          <span className="label-muted"> · {station.id}</span>
        </div>
        <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>
      <div className="atdetail-sub">
        MOS-Punktvorhersage · Stundenwerte +{xs.length} h
        {days.length > 0 ? ` · Tagesextreme +${days.length} d` : ''}
        {run ? ` · Lauf ${fmtRun.format(new Date(run))}` : ''}
      </div>
      {days.length > 0 && (
        <div className="atfc-days">
          {days.map((d) => (
            <div key={d.day} className="atfc-day">
              <span className="atfc-daycap">{fmtDay.format(new Date(`${d.day}T12:00:00Z`))}</span>
              <span className="atfc-max">{d.max != null ? `${Math.round(d.max)}°` : '—'}</span>
              <span className="atfc-min">{d.min != null ? `${Math.round(d.min)}°` : '—'}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div className="panel-placeholder">{error}</div>}
      {!data && !error && <div className="panel-placeholder">Lade Vorhersage …</div>}
      {data && !error && charts.length === 0 && (
        <div className="panel-placeholder">Für diese Station liefert MOSMIX keine Werte</div>
      )}
      {charts.map((c) => (
        <div key={c.title} className="atfc-chart">
          <div className="atfc-chartcap">
            <span>
              {c.title} <span className="label-muted">({c.unit})</span>
            </span>
            {c.curves.length > 1 && (
              <span className="atfc-legend">
                {c.curves.map((s) => (
                  <span key={s.label}>
                    <i style={{ background: s.color }} /> {s.label}
                  </span>
                ))}
              </span>
            )}
          </div>
          <MiniChart xs={xs} chart={c} markTime={markTime} />
        </div>
      ))}
    </div>
  )
}

/** Ein Diagramm des Stapels — uPlot-Setup im Stil von AtStationDetail. */
function MiniChart({ xs, chart, markTime }: { xs: number[]; chart: ChartDef; markTime?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  // Marker über ein Ref führen: sonst würde jede Schieberbewegung den Plot neu
  // aufbauen, statt ihn nur neu zu zeichnen.
  const markRef = useRef<number | undefined>(markTime)

  useEffect(() => {
    markRef.current = markTime
    plotRef.current?.redraw()
  }, [markTime])

  useEffect(() => {
    const el = ref.current
    if (!el || xs.length === 0) return

    const markPlugin: uPlot.Plugin = {
      hooks: {
        draw: (u) => {
          const t = markRef.current
          if (t == null) return
          const x = u.valToPos(t / 1000, 'x', true)
          if (!Number.isFinite(x)) return
          const ctx = u.ctx
          ctx.save()
          ctx.strokeStyle = MARK
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, u.bbox.top)
          ctx.lineTo(x, u.bbox.top + u.bbox.height)
          ctx.stroke()
          ctx.restore()
        },
      },
    }

    const bars = uPlot.paths.bars?.({ size: [0.7, 12] })
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 60),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), TZ),
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      plugins: [markPlugin],
      scales: {
        y: chart.range
          ? { range: chart.range }
          : chart.zeroBased
            ? { range: (_u, _min, max) => [0, max > 0 ? max * 1.1 : 1] }
            : {},
      },
      series: [
        {},
        ...chart.curves.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          points: { show: false },
          ...(s.type === 'bars' ? { fill: s.color, paths: bars } : {}),
        })),
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 62,
          values: (_u, ticks) => ticks.map((t) => fmtAxis.format(new Date(t * 1000))),
        },
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 38,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
      ],
    }
    const u = new uPlot(opts, [xs, ...chart.curves.map((s) => s.values)] as uPlot.AlignedData, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
  }, [xs, chart])

  return <div className="atfc-plot" ref={ref} />
}
