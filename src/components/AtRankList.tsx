// Rangliste der Österreich-Klimakarte: die extremsten Stationen der aktuellen
// Auswahl (höchste/niedrigste Werte) als Liste neben der Karte. Arbeitet REIN
// auf den bereits geladenen Kartenwerten — kein zusätzlicher Request, auch nicht
// im Anomalie-Modus (dort werden die Abweichungen gereiht).
//
// Hover markiert die Station in der Karte, Klick öffnet ihr Detailpanel.

import { useMemo } from 'react'
import type { AtStation } from '../api/geosphere'
import { rankExtremes } from './atRank'

/** Wert kompakt formatieren — gleiche Regel wie die Kartenbeschriftung. */
const fmt = (v: number): string =>
  Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)

export function AtRankList({
  stations,
  values,
  unit,
  title,
  signed = false,
  count = 10,
  onSelect,
  onHover,
  onClose,
}: {
  stations: AtStation[]
  /** Anzeigewerte parallel zu `stations` (Absolut oder Anomalie). */
  values: (number | null)[]
  unit: string
  /** Kopfzeile: was gereiht wird (Parameter + Zeitbezug). */
  title: string
  /** Anomalien mit Vorzeichen zeigen (+2,1 statt 2,1). */
  signed?: boolean
  count?: number
  onSelect: (idx: number) => void
  onHover: (idx: number | null) => void
  onClose: () => void
}) {
  const { top, bottom, n } = useMemo(() => rankExtremes(values, count), [values, count])

  const show = (v: number) => `${signed && v > 0 ? '+' : ''}${fmt(v)}`

  const rows = (list: number[], rank: (pos: number) => number) =>
    list.map((i, pos) => (
      <button
        key={stations[i].id}
        type="button"
        className="atrank-row"
        onMouseEnter={() => onHover(i)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(i)}
        onBlur={() => onHover(null)}
        onClick={() => onSelect(i)}
        title={`${stations[i].name} — Detail öffnen`}
      >
        <span className="atrank-no">{rank(pos)}</span>
        <span className="atrank-val">{show(values[i] as number)}</span>
        <span className="atrank-name">{stations[i].name}</span>
        <span className="atrank-meta">
          {stations[i].altitude != null ? `${Math.round(stations[i].altitude as number)} m` : ''}
        </span>
      </button>
    ))

  return (
    <div className="atrank">
      <div className="atrank-head">
        <strong>Rangliste</strong>
        <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>
      <div className="atrank-sub">
        {title} · {unit}
      </div>
      {n === 0 ? (
        <div className="atrank-empty label-muted">Keine Werte in dieser Auswahl</div>
      ) : (
        <>
          <div className="atrank-cap">Höchste</div>
          {rows(top, (pos) => pos + 1)}
          {bottom.length > 0 && (
            <>
              <div className="atrank-cap">Niedrigste</div>
              {rows(bottom, (pos) => n - pos)}
            </>
          )}
          <div className="atrank-foot label-muted">{n} Stationen mit Wert</div>
        </>
      )}
    </div>
  )
}
