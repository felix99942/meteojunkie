// Stationsdetail des Klimamonitors DEUTSCHLAND — bewusst schlank (Phase 1).
//
// Das Österreich-Detail holt Tagesreihen, Perioden-Historie und Rekorde je
// Station direkt bei GeoSphere. Für den DWD geht das nicht (kein CORS), und
// eine Reihe je Station vorzuerzeugen wären über 500 Dateien mehr je Deploy.
// Hier steht deshalb, was die Karte schon weiß: Wert, Normal, Abweichung und
// die Stammdaten der Station. Reihen und Rekorde folgen mit Phase 3.

import type { AtStation } from '../api/geosphere'
import type { AtParameterSpec } from '../config/atParameters'

const fmt = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '?'

export function DeStationDetail({
  station,
  spec,
  quantity,
  periodLabel,
  value,
  normal,
  anomaly,
  anomalyUnit,
  signed,
  refLabel,
  onClose,
}: {
  station: AtStation
  spec: AtParameterSpec
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
      <div className="atdetail-note">
        DWD-Station {station.id} · Messreihe {fmtDate(station.validFrom)} bis{' '}
        {station.isActive ? 'heute' : fmtDate(station.validTo)} · {station.lat.toFixed(3)}° N,{' '}
        {station.lon.toFixed(3)}° O
      </div>
      <div className="atdetail-note label-muted">
        Reihe der Jahre und Stationsrekorde gibt es für Deutschland noch nicht — sie folgen mit
        den historischen Auswertungen.
      </div>
    </div>
  )
}
