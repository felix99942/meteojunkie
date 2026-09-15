// Föhn-Bereich: Föhndiagnose entlang einer festen Föhnachse (config/foehn.ts),
// ausschließlich mit LOKALMODELLEN (≤ 2,5 km) — ein 25-km-Global glättet genau
// das weg, worum es beim Föhn geht.
//
// Aufbau:
//
//   Überblick     Föhnphasen des Detailmodells + höchste Ensemble-Wahrscheinlichkeit
//   Streifen      Kriterien (Detailmodell): Summe · ΔP · Kammwind · Lee trocken · Δθ
//   Raster 2×3    ΔP Süd − Nord, Modelle überlagert   │ Kamm: Wind 700 hPa + Stau
//                 ΔP je Ensemble-Member (Plume)        │ Lee-Talstation: Wind/Böen/Feuchte
//                 Wahrscheinlichkeit über Schwelle     │ Δθ Tal − 700 hPa
//
// Als ein einziger Stapel waren die sieben Diagramme vertikal so gestaucht,
// dass sich nichts ablesen ließ; als Kacheln bekommt jedes rund ein Drittel der
// Höhe. Links steht der Druck (die Föhngröße und ihre Unsicherheit), rechts,
// was am Kamm und im Tal passiert. Alle Kacheln teilen die Zeitachse und den
// Cursor.
//
// Bewusst ein Kriterien-STREIFEN und kein Index: die Gewichtung der Kriterien
// wäre gesetzt, nicht gemessen — der Streifen zeigt, WELCHES Kriterium
// erfüllt ist, und überlässt das Zusammenlesen dem Menschen. Die Schwellen
// sind Faustregeln (siehe config/foehn.ts) und stehen so in der UI.
//
// Zeitachse: endet am längsten Horizont der gewählten Modelle bzw. des
// Ensembles (Lokalmodelle reichen 33 h bis 5 Tage) — eine 16-Tage-Achse bliebe
// zu vier Fünfteln leer. Kürzere Modelle enden einfach, der Kriterien-Streifen
// markiert dahinter „nicht verfügbar".
//
// Kosten: die Punkte sind durch die Achse fest (Süd, Nord, Kamm, Lee — bei
// Tirol fällt Lee mit Nord zusammen). Der Batcher bündelt je Punkt alle
// Modelle und Variablen zu EINEM Request; dazu zwei Ensemble-Abrufe.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EnsembleSeries, HourlySeries } from '../api/openmeteo'
import { useEnsembleSeriesFor, useMeteogramSeries, usePointSeries } from '../api/queries'
import { MOCK_FOEHN } from '../api/mock'
import { FOEHN_EPISODE } from '../api/mockFoehn'
import { ChartRow } from './ChartStack'
import {
  chartHasData,
  RIGHT_AXIS_SIZE,
  Y_AXIS_SIZE,
  type ChartDef,
  type Curve,
} from '../config/chartDef'
import { SERIES_COLORS } from '../config/colors'
import {
  DEFAULT_DETAIL_MODEL,
  DEFAULT_FOEHN_AXIS,
  DEFAULT_OVERLAY_MODELS,
  DIRECTION_LABEL,
  FOEHN_AXES,
  FOEHN_ENSEMBLES,
  FOEHN_LIMITS,
  FOEHN_MODELS,
  FOEHN_UPPER_AIR_MODELS,
  getFoehnAxis,
  getFoehnEnsemble,
  type FoehnDirection,
} from '../config/foehn'
import { getModel, modelHorizonEnd, resolutionLabel } from '../config/models'
import { formatRunLong, latestRun, RUN_TITLE } from '../config/runs'
import { timeGridMs } from '../config/time'
import { plumeStats } from '../render/plume'
import {
  alignSeries,
  difference,
  exceedanceProbability,
  horizonEdge,
  foehnCriteria,
  foehnPhases,
  memberDifferences,
  thetaDifference,
  type FoehnPhase,
  type Series,
} from './foehn'
import { OpenMeteoAttribution } from './Attribution'

