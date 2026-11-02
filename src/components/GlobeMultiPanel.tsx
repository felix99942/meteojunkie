// Panel-Ansicht der Modellkarten: 4 oder 6 flache Karten (Europa oder
// Österreich) nebeneinander, bedient wie das Panel-Raster der Punktprognosen.
//
// Je Panel Modell und Größe, dazu drei Knöpfe:
//   PARSYNC  diese GRÖSSE für alle Panels — Modellvergleich (Vorgabe)
//   MODSYNC  dieses MODELL für alle Panels — Synoptik, je Panel eine Größe
//   SYNC     gemeinsame Zeit und gemeinsamer Kartenausschnitt; ohne SYNC hat
//            das Panel eigene Pfeile und bleibt beim Verschieben für sich
// PARSYNC und MODSYNC sind wie parsync EIN Quellpanel (Radio), höchstens eine
// Kopplung zugleich; beim Lösen bleibt der gespiegelte Wert stehen
// (`config/globePanels.ts`). Den Wert am Mauszeiger zeigen alle Panels für
// DENSELBEN Ort — der eigentliche Gewinn eines Modellvergleichs. Isolinien
// gibt es hier bewusst NICHT, stattdessen Zahlen im Farbfeld (auf Wunsch).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type maplibregl from 'maplibre-gl'
import { GlobeMapPanel } from './GlobeMapPanel'
import { loadGlobeMeta, setGlobeMeta } from '../api/globeData'
import { GLOBE_GROUPS, GLOBE_MODELS, GLOBE_VARIABLES, getGlobeModel, intervalHours, runMs, variableLabel, type GlobeMeta, type GlobeModelId, type GlobeVarId } from '../config/globe'
import {
  defaultSetup,
  frozenStepIndex,
  effectivePanel,
  makePreset,
  PANEL_PRESET_KEY,
  PANEL_REGIONS,
  parsePresets,
  upsertPreset,
  coarsestTimes,
  releaseCoupling,
  stepAround,
  stepTime,
  validTimes,
  type Coupling,
  type MapPanelConfig,
  type MapPanelPreset,
  type PanelView,
  type PanelCount,
  type PanelRegionId,
} from '../config/globePanels'
import { runLabel, validLabel } from '../config/globeFormat'
import { globalKeyAllowed } from '../lib/globalKeys'

type MetaState = { meta: GlobeMeta } | { error: string }

/** Asien gehört nicht in eine Europa-/Österreich-Ansicht */
const PANEL_MODELS = GLOBE_MODELS.filter((m) => m.id !== 'ecmwf-hres-asia')

function readPresets(): MapPanelPreset[] {
  try {
    return parsePresets(
      localStorage.getItem(PANEL_PRESET_KEY),
      PANEL_MODELS.map((m) => m.id),
      GLOBE_VARIABLES.map((v) => v.id),
    )
  } catch {
    return [] // privates Fenster, gesperrter Speicher: dann eben ohne Presets
  }
}

