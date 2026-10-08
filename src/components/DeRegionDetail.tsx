// Detail eines Gebietsmittels (Bundesland oder Deutschland): die ganze Reihe
// seit 1881 bzw. 1951 für den Ausschnitt des Zeitbezugs, der gewählte
// Zeitraum hervorgehoben, dazu sein RANG — „Platz 2 der wärmsten Septembers
// seit 1881" ist die Frage, mit der man auf ein Gebietsmittel schaut.
//
// Die Balken folgen der Lesart der Perioden-Historie im Österreich-Detail
// (`AtPeriodHistory`): im Abweichungsmodus zweifarbig um das Normal derselben
// Reihe, sonst einfarbig.

import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { rankOf, regionSeries, type RegionSeriesPoint } from '../api/deRegional'
import { anomaly, anomalyBarColors, anomalyDisplay, type AtParameterSpec } from '../config/atParameters'

const INK_MUTED = '#8b8f97'
const GRIDLINE = 'rgba(255,255,255,0.07)'
const AXIS_FONT = '10px system-ui, sans-serif'
const BAR_PLAIN = '#6f8fb3'
const MARK = '#ffd84d'

/** Superlativ im Genitiv Plural — „Platz 2 der wärmsten". */
const SUPERLATIVE: Record<string, [string, string]> = {
  tl_mittel: ['wärmsten', 'kältesten'],
  rr: ['nassesten', 'trockensten'],
  so_h: ['sonnigsten', 'sonnenärmsten'],
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function DeRegionDetail({
  id,
  name,
  spec,
  quantity,
  periodLabel,
  scopeName,
  year,
  month,
  season,
  normal,
  showAnomaly,
  refLabel,
  onClose,
}: {
  id: number
  name: string
  spec: AtParameterSpec
  quantity: string
  periodLabel: string
  /** Ausschnitt im Klartext („September", „Sommer", „Jahr") */
  scopeName: string
  /** Gewähltes Jahr (null bei der Klimaperiode — dann ohne Hervorhebung und Rang). */
  year: number | null
  month: number | null
  season: number | null
  normal: number | null
  showAnomaly: boolean
  refLabel: string
  onClose: () => void
}) {
  const [series, setSeries] = useState<RegionSeriesPoint[] | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const anom = anomalyDisplay(spec)
  const asAnomaly = showAnomaly && normal != null
  // Auch Kenntage mit Nachkommastelle: ein FLÄCHENmittel von 82,9 Frosttagen ist kein Zählwert
  const digits = 1

  useEffect(() => {
    let cancelled = false
    setSeries(null)
    regionSeries(spec, id, month, season)
      .then((s) => !cancelled && setSeries(s))
      .catch(() => !cancelled && setSeries([]))
    return () => {
      cancelled = true
    }
  }, [spec, id, month, season])

  const shown = useMemo(
    () =>
      series?.map((p) => ({
        year: p.year,
        value: asAnomaly ? anomaly(p.value, normal as number, spec.anomalyKind) : p.value,
        absolute: p.value,
      })) ?? null,
    [series, asAnomaly, normal, spec.anomalyKind],
  )
  const baseline = asAnomaly && spec.anomalyKind === 'percent' ? 100 : 0

  useEffect(() => {
    const el = containerRef.current
    if (!el || !shown || shown.length === 0) return
    const xs = shown.map((p) => p.year)
    const barColors = anomalyBarColors(spec)
    const series: (number | null)[][] = asAnomaly
      ? [
          shown.map((p) => (p.value != null && p.value >= baseline ? p.value : null)),
          shown.map((p) => (p.value != null && p.value < baseline ? p.value : null)),
        ]
      : [shown.map((p) => p.value)]
    const bars = uPlot.paths.bars?.({ size: [0.8, 12] })
    const selIdx = year == null ? -1 : xs.indexOf(year)
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 90),
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      scales: {
        x: { time: false },
        y: asAnomaly
          ? { range: (_u, min, max) => [Math.min(min, baseline), Math.max(max, baseline)] }
          : spec.category === 'Temperatur'
            ? { range: (_u, min, max) => [Math.floor(min - 0.5), Math.ceil(max + 0.5)] }
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
          space: 40,
          // Jahreszahlen OHNE Tausenderpunkt — uPlot formatiert sonst nach
          // Gebietsschema („1.885")
          values: (_u, ticks) => ticks.map((t) => (Number.isInteger(t) ? String(t) : '')),
        },
        { stroke: INK_MUTED, font: AXIS_FONT, size: 44, grid: { stroke: GRIDLINE, width: 1 }, ticks: { stroke: GRIDLINE, width: 1 } },
      ],
      hooks: {
        setCursor: [(u) => setHover(u.cursor.idx ?? null)],
        draw: [
          (u) => {
            const ctx = u.ctx
            ctx.save()
            ctx.setLineDash([])
            if (asAnomaly) {
              const y = u.valToPos(baseline, 'y', true)
              ctx.strokeStyle = 'rgba(255,255,255,0.45)'
              ctx.lineWidth = devicePixelRatio
              ctx.beginPath()
              ctx.moveTo(u.bbox.left, y)
              ctx.lineTo(u.bbox.left + u.bbox.width, y)
              ctx.stroke()
            }
            // Der gewählte Zeitraum: gelbe Marke über die volle Höhe — bei
            // 145 Balken fände man ihn sonst nicht
            if (selIdx >= 0) {
              const x = u.valToPos(xs[selIdx], 'x', true)
              ctx.strokeStyle = MARK
              ctx.lineWidth = 2 * devicePixelRatio
              ctx.beginPath()
              ctx.moveTo(x, u.bbox.top)
              ctx.lineTo(x, u.bbox.top + u.bbox.height)
              ctx.stroke()
            }
            ctx.restore()
          },
        ],
      },
    }
    const u = new uPlot(opts, [xs, ...series] as unknown as uPlot.AlignedData, el)
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) u.setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
    }
  }, [shown, asAnomaly, baseline, spec, year])

  const rank = series && year != null ? rankOf(series, year) : null
  const sel = series && year != null ? series.find((p) => p.year === year) : undefined
  const words = spec.monthlyCode ? SUPERLATIVE[spec.monthlyCode] : undefined
  const rankText = rank
    ? rank.high <= rank.low
      ? `Platz ${rank.high} der ${words?.[0] ?? 'höchsten'}`
      : `Platz ${rank.low} der ${words?.[1] ?? 'niedrigsten'}`
    : null
  const first = series?.[0]?.year
  const at = hover != null && shown ? shown[hover] : null
  const unit = asAnomaly ? anom.unit : spec.unit

  return (
    <div className="atdetail is-max">
      <div className="atdetail-head">
        <div>
          <strong>{name}</strong>
          <span className="label-muted"> · Gebietsmittel des DWD</span>
        </div>
        <div className="atdetail-headbtns">
          <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
            ✕
          </button>
        </div>
      </div>
      <div className="atdetail-sub">
        <strong className="atdetail-what">
          {quantity} · {scopeName}
          {asAnomaly ? ' · Abweichung' : ''}
        </strong>
        <span className="label-muted"> · {periodLabel}</span>
      </div>
      <div className="atdetail-stats">
        {sel && (
          <span>
            {year} <strong>{fmt(sel.value, digits)}</strong> {spec.unit}
          </span>
        )}
        {normal != null && (
          <span>
            Normal {refLabel} <strong>{fmt(normal, digits)}</strong>
          </span>
        )}
        {sel && normal != null && (
          <span>
            Abweichung{' '}
            <strong>
              {(() => {
                const a = anomaly(sel.value, normal, spec.anomalyKind)
                if (a == null) return '—'
                return `${anom.signed && a > 0 ? '+' : ''}${fmt(a, spec.anomalyKind === 'percent' ? 0 : 1)}`
              })()}
            </strong>{' '}
            {spec.anomalyUnit}
          </span>
        )}
        {rankText && first != null && (
          <span title="Rang unter allen Jahren der Reihe mit Wert; Gleichstand teilt sich den besseren Platz">
            <strong>{rankText}</strong> · {rank!.of} Jahre seit {first}
          </span>
        )}
      </div>
      <div className="atdetail-histcap">
        {scopeName} {first ?? ''}–{series?.[series.length - 1]?.year ?? ''}
        {asAnomaly ? ` · Abweichung vs. ${refLabel}` : ''} · {unit}
        {year != null ? ' · gelb: gewählt' : ''}
      </div>
      <div ref={containerRef} className="atdetail-chart" style={{ minHeight: 280 }} />
      {!series && <div className="atdetail-note">lädt Reihe …</div>}
      {at && (
        <div className="atdetail-stats">
          <span>
            <strong>{at.year}</strong>
          </span>
          <span>
            {asAnomaly ? 'Abweichung' : 'Wert'}{' '}
            <strong>
              {anom.signed && asAnomaly && at.value != null && at.value > 0 ? '+' : ''}
              {fmt(at.value, digits)}
            </strong>{' '}
            {unit}
          </span>
          {asAnomaly && (
            <span className="label-muted">
              absolut {fmt(at.absolute, digits)} {spec.unit}
            </span>
          )}
        </div>
      )}
      <div className="atdetail-note label-muted">
        Flächenmittel aus dem 1-km-Raster des DWD (regional_averages_DE), kein Stationswert.
      </div>
    </div>
  )
}
