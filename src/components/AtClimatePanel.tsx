// Österreich-Klimakarte — Bereichs-Container (Schritt 3–5). Lädt Stammdaten,
// bietet Parameter-, Zeitbezug- (Tag/Monat/Jahr) und Modus-Wahl (Absolut/
// Abweichung vom Normal 1991–2020), holt die Werte in EINEM Bulk-Request und
// färbt die Karte samt In-Karten-Beschriftung ein. Klick → Stationsdetail.

import { useEffect, useMemo, useState } from 'react'
import { activeStations, loadStations, type AtStation } from '../api/geosphere'
import {
  fetchPeriodValues,
  isParamAvailable,
  loadNormals,
  normalFor,
  todayUtc,
  type NormalsMap,
  type Period,
  type PeriodValues,
} from '../api/atValues'
import { anomaly, AT_PARAMETERS, getAtParameter } from '../config/atParameters'
import { colorForValue } from '../config/colorscales'
import { AtClimateMap } from './AtClimateMap'
import { AtRankList } from './AtRankList'
import { AtStationDetail } from './AtStationDetail'

const pad2 = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// Live-Werte des laufenden Tages ticken alle 10 min weiter — solange „heute"
// gewählt ist, im gleichen Takt nachladen (Cache-TTL in atValues deckelt die Last).
const LIVE_REFRESH_MS = 5 * 60 * 1000

const fmtDayLabel = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const fmtMonthLabel = new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', month: 'long', year: 'numeric' })

const fmtClock = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

/**
 * Neuester sinnvoll darstellbarer Stand je Zeitbezug — zugleich Startwert und
 * Ziel des „Aktuell"-Knopfs. Tag = heute (Live-Werte aus klima-v2-10min);
 * Monat/Jahr = letzte ABGESCHLOSSENE Periode, weil klima-v2-1m erst nach
 * Periodenende aggregiert und der laufende Monat durchgehend null liefert.
 * Bewusst nicht memoisiert: über Mitternacht offene Tabs sollen weiterrücken.
 */
function latestPeriods() {
  const day = todayUtc()
  const lastMonth = new Date()
  lastMonth.setUTCDate(1)
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1)
  const monthStr = `${lastMonth.getUTCFullYear()}-${pad2(lastMonth.getUTCMonth() + 1)}`
  const year = new Date().getUTCFullYear() - 1
  return { day, monthStr, year }
}

