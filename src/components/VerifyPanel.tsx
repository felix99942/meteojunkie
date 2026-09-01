// Verifikation: was WURDE vorhergesagt, und was ist eingetroffen.
//
// Der einzige Bereich, der beide Welten der Seite zusammenbringt — die
// Modellläufe von Open-Meteo und die GEMESSENEN Stationswerte von GeoSphere —
// und der einzige, der rückwärts schaut. Verglichen wird das Tagesmaximum bzw.
// -minimum: es ist die Größe, die der Klimatagesdatensatz direkt führt, also
// braucht es auf der Messseite keine Näherung.
//
// LEITIDEE: Tag für Tag, nicht Modellranking. Die naheliegende Darstellung
// wäre eine Matrix Modell × Vorlauf mit Fehlermaßen — die braucht aber lange
// Zeiträume, um überhaupt etwas zu sagen (über 14 Tage sank der IFS-Fehler mit
// LÄNGEREM Vorlauf, reines Rauschen; erst über 90 Tage wächst er monoton).
// Wer wissen will „wie gut war die Vorhersage diese Woche", bekommt deshalb
// die konkreten Tage nebeneinander: gemessen, vorhergesagt, Differenz. Die
// Fehlermaße stehen als eine Zeile darunter, mit Warnung bei kurzer Reihe.
//
// Kein eigenes Archiv nötig: die Historical-Forecast-API liefert zu einem
// vergangenen Zeitpunkt über `_previous_dayN` das, was N Tage FRÜHER für
// diesen Zeitpunkt vorhergesagt worden war (siehe fetchPastRuns). Alles andere
// hieße, jede Modellausgabe selbst wegzuschreiben und für immer zu halten.
//
// Der Tag ist 00–24 UTC auf BEIDEN Seiten (GeoSphere-Klimatag, Open-Meteo mit
// `timezone: 'UTC'`) — sonst wäre ein Teil des „Fehlers" bloß eine
// Verschiebung.

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPastRuns, MAX_LEAD_DAYS, type PastRunSeries } from '../api/openmeteo'
import { activeStations, DATASET_DAILY, fetchStationSeries, loadStations, type AtStation } from '../api/geosphere'
import { clean } from '../api/atValues'
import { getAtParameter } from '../config/atParameters'
import { isInCoverage, MODELS, SELECTABLE_MODELS, type ModelInfo } from '../config/models'
import { SERIES_COLORS } from '../config/colors'
import { ChartRow } from './ChartStack'
import { OpenMeteoAttribution } from './Attribution'
import { dailyExtremes, dayRange, leadsFor, score, type DailyMode, type Scores } from './verify'

/**
 * Voreingestellte Modelle: je ein Vertreter der interessanten Klassen, dazu
 * „Best Match" — Open-Meteos eigene Mischung ist der natürliche Bezug, gegen
 * den sich die Einzelmodelle behaupten müssen. (Am Testpunkt lag sie NICHT
 * vorn: über 20 Tage 1,33 K gegen 1,16 K von GFS.)
 */
const DEFAULT_MODELS = [
  'best_match',
  'ecmwf_ifs025',
  'icon_eu',
  'gfs_seamless',
  'geosphere_arome_austria',
]
/** Voreingestellte Station: lange Reihe, zentral, jedem ein Begriff. */
const DEFAULT_STATION = 105 // Wien Hohe Warte

/**
 * Drei Zeiträume, aufsteigend vergleichbar. 5 Tage beantworten „wie lief es
 * diese Woche", 20 Tage lassen die Modelle grob gegeneinander antreten.
 *
 * Nach oben bewusst gedeckelt: ein belastbarer Modellvergleich bräuchte
 * Monate. Live gemessen — über 14 Tage SANK der IFS-Fehler mit LÄNGEREM
 * Vorlauf (2,01 K bei +1 d, 1,84 K bei +5 d), reines Rauschen; erst über 90
 * Tage wächst er bei jedem Modell monoton. 20 Tage sind also ein Kompromiss
 * und kein Urteil, und die Fehlerzeile sagt das je nach Länge auch.
 */
