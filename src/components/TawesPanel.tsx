// Bereich TAWES: alle Messgrößen der österreichischen Wetterstationen im 10-Minuten-Takt über
// die letzten 3 Tage. Getrennt von der Klimakarte (seit 2026-11-12, auf Wunsch): die fragt
// „wie war der Zeitraum gegen das Normal", dieser Bereich „was misst das Netz jetzt bzw.
// vorhin". Die Jetzt-Werte der Klimakarte bleiben dort für die tagesaktuelle Statistik.
//
// Daten: die Dateien des Worker-Crons in R2 (`tawes/10min/<code>.bin`, eine je Größe),
// geladen erst, wenn eine Größe gewählt wird. Kein Abruf bei GeoSphere aus dem Browser.

import { useEffect, useMemo, useState } from 'react'
import { activeStations, loadStations, type AtStation } from '../api/geosphere'
import { loadTawesCode } from '../api/tawesRecent'
import { colorForValue } from '../config/colorscales'
import {
  codesFor,
  DEFAULT_PRECIP_STEPS,
  DEFAULT_TAWES_PARAM,
  displayOf,
  getTawesParam,
  PRECIP_WINDOWS,
  stepsFor,
  synopticPeriods,
  TAWES_GROUPS,
  TAWES_PARAMS,
  tawesTitle,
} from '../config/tawesParameters'
import {
  mergeTawesStores,
  TAWES_SLIDER_HOURS,
  TAWES_STEP_MS,
  tawesStepMs,
  tawesStepOf,
  type TawesCode,
  type TawesStore,
} from '../config/tawesStore'
import { formatTawes, prepareParam, tawesValues } from '../config/tawesValues'
import { globalKeyAllowed } from '../lib/globalKeys'
import { AtClimateMap } from './AtClimateMap'
import { AtRankList } from './AtRankList'
import { TawesStationDetail } from './TawesStationDetail'

const fmtClock = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' })
// Synoptische Zeiträume nach UTC-Datum benannt: der Tag nach seinem Datum, die Nacht nach dem
// Morgen, an dem sie endet
const fmtPeriod = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric' })
const fmtClockDay = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Vienna',
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Stand älter als das: der Cron steht, die Karte sagt es */
const STALE_MS = 2 * 3_600_000
/** Nachladen, solange der Bereich offen ist — der Cron schreibt alle 10 Minuten */
const RELOAD_MS = 5 * 60_000

const SLIDER_STEPS = TAWES_SLIDER_HOURS * 6

