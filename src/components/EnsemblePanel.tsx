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
  ENSEMBLE_BUCKET_HOURS,
  ensembleThresholds,
  getEnsembleModel,
  getEnsembleVariable,
  type EnsembleThreshold,
} from '../config/ensemble'
import { formatRunLong, latestRun, RUN_TITLE } from '../config/runs'
import { TIME_RANGE } from '../config/time'
import { accumulateMembers, bucketMembers, exceedance, plumeStats, readoutAt } from '../render/plume'
import { barIndices, barStepHours, barWidth, drawQuantileBars } from '../render/quantileBars'
import { cursorRangeEnd, useWorkbench, type PanelConfig } from '../state/workbench'
import { QuickPoints } from './QuickPoints'

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
/**
 * Wahrscheinlichkeit: eigenes Türkis — Gelb gehört dem Zeit-Cursor, Blau der
 * Plume, Orange/Magenta den beiden Läufen. Die Schwellenlinie in der Plume
 * trägt dieselbe Farbe, damit Linie und Leiste als EINE Aussage lesbar sind.
 */
const PROB_LINE = '#2dd4bf'
const PROB_FILL = 'rgba(45,212,191,0.28)'
/** Höhe der Wahrscheinlichkeitsleiste unter der Plume (CSS-Pixel). */
const PROB_HEIGHT = 118

/**
 * Quantil-Balken (Niederschlag) im selben Blau wie das Band — es ist
 * dieselbe Aussage, nur je Termin statt als Verlauf. Nach außen hin
 * schmaler UND blasser: Hauptbalken, Aufsatz, Strich.
 */
const BAR_BODY = 'rgba(57,135,229,0.62)'
const BAR_TAIL = 'rgba(57,135,229,0.3)'
const BAR_OUTLINE = 'rgba(130,190,250,0.85)'
const BAR_EXTREME = 'rgba(170,210,250,0.9)'
/** Mittel: NEUTRAL, damit es neben den drei farbigen Marken nicht mitspricht. */
const BAR_MEAN = '#e6e3dd'
/**
 * Der Median IN der Säule ist heller als die Medianlinie sonst: er liegt auf
 * der blauen Dichtefüllung, und Blau auf Blau ist keine Marke. In der
 * Säulenansicht nimmt auch die Linie und der Legendenpunkt diesen Ton, damit
 * Legende und Bild dieselbe Farbe zeigen.
 */
const BAR_MEDIAN = '#8ad0ff'
/**
 * Mindestabstand zweier Säulen in CSS-Pixeln. Mit 7 px stand die
 * Summenansicht (361 Stundenwerte über 15 Tage) als geschlossener Block da —
 * die Säulen berührten sich, und aus der Verteilung wurde eine Fläche. 14 px
 * lassen über den vollen Horizont den 6-Stunden-Schritt übrig; beim
 * Hineinzoomen rücken sie automatisch auf 3 h und 1 h nach.
 */
