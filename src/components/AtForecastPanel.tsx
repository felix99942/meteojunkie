// Vorhersage-Modus der Klimakarte (MOS, Slice 3). DACH-Karte mit MOSMIX-
// Stationen; stündliche Parameter (T2m, Niederschlag, Sonne, Bewölkung, Wind)
// über einen Zeitschieber, Tmin/Tmax als Tageswerte. Daten: statische MOS-JSONs.

import { useEffect, useMemo, useState } from 'react'
import { loadForecast, loadMosStations, type ForecastData, type MosStation } from '../api/mosApi'
import { FORECAST_PARAMS, getForecastSpec } from '../config/atForecast'
import { colorForValue } from '../config/colorscales'
import { DACH_VIEW } from '../render/atmap'
import europeBasemapUrl from '../mapdata/europe.basemap.json?url'
import { AtClimateMap } from './AtClimateMap'
import { AtForecastDetail } from './AtForecastDetail'

const fmtHour = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const fmtDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'numeric' })

export function AtForecastPanel() {
  const [stations, setStations] = useState<MosStation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paramKey, setParamKey] = useState('t2m')
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<MosStation | null>(null)

  const spec = getForecastSpec(paramKey)

  useEffect(() => {
    let cancelled = false
    loadMosStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setError(err?.message ?? 'Stationen nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [])

  // Vorhersage-JSON des Parameters laden.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadForecast(paramKey)
      .then((d) => {
        if (cancelled) return
        setData(d)
        // stündlich: auf den Schritt nahe „jetzt" springen; täglich: erster Tag
        if (d.kind === 'hourly' && d.timeSteps) {
          const now = Date.now()
          const i = d.timeSteps.findIndex((t) => Date.parse(t) >= now)
          setIdx(i >= 0 ? i : 0)
        } else {
          setIdx(0)
        }
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Vorhersage nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [paramKey])

  const steps = useMemo(
    () => (data ? (data.kind === 'hourly' ? (data.timeSteps ?? []) : (data.days ?? [])) : []),
    [data],
  )
  const clampedIdx = Math.min(idx, Math.max(0, steps.length - 1))

  const { values, colors, covered } = useMemo(() => {
    const values: (number | null)[] = []
    const colors: (string | null)[] = []
    let covered = 0
    if (stations && data) {
      for (const s of stations) {
        const v = data.byStation[s.id]?.[clampedIdx] ?? null
        values.push(v)
        if (v != null) {
          colors.push(colorForValue(spec.scale, v))
          covered++
        } else colors.push(null)
      }
    }
    return { values, colors, covered }
  }, [stations, data, clampedIdx, spec])

  const stepLabel = useMemo(() => {
    if (!steps.length) return ''
    const t = steps[clampedIdx]
    return data?.kind === 'hourly' ? fmtHour.format(new Date(t)) : fmtDay.format(new Date(`${t}T12:00:00Z`))
  }, [steps, clampedIdx, data])

  // Gewählter Zeitschritt als ms — Marker im Punkt-Verlauf, damit Karte und
  // Meteogramm denselben Termin zeigen.
  const markTime = useMemo(() => {
    if (!steps.length) return undefined
    const t = steps[clampedIdx]
    return data?.kind === 'hourly' ? Date.parse(t) : Date.parse(`${t}T12:00:00Z`)
  }, [steps, clampedIdx, data])

  const runLabel = data ? fmtHour.format(new Date(data.meta.run)) : ''

  return (
    <div className="atclima">
      <div className="atclima-bar">
        <span className="atclima-title">DACH-Vorhersage (MOS)</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Parameter</span>
          <select value={paramKey} onChange={(e) => setParamKey(e.target.value)}>
            {FORECAST_PARAMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="atclima-slider">
          <input
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={clampedIdx}
            onChange={(e) => setIdx(Number(e.target.value))}
            disabled={steps.length === 0}
          />
          <span className="atclima-step">{stepLabel}</span>
        </div>
        <span className="atclima-sub">
          {loading
            ? 'lädt …'
            : error
              ? `⚠ ${error}`
              : `${covered} Stationen · ${spec.unit}${runLabel ? ` · Lauf ${runLabel}` : ''}`}
        </span>
      </div>
      <div className="atclima-body">
        {error && !stations ? (
          <div className="panel-placeholder">Vorhersage nicht ladbar: {error}</div>
        ) : !stations || !data ? (
          <div className="panel-placeholder">Lade Vorhersage …</div>
        ) : (
          <>
            <AtClimateMap
              stations={stations}
              colors={colors}
              values={values}
              unit={spec.unit}
              view={DACH_VIEW}
              basemapUrl={europeBasemapUrl}
              labelMinGap={38}
              onSelect={(i) => setSelected(stations[i])}
            />
            {selected && (
              <AtForecastDetail
                station={selected}
                markTime={markTime}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
      <span className="atclima-attribution">Datenquelle: DWD MOSMIX (GeoNutzV) · MOS-Vorhersage</span>
    </div>
  )
}
