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

import { useEffect, useMemo, useState } from 'react'
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
  day: 'numeric',
  month: 'numeric',
})
/** „Mi, 27.8." — Wochentag dazu, weil man Wetter in Wochentagen erinnert. */
const fmtDay = (day: string) => fmtDayLabel.format(new Date(`${day}T12:00:00Z`))

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
  useEffect(() => {
    if (station && !stationQuery) setStationQuery(station.name)
  }, [station, stationQuery])

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
        const r = await fetchPastRuns(station.lat, station.lon, m.id, FORECAST_VAR, start, end, leads)
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

  /** Diagramm: Messung dick, je Modell die Vorhersage beim gewählten Vorlauf. */
  const chart = useMemo(() => {
    const obs = days.map((d) => observed?.get(d) ?? null)
    const curves = [
      {
        label: 'Messung',
        color: '#e8e8e8',
        type: 'line' as const,
        values: obs,
        width: 2.5,
      },
      ...table.map((row, i) => ({
        label: row.model.label,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        type: 'line' as const,
        values: days.map((d) => row.cells.get(lead)?.daily.get(d) ?? null),
        width: 1.4,
        dash: [4, 3],
      })),
    ]
    return {
      title: `${TARGETS[target].label} · Vorlauf ${lead} Tag${lead > 1 ? 'e' : ''}`,
      unit: '°C',
      curves,
      minSpan: 6,
    }
  }, [days, observed, table, lead, target])

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
              const hit = shown.find((s) => s.name.toLowerCase() === q.trim().toLowerCase())
              if (hit) setStationId(hit.id)
            }}
            onFocus={(e) => e.currentTarget.select()}
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
          <span className="label-muted">Vorlauf im Diagramm</span>
          <select value={lead} onChange={(e) => setLead(Number(e.target.value))}>
            {(availableLeads.length ? availableLeads : [1]).map((n) => (
              <option key={n} value={n}>
                {n} Tag{n > 1 ? 'e' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="atclima-sub">
          {error ? `⚠ ${error}` : loading ? 'lädt …' : `${obsCount} Messtage`}
        </span>
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
            {/* TAG FÜR TAG: gemessen, vorhergesagt, Differenz. Das ist die
                Frage, die man an fünf Tagen stellt — eine Matrix aus
                Fehlermaßen bräuchte Wochen, um überhaupt etwas zu sagen. */}
            <div className="verify-scroll">
            <table className="verify-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th title="Gemessener Wert der Station (GeoSphere klima-v2-1d)">Messung</th>
                  {table.map((row) => (
                    <th
                      key={row.model.id}
                      title={`${row.model.provider} · Horizont ${row.model.forecastHours} h`}
                    >
                      {row.model.label}
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
                                  ? `${row.model.label} rechnet nur ${row.model.forecastHours} h weit — eine ${lead} Tage alte Vorhersage für diesen Tag kann es nicht geben.`
                                  : 'Für diesen Tag liegt keine Vorhersage vor.'
                                : `${row.model.label}, vorhergesagt ${lead} Tag${lead > 1 ? 'e' : ''} vorher: ${fmt1(fc)} °C` +
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
                  <th title="Mittlerer absoluter Fehler und systematische Schieflage über die gezeigten Tage">
                    Ø Fehler
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
            </div>
            <div className="verify-legend label-muted">
              Große Zahl: was das Modell {lead} Tag{lead > 1 ? 'e' : ''} vorher für diesen Tag
              vorhergesagt hat. Kleine Zahl darunter: Abweichung von der Messung, Vorzeichen und
              Größe. In der letzten Zeile der mittlere Fehlerbetrag über alle gezeigten Tage und
              daneben die systematische Schieflage — ein Modell mit +2 K Schieflage liegt immer
              zu warm und ist korrigierbar, eines mit 0 K streut nur. Darin steckt auch der
              Unterschied zwischen Modellgitterzelle und Messplatz. Hervorgehoben ist das
              Modell mit dem kleinsten Fehler ÜBER DEN GANZEN ZEITRAUM. Je Tag das jeweils
              nächstliegende Modell zu zeigen wäre kein Vergleich, sondern Rosinenpicken im
              Nachhinein: an diesem Punkt gemessen käme man damit auf 0,59 K statt 1,16 K des
              besten Einzelmodells — eine Zahl, die niemand im Voraus hätte haben können.
              {' '}
              {span < ROUGH_DAYS ? (
                <>
                  <strong>Über {span} Tage ist das kein Modellvergleich.</strong> Bei so kurzen
                  Reihen entscheidet der Zufall, welches Modell vorn liegt — für eine grobe
                  Reihung auf 20 Tage stellen.
                </>
              ) : (
                <>
                  <strong>Über {span} Tage ist die Reihung grob.</strong> Ein belastbarer
                  Modellvergleich bräuchte Monate; hier gemessen kippt die Ordnung noch bei
                  Unterschieden von einigen Zehntel Kelvin.
                </>
              )}
            </div>
            {/* Bei fünf Tagen sagt die Tabelle alles, was fünf Punkte im
                Diagramm sagen könnten — dann bleibt es weg. Über längere
                Reihen ist der Verlauf dagegen die eigentliche Information. */}
            {days.length >= 8 && (
              <div className="verify-chart">
                <ChartRow xs={xs} chart={chart} height={220} dayRow formatTick={() => ''} xSpace={80} />
              </div>
            )}
          </>
        )}
      </div>
      <OpenMeteoAttribution className="app-attribution" />
    </div>
  )
}