const TZ = 'Etc/UTC'
const CHART_HEIGHT = 110
/** Tick-Mindestabstand: in halber Bildschirmbreite 6- bis 12-Stunden-Ticks. */
const X_TICK_SPACE = 50
const MS_PER_HOUR = 3_600_000

const COLOR_SCORE = '#f0c04a'
const COLOR_PRESSURE = '#d95926'
const COLOR_CREST = '#3987e5'
const COLOR_DRY = '#c98500'
const COLOR_MIXED = '#9085e9'
const COLOR_MEMBER = 'rgba(150,160,175,0.28)'
const COLOR_MEDIAN = '#e8e6df'
const COLOR_PCTL = '#898781'
/** Wahrscheinlichkeit über der Föhnschwelle — Ocker, die Grundfläche. */
const COLOR_PROB = '#c98500'
/** Anteil über der STARKföhn-Schwelle, oben aufgestapelt — knallrot, soll herausstechen. */
const COLOR_PROB_STRONG = '#e01b1b'
const COLOR_WIND = '#199e70'
const COLOR_GUST = '#7fbfa5'
const COLOR_RH = '#3987e5'
const COLOR_PRECIP = '#3987e5'
const COLOR_THETA = '#9085e9'
const COLOR_ZERO = '#5f5f57'
const COLOR_THRESHOLD = '#8a6d2a'
const COLOR_STRONG = '#a04a3a'

// Stunde direkt aus UTC statt über Intl: de-DE formatiert eine reine Stunde
// als „06 Uhr", und das „Uhr" frisst genau den Platz, den das Datum braucht.
const formatTick = (ts: number): string => String(new Date(ts * 1000).getUTCHours()).padStart(2, '0')
const dayFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})
// Stunde selbst anhängen — mit `hour` im Intl-Format stünde „23 Uhr UTC" da.
const when = (ms: number): string =>
  `${dayFmt.format(new Date(ms))} ${String(new Date(ms).getUTCHours()).padStart(2, '0')} UTC`
const num = (v: number, digits = 1): string => v.toFixed(digits).replace('.', ',')
const modelColor = (id: string): string =>
  SERIES_COLORS[(FOEHN_MODELS as readonly string[]).indexOf(id) % SERIES_COLORS.length]

interface Tile {
  chart: ChartDef
  /** Warum die Kachel leer sein kann — steht über der leeren Fläche. */
  empty: string
}