export function GlobeMultiPanel({
  count,
  modeSwitch,
  onCount,
}: {
  count: PanelCount
  modeSwitch: ReactNode
  onCount: (n: PanelCount) => void
}) {
  // Vorgabe je Panelzahl; beim Umschalten 4 ↔ 6 gilt die der neuen Zahl,
  // SOLANGE man nichts selbst eingestellt hat (`pristine`) — wer schon
  // umgebaut hat, behält seinen Stand
  const [initial] = useState(() => defaultSetup(count))
  const pristine = useRef<PanelCount | null>(count)
  const touch = () => {
    pristine.current = null
  }
  const [regionId, setRegionId] = useState<PanelRegionId>(initial.region)
  const region = PANEL_REGIONS.find((r) => r.id === regionId) ?? PANEL_REGIONS[0]
  const [panels, setPanels] = useState<MapPanelConfig[]>(initial.panels)
  const [coupling, setCoupling] = useState<Coupling>(initial.coupling)
  const [sharedMs, setSharedMs] = useState(() => Date.now())
  const [numbersOn, setNumbersOn] = useState(true)
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null)
  const [fitKey, setFitKey] = useState(0)
  useEffect(() => {
    if (pristine.current == null || pristine.current === count) return
    const d = defaultSetup(count)
    pristine.current = count
    setPanels(d.panels)
    setCoupling(d.coupling)
    setRegionId(d.region)
    setFitKey((k) => k + 1)
  }, [count])
  const [metas, setMetas] = useState<Partial<Record<GlobeModelId, MetaState>>>({})

  // --- Presets: Panels, Kopplung, Panelzahl, Region unter einem Namen ---------
  const [presets, setPresets] = useState<MapPanelPreset[]>(readPresets)
  const [presetName, setPresetName] = useState('')
  /** Ausschnitte des zuletzt geladenen Presets — gelten, bis die Region gewechselt wird */
  const [presetViews, setPresetViews] = useState<(PanelView | null)[] | null>(null)
  const [activePreset, setActivePreset] = useState('')
  const storePresets = (list: MapPanelPreset[]) => {
    setPresets(list)
    try {
      localStorage.setItem(PANEL_PRESET_KEY, JSON.stringify(list))
    } catch {
      /* ohne Speicher gilt das Preset nur für diese Sitzung */
    }
  }
  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    if (presets.some((p) => p.name === name) && !window.confirm(`Preset „${name}" überschreiben?`)) return
    // Ausschnitt je Panel mitspeichern (auf Wunsch): Mittelpunkt und Zoom
    const views = panels.map((_, i): PanelView | null => {
      const m = maps.current.get(i)
      if (!m) return presetViews?.[i] ?? null
      const c = m.getCenter()
      return { center: [Math.round(c.lng * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4], zoom: Math.round(m.getZoom() * 100) / 100 }
    })
    storePresets(upsertPreset(presets, makePreset(name, count, regionId, coupling, panels, views)))
    setActivePreset(name)
  }
  const loadPreset = (name: string) => {
    const p = presets.find((q) => q.name === name)
    if (!p) return
    touch()
    setPanels(p.panels.map((q) => ({ ...q, localMs: null })))
    setCoupling(p.coupling)
    setRegionId(p.region)
    setPresetViews(p.views ?? null)
    setFitKey((k) => k + 1)
    onCount(p.count)
    setActivePreset(name)
    setPresetName(name)
  }
  const deletePreset = () => {
    if (!activePreset || !window.confirm(`Preset „${activePreset}" löschen?`)) return
    storePresets(presets.filter((p) => p.name !== activePreset))
    setActivePreset('')
  }

  const visible = useMemo(
    () => Array.from({ length: count }, (_, i) => effectivePanel(panels, i, coupling)),
    [panels, coupling, count],
  )

  // Meta je benutztem Modell, einmal je Sitzung
  const wantedModels = useMemo(() => [...new Set(visible.map((p) => p.model))], [visible])
  useEffect(() => {
    for (const m of wantedModels) {
      if (metas[m]) continue
      setMetas((prev) => ({ ...prev, [m]: prev[m] ?? { error: 'lädt' } }))
      loadGlobeMeta(m)
        .then((meta) => {
          setGlobeMeta(meta)
          setMetas((prev) => ({ ...prev, [m]: { meta } }))
        })
        .catch((e: unknown) => setMetas((prev) => ({ ...prev, [m]: { error: e instanceof Error ? e.message : String(e) } })))
    }
  }, [wantedModels, metas])
  const metaOf = (m: GlobeModelId) => {
    const s = metas[m]
    return s && 'meta' in s ? s.meta : null
  }
  const errorOf = (m: GlobeModelId) => {
    const s = metas[m]
    return s && 'error' in s && s.error !== 'lädt' ? s.error : null
  }

  // Gemeinsame Zeitachse im GRÖBSTEN Takt der offenen Modelle (`coarsestTimes`)
  const timesOf = useCallback(
    (p: MapPanelConfig) => {
      const s = metas[p.model]
      return validTimes(s && 'meta' in s ? s.meta : null, p.varId)
    },
    [metas],
  )
  // TAKTGEBER (auf Wunsch): ein Klick in ein Panel mit feineren Schritten
  // lässt den Regler in DESSEN Takt laufen. Ein gröberes Modell ist nur
  // ZWISCHEN seinen Terminen grau (Stehenbleiben im Panel), zu seinen eigenen
  // Terminen erscheint es normal
  const [pace, setPace] = useState<number | null>(null)
  const pacePanel = pace != null && pace < count && visible[pace]?.sync ? pace : null
  const coarse = useMemo(() => coarsestTimes(visible.filter((p) => p.sync).map(timesOf)), [visible, timesOf])
  const paceTimes = useMemo(() => (pacePanel != null ? timesOf(visible[pacePanel]) : null), [pacePanel, visible, timesOf])
  const sharedTimes = paceTimes ?? coarse
  const sharedIdx = useMemo(() => {
    if (!sharedTimes.length) return -1
    let k = 0
    for (let i = 1; i < sharedTimes.length; i++) if (Math.abs(sharedTimes[i] - sharedMs) < Math.abs(sharedTimes[k] - sharedMs)) k = i
    return k
  }, [sharedTimes, sharedMs])
  const shownMs = sharedIdx >= 0 ? sharedTimes[sharedIdx] : sharedMs

  const stepShared = useCallback((dir: number) => setSharedMs((ms) => stepTime(sharedTimes, ms, dir)), [sharedTimes])

  // Klick ins Panel: Taktgeber an, nur wenn es FEINER läuft als der gemeinsame
  // Regler (ein 3-h-Panel hätte keinen feineren Takt zu bieten); erneut oder Esc: aus
  const onPick = useCallback(
    (i: number) => {
      if (pace === i) {
        setPace(null)
        return
      }
      const p = visible[i]
      if (!p?.sync) return
      if (stepAround(timesOf(p), shownMs) < stepAround(coarse, shownMs)) {
        // Die gezeigte Zeit festhalten: sonst rechnete der feinere Takt von der
        // Uhrzeit aus neu, und um 14:22 sprang die Anzeige von 15 auf 14 UTC
        setSharedMs(shownMs)
        setPace(i)
      }
    },
    [pace, visible, timesOf, shownMs, coarse],
  )
  useEffect(() => {
    if (pacePanel == null) return
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setPace(null)
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [pacePanel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!globalKeyAllowed(e)) return
      e.preventDefault()
      stepShared((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepShared])

  // --- Ausschnitt koppeln ------------------------------------------------------
  const maps = useRef(new Map<number, maplibregl.Map>())
  const syncRef = useRef(visible)
  syncRef.current = visible
  const onMap = useCallback((i: number, map: maplibregl.Map | null) => {
    if (map) maps.current.set(i, map)
    else maps.current.delete(i)
  }, [])
  const onUserMove = useCallback((i: number) => {
    const src = maps.current.get(i)
    if (!src || !syncRef.current[i]?.sync) return
    const view = { center: src.getCenter(), zoom: src.getZoom() }
    for (const [j, m] of maps.current) {
      if (j === i || !syncRef.current[j]?.sync) continue
      // jumpTo löst `move` OHNE originalEvent aus — kein Echo
      m.jumpTo(view)
    }
  }, [])

  // --- Panel bearbeiten ---------------------------------------------------------
  const update = (i: number, patch: Partial<MapPanelConfig>) => {
    touch()
    setPanels((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)))
  }

  // ABSCHALTEN friert den gespiegelten Wert ein (wie parsync), ein WECHSEL
  // dagegen nicht: von ParSync auf ModSync stünde sonst in allen Panels
  // dieselbe Größe UND dasselbe Modell — sechs gleiche Karten (so war es
  // zuerst). Beim Wechsel gilt wieder, was jedes Panel selbst eingestellt hat.
  const toggleCoupling = (kind: 'var' | 'model', i: number) => {
    touch()
    const off = coupling?.kind === kind && coupling.source === i
    if (off) {
      setPanels((ps) => releaseCoupling(ps, coupling))
      setCoupling(null)
    } else setCoupling({ kind, source: i })
  }

  const toggleSync = (i: number) => {
    const p = panels[i]
    if (p.sync) {
      update(i, { sync: false, localMs: shownMs })
      return
    }
    update(i, { sync: true, localMs: null })
    // Beim Wiedereinsteigen den gemeinsamen Ausschnitt übernehmen
    const peer = [...maps.current].find(([j]) => j !== i && visible[j]?.sync)?.[1]
    const own = maps.current.get(i)
    if (peer && own) own.jumpTo({ center: peer.getCenter(), zoom: peer.getZoom() })
  }

  const header = (i: number, p: MapPanelConfig) => {
    const meta = metaOf(p.model)
    const varLocked = coupling?.kind === 'var' && coupling.source !== i
    const modelLocked = coupling?.kind === 'model' && coupling.source !== i
    const isVarSrc = coupling?.kind === 'var' && coupling.source === i
    const isModelSrc = coupling?.kind === 'model' && coupling.source === i
    const ownTimes = p.sync ? [] : validTimes(meta, p.varId)
    const localMs = p.localMs ?? shownMs
    // Intervall des GEZEIGTEN Schritts — dieselbe Regel wie im Kartenpanel
    // (`frozenStepIndex`), damit „Niederschlag 3 h" zum Bild passt
    const vTimes = validTimes(meta, p.varId)
    const vIdx = frozenStepIndex(vTimes, p.sync ? shownMs : localMs)
    const vm = meta?.variables[p.varId]
    const interval = vIdx >= 0 && vm ? intervalHours(vm, vm.steps[vIdx]) : undefined
    return (
      <div className="panel-header gmp-header">
        <select
          value={p.model}
          disabled={modelLocked}
          title={
            modelLocked
              ? `Modell kommt aus Panel ${coupling!.source + 1} (MODSYNC)`
              : meta
                ? `${getGlobeModel(p.model).title} — Lauf ${runLabel(runMs(meta))}`
                : getGlobeModel(p.model).title
          }
          onChange={(e) => {
            update(i, { model: e.target.value as GlobeModelId })
            e.currentTarget.blur()
          }}
        >
          {PANEL_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.resolution}
            </option>
          ))}
        </select>
        <select
          className="panel-variable"
          value={p.varId}
          disabled={varLocked}
          title={varLocked ? `Größe kommt aus Panel ${coupling!.source + 1} (PARSYNC)` : getGlobeVariableTitle(p.varId)}
          onChange={(e) => {
            update(i, { varId: e.target.value as GlobeVarId })
            e.currentTarget.blur()
          }}
        >
          {GLOBE_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {GLOBE_VARIABLES.filter((v) => v.group === g).map((v) => (
                <option key={v.id} value={v.id} disabled={!!meta && !meta.variables[v.id]}>
                  {variableLabel(v, v.id === p.varId ? interval : undefined)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {!p.sync && (
          <span className="gmp-localtime">
            <button type="button" onClick={() => update(i, { localMs: stepTime(ownTimes, localMs, -1) })} aria-label="früher">
              ‹
            </button>
            <span>{validLabel(stepTime(ownTimes, localMs, 0))}</span>
            <button type="button" onClick={() => update(i, { localMs: stepTime(ownTimes, localMs, 1) })} aria-label="später">
              ›
            </button>
          </span>
        )}
        <button
          type="button"
          className={isVarSrc ? 'sync-toggle parsync active' : 'sync-toggle parsync'}
          title={
            isVarSrc
              ? 'Dieses Panel gibt die Größe vor — Klick gibt alle wieder frei'
              : 'Diese Größe in allen Panels zeigen (Modellvergleich)'
          }
          onClick={() => toggleCoupling('var', i)}
        >
          ParSync
        </button>
        <button
          type="button"
          className={isModelSrc ? 'sync-toggle modsync active' : 'sync-toggle modsync'}
          title={
            isModelSrc
              ? 'Dieses Panel gibt das Modell vor — Klick gibt alle wieder frei'
              : 'Dieses Modell in allen Panels zeigen (Synoptik: je Panel eine Größe)'
          }
          onClick={() => toggleCoupling('model', i)}
        >
          ModSync
        </button>
        <button
          type="button"
          className={p.sync ? 'sync-toggle main-sync active' : 'sync-toggle main-sync'}
          title="Zeit und Kartenausschnitt folgen den anderen Sync-Panels"
          onClick={() => toggleSync(i)}
        >
          SYNC
        </button>
      </div>
    )
  }

  return (
    <div className="radar globe gmp">
      <div className="radar-bar">
        <span className="radar-title">Modellkarten</span>
        {modeSwitch}
        <span className="globe-seg" role="group" aria-label="Ausschnitt">
          {PANEL_REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={r.id === regionId ? 'is-active' : ''}
              aria-pressed={r.id === regionId}
              onClick={() => {
                touch()
                setRegionId(r.id)
                setPresetViews(null)
                setFitKey((k) => k + 1)
              }}
            >
              {r.label}
            </button>
          ))}
        </span>
        <button type="button" className="gmp-arrow" onClick={() => stepShared(-1)} disabled={sharedIdx <= 0} aria-label="früher">
          ‹
        </button>
        <input
          type="range"
          className="radar-slider"
          min={0}
          max={Math.max(0, sharedTimes.length - 1)}
          value={Math.max(0, sharedIdx)}
          disabled={!sharedTimes.length}
          onChange={(e) => setSharedMs(sharedTimes[+e.target.value])}
        />
        <button
          type="button"
          className="gmp-arrow"
          onClick={() => stepShared(1)}
          disabled={sharedIdx < 0 || sharedIdx >= sharedTimes.length - 1}
          aria-label="später"
        >
          ›
        </button>
        <span className="radar-step globe-step">{sharedTimes.length ? validLabel(shownMs) : '—'}</span>
        <span className="gmp-presets" role="group" aria-label="Presets">
          <select
            value={activePreset}
            title="Gespeicherte Einstellung laden: Modelle, Größen, SYNC, Kopplung, Panelzahl und Region"
            onChange={(e) => {
              loadPreset(e.target.value)
              e.currentTarget.blur()
            }}
          >
            <option value="" disabled>
              {presets.length ? 'Preset laden …' : 'keine Presets'}
            </option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={presetName}
            placeholder="Name"
            maxLength={40}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && savePreset()}
          />
          <button type="button" onClick={savePreset} disabled={!presetName.trim()} title="Aktuelle Einstellung unter diesem Namen speichern">
            Speichern
          </button>
          {activePreset && (
            <button type="button" onClick={deletePreset} title={`Preset „${activePreset}" löschen`}>
              Löschen
            </button>
          )}
        </span>
        <label className="radar-opt" title="Zahlen im Farbfeld: beim Niederschlag die örtlichen Höchstwerte (mm), sonst die Werte in gleichmäßigem Raster">
          <input type="checkbox" checked={numbersOn} onChange={(e) => setNumbersOn(e.target.checked)} /> Zahlen
        </label>
      </div>
      <div className={`panel-grid layout-${count} gmp-grid`}>
        {visible.map((p, i) => (
          <GlobeMapPanel
            key={i}
            index={i}
            cfg={p}
            meta={metaOf(p.model)}
            metaError={errorOf(p.model)}
            targetMs={p.sync ? shownMs : (p.localMs ?? shownMs)}
            region={region}
            fitKey={fitKey}
            presetView={presetViews?.[i] ?? null}
            numbersOn={numbersOn}
            hover={hover}
            onHover={setHover}
            onMap={onMap}
            onUserMove={onUserMove}
            onPick={onPick}
            pacing={pacePanel === i}
            header={header(i, p)}
          />
        ))}
      </div>
      <span className="attribution radar-attribution">
        Datenquellen: ECMWF Open Data (CC BY 4.0) · Deutscher Wetterdienst (GeoNutzV) · MeteoSwiss Varda-single-1.0
        (CC BY 4.0, gerechnet auf eigener Hardware) — je nach Modell im Panel · Küsten, Grenzen und Namen: Natural Earth. Rohe
        Modellausgabe, kein Warndienst. Zeiten in UTC.
      </span>
    </div>
  )
}

function getGlobeVariableTitle(id: GlobeVarId): string {
  return GLOBE_VARIABLES.find((v) => v.id === id)?.title ?? ''
}
