// Gemeinsamer Baustein für „Stapel aus kleinen Zeitreihen-Diagrammen mit
// gemeinsamer Zeitachse" — ursprünglich für die MOS-Punktvorhersage gebaut
// (AtForecastDetail), jetzt auch vom klassischen Meteogramm genutzt
// (ClassicMeteogram). EIN Ort für uPlot-Setup, Cursor-Sync über `uPlot.sync`
// (gemeinsamer Fadenkreuz-Cursor über alle Reihen eines Stapels), die
// Wind-Pfeile, die optionale Tageszeile unter der Stundenachse und das
// Grauwert-Raster für geschichtete Bewölkung (`bands`).

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Bands, ChartDef, Curve } from '../config/chartDef'

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const GRIDLINE_DAY = '#454540'
const AXIS_FONT = '10px system-ui, sans-serif'
const MARK = '#e8b23a'
// Deckt den Streifen ab, damit die Windlinie ihn nie kreuzt — dieselbe Fläche
// wie der Rest der Chart-Canvas (siehe --bg-panel in index.css).
const BG_PANEL = '#18191b'

/**
 * Windpfeil: Schaft + GEFÜLLTE Spitze, lokal um den Ursprung — bewusst
 * kräftiger als ein reiner Linien-Chevron, weil dieser Pfeil plakativ die
 * Richtung zeigen soll, nicht nur eine Nebeninformation entlang einer Linie.
 */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angleRad: number, len: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angleRad)
  ctx.beginPath()
  ctx.moveTo(0, len / 2)
  ctx.lineTo(0, -len / 2 + len * 0.3)
  ctx.stroke()
  const headW = len * 0.34
  ctx.beginPath()
  ctx.moveTo(0, -len / 2)
  ctx.lineTo(-headW, -len / 2 + len * 0.38)
  ctx.lineTo(headW, -len / 2 + len * 0.38)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * Plugin, das EINEN festen Streifen am OBEREN Rand des Wind-Diagramms mit
 * großen, plakativen Richtungspfeilen belegt — bewusst NICHT entlang der
 * schwankenden Geschwindigkeitslinie (die wäre bei Flaute kaum lesbar und bei
 * Sturm überdeckt): eine eigene, von der Linie unabhängige Zeile, dafür mit
 * einer Deckfläche freigehalten, damit die Linie nie hindurchläuft.
 */
