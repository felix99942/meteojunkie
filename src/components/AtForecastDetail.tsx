// Punkt-Vorhersage einer MOSMIX-Station: Klick auf die DACH-Karte öffnet dieses
// Panel mit dem 72-h-Verlauf ALLER Parameter — das Gegenstück zum Stationsdetail
// der Klimakarte. Kostet kein Budget: die Parameter-JSONs liegen bereits als
// statische Assets vor, `loadForecast` cached sie modulweit; der erste Klick zieht
// die noch fehlenden Dateien einmal nach, jede weitere Station ist gratis.
//
// Die Zeitreihen der einzelnen Parameter werden über ihre EIGENEN timeSteps auf
// die Referenzachse gelegt — MOSMIX liefert nicht für jeden Parameter zwingend
// dieselben Termine, stumpfes Index-Matching würde die Kurven verschieben.

import { useEffect, useMemo, useState } from 'react'
import { alignSeries, loadForecast, type ForecastData, type MosStation } from '../api/mosApi'
import { FORECAST_PARAMS } from '../config/atForecast'
import { ChartRow } from './ChartStack'
import { chartHasData, type ChartDef } from '../config/chartDef'

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
        curves: [
          { label: 'T2m', color: '#d95926', type: 'line', values: get('t2m') },
          { label: 'Gefühlt', color: '#9b59d0', type: 'line', values: get('feels') },
        ],
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
      charts: charts.filter(chartHasData),
      days: dayList.map((day, i) => ({ day, min: tmin[i] ?? null, max: tmax[i] ?? null })),
      run: data.t2m?.meta.run ?? '',
    }
  }, [data, station.id])

  // Fadenkreuz über alle Reihen des Stapels hinweg synchron — pro Station neu,
  // sonst würde ein zweites geöffnetes Detail denselben Sync-Kreis teilen.
  const syncKey = useMemo(() => `atfc-${station.id}`, [station.id])

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
          <ChartRow xs={xs} chart={c} tz={TZ} axisFmt={fmtAxis} markTime={markTime} syncKey={syncKey} />
        </div>
      ))}
    </div>
  )
}
