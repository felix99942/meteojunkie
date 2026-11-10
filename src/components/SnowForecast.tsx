// Schneevorhersage — Unterpunkt des Meteogramms (seit 2026-11-10, auf Wunsch).
// Neuschnee-Summe ab jetzt an EINEM Ort: oben alle Ensembles zusammen
// (gleich gewichtet) mit den vier Hauptläufen, darunter je Ensemble sein
// eigenes Band mit Median und Hauptlauf. Rechenkern und Begründungen:
// `config/snowForecast.ts`.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchDeterministicSeries, fetchEnsembleSeries, type EnsembleSeries } from '../api/openmeteo'
import type { HourlySeries } from '../api/openmeteo'
import { MOCK_MODE } from '../api/mock'
import { plumeStats } from '../render/plume'
import { ChartRow } from './ChartStack'
import { chartHasData, RIGHT_AXIS_SIZE, Y_AXIS_SIZE, type ChartDef, type Curve } from '../config/chartDef'
import {
  groupChanges,
  lastValue,
  parseAromeSnow,
  pooledStats,
  snowGrid,
  sumFromStart,
  SNOW_BAND,
  SNOW_DAYS,
  SNOW_ENSEMBLES,
  SNOW_MAIN_RUNS,
  type GeoSphereTimeseries,
  type SnowMainRun,
} from '../config/snowForecast'
import { alignSeries, horizonEdge, type Series } from './foehn'
import { useWorkbench, type LatLon } from '../state/workbench'
import { LocationPicker } from './LocationPicker'
import { QuickPoints } from './QuickPoints'
import { OpenMeteoAttribution } from './Attribution'

const TZ = 'Etc/UTC'
const X_TICK_SPACE = 50
const CHART_HEIGHT = 200
const STALE_MS = 30 * 60_000
const formatTick = (ts: number): string => String(new Date(ts * 1000).getUTCHours()).padStart(2, '0')
const whenFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})
const when = (ms: number): string => `${whenFmt.format(new Date(ms))} UTC`
const cm = (v: number): string => `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} cm`

const AROME_URL = 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km'

async function fetchAromeSnow(loc: LatLon): Promise<HourlySeries> {
  // Im Mock-Modus kein fremder Abruf — die übrigen Reihen sind dort ohnehin synthetisch
  if (MOCK_MODE !== 'off') return { times: [], values: [], unit: 'cm' }
  const q = new URLSearchParams({
    lat_lon: `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`,
    parameters: 'sf',
    output_format: 'geojson',
  })
  const res = await fetch(`${AROME_URL}?${q}`)
  // Außerhalb des AROME-Gebiets antwortet der Hub mit einem Fehler — das ist
  // „kein Wert", kein Ausfall der Seite
  if (!res.ok) return { times: [], values: [], unit: 'cm' }
  const r = parseAromeSnow((await res.json()) as GeoSphereTimeseries)
  return { times: r.times, values: r.values, unit: 'cm' }
}

interface Tile {
  chart: ChartDef
  legend: { label: string; color: string; band?: true }[]
  empty: string
  /**
   * Eigene, KÜRZERE Zeitachse (Anzahl Stunden ab dem ersten Rasterpunkt):
   * ICON-D2-EPS endet nach 48 h, auf der 7-Tage-Achse wären zwei Drittel der
   * Kachel Schraffur. Ohne Angabe gilt das volle Raster.
   */
  n?: number
  /** Über die volle Breite des Rasters (IFS-ENS, das bis zum Ende reicht). */
  wide?: true
}