export function FoehnPanel() {
  const [axisId, setAxisId] = useState(DEFAULT_FOEHN_AXIS)
  const [direction, setDirection] = useState<FoehnDirection>('south')
  const [overlay, setOverlay] = useState<string[]>(DEFAULT_OVERLAY_MODELS)
  const [detailId, setDetailId] = useState(DEFAULT_DETAIL_MODEL)
  const [ensId, setEnsId] = useState(FOEHN_ENSEMBLES[0].id)
  const [now] = useState(() => Date.now())

  const axis = getFoehnAxis(axisId)
  const lee = direction === 'south' ? axis.leeSouthFoehn : axis.leeNorthFoehn
  const detail = getModel(detailId)
  const ens = getFoehnEnsemble(ensId)
  const upperAir = FOEHN_UPPER_AIR_MODELS.has(detailId)
  const hasGusts = detail.availableVariables.includes('wind_gusts_10m')
  const dirLabel = DIRECTION_LABEL[direction]
  const sign = direction === 'south' ? 1 : -1

  // Werteanzeige am Zeiger — wie im klassischen Meteogramm: der Zustand gilt
  // für alle Kacheln, neu gezeichnet wird nur beim Stundenwechsel.
  const [readoutMs, setReadoutMs] = useState<number | null>(null)
  const hoverMsRef = useRef<number | null>(null)
  const handleHover = useCallback((ms: number | null) => {
    if (ms === hoverMsRef.current) return
    hoverMsRef.current = ms
    setReadoutMs(ms)
  }, [])

  // Druck an beiden Achsenenden für alle überlagerten Modelle PLUS das
  // Detailmodell — dessen ΔP braucht der Kriterien-Streifen auch dann, wenn
  // es im Diagramm nicht angehakt ist.
  const pModels = useMemo(
    () => FOEHN_MODELS.filter((m) => overlay.includes(m) || m === detailId),
    [overlay, detailId],
  )

  // Achse bis zum längsten Horizont der gewählten Modelle bzw. des Ensembles.
  const horizon = Math.max(
    ...pModels.map((id) => modelHorizonEnd(getModel(id), now)),
    modelHorizonEnd(getModel(ens.deterministicModel), now),
  )
  const gridMs = useMemo(() => timeGridMs().filter((t) => t <= horizon), [horizon])
  const xs = useMemo(() => gridMs.map((t) => t / 1000), [gridMs])

  const southQ = useMeteogramSeries(axis.south, pModels, 'pressure_msl')
  const northQ = useMeteogramSeries(axis.north, pModels, 'pressure_msl')
  // Kamm: 700-hPa-Größen nur bei Modellen, die sie liefern (live geprüft).
  const t700Q = usePointSeries(axis.crest, detailId, 'temperature_700hPa', upperAir)
  const ws700Q = usePointSeries(axis.crest, detailId, 'wind_speed_700hPa', upperAir)
  const wd700Q = usePointSeries(axis.crest, detailId, 'wind_direction_700hPa', upperAir)
  const crestPrecipQ = usePointSeries(axis.crest, detailId, 'precipitation')
  // Lee-Talstation.
  const leeT2mQ = usePointSeries(lee, detailId, 'temperature_2m')
  const leeSpQ = usePointSeries(lee, detailId, 'surface_pressure')
  const leeRhQ = usePointSeries(lee, detailId, 'relative_humidity_2m')
  const leeWindQ = usePointSeries(lee, detailId, 'wind_speed_10m')
  const leeGustQ = usePointSeries(lee, detailId, 'wind_gusts_10m', hasGusts)
  // Ensemble: Druck an beiden Enden, ΔP je Member.
  const ensSouthQ = useEnsembleSeriesFor(axis.south, ens.id, 'pressure_msl', ens.forecastDays, ens.members)
  const ensNorthQ = useEnsembleSeriesFor(axis.north, ens.id, 'pressure_msl', ens.forecastDays, ens.members)

  const allQueries = [
    ...southQ, ...northQ, t700Q, ws700Q, wd700Q, crestPrecipQ, leeT2mQ, leeSpQ,
    leeRhQ, leeWindQ, leeGustQ, ensSouthQ, ensNorthQ,
  ]
  // dataUpdatedAt statt „geladen ja/nein": ein Refetch nach 30 min bringt
  // einen neuen Lauf, der Memo muss dann neu rechnen.
  const dataKey = allQueries.map((q) => q.dataUpdatedAt).join('|')
  const loading = allQueries.some((q) => q.isLoading)
  const failed = allQueries.find((q) => q.error)?.error

  const derived = useMemo(() => {
    const g = (q: { data?: HourlySeries }): Series => alignSeries(gridMs, q.data?.times, q.data?.values)
    const members = (q: { data?: EnsembleSeries }): Series[] =>
      (q.data?.members ?? []).map((m) => alignSeries(gridMs, q.data!.times, m))

    const dpByModel = pModels.map((id, i) => ({ id, values: difference(g(southQ[i]), g(northQ[i])) }))
    const dp = dpByModel.find((d) => d.id === detailId)?.values ?? gridMs.map(() => null)
    const crestSpeed = g(ws700Q)
    const crestDir = g(wd700Q)
    const crestPrecip = g(crestPrecipQ)
    const leeWind = g(leeWindQ)
    const leeGust = g(leeGustQ)
    const leeRh = g(leeRhQ)
    const dTheta = thetaDifference(g(leeT2mQ), g(leeSpQ), g(t700Q))
    const crit = foehnCriteria({ dp, crestSpeed, crestDir, leeRh, dTheta }, direction, axis.threshold)
    const phases = foehnPhases(gridMs, crit.signal, dp, direction)

    const ensDp = memberDifferences(members(ensSouthQ), members(ensNorthQ))
    const stats = plumeStats(ensDp)
    const prob = exceedanceProbability(ensDp, axis.threshold, direction)
    const probStrong = exceedanceProbability(ensDp, axis.strong, direction)

    const dpRefs = [
      { value: 0, color: COLOR_ZERO },
      { value: axis.threshold, color: COLOR_THRESHOLD, dash: [5, 4] },
      { value: -axis.threshold, color: COLOR_THRESHOLD, dash: [5, 4] },
      { value: axis.strong, color: COLOR_STRONG, dash: [2, 3] },
      { value: -axis.strong, color: COLOR_STRONG, dash: [2, 3] },
    ]
    const dpName = `ΔP ${axis.south.name} − ${axis.north.name}`

    // Die Zeitachse reicht bis zum LÄNGSTEN Horizont der gewählten Modelle
    // bzw. des Ensembles — jede Kachel graut deshalb den Bereich hinter IHREM
    // eigenen Ende aus. Ohne das laufen Gitter und Schwellenlinien weiter, als
    // wäre die Fläche nur gerade leer: bei ICON-CH1 (33 h) auf einer
    // 120-h-Achse ist das der größere Teil des Diagramms, und die
    // Schwellenlinien lesen sich dort wie Daten.
    //
    // Abgeleitet aus den REIHEN, nicht aus `forecastHours`: so stimmt die
    // Kante auch, wenn ein Modell kürzer liefert als die Registry angibt.
    const veil = (...series: Series[]) => {
      const from = horizonEdge(gridMs, series)
      return from == null ? undefined : { from, label: 'jenseits des Modellhorizonts' }
    }

    const strip: Tile = {
      chart: {
        title: `Föhnkriterien ${dirLabel} — ${detail.label}`,
        unit: '',
        curves: [],
        note: `ΔP ${sign > 0 ? '≥' : '≤'} ${sign * axis.threshold} hPa · Kamm 700 hPa aus ${
          direction === 'south' ? 'SO–WSW' : 'WNW–NO'
        } ≥ ${FOEHN_LIMITS.crestMinSpeedKmh} km/h · rF ${lee.name} ≤ ${FOEHN_LIMITS.leeMaxRh} % · Δθ ≥ ${
          FOEHN_LIMITS.minThetaDiff
        } K · grauer Strich = liefert das Modell nicht`,
        veil: veil(crit.score, crit.pressure, crit.crest, crit.dry, crit.mixed),
        flagRows: {
          rows: [
            { label: 'Summe', values: crit.score, color: COLOR_SCORE, texts: crit.scoreText },
            { label: 'ΔP', values: crit.pressure, color: COLOR_PRESSURE },
            { label: 'Kamm', values: crit.crest, color: COLOR_CREST },
            { label: 'Trocken', values: crit.dry, color: COLOR_DRY },
            { label: 'Δθ', values: crit.mixed, color: COLOR_MIXED },
          ],
        },
      },
      empty: `Keine Daten von ${detail.label}`,
    }

    const dpModels: Tile = {
      chart: {
        title: `${dpName} · Modelle`,
        unit: 'hPa',
        symmetricMin: axis.strong + 2,
        ySpace: 22,
        note: `+ = Südföhn · Schwellen ±${axis.threshold} / ±${axis.strong} hPa (Faustregel)`,
        refLines: dpRefs,
        veil: veil(...dpByModel.filter((d) => overlay.includes(d.id)).map((d) => d.values)),
        curves: dpByModel
          .filter((d) => overlay.includes(d.id))
          .map<Curve>((d) => ({
            label: getModel(d.id).label,
            color: modelColor(d.id),
            type: 'line',
            values: d.values,
            width: d.id === detailId ? 2.4 : 1.6,
          })),
      },
      empty: 'Kein Modell angehakt',
    }

    const dpEnsemble: Tile = {
      chart: {
        title: `${dpName} · ${ens.label}`,
        unit: 'hPa',
        symmetricMin: axis.strong + 2,
        ySpace: 22,
        note: `${ensDp.length} Member, Median und 10/90-Perzentil`,
        refLines: dpRefs,
        veil: veil(stats.median, stats.p10, stats.p90),
        curves: [
          ...ensDp.map<Curve>((m, i) => ({
            label: `Member ${i}`,
            color: COLOR_MEMBER,
            type: 'line',
            values: m,
            width: 1,
            quiet: true,
          })),
          { label: '90 %', color: COLOR_PCTL, type: 'line', values: stats.p90, width: 1.3, dash: [3, 3] },
          { label: 'Median', color: COLOR_MEDIAN, type: 'line', values: stats.median, width: 2.2 },
          { label: '10 %', color: COLOR_PCTL, type: 'line', values: stats.p10, width: 1.3, dash: [3, 3] },
        ],
      },
      empty: `Keine Ensembledaten von ${ens.label}`,
    }

    // Wahrscheinlichkeit, nach Stärke EINGEFÄRBT statt als zwei Linien: die
    // Fläche ist ocker bis zum Anteil der Member über der Föhnschwelle und
    // ROT, soweit die Member über der Starkföhn-Schwelle liegen. Der rote
    // Anteil ist im ockerfarbenen ENTHALTEN (wer 8 hPa überschreitet,
    // überschreitet auch 4) — deshalb ein Streifen zwischen beiden Kurven
    // (`Curve.fillTo`) und KEIN Stapel: die Achse bleibt eine
    // Wahrscheinlichkeit von 0 bis 100 %, und beide Kanten sind an ihr
    // ablesbar (Oberkante = Anteil ≥ 4 hPa, Trennkante = Anteil ≥ 8 hPa).
    // Als zwei gleichrangige Linien ging der starke Anteil unter, weil er
    // meist klein ist.
    const probability: Tile = {
      chart: {
        title: `${dirLabel}-Wahrscheinlichkeit · ${ens.label}`,
        unit: '%',
        range: [0, 100],
        ySpace: 22,
        note: `Anteil der Member über der Schwelle — rot: ≥ ${axis.strong} hPa`,
        refLines: [{ value: 50, color: COLOR_ZERO, dash: [2, 4] }],
        veil: veil(prob, probStrong),
        curves: [
          {
            label: `≥ ${axis.strong} hPa`,
            color: COLOR_PROB_STRONG,
            type: 'line',
            values: probStrong,
            width: 1.8,
            fill: 0.75,
          },
          {
            label: `≥ ${axis.threshold} hPa`,
            color: COLOR_PROB,
            type: 'line',
            values: prob,
            width: 2,
            fill: 0.45,
            // Nur der Streifen zwischen den Schwellen — bis zur Nulllinie
            // gefüllt würde die ockerfarbene Fläche die rote überdecken.
            fillTo: 0,
          },
        ],
      },
      empty: `Keine Ensembledaten von ${ens.label}`,
    }

    const crest: Tile = {
      chart: {
        title: `Kamm ${axis.crest.name} · Wind 700 hPa, Niederschlag · ${detail.label}`,
        unit: 'km/h',
        zeroBased: true,
        minTop: 60,
        topReserve: 0.25,
        ySpace: 22,
        note: 'Fiedern in Knoten · Niederschlag = Stau',
        // Am Kamm ist die WINDRICHTUNG das Kriterium (Sektor SO–WSW bzw.
        // WNW–NO), nicht nur die Stärke — ein Wechsel über wenige Stunden
        // entscheidet über Föhn oder nicht. Deshalb hier so dicht wie
        // lesbar (jeder Zeitschritt, wo der Platz reicht, sonst jeder
        // zweite/dritte) statt im Standardabstand von 6 h.
        barbGap: 10,
        refLines: [{ value: FOEHN_LIMITS.crestMinSpeedKmh, color: COLOR_THRESHOLD, dash: [5, 4] }],
        veil: veil(crestSpeed, crestPrecip),
        rightAxis: { unit: 'mm/h', range: [0, 10] },
        curves: [
          {
            label: 'Wind 700 hPa',
            color: COLOR_WIND,
            type: 'line',
            values: crestSpeed,
            direction: crestDir,
            width: 2,
          },
          { label: 'Niederschlag', color: COLOR_PRECIP, type: 'bars', values: crestPrecip, rightAxis: true },
        ],
      },
      empty: upperAir ? `Keine Daten von ${detail.label}` : `${detail.label} liefert keine 700-hPa-Größen`,
    }

    const leeTile: Tile = {
      chart: {
        title: `Lee ${lee.name} · Wind, Böen, Feuchte · ${detail.label}`,
        unit: 'km/h',
        zeroBased: true,
        minTop: 40,
        ySpace: 22,
        rightAxis: { unit: '%', range: [0, 100] },
        veil: veil(leeWind, leeGust, leeRh),
        curves: [
          { label: 'Wind', color: COLOR_WIND, type: 'line', values: leeWind, width: 2 },
          { label: 'Böen', color: COLOR_GUST, type: 'line', values: leeGust, dash: [4, 3], width: 1.4 },
          { label: 'rel. Feuchte', color: COLOR_RH, type: 'line', values: leeRh, rightAxis: true, width: 1.5, fill: 0.1 },
        ],
      },
      empty: `Keine Daten von ${detail.label}`,
    }

    const theta: Tile = {
      chart: {
        title: `Δθ ${lee.name} − 700 hPa · ${detail.label}`,
        unit: 'K',
        minSpan: 12,
        yInclude: [0, FOEHN_LIMITS.minThetaDiff],
        ySpace: 22,
        note: 'nahe 0 = durchmischt bis zum Talboden · stark negativ = Kaltluftsee',
        veil: veil(dTheta),
        refLines: [
          { value: 0, color: COLOR_ZERO },
          { value: FOEHN_LIMITS.minThetaDiff, color: COLOR_THRESHOLD, dash: [5, 4] },
        ],
        curves: [{ label: 'Δθ', color: COLOR_THETA, type: 'line', values: dTheta, width: 2 }],
      },
      empty: upperAir ? `Keine Daten von ${detail.label}` : `${detail.label} liefert keine 700-hPa-Temperatur`,
    }

    // Reihenfolge = Rasterfluss: links Druck, rechts Kamm/Lee.
    const tiles = [dpModels, crest, dpEnsemble, leeTile, probability, theta]
    return { strip, tiles, phases, prob }
    // Query-Objekte sind jede Renderrunde neue Referenzen — auf `dataKey`
    // keyen (wie im klassischen Meteogramm), sonst rechnet der Memo ständig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, gridMs, direction, axisId, detailId, pModels, overlay, ensId, lee])

  const glance = useMemo(
    () => summarize(derived.phases, derived.prob, gridMs, now),
    [derived, gridMs, now],
  )

  const readoutFrac =
    readoutMs === null || gridMs.length < 2
      ? null
      : Math.min(1, Math.max(0, (readoutMs - gridMs[0]) / (gridMs[gridMs.length - 1] - gridMs[0])))

  const toggleOverlay = (id: string) =>
    setOverlay((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]))

  const tileProps = { xs, now, readoutMs, onHover: handleHover, loading }

  return (
    <div className="meteo">
      <div className="atclima-bar foehn-bar">
        <span className="atclima-title">Föhn</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Achse</span>
          <select value={axisId} onChange={(e) => setAxisId(e.target.value)}>
            {FOEHN_AXES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.region})
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Richtung</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as FoehnDirection)}>
            <option value="south">Südföhn (Lee {axis.leeSouthFoehn.name})</option>
            <option value="north">Nordföhn (Lee {axis.leeNorthFoehn.name})</option>
          </select>
        </label>
        <label
          className="atclima-ctrl"
          title="Modell für Kriterien-Streifen, Kamm, Lee und Δθ — und die Föhnphasen im Überblick. Nur AROME France und ICON-D2 liefern 700-hPa-Größen."
        >
          <span className="label-muted">Details</span>
          <select value={detailId} onChange={(e) => setDetailId(e.target.value)}>
            {FOEHN_MODELS.map((id) => (
              <option key={id} value={id}>
                {getModel(id).label}
                {FOEHN_UPPER_AIR_MODELS.has(id) ? '' : ' (ohne 700 hPa)'}
              </option>
            ))}
          </select>
        </label>
        <span className="label-muted" title={`${detail.label} · ${RUN_TITLE}`}>
          Lauf {formatRunLong(latestRun(detail, now), now)}
        </span>
        <label className="atclima-ctrl">
          <span className="label-muted">Ensemble</span>
          <select value={ensId} onChange={(e) => setEnsId(e.target.value)}>
            {FOEHN_ENSEMBLES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.members} Member)
              </option>
            ))}
          </select>
        </label>
        {/* Eigener Lauf: das Ensemble läuft in einem anderen Takt als das
            Detailmodell — die beiden Kachelspalten können also unterschiedlich
            alt sein, und das ist bei einer Föhnlage genau die Frage.
            Gerechnet über das DETERMINISTISCHE Gegenstück (`deterministicModel`),
            weil die Ensemble-Registry keinen eigenen Takt führt: EPS und
            Hauptlauf laufen im gleichen Rhythmus, das EPS ist aber typisch
            später fertig — die Angabe ist hier also eher zu früh als zu spät.
            Das sagt der Tooltip. */}
        <span
          className="label-muted"
          title={`${ens.label} · Takt des zugehörigen Hauptlaufs (${
            getModel(ens.deterministicModel).label
          }); ein Ensemble ist typisch etwas später verfügbar. ${RUN_TITLE}`}
        >
          Lauf {formatRunLong(latestRun(getModel(ens.deterministicModel), now), now)}
        </span>
        <span
          className="label-muted"
          title="Die Zeitachse endet am längsten Horizont der gewählten Modelle bzw. des Ensembles. Zeiten in UTC. Die Schwellen sind gängige Faustregeln, nicht gegen Messungen kalibriert."
        >
          bis +{Math.max(0, Math.round((horizon - now) / MS_PER_HOUR))} h · UTC
        </span>
        {/* Der TopBar-Badge hängt am Panel-Raster und ist hier nicht zu
            sehen — das Szenario muss aber genau in DIESEM Bereich erkennbar
            sein, sonst hält man synthetischen Orkan für eine echte Lage. */}
        {MOCK_FOEHN && (
          <span
            className="mock-badge"
            title={`Synthetische Südföhn-Episode (?mock=foehn), Höhepunkt +${FOEHN_EPISODE.peakH} h ab heute 00 UTC. Kein API-Verbrauch. Nordföhn zeigt damit korrekt keinen Föhn.`}
          >
            MOCK · FÖHNORKAN +{FOEHN_EPISODE.startH}…{FOEHN_EPISODE.endH} h
          </span>
        )}
        {loading && <span className="label-muted">lädt …</span>}
      </div>
      <div className="atclima-bar foehn-bar">
        <span className="label-muted">ΔP-Modelle</span>
        {FOEHN_MODELS.map((id) => {
          const m = getModel(id)
          return (
            <label key={id} className="foehn-model" title={`${m.provider}, ${resolutionLabel(m)}, +${m.forecastHours} h`}>
              <input type="checkbox" checked={overlay.includes(id)} onChange={() => toggleOverlay(id)} />
              <i style={{ background: modelColor(id) }} />
              {m.label} <span className="label-muted">{resolutionLabel(m)}</span>
            </label>
          )
        })}
      </div>

      <div className="foehn-glance">
        <span>
          <strong>{detail.label}:</strong>{' '}
          {glance.phases.length === 0
            ? `ab jetzt kein ${dirLabel}-Signal bis zum Horizont`
            : glance.phases
                .map((p) => `${when(p.start)} – ${when(p.end)} (ΔP bis ${num(p.peak)} hPa)`)
                .join(' · ')}
        </span>
        <span>
          <strong>{ens.label}:</strong>{' '}
          {glance.maxProb == null
            ? 'keine Daten'
            : glance.maxProb.value < 1
              ? `kein Member über ${axis.threshold} hPa`
              : `höchste ${dirLabel}-Wahrscheinlichkeit ${Math.round(glance.maxProb.value)} % am ${when(
                  glance.maxProb.t,
                )}`}
        </span>
        {failed && <span className="foehn-error">Fehler beim Laden: {failed.message}</span>}
      </div>

      <div className="foehn-body">
        <FoehnTile
          tile={derived.strip}
          className="foehn-strip"
          {...tileProps}
          header={
            <div className="meteo-timebar">
              {readoutFrac === null ? (
                <span className="meteo-timebar-idle">Modellzeit folgt dem Zeiger</span>
              ) : (
                <span
                  className="meteo-timebar-value"
                  style={{
                    left: `calc(${Y_AXIS_SIZE}px + ${readoutFrac} * (100% - ${Y_AXIS_SIZE + RIGHT_AXIS_SIZE}px))`,
                    transform:
                      readoutFrac < 0.07
                        ? 'translateX(0)'
                        : readoutFrac > 0.93
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                  }}
                >
                  {when(readoutMs!)}
                </span>
              )}
            </div>
          }
        />
        <div className="foehn-grid">
          {derived.tiles.map((t) => (
            <FoehnTile key={t.chart.title} tile={t} {...tileProps} />
          ))}
        </div>
      </div>
      <OpenMeteoAttribution className="app-attribution" />
    </div>
  )
}

