// Klick auf eine TAWES-Station: die letzten 3 Tage aller ihrer Messgrößen als Diagrammstapel,
// mit dem Termin des Kartenschiebers als Markerlinie. Daten aus denselben Dateien wie die Karte
// (`loadTawesCode`, je Größe einmal geladen); was die Station nicht misst, fällt weg.

import { useEffect, useMemo, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import { loadTawesCode } from '../api/tawesRecent'
import { chartHasData, type ChartDef } from '../config/chartDef'
import {
  mergeTawesStores,
  TAWES_NT,
  TAWES_SLIDER_HOURS,
  tawesSeries,
  tawesStepMs,
  type TawesCode,
  type TawesStore,
} from '../config/tawesStore'
import { dewpoint } from '../lib/thermo'
import { ChartRow } from './ChartStack'

const TZ = 'Europe/Vienna'
const fmtAxis = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', hour: '2-digit' })

const DETAIL_CODES: TawesCode[] = ['tl', 'rf', 'ts', 'rr', 'ff', 'ffx', 'dd', 'p', 'pred', 'cglo', 'sh', 'tb10', 'tb20', 'tb50']
const STEPS = TAWES_SLIDER_HOURS * 6 + 1

type S = (number | null)[]
const within = (s: S, lo: number, hi: number): S => s.map((v) => (v == null || v < lo || v > hi ? null : v))

export function TawesStationDetail({
  station,
  markMs,
  value,
  valueText,
  title,
  onClose,
}: {
  station: AtStation
  /** Termin des Kartenschiebers (ms) */
  markMs: number | null
  /** Kartenwert der Station zum Termin */
  value: number | null
  valueText: (v: number) => string
  /** Was die Karte zeigt („Niederschlag 3 h") */
  title: string
  onClose: () => void
}) {
  const [store, setStore] = useState<TawesStore | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    Promise.all(DETAIL_CODES.map((c) => loadTawesCode(c))).then((res) => {
      if (!cancelled) setStore(mergeTawesStores(res.filter((s): s is TawesStore => s != null)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const { xs, charts } = useMemo(() => {
    const empty = { xs: [] as number[], charts: [] as ChartDef[] }
    if (!store) return empty
    const s = store.ids.indexOf(station.id)
    if (s < 0) return empty
    const from = TAWES_NT - STEPS
    const get = (c: TawesCode): S => (store.values[c] ? tawesSeries(store, c).get(station.id)!.slice(from) : [])
    const xs = Array.from({ length: STEPS }, (_, i) => tawesStepMs(store, from + i) / 1000)

    const tl = within(get('tl'), -50, 50)
    const rf = within(get('rf'), 0, 100)
    const td = tl.map((t, i) => (t == null || rf[i] == null || rf[i]! <= 0 ? null : dewpoint(t, rf[i]!)))
    const kmh = (v: S) => v.map((x) => (x == null || x < 0 ? null : Math.round(x * 3.6)))
    const pred = within(get('pred'), 900, 1080)
    const usePred = pred.some((v) => v != null)
    const pressure = usePred ? pred : within(get('p'), 500, 1080)
    const charts: ChartDef[] = [
      {
        title: 'Temperatur',
        unit: '°C',
        curves: [
          { label: '2 m', color: '#d95926', type: 'line', values: tl },
          { label: 'Taupunkt', color: '#3f9fd8', type: 'line', values: td, width: 1.2 },
          { label: '5 cm', color: '#9b59d0', type: 'line', values: within(get('ts'), -50, 50), width: 1, dash: [4, 3] },
        ],
        refLines: [{ value: 0, color: 'rgba(120,170,230,0.6)', dash: [3, 3] }],
      },
      {
        title: 'Niederschlag je 10 min',
        unit: 'mm',
        zeroBased: true,
        minTop: 0.5,
        curves: [{ label: 'RR', color: '#3987e5', type: 'bars', values: within(get('rr'), 0, 100) }],
      },
      {
        title: 'Wind',
        unit: 'km/h',
        zeroBased: true,
        minTop: 25,
        curves: [
          { label: 'Mittel', color: '#199e70', type: 'line', values: kmh(within(get('ff'), 0, 80)), direction: get('dd') },
          { label: 'Böe', color: '#e9a23b', type: 'line', values: kmh(within(get('ffx'), 0, 100)), dash: [4, 3], width: 1.2 },
        ],
      },
      {
        title: usePred ? 'Luftdruck auf Meeresniveau' : 'Luftdruck an der Station',
        unit: 'hPa',
        minSpan: 6,
        curves: [{ label: 'Druck', color: '#b9b2a6', type: 'line', values: pressure }],
      },
      {
        title: 'Relative Feuchte',
        unit: '%',
        range: [0, 100],
        curves: [{ label: 'rF', color: '#3bb488', type: 'line', values: rf }],
      },
      {
        title: 'Globalstrahlung',
        unit: 'W/m²',
        zeroBased: true,
        curves: [{ label: 'Global', color: '#d6a300', type: 'line', values: within(get('cglo'), 0, 1500), fill: 0.25 }],
      },
      {
        title: 'Schneehöhe',
        unit: 'cm',
        zeroBased: true,
        minTop: 10,
        curves: [{ label: 'Schnee', color: '#9085e9', type: 'line', values: within(get('sh'), 0, 1500) }],
      },
      {
        title: 'Erdboden',
        unit: '°C',
        curves: [
          { label: '−10 cm', color: '#c98a4a', type: 'line', values: within(get('tb10'), -30, 40) },
          { label: '−20 cm', color: '#9c6b3c', type: 'line', values: within(get('tb20'), -30, 40) },
          { label: '−50 cm', color: '#6e4c2e', type: 'line', values: within(get('tb50'), -30, 40) },
        ],
      },
    ]
    return { xs, charts: charts.map((c) => ({ ...c, curves: c.curves.filter((k) => k.values.some((v) => v != null)) })).filter(chartHasData) }
  }, [store, station.id])

  const syncKey = useMemo(() => `tawes-${station.id}`, [station.id])

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
      <div className="atdetail-what">
        {title}: {value == null ? 'kein Wert' : valueText(value)}
      </div>
      <div className="atdetail-sub">10-Minuten-Werte der letzten {TAWES_SLIDER_HOURS} h · Ortszeit Wien · Linie = Termin der Karte</div>
      {store === undefined && <div className="panel-placeholder">Lade Messwerte …</div>}
      {store !== undefined && charts.length === 0 && <div className="panel-placeholder">Für diese Station liegen keine Werte vor</div>}
      {charts.map((c) => (
        <div key={c.title} className="atfc-chart">
          <div className="atfc-chartcap">
            <span>
              {c.title} <span className="label-muted">({c.unit})</span>
            </span>
            {c.curves.length > 1 && (
              <span className="atfc-legend">
                {c.curves.map((k) => (
                  <span key={k.label}>
                    <i style={{ background: k.color }} /> {k.label}
                  </span>
                ))}
              </span>
            )}
          </div>
          <ChartRow
            xs={xs}
            chart={c}
            tz={TZ}
            axisFmt={fmtAxis}
            markTime={markMs ?? undefined}
            syncKey={syncKey}
          />
        </div>
      ))}
    </div>
  )
}
