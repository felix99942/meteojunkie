// Österreich-Klimakarte — Bereichs-Container (Schritt 3–5). Lädt Stammdaten,
// bietet Parameter-, Zeitbezug- (Tag/Monat/Jahr/Klimaperiode) und Modus-Wahl
// (Absolut/Abweichung vom Normal), holt die Werte in EINEM Bulk-Request und
// färbt die Karte samt In-Karten-Beschriftung ein. Klick → Stationsdetail.
//
// Zeitbezug „Klimaperiode" zeigt das langjährige Mittel einer WMO-Normalperiode
// (z. B. den durchschnittlichen Jahresniederschlag 1961–1990) — vorberechnete
// Assets, also kein Request. Im Abweichungsmodus vergleicht dieser Zeitbezug die
// beiden Perioden MITEINANDER: das ist das Klimasignal, nicht das Wetter.

import { useEffect, useMemo, useState } from 'react'
import { activeStations, loadStations, type AtStation } from '../api/geosphere'
import {
  fetchPeriodValues,
  isParamAvailable,
  loadNormals,
  normalFor,
  SEASON_LABEL,
  SEASONS,
  seasonMonths,
  seasonYearLabel,
  todayUtc,
  type NormalsMap,
  type Period,
  type PeriodCoverage,
  type PeriodValues,
  type Season,
} from '../api/atValues'
import {
  AT_NORMAL_PERIODS,
  comparePeriod,
  DEFAULT_NORMAL_PERIOD,
  normalPeriod,
  type NormalPeriodId,
} from '../config/atNormals'
import {
  anomaly,
  anomalyDisplay,
  anomalyScaleFor,
  AT_PARAMETERS,
  getAtParameter,
  paramOptionLabel,
  scaleFor,
  valueCaption,
  type ValueSpan,
} from '../config/atParameters'
import { colorForValue } from '../config/colorscales'
import { AtClimateMap } from './AtClimateMap'
import { HISTORY_SPAN } from './AtPeriodHistory'
import type { HistoryScope } from './atHistory'
import { AtRankList } from './AtRankList'
import { AtStationDetail } from './AtStationDetail'

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
const fmtMonthName = new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', month: 'long' })
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => fmtMonthName.format(new Date(Date.UTC(2001, i, 15))))
const fmtMonthShort = new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', month: 'short' })
const MONTH_SHORT = Array.from({ length: 12 }, (_, i) =>
  fmtMonthShort.format(new Date(Date.UTC(2001, i, 15))).replace('.', ''),
)

const fmtClock = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

/**
 * Neuester sinnvoll darstellbarer Stand je Zeitbezug — zugleich Startwert und
 * Ziel des „Aktuell"-Knopfs. Tag = heute (Live-Werte aus klima-v2-10min); Monat
 * UND Saison sind der LAUFENDE Zeitraum — klima-v2-1m liefert ihn erst nach
 * Periodenende, `fetchPeriodValues` füllt ihn bis dahin als Teilsumme aus
 * Tageswerten (`fetchRunningMonthPartial`/`PeriodCoverage.partial`, Stand =
 * letzter vollständiger Vortag). Eine Saison-Abweichung gegen das Normal
 * NUR der bisherigen Monate wäre sonst systematisch zu groß — ein halber
 * Sommer sieht gegen ein Drei-Monats-Normal viel zu trocken/nass aus. Jahr
 * bleibt bei der letzten ABGESCHLOSSENEN Periode: eine Jahressumme aus nur
 * wenigen Monaten wäre selten die Frage, die „Aktuell" beantworten soll — wer
 * das Jahr bis dato sehen will, wählt es explizit im Dropdown (auch dafür
 * rechnet `PeriodCoverage` gleitend). Bewusst nicht memoisiert: über
 * Mitternacht offene Tabs sollen weiterrücken.
 */