/** Eine Diagramm-Kachel: Kopfzeile mit Legende, darunter der Plot. */
function FoehnTile({
  tile,
  className = '',
  header,
  xs,
  now,
  readoutMs,
  onHover,
  loading,
}: {
  tile: Tile
  className?: string
  header?: ReactNode
  xs: number[]
  now: number
  readoutMs: number | null
  onHover: (ms: number | null) => void
  loading: boolean
}) {
  const c = tile.chart
  const legend = c.curves.filter((s) => !s.quiet)
  return (
    <div className={`foehn-cell ${className}`.trim()}>
      {header}
      <div className="atfc-chartcap">
        <span>
          {c.title} {c.unit && <span className="label-muted">({c.unit})</span>}
        </span>
        <span className="atfc-legend">
          {c.note && <span className="label-muted">{c.note}</span>}
          {legend.length > 1 &&
            legend.map((s) => (
              <span key={s.label}>
                <i style={{ background: s.color }} /> {s.label}
              </span>
            ))}
        </span>
      </div>
      <div className="meteo-plotwrap">
        <ChartRow
          xs={xs}
          chart={c}
          tz={TZ}
          formatTick={formatTick}
          xSpace={X_TICK_SPACE}
          dayRow
          markTime={now}
          readoutTime={readoutMs ?? undefined}
          onHoverTime={onHover}
          syncKey="foehn"
          height={CHART_HEIGHT}
        />
        {!loading && !chartHasData(c) && <div className="panel-placeholder atdetail-overlay">{tile.empty}</div>}
      </div>
    </div>
  )
}

/** Überblick: künftige Föhnphasen (höchstens drei) und das Maximum der Wahrscheinlichkeit ab jetzt. */
function summarize(
  phases: FoehnPhase[],
  prob: Series,
  gridMs: number[],
  now: number,
): { phases: FoehnPhase[]; maxProb: { value: number; t: number } | null } {
  const future = phases.filter((p) => p.end >= now).slice(0, 3)
  let maxProb: { value: number; t: number } | null = null
  for (let i = 0; i < gridMs.length; i++) {
    const v = prob[i]
    if (v == null || gridMs[i] < now) continue
    if (maxProb === null || v > maxProb.value) maxProb = { value: v, t: gridMs[i] }
  }
  return { phases: future, maxProb }
}