const MIN_BAR_GAP = 14

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
  // Mit der Maus lesen, nicht nur mit dem Zeitschieber: der überfahrene
  // Zeitschritt gewinnt gegenüber dem Zeit-Cursor, beim Verlassen fällt die
  // Ablesezeile auf den Cursor zurück. Der Klick setzt den Cursor weiterhin —
  // Lesen und Navigieren sind zwei verschiedene Handgriffe.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const setCursorTime = useWorkbench((s) => s.setCursorTime)

  const model = getEnsembleModel(panel.ensembleModel)
  const variable = getEnsembleVariable(panel.ensembleVariable)
  const query = useEnsembleSeries(location, model.id, variable.id)
  const hres = useDeterministicSeries(location, model.id, variable.id)

  /**
   * SCHWELLE für die Wahrscheinlichkeitsleiste: Index einer Voreinstellung,
   * `custom` oder `off`. VORGABE IST AUS — die Leiste kommt nur, wenn man
   * nach einer Schwelle fragt. Lokal statt im Panel-Zustand: sie hängt an der
   * GRÖSSE (0 °C sind bei 850 hPa etwas anderes als bei Böen) und geht beim
   * Größenwechsel deshalb wieder aus.
   */
  const presets = ensembleThresholds(variable.id)
  const [thrKey, setThrKey] = useState<string>('off')
  const [customOp, setCustomOp] = useState<'>=' | '<'>('>=')
  const [customValue, setCustomValue] = useState('')
  useEffect(() => {
    setThrKey('off')
    setCustomValue('')
  }, [variable.id])
  const threshold: EnsembleThreshold | null = useMemo(() => {
    if (thrKey === 'off') return null
    if (thrKey === 'custom') {
      const v = Number(customValue.replace(',', '.'))
      return customValue.trim() !== '' && Number.isFinite(v) ? { op: customOp, value: v } : null
    }
    return presets[Number(thrKey)] ?? null
  }, [thrKey, customOp, customValue, presets])
  const thresholdRef = useRef<EnsembleThreshold | null>(threshold)

  /**
   * Die beiden ANSICHTSSCHALTER stehen im Panelkopf neben SYNC (siehe
   * `PanelHeader`) und liegen deshalb im Panel-Zustand, nicht hier: was ein
   * Panel zeigt, stellt man dort ein, wie Modell und Parameter daneben.
   *
   * `bars` = Quantil-Balken statt Linienbündel, Vorgabe bei Summengrößen:
   * beim Niederschlag springen die Member (Member 7 hat den Schauer um 14
   * Uhr, Member 12 um 20 Uhr, zwanzig andere gar nicht), als Linienbündel
   * ist das ein Knäuel. Bei Temperatur und Druck ist die Plume dagegen genau
   * richtig, dort bleibt es bei den Linien.
   */
  const showMembers = panel.ensembleMembers
  const bars = panel.ensembleBars
  const [zoomed, setZoomed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const stripElRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<uPlot | null>(null)
  /** Gemeinsamer Cursor von Plume und Leiste (uPlot.sync). */
  const syncKey = useRef(`ens-${Math.random().toString(36).slice(2)}`).current
  const cursorRef = useRef(cursorTime)

  // Summengrößen (Niederschlag/Schnee): Stundenwerte als 51 Spaghetti sind
  // unlesbar. Zwei brauchbare Sichten — kumulierte Summe (Gesamtmenge) oder
  // 6-h-Mengen je Mitglied (zeitlicher Ablauf, Wetterzentrale-Manier).
  const bucketed = variable.kind === 'accum' && panel.ensembleAccumView === '6h'
  /** Säulen gibt es nur, wo sie etwas können — bei den Summengrößen. */
  const barView = variable.kind === 'accum' && bars
  // In der 6-h-Ansicht ist der Wert eine Menge JE INTERVALL, nicht der Stand
  // einer Summenkurve — das muss an der Zahl stehen, sonst liest man 6-h-Mengen
  // als Gesamtmenge.
  const unitLabel = bucketed ? `${variable.unit}/${ENSEMBLE_BUCKET_HOURS} h` : variable.unit
  const prepared = useMemo(() => {
    if (!query.data) return null

    // Hauptlauf auf die Zeitachse des Ensembles legen (er hat eigene Stützstellen
    // und einen eigenen Horizont) — Index-Matching wäre hier schlicht falsch.
    let rawDet: (number | null)[] | null = null
    if (hres.data) {
      const byTime = new Map<number, number | null>()
      for (let i = 0; i < hres.data.times.length; i++) byTime.set(hres.data.times[i], hres.data.values[i])
      rawDet = query.data.times.map((t) => byTime.get(t) ?? null)
    }

    let times = query.data.times
    let members: (number | null)[][]
    let deterministic: (number | null)[] | null

    if (bucketed) {
      // Hauptlauf als zusätzliche „Reihe" mitbündeln, damit er GARANTIERT auf
      // denselben Stützstellen landet wie die Mitglieder
      const all = rawDet ? [...query.data.members, rawDet] : query.data.members
      const b = bucketMembers(query.data.times, all, ENSEMBLE_BUCKET_HOURS)
      times = b.times
      members = rawDet ? b.members.slice(0, -1) : b.members
      deterministic = rawDet ? b.members[b.members.length - 1] : null
    } else if (variable.kind === 'accum') {
      members = accumulateMembers(query.data.members)
      deterministic = rawDet ? accumulateMembers([rawDet])[0] : null
    } else {
      members = query.data.members
      deterministic = rawDet
    }

    return {
      times,
      members,
      deterministic,
      unit: query.data.unit,
      stats: plumeStats(members),
    }
  }, [query.data, hres.data, variable.kind, bucketed])

  /** Anteil der Member je Zeitschritt, der die Schwelle erfüllt (0…1). */
  const prob = useMemo(
    () => (prepared && threshold ? exceedance(prepared.members, threshold.op, threshold.value) : null),
    [prepared, threshold],
  )
  const thrText = threshold
    ? `${threshold.op === '>=' ? '≥' : '<'} ${String(threshold.value).replace('.', ',')} ${unitLabel}`
    : ''

  // Ablesezeile am Zeit-Cursor.
  const readout = useMemo(() => {
    if (!prepared) return null
    const i =
      hoverIdx != null && hoverIdx < prepared.times.length
        ? hoverIdx
        : prepared.times.findIndex((t) => t >= cursorTime)
    if (i < 0) return null
    return {
      at: prepared.times[i],
      hovered: hoverIdx != null,
      r: readoutAt(prepared.stats, i),
      hres: prepared.deterministic?.[i] ?? null,
      control: prepared.members[0]?.[i] ?? null,
      prob: prob?.[i] ?? null,
    }
  }, [prepared, cursorTime, hoverIdx, prob])

  // Schwellenlinie in der Plume nur neu ZEICHNEN, nicht den Plot neu bauen.
  useEffect(() => {
    thresholdRef.current = threshold
    plotRef.current?.redraw()
  }, [threshold])

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
          // Die Leiste folgt dem Ausschnitt der Plume — dieselbe Zeitachse.
          if (sc.min != null && sc.max != null) stripRef.current?.setScale('x', { min: sc.min, max: sc.max })
        },
        draw: (u) => {
          const thr = thresholdRef.current
          if (thr) {
            const y = u.valToPos(thr.value, 'y', true)
            if (Number.isFinite(y) && y >= u.bbox.top && y <= u.bbox.top + u.bbox.height) {
              const c = u.ctx
              c.save()
              c.setLineDash([6, 4])
              c.strokeStyle = PROB_LINE
              c.lineWidth = 1.5 * (window.devicePixelRatio || 1)
              c.beginPath()
              c.moveTo(u.bbox.left, y)
              c.lineTo(u.bbox.left + u.bbox.width, y)
              c.stroke()
              c.restore()
            }
          }
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

    /**
     * QUANTIL-SÄULEN. Gezeichnet im `draw`-Hook, also ÜBER den Kurven: die
     * Stufen sind halbdurchlässig, Hauptlauf und Kontrolllauf bleiben dahinter
     * sichtbar, während die Striche der Member scharf obenauf liegen.
     * Zeichnen wir sie darunter, verschluckt sie die Bandfüllung.
     *
     * Der Abstand wird bei JEDEM Zeichnen neu bestimmt — beim Hineinzoomen
     * rücken die Säulen also von 12 h über 6 h auf 1 h zusammen, statt in
     * einer festen Rasterung stehen zu bleiben.
     */
    const baseHours =
      prepared.times.length > 1 ? (prepared.times[1] - prepared.times[0]) / 3_600_000 : 1
    const barsPlugin: uPlot.Plugin = {
      hooks: {
        draw: (u) => {
          if (!barView || xs.length < 2) return
          // `valToPos(…, true)` rechnet in GERÄTEpixeln — der Mindestabstand
          // ist aber eine Sache der Anzeige, nicht der Gerätedichte. Auf
          // einem HiDPI-Schirm stünden die Säulen sonst doppelt so dicht.
          const dpr = window.devicePixelRatio || 1
          const spacing =
            Math.abs(u.valToPos(xs[1], 'x', true) - u.valToPos(xs[0], 'x', true)) / dpr
          if (!Number.isFinite(spacing) || spacing <= 0) return
          const step = barStepHours(spacing, baseHours, MIN_BAR_GAP)
          drawQuantileBars(u.ctx, {
            indices: barIndices(prepared.times, step),
            x: (t) => u.valToPos(xs[t], 'x', true),
            y: (v) => u.valToPos(v, 'y', true),
            stats,
            width: barWidth(spacing, step, baseHours) * dpr,
            dpr,
            // Hauptlauf und Kontrolllauf als Marken IN der Säule: sonst muss
            // man den Wert aus der Linie ablesen, die gerade irgendwo durch
            // die Fläche läuft. Der Median kommt aus den Quantilen selbst.
            marks: [
              ...(prepared.deterministic
                ? [{ values: prepared.deterministic, color: HRES_LINE }]
                : []),
              ...(members[0] ? [{ values: members[0], color: CONTROL_LINE }] : []),
            ],
            colors: {
              body: BAR_BODY,
              tail: BAR_TAIL,
              outline: BAR_OUTLINE,
              extreme: BAR_EXTREME,
              median: BAR_MEDIAN,
              mean: BAR_MEAN,
            },
            clip: { left: u.bbox.left, top: u.bbox.top, width: u.bbox.width, height: u.bbox.height },
          })
        },
      },
    }

    /**
     * Serienreihenfolge: p90/p10 (Band), Median, Kontrolllauf, Hauptlauf,
     * dann Mitglieder. Das Band bezieht sich über `bands` auf die
     * Perzentil-Serien.
     *
     * **In der Balkenansicht entfallen die LINIEN von Hauptlauf und
     * Kontrolllauf.** Beide stehen dort als Marke IN jedem Balken; die
     * Verbindung dazwischen ist nicht nur überflüssig, sie behauptet auch
     * einen Verlauf: bei 6-h-Mengen gibt es zwischen zwei Terminen keinen
     * Zwischenwert, und die beiden kräftigen Zickzacklinien waren das
     * Auffälligste im Bild. Die Medianlinie bleibt, dünn — sie ist die eine
     * Spur, an der man die Abfolge der Termine noch entlanglesen kann.
     * Spaghetti entfallen ebenfalls (die Einzelläufe stehen in dieser
     * Ansicht gar nicht).
     */
    const spaghetti = showMembers && !barView
    /** Höchster Memberwert — nur in der Balkenansicht gebraucht (s. `scales`). */
    const barHi = barView
      ? stats.max.reduce<number>((a, v) => (v != null && v > a ? v : a), -Infinity)
      : -Infinity
    const data: (number | null)[][] = [stats.p90, stats.p10, stats.median]
    if (!barView) {
      data.push(members[0] ?? [])
      if (prepared.deterministic) data.push(prepared.deterministic)
      if (spaghetti) for (let m = 1; m < members.length; m++) data.push(members[m])
    }

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 80),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      legend: { show: false },
      // uPlots eigenes Zieh-Auswählen ist AUS: gezoomt wird mit dem Mausrad,
      // gezogen wird verschoben (wie in der Österreich-Karte). Ein Rechteck
      // aufzuziehen trifft den gewünschten Ausschnitt nie beim ersten Versuch.
      cursor: { y: false, drag: { x: false, y: false, setScale: false }, sync: { key: syncKey } },
      plugins: [barsPlugin, cursorPlugin],
      hooks: {
        // Überfahrener Zeitschritt für die Ablesezeile; `null` beim Verlassen.
        setCursor: [(u: uPlot) => setHoverIdx(u.cursor.idx ?? null)],
      },
      /**
       * DIE ACHSE MUSS DIE EXTREME DER BALKEN MITNEHMEN.
       *
       * uPlot skaliert nach den SERIEN, und in der Balkenansicht liegen
       * Minimum und Maximum in keiner: gezeichnet werden sie aus `stats` im
       * `draw`-Hook. Ohne `barHi` reichte die Achse nur bis P90 — die
       * Striche an den Extremen wurden oben abgeschnitten, und zwar
       * unauffällig, weil ein abgeschnittener Balken wie ein hoher Balken
       * aussieht. Seit die Linien von Hauptlauf und Kontrolllauf fehlen,
       * fängt auch niemand mehr zufällig den Höchstwert ein.
       */
      scales: variable.zeroBased
        ? {
            y: {
              range: (_u, _min, max) => {
                const hi = Math.max(max, barHi)
                return [0, hi > 0 ? hi * 1.05 : 1]
              },
            },
          }
        : {},
      // In der Säulenansicht KEIN Band: es zeichnet zwischen zwei Terminen
      // einen Verlauf, den beim Niederschlag kein Member hat — genau das,
      // was die Säulen ersetzen sollen. Die Serien bleiben (der Bandbezug
      // hängt an festen Indizes), nur unsichtbar.
      bands: barView ? [] : [{ series: [1, 2], fill: BAND_FILL }],
      series: [
        {},
        { label: 'P90', stroke: barView ? 'transparent' : BAND_LINE, width: 1, points: { show: false } },
        { label: 'P10', stroke: barView ? 'transparent' : BAND_LINE, width: 1, points: { show: false } },
        {
          label: 'Median',
          stroke: barView ? BAR_MEDIAN : MEDIAN_LINE,
          width: barView ? 1 : 2,
          points: { show: false },
        },
        ...(barView
          ? []
          : [
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
              ...(spaghetti
                ? members.slice(1).map(() => ({
                    stroke: MEMBER_LINE,
                    width: 1,
                    points: { show: false },
                  }))
                : []),
            ]),
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
      // Obergrenze aus dem Store, NICHT TIME_RANGE.end: die Plume reicht bei
      // GEFS über das 16-Tage-Raster hinaus, und ein Klick dorthin muss den
      // Cursor genauso setzen können wie einer davor.
      const end = cursorRangeEnd(useWorkbench.getState())
      if (Number.isFinite(t) && t >= TIME_RANGE.start && t <= end) setCursorTime(t)
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
  }, [prepared, showMembers, barView, variable.zeroBased, setCursorTime, syncKey])

  /**
   * WAHRSCHEINLICHKEITSLEISTE — ein eigenes uPlot unter der Plume, nicht eine
   * zweite y-Achse darin: 0–100 % neben °C oder mm in EINEM Feld liest man
   * unweigerlich gegen die falsche Achse. Zeitachse, Ausschnitt und Cursor
   * teilt sie mit der Plume (`syncKey`, Ausschnitt über den setScale-Hook
   * oben), die linke Achse ist gleich breit, damit die Zeitpunkte senkrecht
   * übereinanderstehen.
   */
  useEffect(() => {
    const el = stripElRef.current
    if (!el || !prepared || !prob || prepared.times.length === 0) return
    const xs = prepared.times.map((t) => t / 1000)
    const main = plotRef.current?.scales.x
    const pct = prob.map((v) => (v == null ? null : v * 100))
    const u = new uPlot(
      {
        width: Math.max(el.clientWidth, 100),
        height: PROB_HEIGHT,
        tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
        legend: { show: false },
        cursor: { y: false, drag: { x: false, y: false, setScale: false }, sync: { key: syncKey } },
        hooks: { setCursor: [(p: uPlot) => setHoverIdx(p.cursor.idx ?? null)] },
        scales: {
          x: main?.min != null && main.max != null ? { min: main.min, max: main.max } : {},
          y: { range: [0, 100] },
        },
        series: [
          {},
          { stroke: PROB_LINE, width: 1.5, fill: PROB_FILL, points: { show: false } },
        ],
        axes: [
          {
            stroke: INK_MUTED,
            font: AXIS_FONT,
            grid: { stroke: GRIDLINE, width: 1 },
            ticks: { stroke: GRIDLINE, width: 1 },
            space: 52,
            size: 24,
            values: (_u, ticks) => ticks.map((t) => fmtDay.format(new Date(t * 1000))),
          },
          {
            stroke: INK_MUTED,
            font: AXIS_FONT,
            size: 46,
            splits: () => [0, 50, 100],
            values: (_u, ticks) => ticks.map((t) => `${t} %`),
            grid: { stroke: GRIDLINE, width: 1 },
            ticks: { stroke: GRIDLINE, width: 1 },
          },
        ],
      },
      [xs, pct] as uPlot.AlignedData,
      el,
    )
    stripRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: PROB_HEIGHT }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      stripRef.current = null
    }
  }, [prepared, prob, syncKey])

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
        <QuickPoints />
        {zoomed && (
          <button type="button" className="quickpt" onClick={resetZoom} title="Ganzen Horizont zeigen">
            ⤢ Zoom zurück
          </button>
        )}
        {/* Welcher Lauf im Bild ist — bei einem 15-Tage-Plume ist das die
            Frage nach dem Alter der Aussage. Immer der neueste verfügbare;
            die Init-Zeit ist geschätzt (RUN_TITLE). */}
        <span className="ens-thr" title="Wahrscheinlichkeit = Anteil der Member, die die Schwelle erfüllen. Unter der Plume als Leiste, in der Plume als gestrichelte Linie.">
          <span className="label-muted">Wahrscheinlichkeit</span>
          <select value={thrKey} onChange={(e) => setThrKey(e.target.value)}>
            <option value="off">aus</option>
            {presets.map((t, i) => (
              <option key={i} value={String(i)}>
                {t.op === '>=' ? '≥' : '<'} {String(t.value).replace('.', ',')} {unitLabel}
                {t.meaning ? ` · ${t.meaning}` : ''}
              </option>
            ))}
            <option value="custom">eigene Schwelle …</option>
          </select>
          {thrKey === 'custom' && (
            <>
              <select value={customOp} onChange={(e) => setCustomOp(e.target.value as '>=' | '<')}>
                <option value=">=">≥</option>
                <option value="<">&lt;</option>
              </select>
              <input
                className="ens-thr-input"
                inputMode="decimal"
                placeholder="Wert"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
              />
              <span className="label-muted">{unitLabel}</span>
            </>
          )}
        </span>
        <span className="label-muted" title={`${model.label} · ${RUN_TITLE}`}>
          Lauf {formatRunLong(latestRun(model, Date.now()), Date.now())}
        </span>
      </div>

      {/* Legende: ohne sie ist nicht ablesbar, welche Linie was ist. */}
      <div className="ens-legend">
        <span title="Deterministischer ECMWF-Lauf (HRES) — höher aufgelöst, EINE Lösung ohne Störung. Eigener Abruf, das Ensemble liefert ihn nicht mit.">
          <i style={{ background: HRES_LINE }} /> Hauptlauf
        </span>
        <span title="Ungestörter Ensemble-Member in Ensemble-Auflösung — die Referenz INNERHALB der Verteilung, nicht der Hauptlauf.">
          <i className={barView ? undefined : 'ens-dash'} style={{ background: CONTROL_LINE }} />{' '}
          Kontrolllauf
        </span>
        <span title="Mittlerer Member je Zeitschritt (50. Perzentil) — die Hälfte der Member liegt darunter.">
          <i style={{ background: barView ? BAR_MEDIAN : MEDIAN_LINE, height: 3 }} /> Median
        </span>
        {barView && (
          <span title="Arithmetisches Mittel aller Member. Bei schiefer Verteilung liegt es ÜBER dem Median: dreißig trockene Member und fünf nasse ergeben Median 0 und Mittel 2 mm — beide Zahlen stimmen und beantworten verschiedene Fragen.">
            <i style={{ background: BAR_MEAN, height: 3 }} /> Mittel
          </span>
        )}
        {/* Das Band gibt es in der Säulenansicht nicht — dort steht dieselbe
            Aussage in jeder Säule. */}
        {!barView && (
          <span title="80 % der Member liegen in diesem Band">
            <i className="ens-bandswatch" /> P10–P90
          </span>
        )}
        {barView && (
          <span title="Der Hauptbalken umfasst P10–P90, also 80 % der Member. Darauf sitzen schmalere Aufsätze bis P5 und P95, darüber die Striche an Minimum und Maximum: nach außen hin schmaler und blasser, weil ein einzelner Lauf nicht so schwer wiegen darf wie die Mehrheit.">
            <i className="ens-barswatch" /> Balken P10–P90 · Aufsatz P5/P95 · Strich min/max
          </span>
        )}
        {showMembers && !barView && (
          <span title="Alle gestörten Member als Spaghetti">
            <i style={{ background: 'rgba(120,170,230,0.6)' }} /> {model.members - 1} Member
          </span>
        )}
        <span className="ens-hint label-muted">
          Maus = ablesen · Klick = Zeit setzen · Rad = Zoom · Ziehen = Verschieben · Doppelklick = Reset
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

      {threshold && prepared && (
        <div className="ens-prob">
          <div
            className="ens-prob-cap"
            title={`Anteil der ${model.members} Member (samt Kontrolllauf, ohne Hauptlauf), die die Schwelle erfüllen. Das ist die ROHE Ensemble-Wahrscheinlichkeit: nicht kalibriert. Ensembles sind am Boden meist zu eng gestreut, 0 % und 100 % sind deshalb selbstsicherer, als die Wirklichkeit es rechtfertigt. Die Auflösung ist 1/${model.members} ≈ ${Math.round(100 / model.members)} %.`}
          >
            <span style={{ color: PROB_LINE }}>
              P({thrText}){threshold.meaning ? ` · ${threshold.meaning}` : ''}
            </span>
            <span className="label-muted"> · Anteil der Member, roh (nicht kalibriert)</span>
          </div>
          <div className="ens-prob-plot" ref={stripElRef} />
        </div>
      )}

      <div className="ens-foot">
        {readout?.r ? (
          <>
            <span className="ens-readcap">
              {fmtFull.format(new Date(readout.at))} UTC
              {readout.hovered && <span className="label-muted"> (Zeiger)</span>}
            </span>
            <span style={{ color: HRES_LINE }}>
              Hauptlauf{' '}
              <strong>{readout.hres != null ? fmtVal(readout.hres) : '—'}</strong> {unitLabel}
            </span>
            <span style={{ color: CONTROL_LINE }}>
              Kontrolllauf{' '}
              <strong>{readout.control != null ? fmtVal(readout.control) : '—'}</strong>
            </span>
            <span style={{ color: barView ? BAR_MEDIAN : MEDIAN_LINE }}>
              Median <strong>{fmtVal(readout.r.median)}</strong>
            </span>
            <span style={{ color: BAR_MEAN }}>
              Mittel <strong>{fmtVal(readout.r.mean)}</strong>
            </span>
            {threshold && readout.prob != null && (
              <span style={{ color: PROB_LINE }}>
                P({thrText}) <strong>{Math.round(readout.prob * 100)} %</strong>
              </span>
            )}
            <span className="label-muted">
              P10–P90 {fmtVal(readout.r.p10)}…{fmtVal(readout.r.p90)} · Spanne{' '}
              {fmtVal(readout.r.min)}…{fmtVal(readout.r.max)} · Streuung{' '}
              <strong>{fmtVal(readout.r.spread)}</strong> {unitLabel}
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
