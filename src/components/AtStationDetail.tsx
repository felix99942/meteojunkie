// Stationsdetail der Österreich-Klimakarte: Klick auf eine Station öffnet dieses
// Panel mit der Tages-Zeitreihe des gewählten Parameters über das letzte Jahr
// (ein Bulk-Request je Station, gecacht), Kennzahlen und den Rekorden.
// uPlot-Setup im Stil von Meteogram.tsx.
//
// Zwei Größen: SCHNELLANSICHT (Overlay in der Kartenecke, kompakt) und
// MAXIMIERT (füllt den Kartenbereich) — maximiert stehen alle Rekordebenen als
// Tabelle mit Datum und die Erklärtexte dabei, die in der Ecke keinen Platz
// hätten.
//
// Rekordtage: die Assets kennen nur Monat bzw. Jahr. Für Tmax/Tmin lässt sich
// der genaue Tag aus dem Tagesdatensatz nachladen (siehe api/atRecords.ts) —
// die absoluten Rekorde immer, die übrigen Ebenen auf Klick, damit ein Öffnen
// des Panels nicht 34 Requests auslöst.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { fetchStationSeries, type AtStation } from '../api/geosphere'
import {
  fetchLiveDayValues,
  loadNationalRecords,
  loadStationRecords,
  SEASON_LABEL,
  SEASONS,
  todayUtc,
  type MaxMin,
  type NationalRecords,
  type StationRecords,
} from '../api/atValues'
import {
  DAY_RESOLVABLE,
  monthOfYearRange,
  monthRange,
  resolveExtremeDay,
  seasonRange,
  type ExtremeDay,
} from '../api/atRecords'
import { getAtParameter } from '../config/atParameters'

const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_NAME = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const INK_MUTED = '#898781'
const GRIDLINE = '#2c2c2a'
const AXIS_FONT = '10px system-ui, sans-serif'
const LINE = '#3987e5'

const fmtMonth = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', month: 'short' })
const fmtRecordDay = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** Rekorde gibt es nur für die vorberechneten Monatscodes. */
const REC_CODES = new Set(['tl_mittel', 'tlmax', 'tlmin', 'rr', 'so_h'])

/** YYYY-MM-DD (UTC) n Tage vor `iso`. */
function daysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Eine Rekordzeile: Ebene + Wert + Zeitraum, in dem der Tag zu suchen ist. */
interface RecRow {
  key: string
  level: string
  kind: 'max' | 'min'
  value: number
  /** Anzeige ohne aufgelösten Tag (Monat bzw. Jahr aus den Assets). */
  when: string
  start: string
  end: string
}

function absRows(abs: MaxMin): RecRow[] {
  const rows: RecRow[] = []
  for (const kind of ['max', 'min'] as const) {
    const e = abs[kind]
    if (!e?.d) continue
    const { start, end } = monthRange(e.d)
    const [y, m] = e.d.split('-').map(Number)
    rows.push({
      key: `abs-${kind}`,
      level: 'Absolut',
      kind,
      value: e.v,
      when: `${MONTH_NAME[m - 1]} ${y}`,
      start,
      end,
    })
  }
  return rows
}

function seasonRows(rec: StationRecords[string]): RecRow[] {
  const rows: RecRow[] = []
  for (const s of SEASONS) {
    for (const kind of ['max', 'min'] as const) {
      const e = rec.sea[s]?.[kind]
      if (!e || e.y == null) continue
      const { start, end } = seasonRange(s, e.y)
      rows.push({
        key: `sea-${s}-${kind}`,
        level: `${SEASON_LABEL[s]}`,
        kind,
        value: e.v,
        when: String(e.y),
        start,
        end,
      })
    }
  }
  return rows
}

function monthRows(rec: StationRecords[string]): RecRow[] {
  const rows: RecRow[] = []
  rec.mon.forEach((m, i) => {
    for (const kind of ['max', 'min'] as const) {
      const e = m[kind]
      if (!e || e.y == null) continue
      const { start, end } = monthOfYearRange(e.y, i + 1)
      rows.push({
        key: `mon-${i}-${kind}`,
        level: MONTH_NAME[i],
        kind,
        value: e.v,
        when: String(e.y),
        start,
        end,
      })
    }
  })
  return rows
}

