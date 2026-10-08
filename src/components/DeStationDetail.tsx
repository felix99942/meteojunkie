// Stationsdetail des Klimamonitors DEUTSCHLAND.
//
// Das Österreich-Detail holt Tagesreihen und Perioden-Historie je Station
// direkt bei GeoSphere. Für den DWD geht das nicht (kein CORS), und eine Reihe
// je Station vorzuerzeugen hieße über 1.000 Dateien mehr je Deploy. Hier steht
// deshalb, was die Karte und die Rekord-Assets wissen: Wert, Normal,
// Abweichung, Stammdaten — und die Rekorde der Station auf der Ebene des
// Zeitbezugs, mit Tagesrekord und deutschlandweitem Gegenstück.

import { useEffect, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import {
  hasRecords,
  loadNationalRecords,
  loadStationRecords,
  SEASON_LABEL,
  type Extreme,
  type MaxMin,
  type ParamRecords,
  type Period,
} from '../api/atValues'
import type { AtParameterSpec } from '../config/atParameters'
import { AtPeriodHistory } from './AtPeriodHistory'
import type { HistoryScope } from './atHistory'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** „Juni 2026" (YYYY-MM), „27.06.2026" (YYYY-MM-DD) oder das Jahr. */
function when(e: Extreme): string {
  if (e.d && e.d.length === 10) return new Date(`${e.d}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' })
  if (e.d) return `${MONTHS[Number(e.d.slice(5, 7)) - 1]} ${e.d.slice(0, 4)}`
  return e.y != null ? String(e.y) : ''
}

/**
 * Die Rekordebene folgt dem ZEITBEZUG der Karte — dieselbe Regel wie
 * `levelFor` im Österreich-Detail: beim Jahr der Jahreswert, nicht der beste
 * Einzelmonat (bei Summen eine Größenordnung Unterschied).
 */
function levelFor(r: ParamRecords, period: Period): { mm: MaxMin | undefined; label: string } {
  if (period.kind === 'year') return { mm: r.ann, label: 'Jahr' }
  if (period.kind === 'season') return { mm: r.sea[period.season], label: SEASON_LABEL[period.season] }
  if (period.kind === 'month') return { mm: r.mon[period.month - 1], label: MONTHS[period.month - 1] }
  if (period.kind === 'record' || period.kind === 'normal') {
    if (period.season) return { mm: r.sea[period.season], label: SEASON_LABEL[period.season] }
    if (period.month != null) return { mm: r.mon[period.month - 1], label: MONTHS[period.month - 1] }
    if (period.kind === 'record' && period.annual) return { mm: r.ann, label: 'Jahr' }
  }
  return { mm: r.abs, label: 'bester Einzelmonat' }
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '?'

export function DeStationDetail({
  station,
  spec,
  period,
  quantity,
  periodLabel,
  value,
  normal,
  anomaly,
  anomalyUnit,
  signed,
  refLabel,
  history,
  onClose,
}: {
  /** Perioden-Historie wie im Österreich-Detail; fehlt im Tag-Zeitbezug und bei Allzeit. */
  history?: {
    scope: HistoryScope
    firstYear: number
    lastYear: number
    normal: number | null
    showAnomaly: boolean
    refLabel: string
  }
  station: AtStation
  spec: AtParameterSpec
  period: Period
  /** Was gezeigt wird („Temperatur Mittel", „Summe der Monate" …). */
  quantity: string
  periodLabel: string
  value: number | null
  normal: number | null
  anomaly: number | null
  anomalyUnit: string
  signed: boolean
  refLabel: string
  onClose: () => void
}) {
  const digits = spec.agg === 'count' ? 0 : 1
  const code = spec.monthlyCode && hasRecords(spec) ? spec.monthlyCode : null
  const [rec, setRec] = useState<ParamRecords | null | undefined>(undefined)
  const [nat, setNat] = useState<ParamRecords | null>(null)
  useEffect(() => {
    if (!code) return
    let cancelled = false
    setRec(undefined)
    loadStationRecords(station.id, 'de').then((r) => !cancelled && setRec(r?.[code] ?? null))
    loadNationalRecords('de')
      .then((n) => !cancelled && setNat(n[code] ?? null))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [station.id, code])
  const lv = rec ? levelFor(rec, period) : null
  const natLv = nat ? levelFor(nat, period) : null
  const anomText =
    anomaly == null
      ? '—'
      : `${signed && anomaly > 0 ? '+' : ''}${fmt(anomaly, spec.anomalyKind === 'percent' ? 0 : 1)} ${anomalyUnit}`
  return (
    <div className="atdetail">
      <div className="atdetail-head">
        <div>
          <strong>{station.name}</strong>
          {station.altitude != null && <span className="label-muted"> · {Math.round(station.altitude)} m</span>}
          {station.state && <span className="label-muted"> · {station.state}</span>}
        </div>
        <div className="atdetail-headbtns">
          <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
            ✕
          </button>
        </div>
      </div>
      <div className="atdetail-sub">
        <strong className="atdetail-what">{quantity}</strong>
        <span className="label-muted"> · {periodLabel}</span>
      </div>
      <div className="atdetail-stats">
        <span>
          Wert <strong>{fmt(value, digits)}</strong> {spec.unit}
        </span>
        <span title={`Langjähriges Mittel ${refLabel} (DWD, multi_annual)`}>
          Normal {refLabel} <strong>{fmt(normal, digits)}</strong>
        </span>
        <span>
          Abweichung <strong>{anomText}</strong>
        </span>
      </div>
      {history && (
        <AtPeriodHistory
          country="de"
          station={station}
          spec={spec}
          scope={history.scope}
          firstYear={history.firstYear}
          lastYear={history.lastYear}
          normal={history.normal}
          showAnomaly={history.showAnomaly}
          refLabel={history.refLabel}
          monthNames={MONTHS}
        />
      )}
      <div className="atdetail-note">
        DWD-Station {station.id} · Messreihe {fmtDate(station.validFrom)} bis{' '}
        {station.isActive ? 'heute' : fmtDate(station.validTo)} · {station.lat.toFixed(3)}° N,{' '}
        {station.lon.toFixed(3)}° O
      </div>
      {code && (
        <div className="atdetail-recblock">
          {rec === undefined && <div className="atdetail-note label-muted">Lade Rekorde …</div>}
          {rec === null && <div className="atdetail-note label-muted">Für diese Station gibt es keine Rekorde.</div>}
          {lv?.mm && (
            <>
              <div className="atdetail-recrow">
                <span className="atdetail-reclabel">Rekord {lv.label}</span>
                {lv.mm.max && (
                  <span>
                    ▲ <strong>{fmt(lv.mm.max.v, digits)}</strong> {when(lv.mm.max)}
                  </span>
                )}
                {lv.mm.min && (
                  <span>
                    ▼ <strong>{fmt(lv.mm.min.v, digits)}</strong> {when(lv.mm.min)}
                  </span>
                )}
              </div>
              {/* Tagesrekorde (wärmste Nacht, kältester Tag, nassester Tag) — exaktes Datum */}
              {rec?.day && (
                <div className="atdetail-recrow" title="Aus den Tageswerten: die Richtung, die der Monatswert nicht trägt (wärmste Nacht, kältester Tag) bzw. der nasseste einzelne Tag">
                  <span className="atdetail-reclabel">Tag</span>
                  {rec.day.abs.max && (
                    <span>
                      ▲ <strong>{fmt(rec.day.abs.max.v, digits)}</strong> {when(rec.day.abs.max)}
                    </span>
                  )}
                  {rec.day.abs.min && (
                    <span>
                      ▼ <strong>{fmt(rec.day.abs.min.v, digits)}</strong> {when(rec.day.abs.min)}
                    </span>
                  )}
                </div>
              )}
              {natLv?.mm && (
                <div className="atdetail-recrow atdetail-recnat" title="Deutschlandweiter Rekord auf derselben Ebene, mit der Station, die ihn hält">
                  <span className="atdetail-reclabel">DE</span>
                  {natLv.mm.max && (
                    <span>
                      ▲ {fmt(natLv.mm.max.v, digits)} {when(natLv.mm.max)} · {natLv.mm.max.n}
                    </span>
                  )}
                  {natLv.mm.min && (
                    <span>
                      ▼ {fmt(natLv.mm.min.v, digits)} {when(natLv.mm.min)} · {natLv.mm.min.n}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
          <div className="atdetail-note label-muted">
            Rekord hängt an der Länge der Reihe — eine junge Station kann eine alte nicht schlagen.
          </div>
        </div>
      )}
    </div>
  )
}
