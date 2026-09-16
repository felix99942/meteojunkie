// Klima-Suchfenster: eine Frage in Alltagssprache, eine Antwort aus den
// vorhandenen Assets. Kostet KEINEN Request — Rekorde und Normale liegen als
// Dateien im Browser (siehe climateAsk.ts für die Frageerkennung).
//
// Gefragt werden kann nach EINER Station oder nach GANZ ÖSTERREICH. Der
// Landesfall ist kein Sonderweg: `_national.json` hat dieselbe Form wie eine
// Stationsdatei, nur trägt dort jeder Rekord die Station, die ihn hält — die
// wird dann Teil der Antwort. Nur beim langjährigen MITTEL gibt es
// österreichweit bewusst keine eine Zahl (siehe `answerFromNormalsRange`).
//
// Dazwischen liegt der ORT: „höchste Temperatur in Wien" ist keine Frage an die
// Hohe Warte, sondern an Wien — beantwortet über ALLE Stationen des Ortes,
// zusammengeführt von `mergeRecords`, mit der Station als Teil der Antwort.
//
// Leitgedanke der Darstellung: Das Fenster zeigt IMMER, was es verstanden hat,
// und zwar als änderbare Auswahl. „Salzburg" heißen acht Stationen und
// „Temperatur" kann Mittel, Maximum oder Minimum meinen — ein Fehlgriff soll
// einen Klick kosten und nicht eine falsche Zahl. Genau das ist der Grund,
// diese Auskunft NICHT von einem Sprachmodell formulieren zu lassen: das
// antwortet flüssig und verbirgt dabei, was es angenommen hat.