export function AtClimatePanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [stationsError, setStationsError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [paramCode, setParamCode] = useState('tl_mittel')
  const [selected, setSelected] = useState<AtStation | null>(null)
  const [showRank, setShowRank] = useState(false)
  const [rankHover, setRankHover] = useState<number | null>(null)

  const init = useMemo(latestPeriods, [])
  const [periodKind, setPeriodKind] = useState<Period['kind']>('day')
  const [day, setDay] = useState(init.day)
  const [monthStr, setMonthStr] = useState(init.monthStr)
  const [year, setYear] = useState(init.year)
  const [mode, setMode] = useState<'abs' | 'anom'>('abs')

  const [values, setValues] = useState<Record<number, number | null> | null>(null)
  const [source, setSource] = useState<PeriodValues['source'] | null>(null)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [valuesError, setValuesError] = useState<string | null>(null)
  const [normals, setNormals] = useState<NormalsMap | null>(null)

  const period = useMemo<Period>(() => {
    if (periodKind === 'day') return { kind: 'day', day }
    if (periodKind === 'month') {
      const [y, m] = monthStr.split('-').map(Number)
      return { kind: 'month', year: y, month: m }
    }
    return { kind: 'year', year }
  }, [periodKind, day, monthStr, year])

  const spec = getAtParameter(paramCode)
  const anomActive = mode === 'anom' && periodKind !== 'day' && isParamAvailable(spec, period)

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setStationsError(err?.message ?? 'Fehler beim Laden'))
    return () => {
      cancelled = true
    }
  }, [])

  // Normale nur laden, wenn der Abweichungsmodus sie braucht.
  useEffect(() => {
    if (mode !== 'anom' || normals) return
    let cancelled = false
    loadNormals()
      .then((n) => !cancelled && setNormals(n))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mode, normals])

  const shown = useMemo(
    () => (stations ? (showAll ? stations : activeStations(stations)) : []),
    [stations, showAll],
  )
  const idsKey = useMemo(() => shown.map((s) => s.id).join(','), [shown])

  // Wenn der Parameter im gewählten Zeitbezug nicht verfügbar ist (z.B. Schnee im
  // Monat), auf Temperatur zurückfallen — nie stumm leer zeigen.
  useEffect(() => {
    if (!isParamAvailable(spec, period)) setParamCode('tl_mittel')
  }, [spec, period])

  // Läuft der gewählte Tag gerade noch? Dann kommen die Werte aus dem
  // 10-Minuten-Datensatz und müssen periodisch nachgezogen werden.
  const isToday = periodKind === 'day' && day >= todayUtc()
  // `force` nur beim Knopfdruck: der Timer darf den TTL-Cache nutzen.
  const [refresh, setRefresh] = useState({ n: 0, force: false })
  useEffect(() => {
    if (!isToday) return
    const t = setInterval(() => setRefresh((r) => ({ n: r.n + 1, force: false })), LIVE_REFRESH_MS)
    return () => clearInterval(t)
  }, [isToday])

  // „Aktuell": auf den neuesten Stand springen — steht der schon, den laufenden
  // Tag stattdessen sofort neu holen (am Cache vorbei, sonst passiert 5 min nichts).
  const latest = latestPeriods()
  const atLatest =
    periodKind === 'day' ? day >= latest.day : periodKind === 'month' ? monthStr === latest.monthStr : year === latest.year
  const goLatest = () => {
    const l = latestPeriods()
    if (periodKind === 'month') setMonthStr(l.monthStr)
    else if (periodKind === 'year') setYear(l.year)
    else if (day < l.day) setDay(l.day)
    else setRefresh((r) => ({ n: r.n + 1, force: true }))
  }

  // Bulk-Abruf der Periodenwerte.
  useEffect(() => {
    if (shown.length === 0 || !isParamAvailable(spec, period)) return
    let cancelled = false
    setValuesLoading(true)
    setValuesError(null)
    fetchPeriodValues(spec, period, shown, refresh.force)
      .then((r) => {
        if (cancelled) return
        setValues(r.byStation)
        setSource(r.source)
        setAsOf(r.asOf ?? null)
      })
      .catch((err) => {
        if (!cancelled) {
          setValues(null)
          setSource(null)
          setAsOf(null)
          setValuesError(err?.message ?? 'Werte nicht ladbar')
        }
      })
      .finally(() => !cancelled && setValuesLoading(false))
    return () => {
      cancelled = true
    }
    // shown über idsKey gekeyed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramCode, period, idsKey, refresh])

  // Anzeigewerte + Farben je gezeigter Station (Absolut oder Anomalie).
  const scale = anomActive ? spec.anomalyScale : spec.scale
  const unit = anomActive ? spec.anomalyUnit : spec.unit
  const { displayValues, colors, covered } = useMemo(() => {
    const displayValues: (number | null)[] = new Array(shown.length).fill(null)
    const colors: (string | null)[] = new Array(shown.length).fill(null)
    let covered = 0
    for (let i = 0; i < shown.length; i++) {
      const raw = values?.[shown[i].id]
      if (raw == null) continue
      let v: number | null = raw
      if (anomActive) {
        const norm = normals ? normalFor(normals, spec, period, shown[i].id) : null
        v = norm != null ? anomaly(raw, norm, spec.anomalyKind) : null
      }
      displayValues[i] = v
      if (v != null) {
        colors[i] = colorForValue(scale, v)
        covered++
      }
    }
    return { displayValues, colors, covered }
  }, [values, normals, shown, spec, period, anomActive, scale])

  const refDay = useMemo(() => {
    if (period.kind === 'day') return period.day
    if (period.kind === 'month') {
      const last = new Date(Date.UTC(period.year, period.month, 0))
      return isoDay(last > new Date() ? new Date() : last)
    }
    const dec = new Date(Date.UTC(period.year, 11, 31))
    return isoDay(dec > new Date() ? new Date() : dec)
  }, [period])

  // Die geöffnete Station bleibt in der Karte markiert; ein Hover in der
  // Rangliste hat Vorrang.
  const selectedIdx = useMemo(() => {
    if (!selected) return null
    const i = shown.findIndex((s) => s.id === selected.id)
    return i >= 0 ? i : null
  }, [selected, shown])

  const periodLabel = useMemo(() => {
    if (period.kind === 'day') return fmtDayLabel.format(new Date(`${period.day}T12:00:00Z`))
    if (period.kind === 'month') return fmtMonthLabel.format(new Date(Date.UTC(period.year, period.month - 1, 15)))
    return String(period.year)
  }, [period])

  const status = valuesLoading
    ? 'lädt Werte …'
    : valuesError
      ? `⚠ ${valuesError}`
      : anomActive && !normals
        ? 'lädt Normale …'
        : `${covered}/${shown.length} Stationen`

  // Live-Hinweis: der laufende Tag ist ein Zwischenstand aus 10-Minuten-Messwerten,
  // kein geprüftes Tagesaggregat — das muss an der Zahl dranstehen.
  const live = source === 'live' && !valuesLoading && !valuesError
  const liveNote = live
    ? asOf
      ? `vorläufig, Stand ${fmtClock.format(new Date(asOf))}`
      : 'vorläufig (10-Minuten-Messwerte)'
    : null

  return (
    <div className="atclima">
      <div className="atclima-bar">
        <span className="atclima-title">Österreich-Klima</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Parameter</span>
          <select value={paramCode} onChange={(e) => setParamCode(e.target.value)} title={spec.description}>
            {AT_PARAMETERS.filter((p) => isParamAvailable(p, period)).map((p) => (
              <option key={p.code} value={p.code}>
                {p.category} – {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Zeitbezug</span>
          <select value={periodKind} onChange={(e) => setPeriodKind(e.target.value as Period['kind'])}>
            <option value="day">Tag</option>
            <option value="month">Monat</option>
            <option value="year">Jahr</option>
          </select>
        </label>
        {periodKind === 'day' && (
          <input type="date" value={day} max={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} />
        )}
        {periodKind === 'month' && (
          <input type="month" value={monthStr} onChange={(e) => setMonthStr(e.target.value)} />
        )}
        {periodKind === 'year' && (
          <input
            type="number"
            value={year}
            min={1991}
            max={new Date().getUTCFullYear()}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 70 }}
          />
        )}
        <button
          type="button"
          className={`atclima-now${atLatest ? ' is-active' : ''}`}
          onClick={goLatest}
          disabled={atLatest && periodKind !== 'day'}
          title={
            periodKind === 'day'
              ? 'Zum heutigen Tag springen; ist er schon gewählt, die 10-Minuten-Messwerte sofort neu holen'
              : periodKind === 'month'
                ? 'Zum letzten abgeschlossenen Monat springen (der laufende Monat wird erst nach Monatsende aggregiert)'
                : 'Zum letzten abgeschlossenen Jahr springen'
          }
        >
          {atLatest && periodKind === 'day' ? '↻ Aktuell' : 'Aktuell'}
        </button>
        <div className="atclima-modes" title={periodKind === 'day' ? 'Anomalien gibt es für Monat/Jahr' : ''}>
          <button
            type="button"
            className={mode === 'abs' ? 'is-active' : ''}
            onClick={() => setMode('abs')}
          >
            Absolut
          </button>
          <button
            type="button"
            className={mode === 'anom' ? 'is-active' : ''}
            disabled={periodKind === 'day'}
            onClick={() => setMode('anom')}
          >
            Abweichung
          </button>
        </div>
        <span className="atclima-sub">
          {status} · {anomActive ? `Δ ${unit} vs. 1991–2020` : unit}
        </span>
        {liveNote && (
          <span
            className="atclima-live"
            title="Der Tagesdatensatz klima-v2-1d wird erst nach Tagesende gerechnet; der laufende Tag wird hier aus den 10-Minuten-Messwerten (klima-v2-10min) zusammengefasst und alle 5 min aktualisiert."
          >
            ● {liveNote}
          </span>
        )}
        <button
          type="button"
          className={`atclima-now${showRank ? ' is-active' : ''}`}
          onClick={() => setShowRank((v) => !v)}
          title="Extremwerte der aktuellen Auswahl als Liste (Hover markiert die Station, Klick öffnet das Detail)"
        >
          Rangliste
        </button>
        <label className="atclima-toggle" title="Auch stillgelegte historische Stationen zeigen">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Historische
        </label>
      </div>
      <div className="atclima-body">
        {stationsError ? (
          <div className="panel-placeholder">Stationsdaten nicht ladbar: {stationsError}</div>
        ) : !stations ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <>
            <AtClimateMap
              stations={shown}
              colors={colors}
              values={displayValues}
              unit={unit}
              onSelect={(i) => setSelected(shown[i])}
              highlightIdx={rankHover ?? selectedIdx}
            />
            {showRank && (
              <AtRankList
                stations={shown}
                values={displayValues}
                unit={anomActive ? `Δ ${unit}` : unit}
                title={`${spec.label}${anomActive ? ' — Abweichung' : ''} · ${periodLabel}`}
                description={
                  anomActive
                    ? `${spec.description} Gereiht wird hier die Abweichung vom Normal 1991–2020.`
                    : spec.description
                }
                signed={anomActive}
                onSelect={(i) => setSelected(shown[i])}
                onHover={setRankHover}
                onClose={() => {
                  setShowRank(false)
                  setRankHover(null)
                }}
              />
            )}
            {selected && (
              <AtStationDetail
                station={selected}
                paramCode={isParamAvailable(spec, period) ? paramCode : 'tl_mittel'}
                day={refDay}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
      <span className="atclima-attribution">
        Datenquelle: GeoSphere Austria, klima-v2-1d/-1m/-10min (CC BY 4.0)
      </span>
    </div>
  )
}