function bandCurves(s: { p10: Series; p25: Series; median: Series; p75: Series; p90: Series }): Curve[] {
  // Reihenfolge = Indizes für `fillTo`: 0 P10, 1 P90 (bis 0), 2 P25, 3 P75 (bis 2)
  return [
    { label: 'P10', color: SNOW_BAND.outer, type: 'line', values: s.p10, width: 0.8 },
    { label: 'P90', color: SNOW_BAND.outer, type: 'line', values: s.p90, width: 0.8, fill: 0.4, fillTo: 0 },
    { label: 'P25', color: SNOW_BAND.inner, type: 'line', values: s.p25, width: 0.8 },
    { label: 'P75', color: SNOW_BAND.inner, type: 'line', values: s.p75, width: 0.8, fill: 0.5, fillTo: 2 },
    { label: 'Median', color: SNOW_BAND.median, type: 'line', values: s.median, width: 2.6 },
  ]
}

const BAND_LEGEND = [
  { label: '10–90 %', color: SNOW_BAND.outer, band: true as const },
  { label: '25–75 %', color: SNOW_BAND.inner, band: true as const },
  { label: 'Median', color: SNOW_BAND.median },
]

export function SnowForecast({ nav }: { nav: ReactNode }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const [now] = useState(() => Date.now())
  const gridMs = useMemo(() => snowGrid(now), [now])
  const xs = useMemo(() => gridMs.map((t) => t / 1000), [gridMs])

  const [readoutMs, setReadoutMs] = useState<number | null>(null)
  const hoverRef = useRef<number | null>(null)
  const handleHover = useCallback((ms: number | null) => {
    if (ms === hoverRef.current) return
    hoverRef.current = ms
    setReadoutMs(ms)
  }, [])

  const latKey = location ? location.lat.toFixed(4) : null
  const lonKey = location ? location.lon.toFixed(4) : null

  const aromeQ = useQuery({
    queryKey: ['snow-arome', latKey, lonKey],
    queryFn: () => fetchAromeSnow(location!),
    enabled: location !== null,
    staleTime: STALE_MS,
    retry: 1,
  })
  const omMain = SNOW_MAIN_RUNS.filter((m) => m.source === 'open-meteo')
  const mainQs = useQueries({
    queries: omMain.map((m) => ({
      queryKey: ['deterministic', latKey, lonKey, m.id, 'snowfall', m.days],
      queryFn: () => fetchDeterministicSeries(location!.lat, location!.lon, m.id, 'snowfall', m.days),
      enabled: location !== null,
      staleTime: STALE_MS,
      retry: 2,
    })),
  })
  const ensQs = useQueries({
    queries: SNOW_ENSEMBLES.map((e) => ({
      queryKey: ['ensemble', latKey, lonKey, e.id, 'snowfall', e.days],
      queryFn: () => fetchEnsembleSeries(location!.lat, location!.lon, e.id, 'snowfall', e.days, e.members),
      enabled: location !== null,
      staleTime: STALE_MS,
      retry: 1,
    })),
  })

  const all = [aromeQ, ...mainQs, ...ensQs]
  const dataKey = all.map((q) => q.dataUpdatedAt).join('|')
  const loading = all.some((q) => q.isLoading)
  const failed = all.find((q) => q.error)?.error as Error | undefined

  const derived = useMemo(() => {
    const seriesOf = (m: SnowMainRun): HourlySeries | undefined =>
      m.source === 'geosphere' ? aromeQ.data : mainQs[omMain.indexOf(m)]?.data
    const mains = SNOW_MAIN_RUNS.map((m) => {
      const d = seriesOf(m)
      return { run: m, sum: sumFromStart(alignSeries(gridMs, d?.times, d?.values)) }
    })
    const ens = SNOW_ENSEMBLES.map((e, i) => {
      const d = ensQs[i]?.data as EnsembleSeries | undefined
      const members = (d?.members ?? []).map((m) => sumFromStart(alignSeries(gridMs, d!.times, m)))
      return { ens: e, members }
    })
    const veil = (...series: Series[]) => {
      const from = horizonEdge(gridMs, series)
      return from == null ? undefined : { from, label: 'jenseits des Modellhorizonts' }
    }

    const pooled = pooledStats(
      ens.map((e) => e.members).filter((m) => m.length > 0),
      gridMs.length,
    )
    const changes = groupChanges(gridMs, pooled.groups)
    const mainCurves: Curve[] = mains.map((m) => ({
      label: m.run.label,
      color: m.run.color,
      type: 'line',
      values: m.sum,
      width: 1.8,
    }))
    const combined: Tile = {
      chart: {
        title: 'Alle Ensembles zusammen · Hauptläufe',
        unit: 'cm',
        zeroBased: true,
        minTop: 5,
        ySpace: 22,
        note:
          changes.length > 0
            ? `Band ab ${changes.map((c) => `${when(c.t)} aus ${c.to} statt ${c.from}`).join(', ')} Ensembles`
            : 'jedes Ensemble zählt gleich viel, nicht jeder Member',
        veil: veil(pooled.median, ...mains.map((m) => m.sum)),
        curves: [...bandCurves(pooled), ...mainCurves],
      },
      legend: [...BAND_LEGEND, ...SNOW_MAIN_RUNS.map((m) => ({ label: m.label, color: m.color }))],
      empty: 'Keine Daten',
    }

    const perModel: Tile[] = ens.map(({ ens: e, members }) => {
      const st = plumeStats(members)
      const main = mains.find((m) => m.run.id === e.main)!
      // Achse bis zum letzten Wert von Ensemble ODER Hauptlauf, plus 3 h Rand
      const end = Math.max(lastValue(st.median)?.i ?? 0, lastValue(main.sum)?.i ?? 0)
      const full = e.days >= SNOW_DAYS
      const n = full || end === 0 ? undefined : Math.min(gridMs.length, Math.max(25, end + 4))
      return {
        n,
        wide: full ? true : undefined,
        chart: {
          title: `${e.label} · ${members.length || e.members} Member, ${e.resolution} · Hauptlauf ${main.run.label}`,
          unit: 'cm',
          zeroBased: true,
          minTop: 5,
          ySpace: 22,
          veil: veil(st.median, main.sum),
          curves: [
            ...bandCurves(st),
            { label: main.run.label, color: main.run.color, type: 'line', values: main.sum, width: 1.8 },
          ],
        },
        legend: [...BAND_LEGEND, { label: `Hauptlauf ${main.run.label}`, color: main.run.color }],
        empty: `Keine Daten von ${e.label}`,
      }
    })

    // Kurzfassung: Summe am Ende jeder Reihe
    const glance = {
      mains: mains
        .map((m) => ({ label: m.run.label, last: lastValue(m.sum) }))
        .filter((m): m is { label: string; last: { i: number; v: number } } => m.last !== null && m.last.i > 0),
      median: lastValue(pooled.median),
      p10: lastValue(pooled.p10),
      p90: lastValue(pooled.p90),
    }
    return { combined, perModel, glance }
    // Query-Objekte sind jede Runde neu — auf `dataKey` keyen (wie im Föhn-Bereich)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, gridMs])

  const readoutFrac =
    readoutMs === null
      ? null
      : Math.min(1, Math.max(0, (readoutMs - gridMs[0]) / (gridMs[gridMs.length - 1] - gridMs[0])))
  const tileProps = { xs, now, readoutMs, onHover: handleHover, loading }
  const g = derived.glance

  return (
    <div className="meteo">
      <div className="atclima-bar foehn-bar">
        {nav}
        <LocationPicker />
        <QuickPoints regions={['at']} />
        <span
          className="label-muted"
          title="Neuschnee als Summe ab der laufenden Stunde, in cm wie Open-Meteo (1 mm Wasserwert = 0,7 cm). Gesetzt, geschmolzen oder verweht ist nicht abgezogen. Werte gelten für die Modellhöhe des Gitterpunkts, nicht für die genaue Höhe des Orts."
        >
          Neuschnee-Summe ab jetzt · {SNOW_DAYS} Tage · UTC ⓘ
        </span>
        {loading && <span className="label-muted">lädt …</span>}
      </div>
      {location && (
        <h2 className="meteo-place">
          {location.label ?? 'Gewählter Punkt'}
          <span className="meteo-place-sub">
            {Math.abs(location.lat).toFixed(2)}° {location.lat >= 0 ? 'N' : 'S'} · {Math.abs(location.lon).toFixed(2)}°{' '}
            {location.lon >= 0 ? 'O' : 'W'} · Schneevorhersage
          </span>
        </h2>
      )}
      {!location && <div className="panel-placeholder">Ort wählen, um die Schneevorhersage zu laden</div>}
      {location && (
        <>
          <div className="foehn-glance">
            {g.median ? (
              <span>
                <strong>Alle Ensembles bis {when(gridMs[g.median.i])}:</strong> Median {cm(g.median.v)}
                {g.p10 && g.p90 && ` · 10–90 % ${cm(g.p10.v)} bis ${cm(g.p90.v)}`}
              </span>
            ) : (
              !loading && <span>Keine Ensembledaten</span>
            )}
            {g.mains.length > 0 && (
              <span>
                <strong>Hauptläufe:</strong>{' '}
                {g.mains.map((m) => `${m.label} ${cm(m.last.v)} (bis ${when(gridMs[m.last.i])})`).join(' · ')}
              </span>
            )}
            {failed && <span className="foehn-error">Fehler beim Laden: {failed.message}</span>}
          </div>
          <div className="foehn-body">
            <SnowTile
              tile={derived.combined}
              className="snow-main"
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
            <div className="snow-grid">
              {derived.perModel.map((t) => (
                <SnowTile key={t.chart.title} tile={t} className={t.wide ? 'snow-wide' : ''} {...tileProps} />
              ))}
            </div>
          </div>
        </>
      )}
      <div className="app-attribution">
        <OpenMeteoAttribution />
        <span className="attribution">
          {' '}
          · AROME 1 km:{' '}
          <a href="https://data.hub.geosphere.at/dataset/nwp-v2-1h-1km" target="_blank" rel="noreferrer">
            GeoSphere Austria
          </a>{' '}
          (CC BY 4.0)
        </span>
      </div>
    </div>
  )
}

function SnowTile({
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
  // Gekürzte Achse: Reihen auf dieselbe Länge schneiden; der Zeiger-Sync
  // bekommt einen eigenen Schlüssel je Achsenlänge (uPlot koppelt über den
  // Index), die Zeitleiste folgt weiter über `readoutTime`
  const n = tile.n
  const c: ChartDef = useMemo(
    () =>
      n == null
        ? tile.chart
        : {
            ...tile.chart,
            veil: tile.chart.veil && tile.chart.veil.from < (xs[n - 1] ?? 0) * 1000 ? tile.chart.veil : undefined,
            curves: tile.chart.curves.map((cv) => ({ ...cv, values: cv.values.slice(0, n) })),
          },
    [tile.chart, n, xs],
  )
  const tileXs = useMemo(() => (n == null ? xs : xs.slice(0, n)), [xs, n])
  return (
    <div className={`foehn-cell ${className}`.trim()}>
      {header}
      <div className="atfc-chartcap">
        <span>
          {c.title} <span className="label-muted">({c.unit})</span>
        </span>
        <span className="atfc-legend">
          {c.note && <span className="label-muted">{c.note}</span>}
          {tile.legend.map((s) => (
            <span key={s.label}>
              <i className={s.band ? 'snow-swatch-band' : undefined} style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </span>
      </div>
      <div className="meteo-plotwrap">
        <ChartRow
          xs={tileXs}
          chart={c}
          tz={TZ}
          formatTick={formatTick}
          xSpace={X_TICK_SPACE}
          dayRow
          markTime={now}
          readoutTime={readoutMs ?? undefined}
          onHoverTime={onHover}
          syncKey={`snow-${tileXs.length}`}
          height={CHART_HEIGHT}
        />
        {!loading && !chartHasData(c) && <div className="panel-placeholder atdetail-overlay">{tile.empty}</div>}
      </div>
    </div>
  )
}