import { useEffect, useMemo, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import { resolveExtremeDay, type ExtremeDay } from '../api/atRecords'
import {
  loadNationalRecords,
  loadNormals,
  loadStationRecords,
  type NationalRecords,
  type NormalsMap,
  type Season,
  type StationRecords,
} from '../api/atValues'
import { AT_NORMAL_PERIODS, type NormalPeriodId } from '../config/atNormals'
import { AT_PARAMETERS, getAtParameter } from '../config/atParameters'
import {
  answerFromNormals,
  answerFromNormalsRange,
  answerFromRecords,
  mergeRecords,
  parseQuestion,
  type AskArea,
  type AskQuery,
  type AskScope,
  askDayRange,
  formatNightSpan,
  directionDerivable,
  directionNote,
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
  'höchste je gemessene temperatur in österreich',
  'höchste temperatur in wien',
  'kälteste temperatur im jänner in innsbruck',
  // Die NACHT ist eine eigene Größe (tiefstes Tagesminimum), nicht der
  // kälteste Tag — und die Antwort nennt das exakte Datum.
  'kälteste nacht in salzburg',
  'nassester sommer in villach',
  'höchster jahresniederschlag in salzburg',
  'meiste hitzetage österreichweit',
  'wie warm ist es im juli in wien normalerweise',
]

/**
 * Zeitraum als ein Auswahlwert: `-` = bester Einzelmonat, `y` = Jahreswert,
 * `m6` = Juni, `sJJA` = Sommer. Die ersten beiden auseinanderzuhalten ist der
 * Punkt: „nassester Monat" und „nassestes Jahr" sind zwei Rekorde.
 */
function periodValue(q: AskQuery): string {
  if (q.month != null) return `m${q.month}`
  if (q.season != null) return `s${q.season}`
  return q.annual ? 'y' : '-'
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
  const [national, setNational] = useState<NationalRecords | null>(null)
  const [normals, setNormals] = useState<NormalsMap | null>(null)

  const parsed = useMemo(
    () => (question.trim() ? parseQuestion(question, stations) : null),
    [question, stations],
  )
  const query: AskQuery | null = parsed && { ...parsed, ...override }

  const area: AskArea = query?.area ?? 'austria'
  const nameById = (id: number) => stations.find((s) => s.id === id)?.name ?? String(id)
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

  // Rekorde ALLER Stationen des Ortes. Es sind kleine Dateien (~10 KB), sie
  // liegen same-origin und werden modulweit gecacht — ein Ort kostet also
  // einmalig ein Dutzend statische Abrufe und danach nichts mehr.
  const placeKey = query?.place?.ids.join(',') ?? ''
  const [placeRecords, setPlaceRecords] = useState<StationRecords | null>(null)
  useEffect(() => {
    if (!placeKey) {
      setPlaceRecords(null)
      return
    }
    let cancelled = false
    const ids = placeKey.split(',').map(Number)
    Promise.all(ids.map((id) => loadStationRecords(id).then((rec) => ({ id, rec })))).then((all) => {
      if (cancelled) return
      // Nach Code umsortieren: `mergeRecords` arbeitet je Parameter, die
      // Assets liegen je Station vor.
      const codes = new Set(all.flatMap((x) => Object.keys(x.rec ?? {})))
      const merged: StationRecords = {}
      for (const code of codes) {
        const m = mergeRecords(
          all.map((x) => ({ id: x.id, name: nameById(x.id), rec: x.rec?.[code] })),
        )
        if (m) merged[code] = m
      }
      setPlaceRecords(merged)
    })
    return () => {
      cancelled = true
    }
    // nameById hängt nur an `stations` und ist für den Effekt stabil genug
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey])

  // Die nationalen Rekorde sind EINE kleine Datei für alle Parameter und
  // Ebenen — sobald eine Landesfrage im Raum steht, einmal laden.
  useEffect(() => {
    if (area !== 'austria' || national) return
    let cancelled = false
    loadNationalRecords()
      .then((n) => !cancelled && setNational(n))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [area, national])

  useEffect(() => {
    if (query?.scope !== 'normal' || normals) return
    let cancelled = false
    loadNormals(NORMAL_PERIOD).then((n) => !cancelled && setNormals(n))
    return () => {
      cancelled = true
    }
  }, [query?.scope, normals])

  const periodLabel = AT_NORMAL_PERIODS.find((p) => p.id === NORMAL_PERIOD)?.label ?? NORMAL_PERIOD
  // Rekorde und Normale sind nach dem MONATScode abgelegt, die Frage nennt den
  // Registry-Code — bei fast allen Parametern derselbe, aber nicht bei der
  // relativen Feuchte (`rfb_mittel` im Tagesdatensatz, `rf_mittel` im
  // Monatsdatensatz). Ohne die Übersetzung fand die Suche dort nichts und
  // meldete „keine Rekorde", obwohl die Assets sie führen.
  const assetCode = query ? (getAtParameter(query.param).monthlyCode ?? query.param) : null
  const stationName = nameById
  const answer =
    !query || !assetCode
      ? null
      : query.area === 'austria'
        ? query.scope === 'normal'
          ? answerFromNormalsRange(query, normals, assetCode, stationName, periodLabel)
          : answerFromRecords(query, national?.[assetCode])
        : query.area === 'place' && query.place
          ? query.scope === 'normal'
            ? answerFromNormalsRange(
                query,
                normals,
                assetCode,
                stationName,
                periodLabel,
                query.place.ids,
              )
            : answerFromRecords(query, placeRecords?.[assetCode])
          : stationId != null
            ? query.scope === 'normal'
              ? answerFromNormals(query, normals?.[stationId]?.[assetCode], periodLabel)
              : answerFromRecords(query, records?.[assetCode])
            : null

  const station = stations.find((s) => s.id === stationId) ?? null
  const spec = query ? getAtParameter(query.param) : null
  // Rekorde und Normale gibt es nur für die vorgenerierten Parameter.
  const hasParam = query && assetCode
    ? query.area === 'austria'
      ? query.scope === 'normal'
        ? normals != null
        : national?.[assetCode] != null
      : query.area === 'place'
        ? query.scope === 'normal'
          ? normals != null
          : placeRecords?.[assetCode] != null
        : query.scope === 'normal'
          ? normals?.[stationId ?? -1]?.[assetCode] != null
          : records?.[assetCode] != null
    : false
  /** Die Frage ist beantwortbar, sobald ein Gebiet feststeht. */
  const areaResolved =
    query != null && (query.area === 'austria' || query.area === 'place' || stationId != null)
  /** Zielstation für „In der Karte zeigen" — beim Landesrekord die, die ihn hält. */
  const showStation =
    (answer?.whereId != null ? stations.find((s) => s.id === answer.whereId) : null) ?? station

  /**
   * EXAKTER Rekordtag, nachgeladen.
   *
   * Die Assets kennen nur Monat und Jahr („Jänner 1940"). Bei `tlmax`/`tlmin`
   * ist der Monatswert aber ein Tagesextrem — der genaue Tag steht in der
   * Tagesreihe und kostet EINEN Request, der für immer gecacht wird. „Das
   * kälteste war der Jänner 1940" ist die halbe Antwort; gefragt ist die
   * kälteste NACHT, und die hat ein Datum.
   *
   * Bei Summen und Mitteln gibt es keinen Rekordtag (ein Monatsniederschlag
   * fällt nicht an einem Tag) — `resolveExtremeDay` lehnt solche Codes ohne
   * Request ab, deshalb braucht es hier keine zweite Whitelist.
   */
  const [recordDay, setRecordDay] = useState<ExtremeDay | null>(null)
  /**
   * Was aufzulösen ist, als SCHLÜSSEL aus Primitiven — nicht als Objekt.
   *
   * `query` wird bei jedem Render neu gebaut (Zeile 113: `{...parsed,
   * ...override}`), ein Effekt mit `query` in den Abhängigkeiten liefe also
   * jede Runde erneut: `setRecordDay(null)` → Render → Effekt → … eine
   * Endlosschleife, die der Linter zu Recht angemahnt hat. Ein String aus den
   * Primitiven ist über Renderrunden hinweg stabil, solange sich inhaltlich
   * nichts ändert — dasselbe Muster wie `dataKey` in `VerifyPanel`.
   */
  const dayTarget = (() => {
    if (!query || !answer || answer.year == null) return null
    const id = answer.whereId ?? showStation?.id
    if (id == null) return null
    const range = askDayRange(query, answer)
    if (!range) return null
    return { code: query.param, id, start: range.start, end: range.end, value: answer.value }
  })()
  const dayKey = dayTarget
    ? `${dayTarget.code}|${dayTarget.id}|${dayTarget.start}|${dayTarget.end}|${dayTarget.value}`
    : null
  useEffect(() => {
    setRecordDay(null)
    if (!dayTarget) return
    let alive = true
    void resolveExtremeDay(
      dayTarget.code,
      dayTarget.id,
      dayTarget.start,
      dayTarget.end,
      dayTarget.value,
    ).then((d) => {
      // Überholte Antwort verwerfen: beim Weitertippen kommt die langsamere
      // ältere sonst nach der neueren an (dieselbe Falle wie in der Ortssuche).
      if (alive) setRecordDay(d)
    })
    return () => {
      alive = false
    }
    // Absichtlich nur der Schlüssel: `dayTarget` ist jede Renderrunde ein
    // neues Objekt, sein INHALT steht vollständig in `dayKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])

  /**
   * „12. Jänner 1940" statt „Jänner 1940" — bei einer NACHTfrage dagegen als
   * Spanne über zwei Daten: eine Nacht gehört zu zwei Kalendertagen, und der
   * aufgelöste Tag ist der Klimatag, in dessen Fenster (19–19 MEZ) die Nacht
   * DAVOR liegt.
   */
  const exactWhen = useMemo(() => {
    if (!recordDay) return null
    if (query?.nightly && query.param === 'tlmin') return formatNightSpan(recordDay.day)
    return new Intl.DateTimeFormat('de-AT', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${recordDay.day}T12:00:00Z`))
  }, [recordDay, query?.nightly, query?.param])

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
            {/* Gebiet und Station sind EIN Gedanke, deshalb nebeneinander: die
                Stationsauswahl schaltet zugleich auf „Station" um. Ohne das
                müsste man erst das Gebiet umstellen, bevor die Station
                überhaupt wirkt — ein Klick zu viel für den häufigsten Fall. */}
            <label>
              <span className="label-muted">Gebiet</span>
              <select value={query.area} onChange={(e) => set({ area: e.target.value as AskArea })}>
                <option value="austria">Österreich (alle Stationen)</option>
                {/* Der Ort steht nur da, wenn sein Name mehr als eine Station
                    trägt — sonst wäre er dasselbe wie „einzelne Station". */}
                {query.place && (
                  <option value="place">
                    {query.place.label} ({query.place.ids.length} Stationen)
                  </option>
                )}
                <option value="station" disabled={stationId == null}>
                  {stationId == null ? 'einzelne Station — keine erkannt' : 'einzelne Station'}
                </option>
              </select>
            </label>
            <label>
              <span className="label-muted">Station</span>
              <select
                value={stationId ?? ''}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  const st = stations.find((s) => s.id === id)
                  set({
                    station: st ? { id: st.id, name: st.name, score: 1 } : null,
                    // Eine Station zu wählen IST die Ansage, sie zu meinen —
                    // auch wenn der Ort gerade als Ganzes gefragt war.
                    area: st ? 'station' : query.area,
                  })
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
                  if (v === '-') set({ month: null, season: null, annual: false })
                  else if (v === 'y') set({ month: null, season: null, annual: true })
                  else if (v.startsWith('m')) set({ month: Number(v.slice(1)), season: null, annual: false })
                  else set({ month: null, season: v.slice(1) as Season, annual: false })
                }}
              >
                {/* „ganzes Jahr" hieß früher BEIDES und meinte den besten
                    Einzelmonat — bei Summen ist das um eine Größenordnung
                    daneben. Jetzt stehen die zwei Ebenen getrennt da. */}
                <option value="-">bester Einzelmonat (ganze Reihe)</option>
                <option value="y">Jahreswert (ganze Reihe)</option>
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
                value={
                  query.scope !== 'normal'
                    ? query.extreme
                    : // Bei einer Station gibt es nur DAS eine Mittel — die
                      // Richtung wäre dort ohne Bedeutung und ließe die
                      // Auswahl leer, wenn sie gerade auf „min" stünde.
                      query.area === 'austria'
                      ? `normal:${query.extreme}`
                      : 'normal:max'
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v.startsWith('normal:')) {
                    set({ scope: 'normal' as AskScope, extreme: v.slice(7) as 'max' | 'min' })
                  } else {
                    set({ scope: 'record' as AskScope, extreme: v as 'max' | 'min' })
                  }
                }}
              >
                <option value="max">Höchstwert seit Messbeginn</option>
                <option value="min">Tiefstwert seit Messbeginn</option>
                {/* Österreichweit ist ein langjähriges Mittel KEINE einzelne
                    Zahl (kein Flächenmittel aus Stationswerten) — gefragt wird
                    deshalb nach dem oberen oder unteren Ende der Spanne, und
                    das muss man auch umschalten können. Bei einer Station
                    bleibt es das eine Mittel dieser Station. */}
                {query.area === 'austria' ? (
                  <>
                    <option value="normal:max">langjähriges Mittel — höchste Station</option>
                    <option value="normal:min">langjähriges Mittel — tiefste Station</option>
                  </>
                ) : (
                  <option value="normal:max">langjähriges Mittel</option>
                )}
              </select>
            </label>
          </div>

          <div className="atask-answer">
            {!areaResolved && (
              <span className="label-muted">
                Keine Station erkannt — Ortsnamen dazuschreiben, oder über die Rangliste suchen.
              </span>
            )}
            {areaResolved && answer && (
              <>
                <div className="atask-value">
                  {answer.value.toFixed(1).replace('.', ',')} <span>{answer.unit}</span>
                </div>
                <div className="atask-what">
                  {answer.what}
                  {(exactWhen ?? answer.when) && (
                    <>
                      {' · '}
                      <strong>{exactWhen ?? answer.when}</strong>
                      {/* Derselbe Wert an mehreren Tagen: dann ist das
                          gezeigte Datum das ERSTE Auftreten, und das gehört
                          dazugesagt statt es als einzigen Tag auszugeben. */}
                      {recordDay && recordDay.ties > 1 && (
                        <span
                          className="label-muted"
                          title={`Der Wert wurde im Zeitraum an ${recordDay.ties} Tagen erreicht — gezeigt ist der erste.`}
                        >
                          {' '}
                          (erstmals)
                        </span>
                      )}
                    </>
                  )}
                  {' · '}
                  {/* Beim Landeswert ist die Station Teil der ANTWORT, bei der
                      Stationsfrage stand sie schon in der Frage. */}
                  {answer.where ?? station?.name}
                </div>
                {answer.note && <div className="atask-note label-muted">{answer.note}</div>}
              </>
            )}
            {/* GEGENRICHTUNG einer Extremgröße: das Archiv hätte hier eine
                Zahl, aber sie beantwortet eine andere Frage („wärmste Nacht"
                → höchster Monats-Tiefstwert). Statt der falschen Zahl die
                Erklärung — „keine Daten" wäre hier ebenfalls unzutreffend. */}
            {areaResolved && !answer && spec && query && !directionDerivable(spec, query.extreme) && (
              <span className="atask-note label-muted">
                {directionNote(spec, query.extreme, query.nightly)}
              </span>
            )}
            {areaResolved &&
              !answer &&
              hasParam === false &&
              spec &&
              directionDerivable(spec, query.extreme) && (
              <span className="label-muted">
                Für „{spec.label}" gibt es{' '}
                {query.area === 'station' ? 'an dieser Station keine' : 'keine'} vorberechneten{' '}
                {query.scope === 'normal' ? 'Normale' : 'Rekorde'}.
              </span>
            )}
            {areaResolved && !answer && hasParam && directionDerivable(spec!, query.extreme) && (
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

          {showStation && (
            <button
              type="button"
              className="atask-show"
              onClick={() =>
                onShow(
                  showStation,
                  query.param,
                  query.month ?? answer?.recordMonth ?? null,
                  query.season,
                  answer?.year ?? null,
                )
              }
            >
              {/* Beim Landesrekord springt die Karte auf die Station, die ihn
                  hält — sonst zeigte sie den richtigen Zeitraum ohne den Ort,
                  um den es in der Antwort ging. */}
              In der Karte zeigen
              {answer?.where && query.area !== 'station' ? ` (${answer.where})` : ''}
            </button>
          )}
        </>
      )}
    </div>
  )
}