const SPANS: { days: number; label: string; hint: string }[] = [
  { days: 5, label: '5 Tage', hint: 'Blick auf die vergangenen Tage — zu kurz für einen Modellvergleich' },
  { days: 10, label: '10 Tage', hint: 'erste Tendenz, welches Modell hier näher liegt — noch stark vom Zufall geprägt' },
  { days: 20, label: '20 Tage', hint: 'grober Modellvergleich; belastbar würde er erst über Monate' },
]
/** Ab hier taugt die Fehlerzeile wenigstens als grobe Reihung. */
const ROUGH_DAYS = 10

/** Was verglichen wird: Messgröße ↔ Vorhersagevariable ↔ Tagesreduktion. */
const TARGETS = {
  tlmax: { label: 'Tageshöchsttemperatur', obsCode: 'tlmax', mode: 'max' as DailyMode },
  tlmin: { label: 'Tagestiefsttemperatur', obsCode: 'tlmin', mode: 'min' as DailyMode },
}
type TargetId = keyof typeof TARGETS

const FORECAST_VAR = 'temperature_2m'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const dayOffset = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}
const fmt1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '—')
const fmtSigned = (v: number) =>
  Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1).replace('.', ',')}` : '—'

const fmtDayLabel = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
/**
 * „Mi, 27.08.2026" — Wochentag dazu, weil man Wetter in Wochentagen erinnert;
 * das Jahr dazu, weil eine Tabelle ohne Jahresangabe nicht sagt, WANN gemessen
 * wurde.
 */
const fmtDay = (day: string) => fmtDayLabel.format(new Date(`${day}T12:00:00Z`))
/** Kurzform für Achsenticks und Fließtext. */
const fmtShort = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
})

/**
 * Beschriftung einer Vorlaufzeit.
 *
 * `previous_dayN` ist der Stand, den die Vorhersage `n·24` Stunden VOR dem
 * jeweiligen Zeitpunkt hatte — ein GLEITENDER Vorlauf, kein fester Lauf.
 * Zweimal live gemessen: die Reihe macht an der Tagesgrenze keinen Sprung
 * (Stundenänderung über 00 UTC 0,69 K gegenüber 0,92 K sonst — genau wie die
 * durchgehende Reihe), und der Fehler ist über den Tagesverlauf flach
 * (0,82/0,83/0,81/0,90 K je Sechs-Stunden-Block). Bei einem festen 00-UTC-Lauf
 * müsste beides anders aussehen: ein Sprung um Mitternacht und ein Fehler, der
 * über den Tag wächst.
 *
 * Aus welchem konkreten Lauf (00/06/12/18 UTC) der Stand jeweils stammt, gibt
 * die API nicht preis; dafür bräuchte es die Single-Runs-API.
 */
const leadLabel = (n: number) => `Stand ${n * 24} h vorher`
const leadDays = (n: number) => (n === 1 ? '1 Tag' : `${n} Tage`)

/** Einfärbung nach Fehlerbetrag: klein = ruhig, groß = warnend. */
function errColor(mae: number): string {
  if (!Number.isFinite(mae)) return 'transparent'
  const steps: [number, string][] = [
    [0.7, '#1d4b3a'],
    [1.2, '#37613a'],
    [1.8, '#6b6033'],
    [2.6, '#7c4a24'],
    [3.6, '#7a3020'],
  ]
  for (const [limit, color] of steps) if (mae < limit) return color
  return '#5c1f1a'
}

export function VerifyPanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [stationId, setStationId] = useState(DEFAULT_STATION)
  /** Text im Suchfeld; die gültige Auswahl steckt in `stationId`. */
  const [stationQuery, setStationQuery] = useState('')
  const [target, setTarget] = useState<TargetId>('tlmax')
  const [span, setSpan] = useState(5)
  const [modelIds, setModelIds] = useState<string[]>(DEFAULT_MODELS)
  const [lead, setLead] = useState(1)

  const [observed, setObserved] = useState<Map<string, number> | null>(null)
  const [runs, setRuns] = useState<Record<string, PastRunSeries>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setError(err?.message ?? 'Stationen nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = useMemo(() => (stations ? activeStations(stations) : []), [stations])
  const station = shown.find((s) => s.id === stationId) ?? null
  // Das Suchfeld EINMAL mit der Startstation vorbelegen, sobald die Liste da
  // ist — und danach nie wieder hineinregieren. Ein Effekt, der bei leerem
  // Feld nachfüllt, kämpft gegen jedes Löschen an: die Rücktaste stellte
  // sofort wieder „Wien Hohe Warte" her, und man kam nie dazu, „Graz" zu
  // tippen. Beim Verlassen des Feldes schnappt es zurück (siehe onBlur) —
  // das ist der richtige Zeitpunkt, nicht jeder Tastendruck.
  /**
   * Freien Text auf eine Station auflösen. Der exakte Name gewinnt (so wählt
   * die Vorschlagsliste aus), danach Namensanfang, danach Teiltreffer: wer
   * „graz" tippt und wegklickt, meint eine Grazer Station und nicht die
   * zuletzt eingestellte. Ohne diese Stufen fühlte sich das Feld an wie der
   * Fehler, den es gerade behoben hat.
   */
  const resolveStation = (text: string): AtStation | null => {
    const q = text.trim().toLowerCase()
    if (!q) return null
    return (
      shown.find((s) => s.name.toLowerCase() === q) ??
      shown.find((s) => s.name.toLowerCase().startsWith(q)) ??
      shown.find((s) => s.name.toLowerCase().includes(q)) ??
      null
    )
  }
  /** Text übernehmen, wenn er eine Station trifft; sonst zurückschnappen. */
  const commitStation = () => {
    const hit = resolveStation(stationQuery)
    if (hit) {
      setStationId(hit.id)
      setStationQuery(hit.name)
    } else if (station) {
      setStationQuery(station.name)
    }
  }

  const queryInit = useRef(false)
  useEffect(() => {
    if (queryInit.current || !station) return
    queryInit.current = true
    setStationQuery(station.name)
  }, [station])

  // Bis GESTERN: der laufende Tag hat noch kein geprüftes Tagesextrem, und ein
  // halber Tag als „Messung" würde jedes Modell schlecht aussehen lassen.
  const end = dayOffset(-1)
  const start = dayOffset(-span)

  const models = useMemo(
    () =>
      modelIds
        .map((id) => MODELS.find((m) => m.id === id))
        .filter((m): m is ModelInfo => m != null && (!station || isInCoverage(m, station.lat, station.lon))),
    [modelIds, station],
  )
  const modelKey = models.map((m) => m.id).join(',')

  // Messung: EIN Bulk-Request, für immer gecacht (historische Tage sind statisch).
  useEffect(() => {
    if (!station) return
    let cancelled = false
    const spec = getAtParameter(TARGETS[target].obsCode)
    fetchStationSeries(spec.code, start, end, [station.id], DATASET_DAILY)
      .then((s) => {
        if (cancelled) return
        const map = new Map<string, number>()
        const data = s.byStation[station.id] ?? []
        for (let i = 0; i < s.timestamps.length; i++) {
          const v = clean(spec, data[i] ?? null)
          if (v != null) map.set(s.timestamps[i].slice(0, 10), v)
        }
        setObserved(map)
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Messwerte nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [station, target, start, end])

  // Vergangene Läufe je Modell — ein Request pro Modell, alle Vorlaufzeiten in
  // einem. Die Vorlaufzeiten sind am Modellhorizont gedeckelt, sonst holt man
  // Spalten, die die API garantiert leer zurückgibt.
  useEffect(() => {
    if (!station || models.length === 0) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all(
      models.map(async (m) => {
        const leads = leadsFor(m.forecastHours, MAX_LEAD_DAYS)
        if (leads.length === 0) return [m.id, null] as const
        // Stationshöhe mitgeben: sonst rechnet die API auf die Höhe ihres
        // Geländemodells und der Höhenunterschied landete als „Bias" in der
        // Verifikation (Sonnblick: 2962 statt 3109 m, rund 1 K).
        const r = await fetchPastRuns(
          station.lat,
          station.lon,
          m.id,
          FORECAST_VAR,
          start,
          end,
          leads,
          station.altitude,
        )
        return [m.id, r] as const
      }),
    )
      .then((all) => {
        if (cancelled) return
        const next: Record<string, PastRunSeries> = {}
        for (const [id, r] of all) if (r) next[id] = r
        setRuns(next)
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Vorhersagen nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // models über modelKey gekeyed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, modelKey, start, end])

  /** Je Modell und Vorlauf: Tageswerte der damaligen Vorhersage + Fehlermaße. */
  const table = useMemo(() => {
    const mode = TARGETS[target].mode
    return models.map((m) => {
      const r = runs[m.id]
      const cells = new Map<number, { daily: Map<string, number>; scores: Scores }>()
      if (r && observed) {
        for (const [n, series] of r.byLead) {
          const daily = dailyExtremes(r.timeMs, series, mode)
          cells.set(n, { daily, scores: score(daily, observed) })
        }
      }
      return { model: m, cells }
    })
  }, [models, runs, observed, target])

  const days = useMemo(() => dayRange(start, end), [start, end])
  const xs = useMemo(() => days.map((d) => Date.parse(`${d}T12:00:00Z`)), [days])

  /**
   * Diagramm rechts: die ABWEICHUNGEN je Modell über den Zeitraum, nicht die
   * Absolutwerte. Die stehen in der Tabelle daneben; was man dort NICHT sieht,
   * ist der Verlauf — ob ein Modell durchgehend zu warm liegt, ob alle am
   * selben Tag danebenlagen (dann war die Lage schwierig, nicht das Modell),
   * oder ob eines ausreißt. Die Nulllinie ist der Bezug: darüber zu warm
   * vorhergesagt, darunter zu kalt.
   */
  const chart = useMemo(() => {
    const curves = table.map((row, i) => ({
      label: row.model.label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      type: 'line' as const,
      values: days.map((d) => {
        const fc = row.cells.get(lead)?.daily.get(d)
        const obs = observed?.get(d)
        return fc != null && obs != null ? fc - obs : null
      }),
      width: 1.8,
    }))
    return {
      title: `Abweichung von der Messung · ${leadLabel(lead)}`,
      unit: 'K',
      curves,
      // Ohne Mindestspanne staucht ein ruhiger Zeitraum die Nulllinie an den
      // Rand und lässt Zehntelkelvin wie Ausreißer aussehen.
      minSpan: 6,
      refLines: [{ value: 0, color: '#8a8a8a' }],
    }
  }, [days, observed, table, lead])

  const availableLeads = useMemo(() => {
    const s = new Set<number>()
    for (const row of table) for (const n of row.cells.keys()) s.add(n)
    return [...s].sort((a, b) => a - b)
  }, [table])
  useEffect(() => {
    if (availableLeads.length && !availableLeads.includes(lead)) setLead(availableLeads[0])
  }, [availableLeads, lead])

  const obsCount = observed ? days.filter((d) => observed.has(d)).length : 0
  /** Kleinster mittlerer Fehler über den ganzen Zeitraum — nur zum Markieren. */
  const bestMae = useMemo(() => {
    const vals = table
      .map((r) => r.cells.get(lead)?.scores)
      .filter((s): s is Scores => s != null && s.n > 0)
      .map((s) => s.mae)
    return vals.length ? Math.min(...vals) : null
  }, [table, lead])

  return (
    <div className="meteo">
      <div className="atclima-bar">
        <span className="atclima-title">Verifikation</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Station</span>
          {/* Tippen statt scrollen: 290 Stationen in einem Dropdown findet
              niemand. `datalist` ist die native Variante — sie filtert beim
              Tippen, ohne eigenes Widget, und funktioniert mit der Tastatur.
              Übernommen wird erst, wenn der Text eine Station EINDEUTIG trifft;
              bis dahin bleibt die alte stehen, statt bei jedem Zeichen zu
              springen. */}
          <input
            type="text"
            list="verify-stations"
            value={stationQuery}
            placeholder="Station suchen …"
            onChange={(e) => {
              const q = e.target.value
              setStationQuery(q)
              // Beim TIPPEN nur der exakte Treffer — so uebernimmt ein Klick
              // in der Vorschlagsliste sofort, ohne dass jedes Zwischenzeichen
              // die Tabelle neu laedt.
              const exact = shown.find((s) => s.name.toLowerCase() === q.trim().toLowerCase())
              if (exact) setStationId(exact.id)
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitStation()
                e.currentTarget.blur()
              }
            }}
            onBlur={commitStation}
            title="Messstation, gegen die verglichen wird — die Vorhersage wird für ihre Koordinaten geholt"
            style={{ width: 200 }}
          />
          <datalist id="verify-stations">
            {[...shown]
              .sort((a, b) => a.name.localeCompare(b.name, 'de'))
              .map((s) => (
                <option key={s.id} value={s.name} />
              ))}
          </datalist>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Größe</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as TargetId)}>
            {Object.entries(TARGETS).map(([id, t]) => (
              <option key={id} value={id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Zeitraum</span>
          <select
            value={span}
            onChange={(e) => setSpan(Number(e.target.value))}
            title={SPANS.find((s) => s.days === span)?.hint}
          >
            {SPANS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Verglichener Lauf</span>
          <select
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            title={
              'Wie ALT die verglichene Vorhersage war. „Stand 24 h vorher" heißt: für jede Stunde ' +
              'des Zieltages wird der Wert genommen, den die Vorhersage 24 Stunden davor hatte — ' +
              'ein gleitender Vorlauf. Es ist ausdrücklich NICHT der 00-UTC-Lauf des Vortags: das ' +
              'Tagesmaximum fällt meist auf 14–16 UTC und stammt damit vom Stand des Vortags um ' +
              'dieselbe Uhrzeit. Gemessen: die Reihe springt an der Tagesgrenze nicht, und der ' +
              'Fehler wächst über den Tag nicht an — bei einem festen 00-UTC-Lauf müsste beides ' +
              'zu sehen sein. Einen bestimmten Lauf gibt die API nicht her (geprüft: `run` wird ' +
              'abgelehnt, `model_run` still ignoriert). Der gleitende Vorlauf hat dafür einen ' +
              'Vorzug: jeder Tag wird beim GLEICHEN Vorhersagealter verglichen, während ein ' +
              'fester Lauf über den Tag hinweg 24 bis 47 Stunden Vorlauf mischt.'
            }
          >
            {(availableLeads.length ? availableLeads : [1]).map((n) => (
              <option key={n} value={n}>
                {leadLabel(n)} ({leadDays(n)})
              </option>
            ))}
          </select>
        </label>
        <span className="atclima-sub">
          {error ? `⚠ ${error}` : loading ? 'lädt …' : `${obsCount} Messtage`}
        </span>
        {/* Die Warnung als Merker in der Leiste statt als Textblock unter der
            Tabelle: dass eine Fünf-Tage-Reihe die Modelle nicht reiht, muss
            sichtbar sein, aber es braucht dafür keinen Absatz. */}
        {span < ROUGH_DAYS && (
          <span
            className="atclima-hint"
            title={
              `Über ${span} Tage entscheidet der Zufall, welches Modell vorn liegt. Die ` +
              'Fehlerzeile taugt so als Blick zurück, nicht als Reihung — dafür auf 20 Tage ' +
              'stellen, und belastbar würde sie erst über Monate.'
            }
          >
            ⚠ kein Modellvergleich
          </span>
        )}
        <span
          className="atclima-hint"
          title={
            'Verglichen wird das Tagesextrem über den UTC-Tag — auf beiden Seiten derselbe ' +
            'Zeitraum, weil GeoSphere-Klimatage ebenso von 00 bis 24 UTC laufen. Die Vorhersage ' +
            'kommt aus der Historical-Forecast-API von Open-Meteo: sie liefert zu einem ' +
            'vergangenen Zeitpunkt auch das, was N Tage vorher dafür vorhergesagt wurde. Der ' +
            'laufende Tag fehlt bewusst — er hat noch kein geprüftes Tagesextrem.'
          }
        >
          Tagesextrem 00–24 UTC
        </span>
      </div>

      {/* Nur Modelle, die den gewählten Vorlauf überhaupt tragen: bei +3 Tagen
          fallen AROME Austria (60 h) und ICON-D2 (48 h) heraus, weil es dort
          keine drei Tage alte Vorhersage für diesen Tag geben KANN. Sie als
          leere Spalten anzubieten wäre nur eine Einladung zum Fehlschluss. */}
      <div className="verify-models">
        <span className="label-muted">Modelle</span>
        {SELECTABLE_MODELS.filter(
          (m) =>
            (!station || isInCoverage(m, station.lat, station.lon)) &&
            m.forecastHours >= lead * 24 + 24,
        ).map((m) => (
          <label key={m.id} className="verify-model" title={`${m.provider} · Horizont ${m.forecastHours} h`}>
            <input
              type="checkbox"
              checked={modelIds.includes(m.id)}
              onChange={(e) =>
                setModelIds((prev) =>
                  e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                )
              }
            />
            {m.label}
          </label>
        ))}
      </div>

      <div className="verify-body">
        {!station ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <>
            {/* Was hier verglichen wird, in einem Satz. Eine Zahlenmatrix ohne
                Größe, Ort, Zeitfenster und Zeitraum ist nicht lesbar. */}
            <div className="verify-what">
              <strong>{TARGETS[target].label}</strong> an der Station{' '}
              <strong>{station.name}</strong>
              {station.altitude != null && <> ({Math.round(station.altitude)} m)</>}, gemessen als
              Tagesextrem über <strong>00–24 UTC</strong>. Verglichen mit der{' '}
              <span
                title={
                  'Rohe Modellausgabe, auf den Punkt und auf die Stationshöhe gerechnet — KEIN ' +
                  'MOS. Statistisch korrigierte Punktvorhersagen führt die Seite als DWD MOSMIX ' +
                  'unter „Österreich-Klima → Vorhersage"; die lassen sich hier nicht verifizieren, ' +
                  'weil MOSMIX kein öffentliches Archiv vergangener Läufe hat.'
                }
              >
                deterministischen Punktprognose
              </span>{' '}
              bei <strong>{leadLabel(lead)}</strong>{' '}
              <span
                title={
                  'GLEITENDER Vorlauf als Referenz: für jede Stunde des Tages der Stand, den die ' +
                  'Vorhersage ' + lead * 24 + ' Stunden davor hatte. Das ist NICHT ein fester ' +
                  'Modelllauf — je nach Zeitpunkt und Modell stammt der Stand aus einem anderen ' +
                  'Lauf, und die Modelle laufen unterschiedlich oft: AROME Austria und ICON-D2 ' +
                  'alle 3 Stunden, IFS alle 6, andere alle 12. Ein fester Lauf wäre über die API ' +
                  'ohnehin nicht zu bekommen (geprüft) — und er hätte einen Nachteil: er mischt ' +
                  'über den Tag hinweg ' + lead * 24 + ' bis ' + (lead * 24 + 23) + ' Stunden ' +
                  'Vorlauf, während der gleitende jeden Tag beim GLEICHEN Vorhersagealter ' +
                  'vergleicht. Gemessen: die Reihe springt an der Tagesgrenze nicht und der ' +
                  'Fehler wächst über den Tag nicht an — beides wäre bei einem festen Lauf anders.'
                }
              >
                (gleitend, kein fester Lauf)
              </span>
              . Zeitraum{' '}
              <strong>
                {fmtShort.format(new Date(`${start}T12:00:00Z`))}–{fmtDay(end)}
              </strong>{' '}
              ({obsCount} Messtage).
            </div>
            <div className="verify-main">
            {/* TAG FÜR TAG: gemessen, vorhergesagt, Differenz. Das ist die
                Frage, die man an fünf Tagen stellt — eine Matrix aus
                Fehlermaßen bräuchte Wochen, um überhaupt etwas zu sagen. */}
            <table className="verify-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th title="Gemessener Wert der Station — Tagesextrem über 00–24 UTC aus dem geprüften Klimatagesdatensatz (GeoSphere klima-v2-1d)">
                    Messung
                    <span className="verify-err">00–24 UTC</span>
                  </th>
                  {table.map((row, i) => (
                    <th
                      key={row.model.id}
                      title={
                        `${row.model.label} · ${row.model.provider} · Horizont ` +
                        `${row.model.forecastHours} h · neuer Lauf alle ${row.model.updateIntervalHours} h\n` +
                        'Obere Zahl: Vorhersagewert. Untere: Abweichung von der Messung.'
                      }
                    >
                      {row.model.label}
                      <span className="verify-err">Wert / Δ</span>
                      {/* Farbmarke = Kurvenfarbe im Diagramm daneben. Erspart
                          dem Diagramm eine eigene Legende und der Tabelle eine
                          zweite Spalte. */}
                      <span
                        className="verify-swatch"
                        style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => {
                  const obs = observed?.get(d) ?? null
                  return (
                    <tr key={d}>
                      <th>{fmtDay(d)}</th>
                      <td className="verify-obs">{obs != null ? `${fmt1(obs)} °C` : '—'}</td>
                      {table.map((row) => {
                        const fc = row.cells.get(lead)?.daily.get(d) ?? null
                        const err = fc != null && obs != null ? fc - obs : null
                        return (
                          <td
                            key={row.model.id}
                            style={{ background: err != null ? errColor(Math.abs(err)) : undefined }}
                            title={
                              fc == null
                                ? row.model.forecastHours < lead * 24 + 24
                                  ? `${row.model.label} rechnet nur ${row.model.forecastHours} h weit — für einen Vorlauf von ${lead * 24} h bietet die API dort keine Reihe an.`
                                  : 'Für diesen Tag liegt keine Vorhersage vor.'
                                : `${row.model.label}, ${leadLabel(lead)}: ${fmt1(fc)} °C` +
                                  (err != null ? `, gemessen ${fmt1(obs!)} °C → ${fmtSigned(err)} K` : '')
                            }
                          >
                            {fc != null ? (
                              <>
                                <span className="verify-fc">{fmt1(fc)}</span>
                                <span className="verify-err">{err != null ? fmtSigned(err) : ''}</span>
                              </>
                            ) : (
                              <span className="verify-empty">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th
                    title={
                      'Über die gezeigten Tage: oben der mittlere Fehlerbetrag, unten die ' +
                      'systematische Schieflage. Ein Modell mit +2 K Schieflage liegt immer zu ' +
                      'warm und ist korrigierbar, eines mit 0 K streut nur; darin steckt auch der ' +
                      'Unterschied zwischen Modellgitterzelle und Messplatz. Markiert ist das ' +
                      'beste Modell ÜBER DEN ZEITRAUM — je Tag das nächstliegende zu zeigen wäre ' +
                      'Rosinenpicken im Nachhinein (gemessen 0,59 K statt 1,16 K des besten ' +
                      'Einzelmodells).' +
                      (span < ROUGH_DAYS
                        ? `\n\nACHTUNG: über ${span} Tage ist das kein Modellvergleich — bei so kurzen Reihen entscheidet der Zufall, welches Modell vorn liegt.`
                        : `\n\nÜber ${span} Tage ist die Reihung grob; belastbar würde sie erst über Monate.`)
                    }
                  >
                    Ø Fehler
                    <span className="verify-err">{obsCount} Tage</span>
                  </th>
                  <td className="verify-empty">—</td>
                  {table.map((row) => {
                    const sc = row.cells.get(lead)?.scores
                    // Bestes Modell ÜBER DEN ZEITRAUM markieren — nicht je Tag.
                    // Je Tag das nächstliegende Modell zu nehmen wäre kein
                    // Vergleich, sondern Rosinenpicken im Nachhinein (siehe
                    // Legende).
                    const isBest = sc != null && sc.n > 0 && bestMae != null && sc.mae === bestMae
                    return (
                      <td
                        key={row.model.id}
                        className={isBest ? 'verify-best' : undefined}
                        title={
                          sc && sc.n
                            ? `${sc.n} Tage · mittlerer absoluter Fehler ${fmt1(sc.mae)} K · Bias ${fmtSigned(sc.bias)} K · RMSE ${fmt1(sc.rmse)} K` +
                              (isBest ? '\nKleinster Fehler über den gezeigten Zeitraum.' : '')
                            : 'Keine gemeinsamen Tage.'
                        }
                      >
                        {sc && sc.n ? (
                          <>
                            <span className="verify-fc">{fmt1(sc.mae)}</span>
                            <span className="verify-err">{fmtSigned(sc.bias)}</span>
                          </>
                        ) : (
                          <span className="verify-empty">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
            {/* Die Kurven tragen die Modellfarben der Spaltenköpfe — dadurch
                braucht das Diagramm keine eigene Legende. */}
            <div className="verify-chart">
              <ChartRow
                xs={xs}
                chart={chart}
                height={Math.max(240, Math.min(days.length * 22 + 90, 520))}
                formatTick={(ts) => fmtShort.format(new Date(ts * 1000))}
                xSpace={58}
              />
            </div>
            </div>
          </>
        )}
      </div>
      <OpenMeteoAttribution className="app-attribution" />
    </div>
  )
}