export function AtStationDetail({
  station,
  paramCode,
  day,
  onClose,
}: {
  station: AtStation
  paramCode: string
  day: string
  onClose: () => void
}) {
  const spec = getAtParameter(paramCode)
  const start = useMemo(() => daysBefore(day, 365), [day])
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  const [maximized, setMaximized] = useState(false)
  const [data, setData] = useState<{ xs: number[]; ys: (number | null)[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [records, setRecords] = useState<StationRecords | null>(null)
  const [national, setNational] = useState<NationalRecords | null>(null)

  useEffect(() => {
    let cancelled = false
    setRecords(null)
    loadStationRecords(station.id).then((r) => !cancelled && setRecords(r))
    loadNationalRecords()
      .then((n) => !cancelled && setNational(n))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [station.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchStationSeries(paramCode, start, day, [station.id])
      .then(async (s) => {
        if (cancelled) return
        const xs = s.timestamps.map((t) => Date.parse(t) / 1000)
        const raw = s.byStation[station.id] ?? []
        // GeoSphere nutzt bei rr/sh -1 (o.ä. < 0) als Fehlwert → als Lücke behandeln
        const nonNeg = spec.category === 'Niederschlag' || spec.category === 'Schnee'
        const ys = raw.map((v) => (v == null || (nonNeg && v < 0) ? null : v))
        // Der laufende Tag fehlt im Tagesdatensatz — Zwischenstand aus den
        // 10-Minuten-Messwerten nachtragen, damit Chart und Karte übereinstimmen.
        const lastIdx = s.timestamps.length - 1
        if (day >= todayUtc() && lastIdx >= 0 && s.timestamps[lastIdx].startsWith(day)) {
          const live = await fetchLiveDayValues(spec, day, [station]).catch(() => null)
          const v = live?.byStation[station.id]
          if (v != null) ys[lastIdx] = v
        }
        if (!cancelled) setData({ xs, ys })
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Zeitreihe nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [station, paramCode, start, day, spec])

  // Kennzahlen über das Fenster.
  const stats = useMemo(() => {
    if (!data) return null
    const nums = data.ys.filter((v): v is number => v != null && Number.isFinite(v))
    if (nums.length === 0) return null
    const sum = nums.reduce((a, b) => a + b, 0)
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
      mean: sum / nums.length,
      sum,
      n: nums.length,
    }
  }, [data])

  // uPlot-Lebenszyklus.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !data) return
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, 80),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false, setScale: false } },
      scales:
        spec.category === 'Niederschlag' || spec.category === 'Sonne' || spec.category === 'Schnee'
          ? { y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] } }
          : {},
      series: [
        {},
        { label: spec.label, stroke: LINE, width: 1.5, points: { show: false } },
      ],
      axes: [
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
          space: 54,
          values: (_u, ticks) =>
            ticks.map((t) => fmtMonth.format(new Date(t * 1000))),
        },
        {
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: 44,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { stroke: GRIDLINE, width: 1 },
        },
      ],
    }
    const u = new uPlot(opts, [data.xs, data.ys] as uPlot.AlignedData, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
  }, [data, spec.label, spec.category])

  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

  const recCode = spec.monthlyCode && REC_CODES.has(spec.monthlyCode) ? spec.monthlyCode : null
  const rec = recCode && records ? records[recCode] : undefined
  const natRec = recCode && national ? national[recCode] : undefined
  const u = spec.unit
  // Nur wo der Monatswert ein Tagesextrem IST, gibt es einen Rekordtag.
  const dayResolvable = recCode ? DAY_RESOLVABLE[recCode] != null : false

  const rows = useMemo(() => {
    if (!rec) return { abs: [] as RecRow[], sea: [] as RecRow[], mon: [] as RecRow[] }
    return { abs: absRows(rec.abs), sea: seasonRows(rec), mon: monthRows(rec) }
  }, [rec])

  // Aufgelöste Rekordtage je Zeilenschlüssel ('loading' während des Abrufs).
  const [days, setDays] = useState<Record<string, ExtremeDay | 'loading' | null>>({})
  const [bulk, setBulk] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  // Wechsel von Station/Parameter → alte Auflösungen verwerfen.
  useEffect(() => setDays({}), [station.id, recCode])

  const resolveRow = useCallback(
    async (row: RecRow) => {
      if (!recCode || !dayResolvable) return
      setDays((d) => (d[row.key] ? d : { ...d, [row.key]: 'loading' }))
      const r = await resolveExtremeDay(recCode, station.id, row.start, row.end, row.value)
      if (aliveRef.current) setDays((d) => ({ ...d, [row.key]: r }))
    },
    [recCode, dayResolvable, station.id],
  )

  // Die absoluten Rekorde immer auflösen — das sind zwei Requests, und genau die
  // will man beim Öffnen sehen.
  useEffect(() => {
    if (!dayResolvable) return
    rows.abs.forEach((r) => void resolveRow(r))
  }, [rows.abs, dayResolvable, resolveRow])

  const resolveAll = async () => {
    setBulk(true)
    // Nacheinander: 30+ gleichzeitige Abrufe wären gegenüber GeoSphere unhöflich
    // und bringen nichts — ab dem zweiten Öffnen kommt ohnehin alles aus dem Cache.
    for (const row of [...rows.sea, ...rows.mon]) {
      if (!aliveRef.current) break
      await resolveRow(row)
    }
    if (aliveRef.current) setBulk(false)
  }

  /** Datum einer Rekordzeile als Text: aufgelöster Tag, sonst Monat/Jahr. */
  const dayText = (row: RecRow): { text: string; exact: boolean; loading: boolean } => {
    const d = days[row.key]
    if (d === 'loading') return { text: row.when, exact: false, loading: true }
    if (d && typeof d === 'object')
      return { text: fmtRecordDay.format(new Date(`${d.day}T12:00:00Z`)), exact: true, loading: false }
    return { text: row.when, exact: false, loading: false }
  }

  const recRow = (row: RecRow) => {
    const { text, exact, loading: busy } = dayText(row)
    const d = days[row.key]
    const ties = d && typeof d === 'object' ? d.ties : 0
    return (
      <tr key={row.key}>
        <td>{row.level}</td>
        <td className={row.kind === 'max' ? 'atdetail-recmax' : 'atdetail-recmin'}>
          {row.kind === 'max' ? '▲' : '▼'} {fmt(row.value)} {u}
        </td>
        <td>
          <span className={exact ? 'atrec-exact' : 'label-muted'} title={ties > 1 ? `Wert kam im Zeitraum ${ties}× vor — gezeigt ist das erste Auftreten` : undefined}>
            {text}
            {ties > 1 ? ' *' : ''}
          </span>
          {dayResolvable && !exact && (
            <button
              type="button"
              className="atrec-daybtn"
              disabled={busy || bulk}
              onClick={() => void resolveRow(row)}
              title="Genauen Tag aus dem Tagesdatensatz nachladen"
            >
              {busy ? '…' : 'Tag'}
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className={`atdetail${maximized ? ' is-max' : ''}`}>
      <div className="atdetail-head">
        <div>
          <strong>{station.name}</strong>
          {station.altitude != null && <span className="label-muted"> · {Math.round(station.altitude)} m</span>}
          {station.state && <span className="label-muted"> · {station.state}</span>}
        </div>
        <div className="atdetail-headbtns">
          <button
            type="button"
            className="atdetail-close"
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? 'Zurück zur Schnellansicht' : 'Fenster maximieren — alle Rekordebenen mit Datum'}
          >
            {maximized ? '❐' : '⛶'}
          </button>
          <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
            ✕
          </button>
        </div>
      </div>
      <div className="atdetail-sub">
        {spec.label} ({spec.unit}) · Tageswerte der letzten 12 Monate bis {day}
      </div>
      {maximized && <div className="atdetail-note">{spec.description}</div>}

      <div className={maximized ? 'atdetail-cols' : undefined}>
        <div className="atdetail-col">
          {stats && (
            <div className="atdetail-stats">
              <span>Min <strong>{fmt(stats.min)}</strong></span>
              <span>Mittel <strong>{fmt(stats.mean)}</strong></span>
              <span>Max <strong>{fmt(stats.max)}</strong></span>
              {(spec.agg === 'sum') && <span>Summe <strong>{fmt(stats.sum)}</strong></span>}
              <span className="label-muted">{stats.n} Tage mit Wert</span>
            </div>
          )}
          <div className="atdetail-chart">
            <div className="atdetail-plot" ref={containerRef} />
            {loading && <div className="panel-placeholder atdetail-overlay">Lade Zeitreihe …</div>}
            {error && <div className="panel-placeholder atdetail-overlay">{error}</div>}
            {!loading && !error && !stats && (
              <div className="panel-placeholder atdetail-overlay">Keine Daten im Zeitraum</div>
            )}
          </div>
          {maximized && (
            <div className="atdetail-note">
              Zeitreihe aus dem Tagesdatensatz klima-v2-1d. Der laufende Tag ist ein Zwischenstand
              aus den 10-Minuten-Messwerten und kann sich noch ändern.
            </div>
          )}
        </div>

        <div className="atdetail-col">
          {recCode && !rec && <div className="atdetail-records-empty label-muted">Lade Rekorde …</div>}
          {!recCode && (
            <div className="atdetail-note">
              Für {spec.label} gibt es keine vorberechneten Rekorde — sie stammen aus dem
              Monatsdatensatz, den dieser Parameter nicht führt.
            </div>
          )}

          {rec && !maximized && (
            <div className="atdetail-recblock">
              {rows.abs.map((row) => {
                const { text, exact } = dayText(row)
                return (
                  <div key={row.key} className="atdetail-recrow">
                    <span className="atdetail-reclabel">{row.kind === 'max' ? 'Höchstwert' : 'Tiefstwert'}</span>
                    <span className={row.kind === 'max' ? 'atdetail-recmax' : 'atdetail-recmin'}>
                      {row.kind === 'max' ? '▲' : '▼'} {fmt(row.value)} {u}
                    </span>
                    <span className={exact ? 'atrec-exact' : 'label-muted'}>{text}</span>
                  </div>
                )
              })}
              {natRec && (
                <div
                  className="atdetail-recrow atdetail-recnat"
                  title={`Österreichweit höchster bzw. niedrigster Monatswert von ${spec.label} — bei einem Maximum-Parameter ist ▼ also der niedrigste je gemessene Monatshöchstwert.`}
                >
                  <span className="atdetail-reclabel">AT</span>
                  <span className="atdetail-recmax">▲ {fmt(natRec.max.v)} {u} <span className="label-muted">{natRec.max.n}, {natRec.max.d}</span></span>
                  <span className="atdetail-recmin">▼ {fmt(natRec.min.v)} {u} <span className="label-muted">{natRec.min.n}, {natRec.min.d}</span></span>
                </div>
              )}
              <div className="atdetail-recgrid">
                {SEASONS.map((s) => (
                  <div key={s} className="atdetail-reccell" title={`${SEASON_LABEL[s]}: wärmster/kältester Saisonwert der Reihe`}>
                    <span className="atdetail-reccap">{SEASON_LABEL[s]}</span>
                    <span className="atdetail-recmax">▲ {fmt(rec.sea[s].max.v)} <span className="label-muted">’{String(rec.sea[s].max.y).slice(2)}</span></span>
                    <span className="atdetail-recmin">▼ {fmt(rec.sea[s].min.v)} <span className="label-muted">’{String(rec.sea[s].min.y).slice(2)}</span></span>
                  </div>
                ))}
              </div>
              <div className="atdetail-recmonths">
                {rec.mon.map((m, i) => (
                  <div key={i} className="atdetail-reccell" title={`${MONTH_NAME[i]}: ▲${fmt(m.max.v)} ${m.max.y} · ▼${fmt(m.min.v)} ${m.min.y}`}>
                    <span className="atdetail-reccap">{MONTH_ABBR[i]}</span>
                    <span className="atdetail-recmax">{fmt(m.max.v)}</span>
                    <span className="atdetail-recmin">{fmt(m.min.v)}</span>
                  </div>
                ))}
              </div>
              <div className="atdetail-note">
                Rekorde aus dem Monatsdatensatz ab 1900.{' '}
                {dayResolvable
                  ? 'Maximieren (⛶) zeigt jede Ebene mit dem genauen Rekordtag.'
                  : 'Maximieren (⛶) zeigt jede Ebene einzeln mit Jahr.'}
              </div>
            </div>
          )}

          {rec && maximized && (
            <div className="atdetail-recblock">
              <div className="atdetail-rechead">
                <strong>Rekorde</strong>
                {dayResolvable && (
                  <button type="button" onClick={() => void resolveAll()} disabled={bulk}>
                    {bulk ? 'lade Rekordtage …' : 'Alle Rekordtage laden'}
                  </button>
                )}
              </div>
              <div className="atdetail-note">
                Aus dem Monatsdatensatz klima-v2-1m ab 1900. <strong>Absolut</strong> = extremster
                Monatswert der ganzen Reihe, <strong>Saison</strong> = extremster Saisonwert
                (Winter = Dezember bis Februar, der Dezember zählt zum Folgejahr),{' '}
                <strong>Monat</strong> = extremster Wert je Kalendermonat.{' '}
                {dayResolvable
                  ? 'Weil der Monatswert hier ein Tagesextrem ist, lässt sich der genaue Tag aus dem Tagesdatensatz nachladen (einmal geladen, bleibt er gespeichert).'
                  : `${spec.label} wird über den Monat gemittelt bzw. summiert — dafür gibt es keinen einzelnen Rekordtag, deshalb steht hier Monat und Jahr.`}
              </div>
              <table className="atrec-table">
                <thead>
                  <tr>
                    <th>Ebene</th>
                    <th>Wert</th>
                    <th>{dayResolvable ? 'Datum' : 'Zeitraum'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.abs.map(recRow)}
                  {rows.sea.map(recRow)}
                  {rows.mon.map(recRow)}
                </tbody>
              </table>
              {natRec && (
                <div className="atdetail-note">
                  Österreichweit: höchster Monatswert <strong>{fmt(natRec.max.v)} {u}</strong> (
                  {natRec.max.n}, {natRec.max.d}), niedrigster{' '}
                  <strong>{fmt(natRec.min.v)} {u}</strong> ({natRec.min.n}, {natRec.min.d}). Bei
                  einem Maximum-Parameter ist der niedrigste Wert also der kühlste je gemessene
                  Monatshöchstwert.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
