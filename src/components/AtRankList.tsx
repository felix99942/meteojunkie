// Rangliste der Österreich-Klimakarte: reiht die Stationen nach dem aktuell
// gezeigten Kartenwert. Arbeitet REIN auf den bereits geladenen Werten — kein
// zusätzlicher Request, auch nicht im Anomalie-Modus (dort werden die
// Abweichungen gereiht).
//
// Zwei Größen, wie beim Stationsdetail:
//   SCHNELLANSICHT — Extreme (höchste/niedrigste 10) in der Kartenecke
//   MAXIMIERT      — vollständige, sortierbare Tabelle über den Kartenbereich
//
// Interaktion: Hover markiert die Station in der Karte, Klick öffnet ihr
// Detailpanel, das Suchfeld filtert die Anzeige (nie die Rangzahl).

import { useMemo, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import { extremes, rankAll, summarize, type RankEntry } from './atRank'

/** Wert kompakt formatieren — gleiche Regel wie die Kartenbeschriftung. */
const fmt = (v: number): string =>
  Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)

type SortKey = 'rank' | 'name' | 'alt' | 'state'

export function AtRankList({
  stations,
  values,
  unit,
  title,
  description,
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
  /** Klartext zum Parameter (aus der Registry). */
  description?: string
  /** Anomalien mit Vorzeichen zeigen (+2,1 statt 2,1). */
  signed?: boolean
  count?: number
  onSelect: (idx: number) => void
  onHover: (idx: number | null) => void
  onClose: () => void
}) {
  const [maximized, setMaximized] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 })

  const ranked = useMemo(() => rankAll(values), [values])
  const stats = useMemo(() => summarize(ranked), [ranked])
  const { top, bottom } = useMemo(() => extremes(ranked, count), [ranked, count])

  const q = query.trim().toLowerCase()
  const matches = (e: RankEntry) => {
    if (!q) return true
    const s = stations[e.idx]
    return s.name.toLowerCase().includes(q) || (s.state?.toLowerCase().includes(q) ?? false)
  }

  const show = (v: number) => `${signed && v > 0 ? '+' : ''}${fmt(v)}`

  // Vollständige Tabelle (maximiert): Rang bleibt global, sortiert wird nur die Anzeige.
  const tableRows = useMemo(() => {
    const rows = ranked.filter(matches)
    const dir = sort.dir
    const cmp: Record<SortKey, (a: RankEntry, b: RankEntry) => number> = {
      rank: (a, b) => a.rank - b.rank,
      name: (a, b) => stations[a.idx].name.localeCompare(stations[b.idx].name, 'de'),
      alt: (a, b) => (stations[b.idx].altitude ?? -1) - (stations[a.idx].altitude ?? -1),
      state: (a, b) => (stations[a.idx].state ?? '').localeCompare(stations[b.idx].state ?? '', 'de'),
    }
    return [...rows].sort((a, b) => cmp[sort.key](a, b) * dir)
    // stations/values ändern sich gemeinsam mit `ranked`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, sort, q, stations])

  const sortBtn = (key: SortKey, label: string) => (
    <th>
      <button
        type="button"
        className="atrank-sortbtn"
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}
        title={`Nach ${label} sortieren`}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  )

  const rowProps = (e: RankEntry) => ({
    onMouseEnter: () => onHover(e.idx),
    onMouseLeave: () => onHover(null),
    onClick: () => onSelect(e.idx),
  })

  const compactRows = (list: RankEntry[]) =>
    list.filter(matches).map((e) => (
      <button
        key={stations[e.idx].id}
        type="button"
        className="atrank-row"
        onFocus={() => onHover(e.idx)}
        onBlur={() => onHover(null)}
        title={`${stations[e.idx].name} — Detail öffnen`}
        {...rowProps(e)}
      >
        <span className="atrank-no">{e.rank}</span>
        <span className="atrank-val">{show(e.value)}</span>
        <span className="atrank-name">{stations[e.idx].name}</span>
        <span className="atrank-meta">
          {stations[e.idx].altitude != null ? `${Math.round(stations[e.idx].altitude as number)} m` : ''}
        </span>
      </button>
    ))

  const hiddenByQuery = q ? ranked.length - ranked.filter(matches).length : 0

  return (
    <div className={`atrank${maximized ? ' is-max' : ''}`}>
      <div className="atrank-head">
        <strong>Rangliste</strong>
        <div className="atdetail-headbtns">
          <button
            type="button"
            className="atdetail-close"
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? 'Zurück zur Schnellansicht' : 'Fenster maximieren — alle Stationen als sortierbare Tabelle'}
          >
            {maximized ? '❐' : '⛶'}
          </button>
          <button type="button" className="atdetail-close" onClick={onClose} title="Schließen">
            ✕
          </button>
        </div>
      </div>
      <div className="atrank-sub">
        {title} · {unit}
      </div>
      {maximized && description && <div className="atdetail-note">{description}</div>}

      <input
        className="atrank-search"
        type="search"
        value={query}
        placeholder="Station oder Bundesland suchen …"
        onChange={(ev) => setQuery(ev.target.value)}
      />

      {stats ? (
        <>
          <div className="atrank-stats">
            <span>Höchster <strong>{show(stats.max)}</strong></span>
            <span>Median <strong>{show(stats.median)}</strong></span>
            <span>Mittel <strong>{show(stats.mean)}</strong></span>
            <span>Tiefster <strong>{show(stats.min)}</strong></span>
          </div>

          {maximized ? (
            <div className="atrank-tablewrap">
              <table className="atrank-table">
                <thead>
                  <tr>
                    {sortBtn('rank', 'Rang')}
                    <th>Wert</th>
                    {sortBtn('name', 'Station')}
                    {sortBtn('alt', 'Höhe')}
                    {sortBtn('state', 'Bundesland')}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((e) => (
                    <tr key={stations[e.idx].id} {...rowProps(e)} title="Detail öffnen">
                      <td className="atrank-no">{e.rank}</td>
                      <td className="atrank-val">{show(e.value)}</td>
                      <td className="atrank-name">{stations[e.idx].name}</td>
                      <td className="atrank-meta">
                        {stations[e.idx].altitude != null ? `${Math.round(stations[e.idx].altitude as number)} m` : '—'}
                      </td>
                      <td className="atrank-meta">{stations[e.idx].state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="atrank-cap">Höchste</div>
              {compactRows(top)}
              {bottom.length > 0 && (
                <>
                  <div className="atrank-cap">Niedrigste</div>
                  {compactRows(bottom)}
                </>
              )}
            </>
          )}

          <div className="atrank-foot label-muted">
            {stats.n} von {stations.length} Stationen haben einen Wert
            {hiddenByQuery > 0 ? ` · ${hiddenByQuery} durch die Suche ausgeblendet` : ''}
            {maximized ? '' : ' · Klick öffnet das Detail, Hover markiert die Station in der Karte'}
          </div>
          {maximized && (
            <div className="atdetail-note">
              Der <strong>Rang</strong> gilt immer für alle Stationen mit Wert — Suche und
              Spaltensortierung ändern nur die Anzeige. Zeile anklicken öffnet das Stationsdetail,
              Überfahren markiert die Station in der Karte.
            </div>
          )}
        </>
      ) : (
        <div className="atrank-empty label-muted">Keine Werte in dieser Auswahl</div>
      )}
    </div>
  )
}