function windArrowStripPlugin(curve: Curve, color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const dir = curve.direction
        if (!dir) return
        const xs = u.data[0]
        const stripH = Math.min(36, u.bbox.height * 0.34)
        const ctx = u.ctx
        ctx.save()
        // Deckfläche: verhindert, dass die Windlinie bei starkem Wind in den
        // Pfeilstreifen hineinragt und die Pfeile verdeckt.
        ctx.fillStyle = BG_PANEL
        ctx.fillRect(u.bbox.left, u.bbox.top, u.bbox.width, stripH)
        ctx.strokeStyle = GRIDLINE
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(u.bbox.left, u.bbox.top + stripH + 0.5)
        ctx.lineTo(u.bbox.left + u.bbox.width, u.bbox.top + stripH + 0.5)
        ctx.stroke()

        const y = u.bbox.top + stripH / 2
        const minPxGap = 42
        const step = Math.max(1, Math.ceil((minPxGap * xs.length) / Math.max(u.bbox.width, 1)))
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.lineWidth = 1.75
        for (let i = 0; i < xs.length; i += step) {
          const d = dir[i]
          if (d == null) continue
          const x = u.valToPos(xs[i], 'x', true)
          if (!Number.isFinite(x)) continue
          // Meteorologisch: Richtung, AUS der der Wind kommt. Der Pfeil soll
          // dorthin zeigen, WOHIN er weht → +180°. uPlot/Canvas-Winkel ab
          // „oben" im Uhrzeigersinn, deckt sich mit der Kompass-Konvention.
          const angle = ((d + 180) % 360) * (Math.PI / 180)
          drawArrow(ctx, x, y, angle, 17)
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Grauwert-Raster für geschichtete Bewölkung (tief/mittel/hoch) — das
 * klassische Meteogramm-Schema: eine Reihe Pixel je Höhenschicht, HELL = klar,
 * DUNKEL = bedeckt — die übliche Lesart (wie eine bewölkte vs. eine klare
 * Himmelsfläche). Die dunkle Seite bleibt bewusst deutlich über der
 * Seiten-Hintergrundfarbe (`--bg-page` #101113 ≈ rgb(16,17,19)), sonst würde
 * „ganz bedeckt" im dunklen Theme unsichtbar statt auffällig.
 */
function cloudBandsPlugin(bands: Bands): uPlot.Plugin {
  const [rmin, rmax] = bands.range ?? [0, 100]
  return {
    hooks: {
      draw: (u) => {
        const xs = u.data[0]
        const rows = bands.rows
        const n = rows.length
        if (n === 0 || xs.length === 0) return
        const top = u.bbox.top
        const rowH = u.bbox.height / n
        const ctx = u.ctx
        ctx.save()
        for (let r = 0; r < n; r++) {
          const vals = rows[r].values
          for (let i = 0; i < xs.length; i++) {
            const v = vals[i]
            if (v == null) continue
            const x0 = u.valToPos(xs[i], 'x', true)
            const xNext = i + 1 < xs.length ? u.valToPos(xs[i + 1], 'x', true) : x0 + (x0 - u.valToPos(xs[i - 1] ?? xs[i], 'x', true))
            const t = Math.max(0, Math.min(1, (v - rmin) / (rmax - rmin || 1)))
            const shade = Math.round(205 - t * 140)
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`
            ctx.fillRect(x0, top + r * rowH, Math.max(1, xNext - x0), rowH)
          }
        }
        // Zeilentrenner zwischen den Höhenschichten.
        ctx.strokeStyle = GRIDLINE
        ctx.lineWidth = 1
        for (let r = 1; r < n; r++) {
          const y = Math.round(top + r * rowH) + 0.5
          ctx.beginPath()
          ctx.moveTo(u.bbox.left, y)
          ctx.lineTo(u.bbox.left + u.bbox.width, y)
          ctx.stroke()
        }
        // Zeilenbeschriftung als kleine Chips — unabhängig vom Grauwert darunter lesbar.
        ctx.font = AXIS_FONT
        ctx.textBaseline = 'middle'
        for (let r = 0; r < n; r++) {
          const y = top + r * rowH + rowH / 2
          const label = rows[r].label
          const tw = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(10,10,10,0.6)'
          ctx.fillRect(u.bbox.left + 3, y - 8, tw + 8, 16)
          ctx.fillStyle = '#e8e6df'
          ctx.fillText(label, u.bbox.left + 7, y)
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Senkrechte Markerlinie an einem festen Zeitpunkt (z. B. Kartenschieber der
 * MOS-Vorhersage). Getrennt vom Cursor-Sync — ein von außen vorgegebener
 * Zeitpunkt ist etwas anderes als der Hover-Fadenkreuz-Sync über den Stapel.
 */
function markPlugin(markRef: { current: number | undefined }): uPlot.Plugin {
  return {
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
}

/** Ein Diagramm des Stapels — uPlot-Setup, optional synchronisiertes Fadenkreuz über `syncKey`. */
export function ChartRow({
  xs,
  chart,
  tz = 'Etc/UTC',
  axisFmt,
  formatTick,
  xSpace = 62,
  dayRow = false,
  markTime,
  syncKey,
  height = 88,
}: {
  xs: number[]
  chart: ChartDef
  /** Zeitzone der Achsenbeschriftung — Standard UTC wie im Rest der App. */
  tz?: string
  /** Formatter für die x-Achsen-Ticks; Default: Wochentag + Stunde in `tz`. */
  axisFmt?: Intl.DateTimeFormat
  /**
   * Feinere Alternative zu `axisFmt`: eigene Funktion je Tick (Sekunden-
   * Timestamp). Hat Vorrang vor `axisFmt`, wenn gesetzt.
   */
  formatTick?: (ts: number) => string
  /** Mindestabstand zwischen x-Achsen-Ticks in Pixeln — kleiner = mehr Ticks. */
  xSpace?: number
  /**
   * Zweite Zeile UNTER der Stunden-Achse, nur für Tagesgrenzen (00 Uhr in
   * `tz`): Wochentag+Datum plus eine durchgehende Trennlinie über die ganze
   * Höhe. Braucht dafür KEINE eigene Formatierung der Stunden-Achse mehr —
   * die zeigt dann nur noch die Uhrzeit, den Tag übernimmt diese Zeile.
   */
  dayRow?: boolean
  /** Fester Zeitpunkt (ms) als gestrichelte Markerlinie, z. B. vom Kartenschieber. */
  markTime?: number
  /** Gemeinsamer Cursor über mehrere ChartRow-Instanzen (uPlot.sync-Key). */
  syncKey?: string
  /**
   * NUR Mindesthöhe für uPlots Erstaufbau, falls `el.clientHeight` beim Mount
   * noch 0 ist (Layout nicht fertig) — die tatsächliche Höhe kommt aus CSS
   * (`.atfc-plot` bzw. der umgebende Flex-Container) und wird per
   * ResizeObserver nachgezogen. KEIN inline `height`/`min-height` mehr auf dem
   * Element selbst, sonst kann CSS die Zeile nicht mehr strecken.
   */
  height?: number
}) {
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

    const fmt = axisFmt ?? new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short', hour: '2-digit' })
    const tickLabel = formatTick ?? ((ts: number) => fmt.format(new Date(ts * 1000)))
    const bars = uPlot.paths.bars?.({ size: [0.7, 12] })
    const windCurve = chart.curves.find((c) => c.direction)
    const bands = chart.bands

    // Für die Tageszeile: Stunde in `tz` je Split ermitteln (h23, damit „0"
    // eindeutig Mitternacht ist) und die Tageslabel-Formatierung.
    const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' })
    const dayLabelFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric' })
    const isDayStart = (v: number) => hourOf.format(new Date(v * 1000)) === '00'
    const onlyDayStarts = (_u: uPlot, splits: number[]) => splits.map((v) => (isDayStart(v) ? v : null))

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, height),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), tz),
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false },
        ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
      },
      plugins: [
        markPlugin(markRef),
        ...(windCurve ? [windArrowStripPlugin(windCurve, windCurve.color)] : []),
        ...(bands ? [cloudBandsPlugin(bands)] : []),
      ],
      scales: {
        y: bands
          ? { range: bands.range ?? [0, 100] }
          : chart.range
            ? { range: chart.range }
            : chart.zeroBased
              ? { range: (_u, _min, max) => [0, max > 0 ? max * 1.1 : 1] }
              : {},
      },
      series: bands
        ? [{}, { show: false }]
        : [
            {},
            ...chart.curves.map((s) => ({
              label: s.label,
              stroke: s.color,
              width: 1.5,
              points: { show: false },
              ...(s.dash ? { dash: s.dash } : {}),
              ...(s.type === 'bars' ? { fill: s.color, paths: bars } : {}),
            })),
          ],
      axes: [
        {
          scale: 'x',
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: xSpace,
          values: (_u, ticks) => ticks.map(tickLabel),
        },
        {
          scale: 'y',
          show: !bands,
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 38,
          space: 30,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
        ...(dayRow
          ? [
              {
                scale: 'x',
                side: 2 as uPlot.Axis.Side,
                stroke: INK_MUTED,
                font: AXIS_FONT,
                size: 20,
                gap: 3,
                ticks: { show: false },
                grid: { stroke: GRIDLINE_DAY, width: 1, filter: onlyDayStarts },
                filter: onlyDayStarts,
                values: (_u: uPlot, splits: number[]) =>
                  splits.map((v) => (v == null ? '' : dayLabelFmt.format(new Date(v * 1000)))),
              },
            ]
          : []),
      ],
    }
    const data = bands
      ? [xs, bands.rows[0]?.values ?? xs.map(() => null)]
      : [xs, ...chart.curves.map((s) => s.values)]
    const u = new uPlot(opts, data as uPlot.AlignedData, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xs, chart, tz, syncKey, height, axisFmt, formatTick, xSpace, dayRow])

  return <div className="atfc-plot" ref={ref} />
}
