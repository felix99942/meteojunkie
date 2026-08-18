// Perioden-Historie im Stationsdetail: dieselbe Größe wie in der Karte, aber
// über die letzten Jahre. Wer „Niederschlagssumme, Sommer 2026, Abweichung"
// anschaut und eine Station anklickt, will die Sommer VERGLEICHEN — Tagessummen
// des letzten Jahres beantworten dort keine Frage.
//
// Ein Request je Station (Monatsdatensatz, ~16 Jahre), gecacht wie alle
// GeoSphere-Abrufe. Im Abweichungsmodus wird gegen dasselbe Normal gerechnet
// wie in der Karte, damit Balken und Kartenfarbe dieselbe Zahl meinen.

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { DATASET_MONTHLY, fetchStationSeries, type AtStation } from '../api/geosphere'
import { clean, recentPeriodTtl, SEASON_LABEL, seasonYearLabel } from '../api/atValues'
import { anomaly, anomalyBarColors, anomalyDisplay, type AtParameterSpec } from '../config/atParameters'
import { buildHistory, historyStart, historyStats, type HistoryScope } from './atHistory'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'
const BAR_PLAIN = '#3987e5'

/** Wie viele Perioden zurück. 15 zeigt einen Trend, ohne die Balken zu zerquetschen. */
export const HISTORY_SPAN = 15

const fmt = (v: number): string =>
  Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)

function scopeLabel(scope: HistoryScope, monthNames: string[]): string {
  if (scope.kind === 'month') return monthNames[scope.month - 1]
  if (scope.kind === 'season') return SEASON_LABEL[scope.season]
  return 'Jahr'
}

function pointLabel(scope: HistoryScope, year: number, monthNames: string[]): string {
  if (scope.kind === 'month') return `${monthNames[scope.month - 1]} ${year}`
  if (scope.kind === 'season') return seasonYearLabel(scope.season, year)
  return String(year)
}

