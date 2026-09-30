// Vorhersage-Modus der Klimakarte (MOS, Slice 3). DACH-Karte mit MOSMIX-
// Stationen; stündliche Parameter (T2m, Niederschlag, Sonne, Bewölkung, Wind)
// über einen Zeitschieber, Tmin/Tmax als Tageswerte. Daten: statische MOS-JSONs.

import { useEffect, useMemo, useState } from 'react'
import { loadForecast, loadMosStations, type ForecastData, type MosStation } from '../api/mosApi'
import {
  FORECAST_PARAMS,
  forecastFreshness,
  getForecastSpec,
  STALE_RUN_HOURS,
} from '../config/atForecast'
import { formatRunLong } from '../config/runs'
import { colorForValue } from '../config/colorscales'
import { globalKeyAllowed } from '../lib/globalKeys'
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

  /**
   * ←/→ bewegen den Zeitschieber, Shift springt sechs Schritte weit — wie
   * im Zeit-Scrubber der Panel-Bereiche.
   *
   * Der Regler ist ein `input[type=range]` und kann das von sich aus, aber
   * eben NUR mit dem Fokus darauf: wer die Karte, das Parameter-Dropdown
   * oder eine Station angeklickt hat, drückte ins Leere. Ein Zeitschieber,
   * den man erst suchen und anklicken muss, ist im operationellen Gebrauch
   * kein Zeitschieber.
   */
  useEffect(() => {
    const last = steps.length - 1
    if (last < 1) return
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e)) return
      const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      if (dir === 0) return
      e.preventDefault()
      setIdx((i) => Math.max(0, Math.min(last, Math.min(i, last) + dir * (e.shiftKey ? 6 : 1))))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps.length])

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

  /**
   * WIE ALT IST DER STAND? Die Laufangabe stand hier als reine Uhrzeit — ein
   * sechs Wochen alter Lauf sah damit aus wie der von heute, und genau das
   * ist lokal passiert (die Vorhersage-JSONs sind nicht im Repo, sie
   * entstehen beim Bauen). Jetzt mit Tagesbezug wie überall sonst, plus
   * einem sichtbaren Hinweis, sobald der Stand alt oder verbraucht ist.
   *
   * Anders als bei den Open-Meteo-Bereichen ist der Lauf hier GEMELDET und
   * nicht geschätzt — deshalb kein `RUN_TITLE`-Vorbehalt.
   */
  const stand = useMemo(() => {
    if (!data) return null
    const now = Date.now()
    const runMs = Date.parse(data.meta.run)
    const last = steps[steps.length - 1]
    // Ein Tageswert gilt bis zum Ende SEINES Tages, nicht bis Mitternacht davor.
    const lastMs = last
      ? data.kind === 'hourly'
        ? Date.parse(last)
        : Date.parse(`${last}T23:59:59Z`)
      : Number.NaN
    return {
      label: Number.isFinite(runMs)
        ? formatRunLong({ initTime: runMs, initHourUtc: new Date(runMs).getUTCHours() }, now)
        : '',
      freshness: forecastFreshness(runMs, lastMs, now),
    }
  }, [data, steps])

  return (
    <div className="atclima">
      <div className="atclima-bar">
        <span className="atclima-title">DACH-Vorhersage (MOS)</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Parameter</span>
          <select value={paramKey} onChange={(e) => setParamKey(e.target.value)}>
            {/* Einheit gehört an die Auswahl — sonst rät man sie aus dem Kartenbild */}
            {FORECAST_PARAMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} ({p.unit})
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
            title="Zeitschritt wählen — ←/→ auch ohne Klick, Shift+←/→ sechs Schritte"
          />
          <span className="atclima-step">{stepLabel}</span>
        </div>
        <span className="atclima-sub">
          {loading ? (
            'lädt …'
          ) : error ? (
            `⚠ ${error}`
          ) : (
            <>
              {covered} Stationen · Werte in {spec.unit}
              {stand?.label ? ` · Lauf ${stand.label}` : ''}
              {stand && stand.freshness !== 'fresh' && (
                <span
                  className="atclima-stale"
                  title={
                    stand.freshness === 'expired'
                      ? 'Der letzte Vorhersagetermin liegt in der Vergangenheit — dieser Stand ist verbraucht. Die Vorhersage-Dateien entstehen beim Bauen (auf der Seite alle 3 h per Cron, lokal über „npm run ingest:mos:forecast").'
                      : `Der Lauf ist älter als ${STALE_RUN_HOURS} Stunden. MOSMIX rechnet ~4×/Tag — hier fehlen also mindestens zwei Läufe.`
                  }
                >
                  {' '}
                  ⚠ {stand.freshness === 'expired' ? 'Stand verbraucht' : 'alter Lauf'}
                </span>
              )}
            </>
          )}
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
      <span className="attribution atclima-attribution">
        Datenquelle:{' '}
        <a
          href="https://www.dwd.de/DE/leistungen/opendata/opendata.html"
          target="_blank"
          rel="noreferrer"
          title="MOSMIX: statistisch optimierte Punktvorhersagen des Deutschen Wetterdienstes (Model Output Statistics), 3060 Stationen im DACH-Raum, alle 3 h neu"
        >
          DWD Open Data
        </a>
        {' '}— MOSMIX-Punktvorhersagen (Model Output Statistics), Nutzung nach{' '}
        <a
          href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html"
          target="_blank"
          rel="noreferrer"
        >
          GeoNutzV
        </a>
        .
      </span>
    </div>
  )
}
