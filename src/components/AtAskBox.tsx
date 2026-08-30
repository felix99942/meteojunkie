// Klima-Suchfenster: eine Frage in Alltagssprache, eine Antwort aus den
// vorhandenen Assets. Kostet KEINEN Request — Rekorde und Normale liegen als
// Dateien im Browser (siehe climateAsk.ts für die Frageerkennung).
//
// Leitgedanke der Darstellung: Das Fenster zeigt IMMER, was es verstanden hat,
// und zwar als änderbare Auswahl. „Salzburg" heißen acht Stationen und
// „Temperatur" kann Mittel, Maximum oder Minimum meinen — ein Fehlgriff soll
// einen Klick kosten und nicht eine falsche Zahl. Genau das ist der Grund,
// diese Auskunft NICHT von einem Sprachmodell formulieren zu lassen: das
// antwortet flüssig und verbirgt dabei, was es angenommen hat.

import { useEffect, useMemo, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import {
  loadNormals,
  loadStationRecords,
  type NormalsMap,
  type Season,
  type StationRecords,
} from '../api/atValues'
import { AT_NORMAL_PERIODS, type NormalPeriodId } from '../config/atNormals'
import { AT_PARAMETERS, getAtParameter } from '../config/atParameters'
import {
  answerFromNormals,
  answerFromRecords,
  parseQuestion,
  type AskQuery,
  type AskScope,
} from './climateAsk'

const MONTH_NAMES = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const SEASON_LABEL: Record<Season, string> = {
  DJF: 'Winter', MAM: 'Frühling', JJA: 'Sommer', SON: 'Herbst',
}
/** Normalperiode der Antworten — dieselbe Vorgabe wie in der Karte. */
const NORMAL_PERIOD: NormalPeriodId = '1991-2020'

const EXAMPLES = [
  'was war das tagesmaximum im juli seit messbeginn in salzburg?',
  'kälteste temperatur im jänner in innsbruck',
  'nassester sommer in villach',
  'wie warm ist es im juli in wien normalerweise',
]

/** Zeitraum als ein Auswahlwert: `-` = ganzes Jahr, `m6` = Juni, `sJJA` = Sommer. */
function periodValue(q: AskQuery): string {
  if (q.month != null) return `m${q.month}`
  if (q.season != null) return `s${q.season}`
  return '-'
}

export function AtAskBox({
  stations,
  onShow,
  onClose,
}: {
  stations: AtStation[]
  /** „In der Karte zeigen" — setzt Parameter, Zeitraum und Station. */
  onShow: (
    station: AtStation,
    paramCode: string,
    month: number | null,
    season: Season | null,
    /** Jahr des Rekords — ohne es zeigte die Karte den richtigen Monat im falschen Jahr. */
    year: number | null,
  ) => void
  onClose: () => void
}) {
  const [question, setQuestion] = useState('')
  // Was der Erkenner verstanden hat — und was der Nutzer davon überstimmt hat.
  // Die Overrides werden bei JEDER neuen Frage verworfen, sonst hinge eine
  // alte Korrektur still an der nächsten Frage.
  const [override, setOverride] = useState<Partial<AskQuery>>({})
  const [records, setRecords] = useState<StationRecords | null>(null)
  const [normals, setNormals] = useState<NormalsMap | null>(null)

  const parsed = useMemo(
    () => (question.trim() ? parseQuestion(question, stations) : null),
    [question, stations],
  )
  const query: AskQuery | null = parsed && { ...parsed, ...override }

  const stationId = query?.station?.id ?? null
  useEffect(() => {
    if (stationId == null) {
      setRecords(null)
      return
    }
    let cancelled = false
    loadStationRecords(stationId).then((r) => !cancelled && setRecords(r))
    return () => {
      cancelled = true
    }
  }, [stationId])

  useEffect(() => {
    if (query?.scope !== 'normal' || normals) return
    let cancelled = false
    loadNormals(NORMAL_PERIOD).then((n) => !cancelled && setNormals(n))
    return () => {
      cancelled = true
    }
  }, [query?.scope, normals])

  const periodLabel = AT_NORMAL_PERIODS.find((p) => p.id === NORMAL_PERIOD)?.label ?? NORMAL_PERIOD
  const answer =
    query && stationId != null
      ? query.scope === 'normal'
        ? answerFromNormals(query, normals?.[stationId]?.[query.param], periodLabel)
        : answerFromRecords(query, records?.[query.param])
      : null

  const station = stations.find((s) => s.id === stationId) ?? null
  const spec = query ? getAtParameter(query.param) : null
  // Rekorde und Normale gibt es nur für die vorgenerierten Parameter.
  const stationHasParam = query
    ? query.scope === 'normal'
      ? normals?.[stationId ?? -1]?.[query.param] != null
      : records?.[query.param] != null
    : false

  function set(patch: Partial<AskQuery>) {
    setOverride((o) => ({ ...o, ...patch }))
  }

  return (
    <div className="atask">
      <div className="atask-head">
        <span className="atask-title">Frage ans Klimaarchiv</span>
        <button type="button" className="atrank-close" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>

      <input
        className="atask-input"
        type="text"
        autoFocus
        value={question}
        placeholder="z. B. höchste temperatur im juli in salzburg"
        onChange={(e) => {
          setQuestion(e.target.value)
          setOverride({})
        }}
      />

      {!question.trim() && (
        <div className="atask-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setQuestion(ex); setOverride({}) }}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {query && (
        <>
          {/* Verstandene Frage als ÄNDERBARE Auswahl — nicht als Fließtext. */}
          <div className="atask-understood">
            <label>
              <span className="label-muted">Station</span>
              <select
                value={stationId ?? ''}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  const st = stations.find((s) => s.id === id)
                  set({ station: st ? { id: st.id, name: st.name, score: 1 } : null })
                }}
              >
                {stationId == null && <option value="">— keine erkannt —</option>}
                {[query.station, ...query.alternatives]
                  .filter((m): m is NonNullable<typeof m> => m != null)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                {/* Nicht erkannte Station von Hand: die volle Liste wäre hier
                    unbrauchbar lang — dafür gibt es die Rangliste mit Suche. */}
              </select>
            </label>
            <label>
              <span className="label-muted">Größe</span>
              <select value={query.param} onChange={(e) => set({ param: e.target.value })}>
                {AT_PARAMETERS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label-muted">Zeitraum</span>
              <select
                value={periodValue(query)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '-') set({ month: null, season: null })
                  else if (v.startsWith('m')) set({ month: Number(v.slice(1)), season: null })
                  else set({ month: null, season: v.slice(1) as Season })
                }}
              >
                <option value="-">ganzes Jahr</option>
                <optgroup label="Monat">
                  {MONTH_NAMES.map((n, i) => (
                    <option key={n} value={`m${i + 1}`}>
                      {n}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Jahreszeit">
                  {(Object.keys(SEASON_LABEL) as Season[]).map((s) => (
                    <option key={s} value={`s${s}`}>
                      {SEASON_LABEL[s]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label>
              <span className="label-muted">gesucht</span>
              <select
                value={query.scope === 'normal' ? 'normal' : query.extreme}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'normal') set({ scope: 'normal' as AskScope })
                  else set({ scope: 'record' as AskScope, extreme: v as 'max' | 'min' })
                }}
              >
                <option value="max">Höchstwert seit Messbeginn</option>
                <option value="min">Tiefstwert seit Messbeginn</option>
                <option value="normal">langjähriges Mittel</option>
              </select>
            </label>
          </div>

          <div className="atask-answer">
            {stationId == null && (
              <span className="label-muted">
                Keine Station erkannt — Ortsnamen dazuschreiben, oder über die Rangliste suchen.
              </span>
            )}
            {stationId != null && answer && (
              <>
                <div className="atask-value">
                  {answer.value.toFixed(1).replace('.', ',')} <span>{answer.unit}</span>
                </div>
                <div className="atask-what">
                  {answer.what}
                  {answer.when && <> · <strong>{answer.when}</strong></>}
                  {' · '}
                  {station?.name}
                </div>
              </>
            )}
            {stationId != null && !answer && stationHasParam === false && spec && (
              <span className="label-muted">
                Für „{spec.label}" gibt es an dieser Station keine vorberechneten{' '}
                {query.scope === 'normal' ? 'Normale' : 'Rekorde'}.
              </span>
            )}
            {stationId != null && !answer && stationHasParam && (
              <span className="label-muted">Für diesen Zeitraum liegt kein Wert vor.</span>
            )}
          </div>

          {/* Eine Jahreszahl beantwortet das Archiv nicht — die Karte schon. */}
          {query.year != null && (
            <div className="atask-note label-muted">
              Für ein einzelnes Jahr ({query.year}) hat das Archiv keinen Wert — dafür in der Karte
              den Zeitbezug auf {query.year} stellen.
            </div>
          )}

          {station && (
            <button
              type="button"
              className="atask-show"
              onClick={() =>
                onShow(
                  station,
                  query.param,
                  query.month ?? answer?.recordMonth ?? null,
                  query.season,
                  answer?.year ?? null,
                )
              }
            >
              In der Karte zeigen
            </button>
          )}
        </>
      )}
    </div>
  )
}