export function AtPeriodHistory({
  station,
  spec,
  scope,
  firstYear,
  lastYear,
  /** Normal dieser Station für den Zeitbezug; null → keine Abweichung möglich. */
  normal,
  showAnomaly,
  refLabel,
  monthNames,
}: {
  station: AtStation
  spec: AtParameterSpec
  scope: HistoryScope
  firstYear: number
  lastYear: number
  normal: number | null
  showAnomaly: boolean
  refLabel: string
  monthNames: string[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [raw, setRaw] = useState<{ timestamps: string[]; values: (number | null)[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  const code = spec.monthlyCode
  const start = useMemo(() => historyStart(scope, firstYear), [scope, firstYear])
  const end = `${lastYear}-12-01`

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchStationSeries(code, start, end, [station.id], DATASET_MONTHLY, recentPeriodTtl(end))
      .then((s) => {
        if (cancelled) return
        setRaw({ timestamps: s.timestamps, values: s.byStation[station.id] ?? [] })
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Reihe nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [code, start, end, station.id])

  // Werte der Perioden — bei Saison/Jahr mit annualAgg, wie in der Karte.
  const points = useMemo(() => {
    if (!raw) return null
    const agg = scope.kind === 'month' ? spec.agg : spec.annualAgg
    const cleaned = raw.values.map((v) => clean(spec, v))
    return buildHistory(raw.timestamps, cleaned, scope, firstYear, lastYear, agg)
  }, [raw, scope, firstYear, lastYear, spec])

  const anom = anomalyDisplay(spec)
  const asAnomaly = showAnomaly && normal != null

  /** Angezeigte Werte: Absolutwerte oder Abweichungen gegen dasselbe Normal wie die Karte. */
  const shown = useMemo(() => {
    if (!points) return null
    return points.map((p) => ({
      year: p.year,
      value:
        p.value == null
          ? null
          : asAnomaly
            ? anomaly(p.value, normal as number, spec.anomalyKind)
            : p.value,
      absolute: p.value,
    }))
  }, [points, asAnomaly, normal, spec.anomalyKind])

  const stats = useMemo(
    () => (points ? historyStats(points.map((p) => ({ year: p.year, value: p.value }))) : null),
    [points],
  )

  // Bei Prozent-Anomalien liegt die Neutrallinie bei 100 %, nicht bei 0.
  const baseline = asAnomaly && spec.anomalyKind === 'percent' ? 100 : 0

  useEffect(() => {
    const el = containerRef.current
    if (!el || !shown || shown.length === 0) return
    const xs = shown.map((p) => p.year)
    const above = shown.map((p) => (p.value != null && p.value >= baseline ? p.value : null))
    const below = shown.map((p) => (p.value != null && p.value < baseline ? p.value : null))
    // Absolutwerte brauchen keine Zweifarbigkeit — dort ist alles „eine Richtung".
    const series: (number | null)[][] = asAnomaly ? [above, below] : [shown.map((p) => p.value)]
    const barColors = anomalyBarColors(spec)

    const bars = uPlot.paths.bars?.({ size: [0.72, 24] })
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 70),
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      scales: {
        // Jahre, keine Zeitachse — sonst rechnet uPlot sie in Epoch-Sekunden um.
        x: { time: false },
        y: asAnomaly
          ? {
              // Neutrallinie IMMER im Bild, sonst wirkt eine leichte Abweichung
              // wie ein Extrem (die Achse begänne sonst am kleinsten Balken).
              range: (_u, min, max) => [Math.min(min, baseline), Math.max(max, baseline)],
            }
          : { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] },
      },
      series: [
        {},
        ...(asAnomaly
          ? [
              { stroke: barColors.pos, fill: barColors.pos, paths: bars, points: { show: false } },
              { stroke: barColors.neg, fill: barColors.neg, paths: bars, points: { show: false } },
            ]
          : [{ stroke: BAR_PLAIN, fill: BAR_PLAIN, paths: bars, points: { show: false } }]),
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { show: false },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 34,
          values: (_u, ticks) => ticks.map((t) => (Number.isInteger(t) ? `'${String(t).slice(2)}` : '')),
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
        setCursor: [(u) => setHover(u.cursor.idx ?? null)],
        draw: [
          (u) => {
            // Bezugslinie (0 bzw. 100 %) hervorheben — ohne sie ist bei einer
            // Abweichungsreihe nicht ablesbar, wo „normal" liegt.
            if (!asAnomaly) return
            const y = u.valToPos(baseline, 'y', true)
            const ctx = u.ctx
            ctx.save()
            ctx.strokeStyle = 'rgba(255,255,255,0.45)'
            ctx.lineWidth = devicePixelRatio
            ctx.beginPath()
            ctx.moveTo(u.bbox.left, y)
            ctx.lineTo(u.bbox.left + u.bbox.width, y)
            ctx.stroke()
            ctx.restore()
          },
        ],
      },
    }
    const u = new uPlot(opts, [xs, ...series] as unknown as uPlot.AlignedData, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        u.setSize({ width: el.clientWidth, height: el.clientHeight })
      }
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
  }, [shown, asAnomaly, baseline, spec])

  if (!code) {
    return (
      <div className="atdetail-note">
        {spec.label} gibt es nur im Tagesdatensatz — für Monat, Saison und Jahr führt GeoSphere
        keine Werte, deshalb auch keine Reihe über die Jahre.
      </div>
    )
  }

  const unit = asAnomaly ? anom.unit : spec.unit
  const at = hover != null && shown ? shown[hover] : null

  return (
    <>
      <div className="atdetail-histcap">
        {scopeLabel(scope, monthNames)} {firstYear}–{lastYear} ·{' '}
        {asAnomaly ? `Abweichung vs. ${refLabel}` : spec.label} · {unit}
      </div>
      <div ref={containerRef} className="atdetail-chart" />
      {loading && <div className="atdetail-note">lädt Reihe …</div>}
      {error && <div className="atdetail-note">{error}</div>}
      {at && at.value != null ? (
        <div className="atdetail-stats">
          <span>
            <strong>{pointLabel(scope, at.year, monthNames)}</strong>
          </span>
          <span>
            {asAnomaly ? 'Abweichung' : 'Wert'}{' '}
            <strong>
              {anom.signed && asAnomaly && at.value > 0 ? '+' : ''}
              {fmt(at.value)}
            </strong>{' '}
            {unit}
          </span>
          {asAnomaly && at.absolute != null && (
            <span className="label-muted">
              absolut {fmt(at.absolute)} {spec.unit}
            </span>
          )}
        </div>
      ) : (
        stats && (
          <div className="atdetail-stats">
            <span>
              Höchster <strong>{fmt(stats.max)}</strong>
            </span>
            <span>
              Mittel <strong>{fmt(stats.mean)}</strong>
            </span>
            <span>
              Tiefster <strong>{fmt(stats.min)}</strong>
            </span>
            <span className="label-muted">{stats.n} vollständige Perioden</span>
          </div>
        )
      )}
      {showAnomaly && normal == null && (
        <div className="atdetail-note">
          Für diese Station gibt es kein Normal in {refLabel} — gezeigt sind die Absolutwerte.
        </div>
      )}
    </>
  )
}