/** „Dez–Feb", „Mär–Mai" … — macht die Monatszuordnung im Dropdown sichtbar. */
function seasonMonthLabel(season: Season): string {
  const m = seasonMonths(season)
  return `${MONTH_SHORT[m[0].month - 1]}–${MONTH_SHORT[m[m.length - 1].month - 1]}`
}

function latestPeriods() {
  const day = todayUtc()
  const monthStr = day.slice(0, 7)
  const year = new Date().getUTCFullYear() - 1
  // Laufende Saison — dieselbe Dezember-Konvention wie `seasonMonths` (der
  // Dezember gehört zum Winter des FOLGEJAHRS, `seasonYear` ist das Jahr von
  // Jan/Feb).
  const now = new Date()
  const m = now.getUTCMonth() + 1 // 1..12
  const y = now.getUTCFullYear()
  const currentSeason: { season: Season; seasonYear: number } =
    m === 12
      ? { season: 'DJF', seasonYear: y + 1 }
      : m <= 2
        ? { season: 'DJF', seasonYear: y }
        : m <= 5
          ? { season: 'MAM', seasonYear: y }
          : m <= 8
            ? { season: 'JJA', seasonYear: y }
            : { season: 'SON', seasonYear: y }
  return { day, monthStr, year, season: currentSeason.season, seasonYear: currentSeason.seasonYear }
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
  // Klimaperiode: welche Periode und welcher Ausschnitt (null = Jahresmittel).
  const [normPeriodId, setNormPeriodId] = useState<NormalPeriodId>(DEFAULT_NORMAL_PERIOD)
  // Klimaperioden-Ausschnitt: Jahr (beides null), Kalendermonat ODER Saison.
  const [normMonth, setNormMonth] = useState<number | null>(null)
  const [normSeason, setNormSeason] = useState<Season | null>(null)
  // Saison-Zeitbezug: eigene Auswahl, damit der Jahr-Zeitbezug unberührt bleibt.
  const [season, setSeason] = useState<Season>(init.season)
  const [seasonYear, setSeasonYear] = useState(init.seasonYear)
  const [mode, setMode] = useState<'abs' | 'anom'>('abs')

  const [values, setValues] = useState<Record<number, number | null> | null>(null)
  const [source, setSource] = useState<PeriodValues['source'] | null>(null)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<PeriodCoverage | undefined>(undefined)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [valuesError, setValuesError] = useState<string | null>(null)
  // Normale je Klimaperiode — im Vergleichsmodus wird die Bezugsperiode geladen.
  const [normals, setNormals] = useState<Partial<Record<NormalPeriodId, NormalsMap>>>({})

  const period = useMemo<Period>(() => {
    if (periodKind === 'day') return { kind: 'day', day }
    if (periodKind === 'month') {
      const [y, m] = monthStr.split('-').map(Number)
      return { kind: 'month', year: y, month: m }
    }
    if (periodKind === 'season') return { kind: 'season', year: seasonYear, season }
    if (periodKind === 'normal')
      return { kind: 'normal', periodId: normPeriodId, month: normMonth, season: normSeason }
    return { kind: 'year', year }
  }, [periodKind, day, monthStr, year, normPeriodId, normMonth, normSeason, season, seasonYear])

  const spec = getAtParameter(paramCode)
  const anomActive = mode === 'anom' && periodKind !== 'day' && isParamAvailable(spec, period)
  /** Perioden-Vergleich: Normale gegen Normale statt Wetter gegen Normal. */
  const climate = anomActive && period.kind === 'normal'
  /**
   * Bezugsperiode der Abweichung: im Klimaperioden-Zeitbezug die jeweils andere
   * Periode (sonst wäre die Karte durchgehend null), sonst die gültige Norm.
   */
  const refPeriodId: NormalPeriodId =
    period.kind === 'normal' ? comparePeriod(period.periodId) : DEFAULT_NORMAL_PERIOD
  const refNormals = normals[refPeriodId] ?? null

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setStationsError(err?.message ?? 'Fehler beim Laden'))
    return () => {
      cancelled = true
    }
  }, [])

  // Normale der BEZUGSperiode nur laden, wenn der Abweichungsmodus sie braucht
  // (die angezeigte Periode holt fetchPeriodValues selbst).
  useEffect(() => {
    if (mode !== 'anom' || normals[refPeriodId]) return
    let cancelled = false
    loadNormals(refPeriodId)
      .then((n) => !cancelled && setNormals((prev) => ({ ...prev, [refPeriodId]: n })))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mode, normals, refPeriodId])

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
    periodKind === 'day'
      ? day >= latest.day
      : periodKind === 'month'
        ? monthStr === latest.monthStr
        : periodKind === 'season'
          ? season === latest.season && seasonYear === latest.seasonYear
          : periodKind === 'year'
            ? year === latest.year
            : true // Klimaperioden sind fest — es gibt nichts "Aktuelleres"
  const goLatest = () => {
    const l = latestPeriods()
    if (periodKind === 'normal') return
    if (periodKind === 'month') setMonthStr(l.monthStr)
    else if (periodKind === 'season') {
      setSeason(l.season)
      setSeasonYear(l.seasonYear)
    } else if (periodKind === 'year') setYear(l.year)
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
        setCoverage(r.coverage)
      })
      .catch((err) => {
        if (!cancelled) {
          setCoverage(undefined)
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
  // Der Zeitbezug bestimmt die Größenordnung und damit die Skala: eine
  // Jahressumme gehört nicht auf die Tagesskala (sonst alles im obersten Band).
  const span: ValueSpan =
    period.kind === 'day'
      ? 'day'
      : period.kind === 'month'
        ? 'month'
        : period.kind === 'season'
          ? 'season'
          : period.kind === 'year'
            ? 'year'
            : period.month != null
              ? 'month'
              : period.season
                ? 'season'
                : 'year'
  const scale = anomActive ? anomalyScaleFor(spec, climate) : scaleFor(spec, span)
  // Abweichungen brauchen eine eigene Beschriftung: eine Differenz (Δ K) und
  // ein Anteil (% vom Normal) sehen als Zahl gleich aus, meinen aber etwas
  // völlig anderes — siehe anomalyDisplay() in config/atParameters.ts.
  const anom = anomalyDisplay(spec)
  const unit = anomActive ? anom.short : spec.unit
  // Welche Größe steht wirklich in der Karte? Zeitbezug und Aggregat ergeben
  // zusammen etwas anderes als der Parametername: „Temperatur Maximum" plus
  // Klimaperiode plus Jahr ist das MITTEL der Jahreshöchstwerte.
  const normalScope: 'year' | 'month' | 'season' =
    period.kind === 'normal' && period.month != null
      ? 'month'
      : period.kind === 'normal' && period.season
        ? 'season'
        : 'year'
  const shownQuantity = valueCaption(spec, period.kind, normalScope)

  /**
   * Läuft der Zeitraum noch? Dann steht in der Karte ein Zwischenstand, und die
   * Abweichung wird gegen das Normal DESSELBEN Zeitraums gerechnet. Das gehört
   * in die Überschrift — sonst liest man einen halben Sommer als ganzen.
   */
  const running = useMemo(() => {
    if (!coverage || (coverage.complete && !coverage.partial)) return null
    const parts = [
      ...coverage.months.map((m) => MONTH_SHORT[m.month - 1]),
      ...(coverage.partial ? [`${MONTH_SHORT[coverage.partial.month - 1]} 1.–${coverage.partial.days}.`] : []),
    ]
    const canCompare = spec.annualAgg === 'sum' || spec.annualAgg === 'mean'
    return { text: parts.join(' + '), canCompare, expected: coverage.expected }
  }, [coverage, spec.annualAgg])
  const { displayValues, colors, covered } = useMemo(() => {
    const displayValues: (number | null)[] = new Array(shown.length).fill(null)
    const colors: (string | null)[] = new Array(shown.length).fill(null)
    let covered = 0
    for (let i = 0; i < shown.length; i++) {
      const raw = values?.[shown[i].id]
      if (raw == null) continue
      let v: number | null = raw
      if (anomActive) {
        const norm = refNormals ? normalFor(refNormals, spec, period, shown[i].id, coverage) : null
        v = norm != null ? anomaly(raw, norm, spec.anomalyKind) : null
      }
      displayValues[i] = v
      if (v != null) {
        colors[i] = colorForValue(scale, v)
        covered++
      }
    }
    return { displayValues, colors, covered }
  }, [values, refNormals, shown, spec, period, anomActive, scale, coverage])

  const refDay = useMemo(() => {
    if (period.kind === 'day') return period.day
    if (period.kind === 'month') {
      const last = new Date(Date.UTC(period.year, period.month, 0))
      return isoDay(last > new Date() ? new Date() : last)
    }
    // Klimaperiode: das Stationsdetail zeigt Tageswerte — sinnvoller Anker ist
    // das Ende der Periode, nicht heute.
    if (period.kind === 'season') {
      const months = seasonMonths(period.season)
      const last = months[months.length - 1]
      const end = new Date(Date.UTC(period.year + last.yearOffset, last.month, 0))
      return isoDay(end > new Date() ? new Date() : end)
    }
    const endYear = period.kind === 'year' ? period.year : normalPeriod(period.periodId).lastYear
    const dec = new Date(Date.UTC(endYear, 11, 31))
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
    if (period.kind === 'season') return seasonYearLabel(period.season, period.year)
    if (period.kind === 'normal') {
      // Nur den Zeitraum benennen — WAS gemittelt wurde, sagt `shownQuantity`.
      // „Jahresmittel 1991–2020" wäre bei einem Maximum-Parameter irreführend.
      const label = normalPeriod(period.periodId).label
      if (period.season) return `${SEASON_LABEL[period.season]} ${label}`
      return period.month == null ? `Jahr ${label}` : `${MONTH_NAMES[period.month - 1]} ${label}`
    }
    return String(period.year)
  }, [period])

  const status = valuesLoading
    ? 'lädt Werte …'
    : valuesError
      ? `⚠ ${valuesError}`
      : anomActive && !refNormals
        ? 'lädt Normale …'
        : `${covered}/${shown.length} Stationen`

  const refLabel = normalPeriod(refPeriodId).label

  /**
   * Perioden-Historie fürs Stationsdetail: dieselbe Größe wie in der Karte über
   * die letzten Jahre. Nur außerhalb des Tag-Zeitbezugs — dort IST die
   * Tagesreihe die passende Antwort. Bei der Klimaperiode wird die Reihe über
   * die Periode selbst gezeigt (die 30 Sommer, aus denen das Normal entsteht).
   */
  const historyProps = useMemo(() => {
    if (period.kind === 'day' || !selected) return undefined
    const scope: HistoryScope =
      period.kind === 'month'
        ? { kind: 'month', month: period.month }
        : period.kind === 'season'
          ? { kind: 'season', season: period.season }
          : period.kind === 'year'
            ? { kind: 'year' }
            : period.month != null
              ? { kind: 'month', month: period.month }
              : period.season
                ? { kind: 'season', season: period.season }
                : { kind: 'year' }
    const [firstYear, lastYear] =
      period.kind === 'normal'
        ? [normalPeriod(period.periodId).firstYear, normalPeriod(period.periodId).lastYear]
        : [period.year - HISTORY_SPAN + 1, period.year]
    const normal =
      anomActive && refNormals ? normalFor(refNormals, spec, period, selected.id, coverage) : null
    return { scope, firstYear, lastYear, normal, showAnomaly: anomActive, refLabel }
  }, [period, selected, anomActive, refNormals, spec, refLabel, coverage])


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
                {paramOptionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Zeitbezug</span>
          <select value={periodKind} onChange={(e) => setPeriodKind(e.target.value as Period['kind'])}>
            <option value="day">Tag</option>
            <option value="month">Monat</option>
            <option value="season">Saison</option>
            <option value="year">Jahr</option>
            <option value="normal">Klimaperiode</option>
          </select>
        </label>
        {periodKind === 'day' && (
          <input type="date" value={day} max={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} />
        )}
        {periodKind === 'month' && (
          <input type="month" value={monthStr} onChange={(e) => setMonthStr(e.target.value)} />
        )}
        {periodKind === 'season' && (
          <>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value as Season)}
              title="Meteorologische Jahreszeit — der Dezember zählt zum Winter des FOLGEJAHRS"
            >
              {SEASONS.map((sid) => (
                <option key={sid} value={sid}>
                  {SEASON_LABEL[sid]} ({seasonMonthLabel(sid)})
                </option>
              ))}
            </select>
            <input
              type="number"
              value={seasonYear}
              min={1991}
              max={new Date().getUTCFullYear()}
              onChange={(e) => setSeasonYear(Number(e.target.value))}
              title={
                season === 'DJF'
                  ? 'Jahr von Januar und Februar — der Dezember stammt aus dem Vorjahr'
                  : 'Jahr der Saison'
              }
              style={{ width: 70 }}
            />
          </>
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
        {periodKind === 'normal' && (
          <>
            <select
              value={normPeriodId}
              onChange={(e) => setNormPeriodId(e.target.value as NormalPeriodId)}
              title="30-jährige Bezugsperiode (WMO-Normalperiode) — vorberechnetes langjähriges Mittel"
            >
              {AT_NORMAL_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={normSeason ?? (normMonth ?? 'year')}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'year') {
                  setNormMonth(null)
                  setNormSeason(null)
                } else if (SEASONS.includes(v as Season)) {
                  setNormMonth(null)
                  setNormSeason(v as Season)
                } else {
                  setNormSeason(null)
                  setNormMonth(Number(v))
                }
              }}
              title="Langjähriges Mittel: über das ganze Jahr, über eine Jahreszeit oder über einen einzelnen Kalendermonat"
            >
              <option value="year">Jahr</option>
              <optgroup label="Jahreszeit">
                {SEASONS.map((sid) => (
                  <option key={sid} value={sid}>
                    {SEASON_LABEL[sid]} ({seasonMonthLabel(sid)})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Kalendermonat">
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </optgroup>
            </select>
          </>
        )}
        {periodKind !== 'normal' && (
        <button
          type="button"
          className={`atclima-now${atLatest ? ' is-active' : ''}`}
          onClick={goLatest}
          disabled={atLatest && periodKind !== 'day'}
          title={
            periodKind === 'day'
              ? 'Zum heutigen Tag springen; ist er schon gewählt, die 10-Minuten-Messwerte sofort neu holen'
              : periodKind === 'month'
                ? 'Zum laufenden Monat springen — als Teilsumme bis zum letzten abgeschlossenen Tag, das amtliche Monatsende folgt erst nach Monatsende'
                : periodKind === 'season'
                  ? 'Zur laufenden Jahreszeit springen — als Teilsumme aus den bisherigen Monaten plus dem laufenden bis zum letzten abgeschlossenen Tag'
                  : 'Zum letzten abgeschlossenen Jahr springen'
          }
        >
          {atLatest && periodKind === 'day' ? '↻ Aktuell' : 'Aktuell'}
        </button>
        )}
        <div
          className="atclima-modes"
          title={
            periodKind === 'day'
              ? 'Anomalien gibt es für Monat/Jahr/Klimaperiode'
              : periodKind === 'normal'
                ? `Abweichung vergleicht die gewählte Klimaperiode mit ${refLabel}`
                : ''
          }
        >
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
        <span
          className="atclima-sub"
          title={
            anomActive
              ? `Gezeigt wird die Abweichung von „${shownQuantity}" (${spec.label}) gegenüber ${refLabel}. ${anom.caption}.`
              : `Gezeigt wird „${shownQuantity}" von ${spec.label}, in ${spec.unit}. ${spec.description}`
          }
        >
          {status}
        </span>
        {periodKind === 'normal' && (
          <span
            className="atclima-hint"
            title={
              'Langjähriges Mittel der Klimaperiode, vorberechnet aus dem Monatsdatensatz klima-v2-1m. ' +
              'Eine Station bekommt nur dann ein Normal, wenn sie in der Periode mindestens 24 vollständige ' +
              'Jahre gemessen hat (WMO-Regel) — kürzere Reihen bleiben leer statt ein Mittel aus wenigen ' +
              'Jahren vorzutäuschen. Deshalb sind hier weniger Stationen besetzt als in der Tageskarte, ' +
              'und im Vergleich zweier Perioden nur jene, die in BEIDEN messen. Bei älteren Perioden ' +
              'lohnt der Haken „Historische": viele Stationen von 1961–1990 sind heute stillgelegt.'
            }
          >
            Normal, ≥ 24 Jahre
          </span>
        )}
        {liveNote && (
          <span
            className="atclima-live"
            title="Der Tagesdatensatz klima-v2-1d wird erst nach Tagesende gerechnet; der laufende Tag wird hier aus den 10-Minuten-Messwerten (klima-v2-10min) zusammengefasst und alle 5 min aktualisiert."
          >
            ● {liveNote}
          </span>
        )}
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
            {/* Was die Karte zeigt, gehört IN die Karte — groß und zentral.
                Klein in der Werkzeugleiste hat es niemand gelesen, und genau
                diese Zeile entscheidet, wie die Farben zu lesen sind. */}
            <div className="atmap-headline">
              <span className="atmap-headline-main">
                {shownQuantity}
                {anomActive ? ' — Abweichung' : ''}
              </span>
              <span className="atmap-headline-sub">
                {spec.label} · {periodLabel} ·{' '}
                {anomActive ? `${anom.caption} · ${anom.unit} vs. ${refLabel}` : spec.unit}
              </span>
              {running && (
                <span
                  className="atmap-headline-running"
                  title={
                    running.canCompare
                      ? 'Der Zeitraum läuft noch. Verglichen wird mit dem Normal GENAU DIESES Zeitraums — der laufende Monat anteilig nach Tagen.'
                      : 'Der Zeitraum läuft noch. Für Maximum-/Minimum-Parameter lässt sich kein Teil-Normal bilden, deshalb gibt es hier keine Abweichung.'
                  }
                >
                  ● läuft noch — bisher {running.text}
                  {anomActive && !running.canCompare
                    ? ' · keine Abweichung möglich'
                    : anomActive
                      ? ' · Normal auf denselben Zeitraum gerechnet'
                      : ''}
                </span>
              )}
            </div>
            {/* Einstieg dort, wo die Liste danach aufgeht — kein Suchen in der
                Werkzeugleiste. Verschwindet, sobald die Liste offen ist: sie
                belegt denselben Platz und schließt über ihr eigenes ✕. */}
            {!showRank && (
              <button
                type="button"
                className="atmap-rankbtn"
                onClick={() => setShowRank(true)}
                title="Alle Stationen durchsuchen und nach Wert reihen — Hover markiert die Station, Klick öffnet ihr Detail"
              >
                <span aria-hidden="true">🔍</span> Rangliste &amp; Stationssuche
              </button>
            )}
            {showRank && (
              <AtRankList
                stations={shown}
                values={displayValues}
                unit={anomActive ? anom.short : spec.unit}
                title={`${shownQuantity}${anomActive ? ' — Abweichung' : ''} · ${periodLabel}`}
                description={
                  anomActive
                    ? `${spec.description} Gereiht wird die Abweichung von „${shownQuantity}" gegenüber ${refLabel} — ${anom.caption}.`
                    : period.kind === 'normal'
                      ? `${spec.description} Gereiht wird „${shownQuantity}" der Periode ${normalPeriod(period.periodId).label}.`
                      : `${spec.description} Gereiht wird „${shownQuantity}".`
                }
                signed={anomActive && anom.signed}
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
                history={historyProps}
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