export function TawesPanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paramKey, setParamKey] = useState(DEFAULT_TAWES_PARAM)
  const [precipSteps, setPrecipSteps] = useState(DEFAULT_PRECIP_STEPS)
  const [barbs, setBarbs] = useState(true)
  /** Geladene Größen, je eine Datei */
  const [codes, setCodes] = useState<Partial<Record<TawesCode, TawesStore>>>({})
  const [missing, setMissing] = useState<TawesCode[]>([])
  const [loading, setLoading] = useState(false)
  /** Termin am Schieber; null = jüngster Stand (rückt beim Nachladen mit) */
  const [atMs, setAtMs] = useState<number | null>(null)
  const [selected, setSelected] = useState<AtStation | null>(null)
  const [showRank, setShowRank] = useState(false)
  const [rankHover, setRankHover] = useState<number | null>(null)
  const [reload, setReload] = useState(0)

  const param = getTawesParam(paramKey)
  const steps = stepsFor(param, precipSteps)
  const disp = displayOf(param, steps)
  const withBarbs = barbs && !!param.dir

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(activeStations(s).filter((x) => x.has10min)))
      .catch((err) => !cancelled && setError(err?.message ?? 'Stationen nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [])

  // Benötigte Dateien laden; beim Nachladen alle schon geladenen erneuern
  const needed = useMemo(() => codesFor(param, withBarbs), [param, withBarbs])
  const neededKey = needed.join(',')
  useEffect(() => {
    let cancelled = false
    const want = needed.filter((c) => !codes[c])
    if (want.length === 0) return
    setLoading(true)
    Promise.all(want.map((c) => loadTawesCode(c)))
      .then((res) => {
        if (cancelled) return
        setCodes((old) => {
          const next = { ...old }
          want.forEach((c, i) => {
            if (res[i]) next[c] = res[i]!
          })
          return next
        })
        setMissing(want.filter((_, i) => !res[i]))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // `codes` absichtlich nicht: sonst liefe der Effekt nach jedem Laden erneut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey])

  useEffect(() => {
    const t = window.setInterval(() => setReload((n) => n + 1), RELOAD_MS)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    if (reload === 0) return
    let cancelled = false
    const have = Object.keys(codes) as TawesCode[]
    Promise.all(have.map((c) => loadTawesCode(c, true))).then((res) => {
      if (cancelled) return
      setCodes((old) => {
        const next = { ...old }
        have.forEach((c, i) => {
          if (res[i] && res[i]!.endMs >= (old[c]?.endMs ?? 0)) next[c] = res[i]!
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  const store = useMemo(() => {
    const parts = needed.map((c) => codes[c]).filter((s): s is TawesStore => s != null)
    return parts.length === needed.length ? mergeTawesStores(parts) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, neededKey])

  const result = useMemo(() => {
    if (!store) return null
    return tawesValues(param, precipSteps, store, atMs == null ? null : tawesStepOf(store, atMs), withBarbs)
  }, [store, param, precipSteps, atMs, withBarbs])

  // Schieber: die letzten 72 h bis zum Stand des Netzes dieser Größe
  const range = useMemo(() => {
    const newest = store ? prepareParam(param, store)?.last : undefined
    if (!store || newest == null || newest < 0) return null
    const lastMs = tawesStepMs(store, newest)
    return { firstMs: lastMs - SLIDER_STEPS * TAWES_STEP_MS, lastMs }
  }, [store, param])
  const shownMs = store && result ? tawesStepMs(store, result.at) : null

  // TAGESMODUS bei Höchst- und Tiefstwerten (auf Wunsch): die Zeitleiste zeigt die
  // synoptischen Tage bzw. Nächte, so viele, wie der Speicher trägt, statt 10-Minuten-Termine
  const periods = useMemo(() => {
    if (!param.synoptic || !store || !range) return null
    return synopticPeriods(range.lastMs, tawesStepMs(store, 0), param.synoptic)
  }, [param.synoptic, store, range])
  const periodIdx = periods && result?.window ? periods.findIndex((w) => w.endMs === result.window!.endMs) : -1
  const periodLabel = (w: { endMs: number }) =>
    param.synoptic === 'night' ? `Nacht auf ${fmtPeriod.format(new Date(w.endMs))}` : fmtPeriod.format(new Date(w.endMs))
  const pickPeriod = (i: number) => {
    if (!periods) return
    const j = Math.max(0, Math.min(periods.length - 1, i))
    setAtMs(j === periods.length - 1 ? null : periods[j].endMs)
  }

  useEffect(() => {
    if (!periods) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !globalKeyAllowed(e)) return
      e.preventDefault()
      pickPeriod((periodIdx < 0 ? periods.length - 1 : periodIdx) + (e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, periodIdx])

  useEffect(() => {
    if (!range || periods) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !globalKeyAllowed(e)) return
      e.preventDefault()
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 6 : 1) * TAWES_STEP_MS
      setAtMs((at) => {
        const next = Math.max(range.firstMs, (at ?? range.lastMs) + d)
        return next >= range.lastMs ? null : next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [range, periods])

  const { values, colors, dirs, covered } = useMemo(() => {
    const values: (number | null)[] = []
    const colors: (string | null)[] = []
    const dirs: (number | null)[] = []
    let covered = 0
    for (const s of stations ?? []) {
      const raw = result?.byStation.get(s.id) ?? null
      const v = raw == null ? null : Number(raw.toFixed(disp.decimals))
      values.push(v)
      colors.push(v == null ? null : colorForValue(disp.scale, v))
      dirs.push(result?.direction?.get(s.id) ?? null)
      if (v != null) covered++
    }
    return { values, colors, dirs, covered }
  }, [stations, result, disp])

  const title = tawesTitle(param, precipSteps)
  const clock = shownMs == null ? '' : (atMs == null ? fmtClock : fmtClockDay).format(new Date(shownMs))
  const stale = store != null && Date.now() - store.endMs > STALE_MS
  const selectedIdx = selected && stations ? stations.findIndex((s) => s.id === selected.id) : -1
  const windowed = param.agg !== 'last' && param.agg !== 'change'

  return (
    <div className="atclima tawes">
      <div className="atclima-bar">
        <span className="atclima-title">TAWES · Messnetz Österreich</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Größe</span>
          <select
            value={paramKey}
            onChange={(e) => {
              // Wechsel zwischen Termin, Tag und Nacht: ein Termin der einen Art ist in der
              // anderen ein anderer Zeitraum (06 UTC wäre als Höchstwert der Vortag)
              if (getTawesParam(e.target.value).synoptic !== param.synoptic) setAtMs(null)
              setParamKey(e.target.value)
              e.currentTarget.blur()
            }}
          >
            {TAWES_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {TAWES_PARAMS.filter((p) => p.group === g).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {param.windowed && (
          <label className="atclima-ctrl">
            <span className="label-muted">Summe über</span>
            <select
              value={precipSteps}
              onChange={(e) => {
                setPrecipSteps(Number(e.target.value))
                e.currentTarget.blur()
              }}
            >
              {PRECIP_WINDOWS.map((w) => (
                <option key={w.steps} value={w.steps}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {param.dir && (
          <label className="atclima-ctrl" title="Richtung und Stärke als Windfiedern statt als Zahl">
            <input type="checkbox" checked={barbs} onChange={(e) => setBarbs(e.target.checked)} /> Windfiedern
          </label>
        )}
        <span className="atclima-sub">
          {loading ? (
            'lädt …'
          ) : error ? (
            `⚠ ${error}`
          ) : missing.length > 0 && !store ? (
            `⚠ keine Daten für ${missing.join(', ')}`
          ) : (
            <>
              {covered} Stationen · Werte in {disp.unit}
              {stale && store && (
                <span className="atclima-stale" title="Der Speicher wird alle 10 Minuten erneuert. Älter als zwei Stunden heißt: der Cron steht.">
                  {' '}
                  ⚠ Stand {fmtClockDay.format(new Date(store.endMs))}
                </span>
              )}
            </>
          )}
        </span>
      </div>
      <div className="atclima-body">
        {error && !stations ? (
          <div className="panel-placeholder">Stationen nicht ladbar: {error}</div>
        ) : !stations ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <>
            <AtClimateMap
              stations={stations}
              colors={colors}
              values={values}
              unit={disp.unit}
              barbDirs={withBarbs ? dirs : undefined}
              onSelect={(i) => setSelected(stations[i])}
              highlightIdx={rankHover}
              markedIdx={selectedIdx >= 0 ? selectedIdx : null}
            />
            {!showRank && (
              <div className="atmap-tools">
                <button
                  type="button"
                  className="atmap-toolbtn"
                  onClick={() => setShowRank(true)}
                  title="Alle Stationen durchsuchen und nach Wert reihen — Hover markiert die Station, Klick öffnet ihr Detail"
                >
                  <span aria-hidden="true">🔍</span> Rangliste &amp; Stationssuche
                </button>
              </div>
            )}
            {showRank && (
              <AtRankList
                stations={stations}
                values={values}
                unit={disp.unit}
                title={`${title} · ${clock}`}
                description={param.description}
                signed={param.agg === 'change'}
                onSelect={(i) => setSelected(stations[i])}
                onHover={setRankHover}
                onClose={() => {
                  setShowRank(false)
                  setRankHover(null)
                }}
              />
            )}
            <div className="atmap-headline">
              <span className="atmap-headline-main" title={param.description}>
                {title} · {result?.window ? periodLabel(result.window) : `${windowed ? 'bis ' : ''}${clock || '—'}`}
              </span>
              <span className="atmap-headline-sub">
                {disp.unit} · 10-Minuten-Werte der TAWES-Stationen, ungeprüft
                {store && !result ? ' · keine Werte' : ''}
              </span>
              {result?.window?.running && (
                <span className="atmap-headline-running">● läuft noch — bisher bis {fmtClock.format(new Date(shownMs!))}</span>
              )}
            </div>
            {periods && (
              <div className="atmap-timebar tawes-periods" role="group" aria-label={param.synoptic === 'night' ? 'Nacht wählen' : 'Tag wählen'}>
                {periods.map((w, i) => (
                  <button
                    key={w.endMs}
                    type="button"
                    className={i === periodIdx ? 'is-active' : undefined}
                    onClick={() => pickPeriod(i)}
                    title={`${param.synoptic === 'night' ? '18–06' : '06–18'} UTC${w.running ? ' — läuft noch' : ''} · ←/→ wechselt`}
                  >
                    {periodLabel(w)}
                    {w.running ? ' ●' : ''}
                  </button>
                ))}
              </div>
            )}
            {range && !periods && (
              <div className="atmap-timebar">
                <strong>{clock}</strong>
                <input
                  type="range"
                  aria-label="Zeitpunkt der letzten 3 Tage"
                  min={0}
                  max={SLIDER_STEPS}
                  value={Math.round(((atMs ?? range.lastMs) - range.firstMs) / TAWES_STEP_MS)}
                  onChange={(e) => {
                    const ms = range.firstMs + Number(e.target.value) * TAWES_STEP_MS
                    setAtMs(ms >= range.lastMs ? null : ms)
                  }}
                  title="Termin wählen — ←/→ auch ohne Klick, Shift+←/→ eine Stunde"
                />
                <button type="button" disabled={atMs == null} onClick={() => setAtMs(null)}>
                  Jetzt
                </button>
              </div>
            )}
            {selected && (
              <TawesStationDetail
                station={selected}
                markMs={shownMs}
                value={result?.byStation.get(selected.id) ?? null}
                valueText={(v) => `${formatTawes(v, disp.decimals)} ${disp.unit}`}
                title={title}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
      <span className="attribution atclima-attribution">
        Datenquelle:{' '}
        <a href="https://data.hub.geosphere.at/dataset/klima-v2-10min" target="_blank" rel="noreferrer">
          GeoSphere Austria — Messstationen 10-Minuten-Daten
        </a>{' '}
        (TAWES, vorläufig und ungeprüft), Lizenz{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        .
      </span>
    </div>
  )
}
