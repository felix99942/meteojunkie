// Rangliste der Österreich-Klimakarte: reiht die Stationen nach dem aktuell
// gezeigten Kartenwert. Arbeitet REIN auf den bereits geladenen Werten — kein
// zusätzlicher Request, auch nicht im Anomalie-Modus (dort werden die
// Abweichungen gereiht).
//
// Zwei Größen, wie beim Stationsdetail:
//   SCHNELLANSICHT — Extreme (höchste/niedrigste 10) in der Kartenecke
//   MAXIMIERT      — vollständige, sortierbare Tabelle über den Kartenbereich
//
// Die SUCHE geht in BEIDEN Größen über die ganze Reihung, nicht nur über die
// angezeigten Zeilen: sonst wäre eine Station auf Rang 87 in der
// Schnellansicht unauffindbar, weil dort nur die Extreme stehen. Sobald etwas
// im Suchfeld steht, treten die Extremlisten deshalb hinter die Trefferliste
// zurück. Die Rangzahl bleibt dabei immer die globale.
//
// Interaktion: Hover markiert die Station in der Karte, Klick öffnet ihr
// Detailpanel.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import { extremes, rankAll, searchRanked, summarize, type RankEntry } from './atRank'

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
  // Die Liste wird über „Rangliste & Stationssuche" geöffnet — dann soll man
  // sofort tippen können, ohne erst ins Feld zu klicken.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 })

  const ranked = useMemo(() => rankAll(values), [values])
  const stats = useMemo(() => summarize(ranked), [ranked])
  const { top, bottom } = useMemo(() => extremes(ranked, count), [ranked, count])

  const q = query.trim()
  const searching = q.length > 0
  // Suche über die GANZE Reihung — inklusive der Stationen ohne Wert, die sonst
  // spurlos verschwänden ("gibt es nicht" statt "hat hier keinen Wert").
  const search = useMemo(() => searchRanked(stations, ranked, q), [stations, ranked, q])

  const show = (v: number) => `${signed && v > 0 ? '+' : ''}${fmt(v)}`

  // Vollständige Tabelle (maximiert): Rang bleibt global, sortiert wird nur die Anzeige.
  const tableRows = useMemo(() => {
    const rows = search.hits
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
  }, [search, sort, stations])

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
    list.map((e) => (
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

  /** Gefundene Stationen ohne Wert — als Zeilen mit „—" statt gar nicht. */
  const noValueRows = search.withoutValue.map((idx) => (
    <button
      key={stations[idx].id}
      type="button"
      className="atrank-row is-novalue"
      onFocus={() => onHover(idx)}
      onBlur={() => onHover(null)}
      onMouseEnter={() => onHover(idx)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(idx)}
      title={`${stations[idx].name} — kein Wert in dieser Auswahl, Detail öffnen`}
    >
      <span className="atrank-no">–</span>
      <span className="atrank-val">—</span>
      <span className="atrank-name">{stations[idx].name}</span>
      <span className="atrank-meta">
        {stations[idx].altitude != null ? `${Math.round(stations[idx].altitude as number)} m` : ''}
      </span>
    </button>
  ))

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
        ref={searchRef}
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
                  {/* Treffer ohne Wert stehen am Ende — mit „—" statt gar nicht,
                      sonst wirkt die Station wie nicht vorhanden. */}
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
                  {search.withoutValue.map((idx) => (
                    <tr
                      key={`nv-${stations[idx].id}`}
                      className="is-novalue"
                      onMouseEnter={() => onHover(idx)}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => onSelect(idx)}
                      title="Kein Wert in dieser Auswahl — Detail öffnen"
                    >
                      <td className="atrank-no">–</td>
                      <td className="atrank-val">—</td>
                      <td className="atrank-name">{stations[idx].name}</td>
                      <td className="atrank-meta">
                        {stations[idx].altitude != null
                          ? `${Math.round(stations[idx].altitude as number)} m`
                          : '—'}
                      </td>
                      <td className="atrank-meta">{stations[idx].state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : searching ? (
            // Suche schlägt die Extremlisten: gesucht wird über ALLE Ränge,
            // sonst bliebe Rang 87 in der Schnellansicht unauffindbar.
            <div className="atrank-results">
              {search.hits.length === 0 && search.withoutValue.length === 0 ? (
                <div className="atrank-empty label-muted">Keine Station gefunden</div>
              ) : (
                <>
                  {search.hits.length > 0 && (
                    <>
                      <div className="atrank-cap">
                        {search.hits.length} {search.hits.length === 1 ? 'Treffer' : 'Treffer'}
                      </div>
                      {compactRows(search.hits)}
                    </>
                  )}
                  {search.withoutValue.length > 0 && (
                    <>
                      <div className="atrank-cap" title="Station existiert, hat in diesem Zeitbezug aber keinen Wert">
                        Ohne Wert ({search.withoutValue.length})
                      </div>
                      {noValueRows}
                    </>
                  )}
                </>
              )}
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
            {searching
              ? `${search.hits.length} von ${stats.n} Stationen mit Wert passen zur Suche` +
                (search.withoutValue.length > 0
                  ? ` · ${search.withoutValue.length} weitere ohne Wert`
                  : '')
              : `${stats.n} von ${stations.length} Stationen haben einen Wert`}
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
