// Klima-Suchfenster: eine Frage in Alltagssprache, eine Antwort aus den
// vorhandenen Assets. Rekorde und Normale liegen als Dateien im Browser, diese
// Fragen kosten also keinen Request (siehe climateAsk.ts für die
// Frageerkennung). Die Ausnahme ist die WERTfrage nach einem benannten
// Zeitraum („Frosttage im Jänner 2024"): sie kostet EINEN Bulk-Abruf, der
// danach im selben IndexedDB-Cache liegt wie die Karte.
//
// Gefragt werden kann nach EINER Station, einem ORT, einem BUNDESLAND oder
// GANZ ÖSTERREICH. Der Landesfall ist kein Sonderweg: `_national.json` hat
// dieselbe Form wie eine Stationsdatei, nur trägt dort jeder Rekord die
// Station, die ihn hält — die wird dann Teil der Antwort. Nur beim
// langjährigen MITTEL gibt es österreichweit bewusst keine eine Zahl (siehe
// `answerFromNormalsRange`); dasselbe gilt für einen Periodenwert über eine
// Stationsmenge (`answerFromPeriod`).
//
// Dazwischen liegen ORT und BUNDESLAND: „höchste Temperatur in Wien" ist keine
// Frage an die Hohe Warte, sondern an Wien — beantwortet über ALLE Stationen
// des Gebiets, zusammengeführt von `mergeRecords`, mit der Station als Teil
// der Antwort.
//
// Leitgedanke der Darstellung: Das Fenster zeigt IMMER, was es verstanden hat,
// und zwar als änderbare Auswahl. „Salzburg" heißen acht Stationen und
// „Temperatur" kann Mittel, Maximum oder Minimum meinen — ein Fehlgriff soll
// einen Klick kosten und nicht eine falsche Zahl. Genau das ist der Grund,
// diese Auskunft NICHT von einem Sprachmodell formulieren zu lassen: das
// antwortet flüssig und verbirgt dabei, was es angenommen hat.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AtStation } from '../api/geosphere'
import { resolveExtremeDay, type ExtremeDay } from '../api/atRecords'
import {
  fetchPeriodValues,
  isParamAvailable,
  loadNationalRecords,
  loadNormals,
  loadRecordIndex,
  loadStationRecords,
  recordDayLevel,
  recordLevel,
  type NationalRecords,
  type NormalsMap,
  type PeriodValues,
  type Season,
  type StationRecords,
} from '../api/atValues'
import { AT_NORMAL_PERIODS, type NormalPeriodId } from '../config/atNormals'
import { fetchDePeriodValues, loadDeNormals } from '../api/deClimate'
import { AT_PARAMETERS, getAtParameter } from '../config/atParameters'
import {
  answerFromNormals,
  answerFromNormalsRange,
  answerFromPeriod,
  answerFromRecords,
  askValuePeriod,
  mergeRecords,
  parseQuestion,
  ASK_AT,
  ASK_DE,
  type AskArea,
  type AskQuery,
  type AskScope,
  askDayRange,
  formatNightSpan,
  matchesTerrain,
  MOUNTAIN_M,
  type AskTerrain,
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

/**
 * Die neun Bundesländer, geschrieben wie `AtStation.state` sie führt — die
 * Auswahl filtert darauf, der Text ist also kein Etikett, sondern der
 * Schlüssel. Fest verdrahtet und nicht aus den Stationen abgeleitet: die Liste
 * ist abgeschlossen und soll auch dann vollständig dastehen, wenn ein
 * Bundesland gerade keine Station mit Wert hat.
 */
const STATES = {
  at: ['Burgenland', 'Kärnten', 'Niederösterreich', 'Oberösterreich', 'Salzburg',
    'Steiermark', 'Tirol', 'Vorarlberg', 'Wien'],
  de: [...new Set(Object.values(ASK_DE.states))].sort((a, b) => a.localeCompare(b, 'de')),
}

/**
 * Beispielfragen, nach EBENEN geordnet — die Liste ist auch eine Landkarte
 * dessen, was der Erkenner auseinanderhält. Bewusst nebeneinander: Tag,
 * Nacht, Monat, Saison und Jahr derselben Größe sind fünf verschiedene
 * Antworten, und beim Niederschlag liegen sie um Größenordnungen auseinander
 * (Salzburg: 135 mm an einem Tag, 404 mm im nassesten Monat, 1.835 mm im
 * nassesten Jahr). Wer das nicht weiß, hält die erste Zahl für die Antwort.
 */
const EXAMPLES = [
  'was war das tagesmaximum im juli seit messbeginn in salzburg?',
  'höchste je gemessene temperatur in österreich',
  'höchste temperatur in wien',
  'kälteste temperatur im jänner in innsbruck',
  // Die NACHT ist eine eigene Größe (Tagesminimum), nicht der kälteste Tag —
  // und die Antwort nennt Datum und Nachtspanne.
  'kälteste nacht in salzburg',
  // Die WÄRMSTE Nacht ist die Gegenrichtung derselben Größe und war aus dem
  // Monatsarchiv gar nicht beantwortbar (sie kam auf den höchsten
  // Monats-Tiefstwert). Wien ist dafür der interessante Ort: Tropennächte.
  'wärmste nacht in wien',
  // Symmetrisch dazu, und vorher still falsch (tiefster Monats-Höchstwert).
  'kältester tag in innsbruck',
  // Der einzelne TAG als eigene Ebene: vorher antwortete das mit der
  // Monatssumme — 404 mm statt 135 mm.
  'höchster tagesniederschlag in salzburg',
  'nassester sommer in villach',
  'höchster jahresniederschlag in salzburg',
  'meiste hitzetage österreichweit',
  'wie warm ist es im juli in wien normalerweise',
  // WERTfragen: ein benannter Zeitraum statt eines Rekords. Sie kosten als
  // einzige einen Abruf — und beantworten die Frage, die man beim Blick auf
  // eine Kenntage-Karte als Nächstes hat.
  'anzahl der frosttage in innsbruck im jänner 2024',
  'hitzetage in der steiermark im jahr 2024',
  'niederschlag im sommer 2024 in vorarlberg',
]

/** Dieselben Ebenen für Deutschland — Orte, die mehrere Stationen tragen (Berlin, München). */
const EXAMPLES_DE = [
  'höchste je gemessene temperatur in deutschland',
  'höchste temperatur in berlin',
  'kälteste nacht in münchen',
  'wärmste nacht in hamburg',
  'höchster tagesniederschlag in sachsen',
  'nassestes jahr in bayern',
  'meiste hitzetage deutschlandweit',
  'wie warm ist es im juli in frankfurt normalerweise',
  'anzahl der frosttage in münchen im januar 2024',
]

/**
 * Zeitraum als ein Auswahlwert: `-` = bester Einzelmonat, `y` = Jahreswert,
 * `m6` = Juni, `sJJA` = Sommer. Die ersten beiden auseinanderzuhalten ist der
 * Punkt: „nassester Monat" und „nassestes Jahr" sind zwei Rekorde.
 */
function periodValue(q: AskQuery): string {
  if (q.month != null) return `m${q.month}`
  if (q.season != null) return `s${q.season}`
  // Bei einer WERTfrage gibt es keine „ganze Reihe": nennt sie weder Monat
  // noch Jahreszeit, ist das genannte JAHR gemeint.
  return q.annual || q.scope === 'value' ? 'y' : '-'
}

/**
 * Vorgabejahr, wenn von Hand auf „gemessener Wert" umgeschaltet wird: das
 * letzte ABGESCHLOSSENE Jahr. Das laufende wäre eine Teilsumme und sähe bei
 * Kenntagen und Niederschlag wie ein Rekordtief aus.
 */
const defaultValueYear = () => new Date().getUTCFullYear() - 1

export function AtAskBox({
  stations,
  country = 'at',
  initial,
  onShow,
  onClose,
}: {
  stations: AtStation[]
  /**
   * Land des Archivs: bestimmt Bundesländer und Landeswörter des Parsers
   * (`AskCountry`), die Rekord-Assets (`at/` bzw. `de/records`) und woher
   * Normale und Zeitraumwerte kommen (GeoSphere bzw. die DWD-Dateien).
   */
  country?: 'at' | 'de'
  /**
   * Was schon im Einstiegsfeld der Karte stand, als das Fenster aufging. Das
   * Feld dort ist ein echtes Suchfeld: wer lostippt, soll seine Zeichen
   * wiederfinden und weiterschreiben können, statt sie an einen Knopf zu
   * verlieren.
   */
  initial?: string
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
  const [question, setQuestion] = useState(initial ?? '')
  const loc = country === 'de' ? ASK_DE : ASK_AT
  /**
   * Sprache des Landes in ANGEZEIGTEN Texten. Der Parser und die Antworttexte
   * schreiben österreichisch („Jänner"); für Deutschland wird das hier beim
   * Anzeigen gewechselt, statt jede Formatierungsfunktion um ein Land zu
   * erweitern — die Funktionen ohne Frage-Objekt (Datumsformate) kennten es
   * gar nicht. Einziger Unterschied ist der Januar.
   */
  const L = (t: string) => (country === 'de' ? t.replace(/Jänner/g, 'Januar') : t)
  // Was der Erkenner verstanden hat — und was der Nutzer davon überstimmt hat.
  // Die Overrides werden bei JEDER neuen Frage verworfen, sonst hinge eine
  // alte Korrektur still an der nächsten Frage.
  const [override, setOverride] = useState<Partial<AskQuery>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const [records, setRecords] = useState<StationRecords | null>(null)
  const [national, setNational] = useState<NationalRecords | null>(null)
  const [normals, setNormals] = useState<NormalsMap | null>(null)

  // Fokus beim Öffnen — und zwar mit dem Cursor HINTER dem mitgebrachten Text.
  // `autoFocus` allein reichte, solange das Feld immer leer aufging; mit einem
  // ersten Zeichen aus dem Einstiegsfeld stünde der Cursor je nach Browser
  // davor, und der zweite Buchstabe landete vor dem ersten.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const parsed = useMemo(
    () => (question.trim() ? parseQuestion(question, stations, loc) : null),
    [question, stations, loc],
  )
  const query: AskQuery | null = parsed && { ...parsed, ...override }

  const area: AskArea = query?.area ?? 'country'
  const nameById = (id: number) => stations.find((s) => s.id === id)?.name ?? String(id)
  const stationId = query?.station?.id ?? null
  useEffect(() => {
    if (stationId == null) {
      setRecords(null)
      return
    }
    let cancelled = false
    loadStationRecords(stationId, country).then((r) => !cancelled && setRecords(r))
    return () => {
      cancelled = true
    }
  }, [stationId, country])

  const station = stations.find((s) => s.id === stationId) ?? null
  const spec = query ? getAtParameter(query.param) : null

  /**
   * Die Stationen, über die geantwortet wird. EINE Liste für alle vier
   * Gebiete — Station, Ort, Bundesland, Österreich unterscheiden sich nur
   * darin, welche Stationen sie umfassen, nicht darin, was mit ihnen
   * geschieht.
   */
  const inTerrain = (id: number) =>
    !query ||
    query.area === 'station' ||
    matchesTerrain(stations.find((s) => s.id === id)?.altitude, query.terrain)
  const areaIds: number[] = (
    !query
      ? []
      : query.area === 'station'
        ? stationId != null
          ? [stationId]
          : []
        : query.area === 'place'
          ? (query.place?.ids ?? [])
          : query.area === 'state'
            ? stations.filter((s) => s.state === query.state).map((s) => s.id)
            : stations.map((s) => s.id)
  ).filter(inTerrain)
  /**
   * Wie viele Stationen jede Lage im gewählten Gebiet hat — die Zahl gehört
   * in die Auswahl: „ohne Bergstationen" über drei Stationen ist eine andere
   * Aussage als über vierhundertsiebzig.
   */
  const areaCount = (() => {
    const base = !query
      ? []
      : query.area === 'place'
        ? (query.place?.ids ?? [])
        : query.area === 'state'
          ? stations.filter((s) => s.state === query.state).map((s) => s.id)
          : stations.map((s) => s.id)
    const alt = (id: number) => stations.find((s) => s.id === id)?.altitude
    return {
      all: base.length,
      high: base.filter((id) => matchesTerrain(alt(id), 'high')).length,
      low: base.filter((id) => matchesTerrain(alt(id), 'low')).length,
    }
  })()

  /** Wie das Gebiet im Antworttext heißt. */
  const baseAreaLabel = !query
    ? ''
    : query.area === 'station'
      ? (station?.name ?? '')
      : query.area === 'place'
        ? (query.place?.label ?? '')
        : query.area === 'state'
          ? (query.state ?? '')
          : loc.name
  /**
   * Der Höhenfilter gehört in den Antworttext. „Meiste Eistage in
   * Österreich: 112 Tage" wäre sonst schlicht falsch — es sind 292 am
   * Sonnblick, 112 ist die Zahl OHNE die Bergstationen.
   */
  const areaLabel =
    !query || query.terrain === 'all' || query.area === 'station'
      ? baseAreaLabel
      : query.terrain === 'high'
        ? `${baseAreaLabel}, nur Bergstationen`
        : `${baseAreaLabel}, ohne Bergstationen`

  // Rekorde ALLER Stationen einer MENGE — eines Ortes oder eines Bundeslands.
  // Es sind kleine Dateien (~13 KB), sie liegen same-origin und werden
  // modulweit gecacht; ein Ort kostet also einmalig ein Dutzend statische
  // Abrufe und danach nichts mehr. Ein Bundesland kostet entsprechend mehr
  // (Niederösterreich 117) — deshalb NUR im Rekordfall: Werte und Normale
  // kommen aus einer einzigen Datei bzw. einem einzigen Abruf, dafür braucht
  // es die Stationsdateien nicht.
  const setKey =
    query && query.scope === 'record' && (query.area === 'place' || query.area === 'state')
      ? areaIds.join(',')
      : ''
  const [areaRecords, setAreaRecords] = useState<StationRecords | null>(null)
  useEffect(() => {
    if (!setKey) {
      setAreaRecords(null)
      return
    }
    let cancelled = false
    const ids = setKey.split(',').map(Number)
    Promise.all(ids.map((id) => loadStationRecords(id, country).then((rec) => ({ id, rec })))).then((all) => {
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
      setAreaRecords(merged)
    })
    return () => {
      cancelled = true
    }
    // nameById hängt nur an `stations` und ist für den Effekt stabil genug
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey])

  // Die nationalen Rekorde sind EINE kleine Datei für alle Parameter und
  // Ebenen — sobald eine Landesfrage im Raum steht, einmal laden.
  useEffect(() => {
    if (area !== 'country' || national) return
    let cancelled = false
    loadNationalRecords(country)
      .then((n) => !cancelled && setNational(n))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [area, national, country])

  useEffect(() => {
    if (query?.scope !== 'normal' || normals) return
    let cancelled = false
    ;(country === 'de' ? loadDeNormals(NORMAL_PERIOD) : loadNormals(NORMAL_PERIOD)).then(
      (n) => !cancelled && setNormals(n),
    )
    return () => {
      cancelled = true
    }
  }, [query?.scope, normals, country])

  /**
   * WERTfrage: der gemessene Wert eines benannten Zeitraums („Frosttage im
   * Jänner 2024"). Der einzige Pfad dieses Fensters, der nicht aus einem
   * vorberechneten Asset kommt — er kostet EINEN Bulk-Abruf über ALLE
   * Stationen, der für immer im IndexedDB-Cache liegt (historische Klimadaten
   * ändern sich nicht) und denselben Schlüssel benutzt wie die Karte: wer den
   * Zeitraum dort schon angesehen hat, zahlt hier gar nichts.
   *
   * Geholt wird bewusst über ALLE Stationen statt nur über das Gebiet: das
   * ist derselbe Request, den die Karte stellt, und ein auf ein Bundesland
   * zugeschnittener wäre ein zweiter Cache-Eintrag für dieselben Daten.
   */
  const valuePeriod = query ? askValuePeriod(query) : null
  const valueKey =
    valuePeriod && query && spec && isParamAvailable(spec, valuePeriod)
      ? `${query.param}|${JSON.stringify(valuePeriod)}`
      : null
  const [periodVals, setPeriodVals] = useState<PeriodValues | null>(null)
  const [valueBusy, setValueBusy] = useState(false)
  useEffect(() => {
    setPeriodVals(null)
    if (!valueKey || !valuePeriod || !spec) return
    let cancelled = false
    setValueBusy(true)
    ;(country === 'de' ? fetchDePeriodValues(spec, valuePeriod, stations) : fetchPeriodValues(spec, valuePeriod, stations))
      .then((v) => !cancelled && setPeriodVals(v))
      .catch(() => {})
      .finally(() => !cancelled && setValueBusy(false))
    return () => {
      cancelled = true
    }
    // Absichtlich nur der Schlüssel: `valuePeriod` und `spec` sind jede
    // Renderrunde neue Objekte, ihr INHALT steht vollständig in `valueKey`
    // (dasselbe Muster wie `dayKey` weiter unten).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey, stations])

  const periodLabel = AT_NORMAL_PERIODS.find((p) => p.id === NORMAL_PERIOD)?.label ?? NORMAL_PERIOD
  // Rekorde und Normale sind nach dem MONATScode abgelegt, die Frage nennt den
  // Registry-Code — bei fast allen Parametern derselbe, aber nicht bei der
  // relativen Feuchte (`rfb_mittel` im Tagesdatensatz, `rf_mittel` im
  // Monatsdatensatz). Ohne die Übersetzung fand die Suche dort nichts und
  // meldete „keine Rekorde", obwohl die Assets sie führen.
  const assetCode = query ? (getAtParameter(query.param).monthlyCode ?? query.param) : null
  const stationName = nameById

  /**
   * REKORD über eine GEFILTERTE Landesmenge — der einzige Fall, der weder
   * über `_national.json` noch über die Stationsdateien geht.
   *
   * `_national.json` ist über ALLE Stationen vorgerechnet, ein Höhenfilter
   * lässt sich daraus nicht herausrechnen; die Stationsdateien einzeln zu
   * holen wären bei „ohne Bergstationen" rund 470 Dateien. Beides scheidet
   * aus. Genommen wird deshalb der KARTEN-INDEX (`_map-<code>.json`, eine
   * Datei mit einer Größe über alle Stationen, 46–175 KB): daraus den
   * Gewinner unter den erlaubten Stationen bestimmen und NUR DESSEN
   * Stationsdatei nachladen — zwei Abrufe statt Hunderten, und die Antwort
   * bekommt dadurch Datum und alle Ebenen wie sonst auch.
   *
   * Die Grenze des Verfahrens: der Index kennt den TAGESblock nicht. Wo die
   * Antwort von dort käme (Gegenrichtung einer Extremgröße, ausdrückliche
   * Tagesfrage), ist der gefilterte Landesrekord nicht zu haben — die UI
   * sagt das, statt eine Zahl von der falschen Ebene zu zeigen.
   */
  /**
   * Kommt die Antwort aus dem TAGESblock? Dieselbe Bedingung wie in
   * `answerFromRecords` — die Gegenrichtung einer Extremgröße und die
   * ausdrückliche Tagesfrage.
   */
  const fromDay =
    query != null && spec != null && (query.daily === true || !directionDerivable(spec, query.extreme))
  const filteredNational =
    query != null &&
    assetCode != null &&
    query.scope === 'record' &&
    query.area === 'country' &&
    query.terrain !== 'all'
  /** `'none'` = gerechnet, aber kein Ergebnis (Asset ohne Tagesblock). */
  const [pick, setPick] = useState<{ id: number; rec: StationRecords } | 'none' | null>(null)
  const pickKey = filteredNational && query
    ? [assetCode, query.terrain, query.extreme, query.month, query.season, query.annual, fromDay].join('|')
    : null
  useEffect(() => {
    setPick(null)
    if (!pickKey || !assetCode || !query) return
    let alive = true
    const want = query.extreme
    void loadRecordIndex(assetCode, country)
      .then(async (idx) => {
        const at = {
          extreme: want,
          month: query.month,
          season: query.season,
          annual: query.annual,
        }
        // Der Tagesblock ist eine ANDERE Ebene — auf die Monatsebene
        // auszuweichen beantwortete eine andere Frage (der kälteste TAG
        // gegen den kältesten Monats-Höchstwert).
        const level = fromDay ? recordDayLevel(idx, at) : recordLevel(idx, at)
        if (!level) return 'none' as const
        let best: { id: number; v: number } | null = null
        for (let i = 0; i < idx.ids.length; i++) {
          const v = level.v[i]
          if (v == null || !Number.isFinite(v)) continue
          if (!inTerrain(idx.ids[i])) continue
          if (!best || (want === 'max' ? v > best.v : v < best.v)) best = { id: idx.ids[i], v }
        }
        if (!best) return 'none' as const
        const rec = await loadStationRecords(best.id, country)
        return rec ? { id: best.id, rec } : ('none' as const)
      })
      .then((r) => {
        if (alive) setPick(r)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // Absichtlich nur der Schlüssel — `query` ist jede Renderrunde neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, fromDay])

  /** Station an eine Antwort hängen, die aus EINER Stationsdatei stammt. */
  const withStation = (a: ReturnType<typeof answerFromRecords>, id?: number) =>
    a && id != null ? { ...a, where: nameById(id), whereId: id } : a

  const answer =
    !query || !assetCode
      ? null
      : query.scope === 'value'
        ? answerFromPeriod(query, periodVals?.byStation ?? null, areaIds, stationName, areaLabel)
        : query.area === 'country'
          ? query.scope === 'normal'
            ? answerFromNormalsRange(
                query,
                normals,
                assetCode,
                stationName,
                periodLabel,
                query.terrain === 'all' ? undefined : areaIds,
                areaLabel,
              )
            : filteredNational
              ? // NIE auf die ungefilterte Zahl zurückfallen: „kältester Tag
                // ohne Bergstationen" zeigte so −33,2 °C vom Sonnblick, also
                // genau das, was der Filter ausschließen sollte. Lieber keine
                // Zahl und die Erklärung darunter.
                pick && pick !== 'none'
                ? withStation(answerFromRecords(query, pick.rec[assetCode], areaLabel), pick.id)
                : null
              : answerFromRecords(query, national?.[assetCode])
          : query.area === 'place' || query.area === 'state'
            ? query.scope === 'normal'
              ? answerFromNormalsRange(
                  query,
                  normals,
                  assetCode,
                  stationName,
                  periodLabel,
                  areaIds,
                  areaLabel,
                )
              : answerFromRecords(
                  query,
                  areaRecords?.[assetCode],
                  query.terrain === 'all' ? undefined : areaLabel,
                )
            : stationId != null
              ? query.scope === 'normal'
                ? answerFromNormals(query, normals?.[stationId]?.[assetCode], periodLabel)
                : answerFromRecords(query, records?.[assetCode])
              : null

  // Rekorde und Normale gibt es nur für die vorgenerierten Parameter; einen
  // gemessenen WERT gibt es, wo der Parameter im Zeitbezug überhaupt existiert
  // (die Schneehöhe hat keinen Monatsdatensatz, die gefühlte Temperatur gar
  // kein GeoSphere-Feld).
  const hasParam = query && assetCode
    ? query.scope === 'value'
      ? valueKey != null
      : query.area === 'country'
        ? query.scope === 'normal'
          ? normals != null
          : national?.[assetCode] != null
        : query.area === 'place' || query.area === 'state'
          ? query.scope === 'normal'
            ? normals != null
            : areaRecords?.[assetCode] != null
          : query.scope === 'normal'
            ? normals?.[stationId ?? -1]?.[assetCode] != null
            : records?.[assetCode] != null
    : false
  /** Die Frage ist beantwortbar, sobald ein Gebiet feststeht. */
  const areaResolved =
    query != null &&
    (query.area === 'country' ||
      query.area === 'place' ||
      (query.area === 'state' && areaIds.length > 0) ||
      stationId != null)
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
    // Das Asset führt das exakte Datum schon (Tagespass des Rekord-Ingests) —
    // dann ist nichts nachzuladen. Das gilt für genau die Fälle, die vorher
    // gar nicht beantwortbar waren (wärmste Nacht, kältester Tag).
    if (answer.day) return null
    // Den exakten Tag holt `resolveExtremeDay` bei GeoSphere — für die
    // DWD-Stationen gibt es dorthin keinen Abruf (kein CORS); die Antwort
    // nennt dann Monat und Jahr
    if (country !== 'at') return null
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
    // `answer.when` ist bei einem Asset-Datum schon tagesgenau formatiert
    // (formatRecordWhen) — hier ist dann nichts zu ergänzen.
    if (answer?.day) return null
    if (!recordDay) return null
    if (query?.nightly && query.param === 'tlmin') return formatNightSpan(recordDay.day)
    return new Intl.DateTimeFormat('de-AT', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${recordDay.day}T12:00:00Z`))
  }, [recordDay, query?.nightly, query?.param, answer?.day])

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
        ref={inputRef}
        className="atask-input"
        type="text"
        value={question}
        placeholder={country === 'de' ? 'z. B. höchste temperatur im juli in münchen' : 'z. B. höchste temperatur im juli in salzburg'}
        onChange={(e) => {
          setQuestion(e.target.value)
          setOverride({})
        }}
      />

      {!question.trim() && (
        <div className="atask-examples">
          {(country === 'de' ? EXAMPLES_DE : EXAMPLES).map((ex) => (
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
              <select
                value={query.area === 'state' ? `state:${query.state ?? ''}` : query.area}
                onChange={(e) => {
                  const v = e.target.value
                  if (v.startsWith('state:')) set({ area: 'state', state: v.slice(6) })
                  else set({ area: v as AskArea })
                }}
              >
                <option value="country">{loc.name} (alle Stationen)</option>
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
                {/* Alle neun stehen da, nicht nur das erkannte: „in Salzburg"
                    meint die STADT (so beantwortet es das Fenster seit jeher),
                    und der Sprung aufs Land soll ein Klick sein statt einer
                    neu formulierten Frage. */}
                <optgroup label="Bundesland">
                  {STATES[country].map((st) => (
                    <option key={st} value={`state:${st}`}>
                      {st}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {/* HÖHENFILTER. Bei einer einzelnen Station hat er keine
                Bedeutung — dort steht er deshalb gar nicht. */}
            {query.area !== 'station' && (
              <label>
                <span className="label-muted">Lage</span>
                <select
                  value={query.terrain}
                  onChange={(e) => set({ terrain: e.target.value as AskTerrain })}
                  title={`Reiner Höhenschnitt bei ${MOUNTAIN_M} m — keine topografische Einteilung. Galtür (1587 m) ist ein Talort und zählt als Berg, der Schöckl (1443 m) ist ein Gipfel und zählt nicht.`}
                >
                  <option value="all">alle Stationen ({areaCount.all})</option>
                  <option value="high">nur Bergstationen ab {MOUNTAIN_M} m ({areaCount.high})</option>
                  <option value="low">ohne Bergstationen ({areaCount.low})</option>
                </select>
              </label>
            )}
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
                {query.scope === 'value' ? (
                  <option value="y">ganzes Jahr</option>
                ) : (
                  <>
                    <option value="-">bester Einzelmonat (ganze Reihe)</option>
                    <option value="y">Jahreswert (ganze Reihe)</option>
                  </>
                )}
                <optgroup label="Monat">
                  {MONTH_NAMES.map(L).map((n, i) => (
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
            {/* Das JAHR gehört nur zur Wertfrage — bei Rekord und Normal gibt
                es keines (ein Rekord bringt sein Jahr mit, ein langjähriges
                Mittel hat keins). */}
            {query.scope === 'value' && (
              <label>
                <span className="label-muted">Jahr</span>
                <input
                  className="atask-year"
                  type="number"
                  min={1767}
                  max={new Date().getUTCFullYear()}
                  step={1}
                  value={query.year ?? ''}
                  onChange={(e) => {
                    const y = Number(e.target.value)
                    set({ year: Number.isFinite(y) && y > 999 ? y : null })
                  }}
                />
              </label>
            )}
            <label>
              <span className="label-muted">gesucht</span>
              <select
                value={
                  query.scope === 'record'
                    ? query.extreme
                    : // Bei einer Station gibt es nur DEN einen Wert — die
                      // Richtung wäre dort ohne Bedeutung und ließe die
                      // Auswahl leer, wenn sie gerade auf „min" stünde.
                      `${query.scope}:${query.area === 'station' ? 'max' : query.extreme}`
                }
                onChange={(e) => {
                  const v = e.target.value
                  const [kind, dir] = v.includes(':') ? v.split(':') : ['record', v]
                  const extreme = dir as 'max' | 'min'
                  if (kind === 'value') {
                    // Ohne Jahreszahl gäbe es keinen Zeitraum — die Frage
                    // stünde dann ohne Antwort da, obwohl der Nutzer gerade
                    // ausdrücklich einen Wert verlangt hat.
                    set({
                      scope: 'value' as AskScope,
                      extreme,
                      ...(query.year == null ? { year: defaultValueYear() } : {}),
                    })
                  } else {
                    set({ scope: kind as AskScope, extreme })
                  }
                }}
              >
                <option value="max">Höchstwert seit Messbeginn</option>
                <option value="min">Tiefstwert seit Messbeginn</option>
                {/* Über eine Stationsmenge ist weder ein langjähriges Mittel
                    noch ein Periodenwert EINE Zahl (kein Flächenmittel aus
                    Stationswerten) — gefragt wird deshalb nach dem oberen oder
                    unteren Ende der Spanne, und das muss man umschalten
                    können. Bei einer Station bleibt es der eine Wert. */}
                {query.area === 'station' ? (
                  <>
                    <option value="normal:max">langjähriges Mittel</option>
                    <option value="value:max">gemessener Wert (bestimmtes Jahr)</option>
                  </>
                ) : (
                  <>
                    <option value="normal:max">langjähriges Mittel — höchste Station</option>
                    <option value="normal:min">langjähriges Mittel — tiefste Station</option>
                    <option value="value:max">gemessener Wert — höchste Station</option>
                    <option value="value:min">gemessener Wert — tiefste Station</option>
                  </>
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
                  {L(answer.what)}
                  {(exactWhen ?? answer.when) && (
                    <>
                      {' · '}
                      <strong>{L(exactWhen ?? answer.when ?? '')}</strong>
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
                {answer.note && <div className="atask-note label-muted">{L(answer.note)}</div>}
              </>
            )}
            {/* GEGENRICHTUNG einer Extremgröße: das Archiv hätte hier eine
                Zahl, aber sie beantwortet eine andere Frage („wärmste Nacht"
                → höchster Monats-Tiefstwert). Statt der falschen Zahl die
                Erklärung — „keine Daten" wäre hier ebenfalls unzutreffend. */}
            {/* Der Vorbehalt gilt nur für REKORDE aus dem Monatsarchiv: dort
                ist die Gegenrichtung einer Extremgröße eine andere Aussage.
                Ein gemessener Periodenwert hat das Problem nicht — „tiefstes
                Tagesmaximum im Jänner 2024" ist genau der Monatswert. */}
            {areaResolved && !answer && spec && query && query.scope === 'record' &&
              !directionDerivable(spec, query.extreme) && (
              <span className="atask-note label-muted">
                {directionNote(spec, query.extreme, query.nightly)}
              </span>
            )}
            {areaResolved &&
              !answer &&
              hasParam === false &&
              spec &&
              query.scope !== 'value' &&
              directionDerivable(spec, query.extreme) && (
              <span className="label-muted">
                Für „{spec.label}" gibt es{' '}
                {query.area === 'station' ? 'an dieser Station keine' : 'keine'} vorberechneten{' '}
                {query.scope === 'normal' ? 'Normale' : 'Rekorde'}.
              </span>
            )}
            {areaResolved && !answer && hasParam && !valueBusy &&
              (query.scope === 'value' || directionDerivable(spec!, query.extreme)) && (
              <span className="label-muted">Für diesen Zeitraum liegt kein Wert vor.</span>
            )}
          </div>

          {/* Der gefilterte Landesrekord kommt aus dem Karten-Index, und der
              kennt den Tagesblock nicht (Begründung bei `filteredNational`). */}
          {filteredNational && pick === 'none' && (
            <div className="atask-note label-muted">
              Für diese Ebene lässt sich der Höhenfilter nicht rechnen — der Karten-Index führt
              sie nicht. Ohne Filter gibt es die Antwort.
            </div>
          )}
          {/* Die Wertfrage ist der einzige Pfad mit einem Abruf — und der
              einzige, der ins Leere laufen kann, weil der Zeitraum vor dem
              Messbeginn der Station liegt. Beides gehört gesagt. */}
          {query.scope === 'value' && (
            <div className="atask-note label-muted">
              {query.year == null
                ? 'Für einen gemessenen Wert fehlt die Jahreszahl.'
                : valueBusy
                  ? 'Werte werden geholt …'
                  : hasParam === false
                    ? `„${spec?.label}" gibt es für diesen Zeitbezug nicht.`
                    : 'Gemessener Wert aus dem GeoSphere-Klimaarchiv — einmal geholt, danach ' +
                      'aus dem Zwischenspeicher (dieselben Daten wie in der Karte).'}
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
