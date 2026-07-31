// Globaler Workbench-State (SPEC §10): Zeit-Cursor, Domain, Location-Lock,
// Modelllauf plus Panel-Konfigurationen. Zeiten als Epoch-ms (UTC) statt Date,
// damit Vergleiche/Clamping trivial bleiben.
//
// Sync-Semantik: Der SYNC-Button eines Panels koppelt Zeit-Cursor,
// Kartenzoom (sharedView) und Modellauswahl (sharedModels/sharedMapModel)
// an den gemeinsamen Zustand; sync-aktive Panels LESEN die gemeinsamen
// Werte (useEffectivePanel), beim Aussteigen wird eingefroren.
//
// ParSync ist davon getrennt: Radio-Semantik über parSyncSource (Panel-Index
// oder null), KEIN Boolean pro Panel. Das aktive Panel ist die Quelle; sein
// Parameter wird beim Aktivieren und bei jedem Wechsel live in die übrigen
// Panels geschrieben (Push — beim Abschalten behalten alle den zuletzt
// gesetzten Parameter, kein Zurücksetzen). Solange eine Quelle aktiv ist,
// sind die parsync-Schalter der anderen Panels deaktiviert und deren
// Parameter-Dropdowns gesperrt; Modell, Modus und Zeit-Sync bleiben frei.
// Ist der Parameter in einem Panel nicht verfügbar (Modell-Schnittmenge),
// zeigt das Panel eine Meldung — die Modellauswahl wird NIE automatisch
// verändert, das würde die Vergleichsabsicht still zerstören.

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { DOMAIN_PRESETS, type DomainPreset } from '../config/domains'
import { DEFAULT_ENSEMBLE_MODEL, DEFAULT_ENSEMBLE_VARIABLE } from '../config/ensemble'
import { MAX_MODELS_PER_PANEL } from '../config/colors'
import { clampToRange, floorToStep, STEP_MS, TIME_RANGE } from '../config/time'

export interface LatLon {
  lat: number
  lon: number
  label?: string
}

export interface MapView {
  center: [number, number] // [lon, lat]
  zoom: number
}

export type PanelMode = 'map' | 'meteogram' | 'profile' | 'ensemble'

export interface PanelConfig {
  mode: PanelMode
  /** Meteogramm: mehrere Modelle überlagert — der Kern des Modellvergleichs. */
  models: string[]
  /** Farb-Slot je Modell; bleibt beim Abwählen anderer Modelle stabil. */
  modelSlots: Record<string, number>
  /** Karte: genau ein Modell — getrennt von der Meteogramm-Auswahl. */
  mapModel: string
  variable: string
  /**
   * Ensemble: eigenes Modell und eigene Variable. Getrennt von `models`/
   * `variable`, weil die Ensemble-API andere Modelle UND andere Größen führt
   * (u.a. Höhenwetter) — eine gemeinsame Auswahl würde ständig auf nicht
   * verfügbare Kombinationen zeigen. Ensembles werden bewusst NICHT von SYNC
   * gekoppelt: ein Ensemble je Panel ist teuer genug.
   */
  ensembleModel: string
  ensembleVariable: string
  /** SYNC: Zeit, Kartenzoom und Modell folgen dem gemeinsamen Zustand. */
  sync: boolean
  /** Eingefrorene Panel-Zeit, wirksam bei sync=false. */
  localTime: number
  /**
   * Hinweis aus dem Preset-Laden (z.B. Modell existiert nicht mehr) —
   * transient, wird nie mitgespeichert; per ✕ im Panel wegklickbar.
   */
  presetWarning?: string
}

interface WorkbenchStore {
  cursorTime: number
  domain: DomainPreset
  lockedLocation: LatLon | null
  /** Fixierter Modelllauf (Phase 3, Single-Runs-API) — bis dahin null. */
  runInit: number | null
  playing: boolean
  panels: PanelConfig[]

  // gemeinsamer Zustand für sync-aktive Panels
  sharedModels: string[]
  sharedModelSlots: Record<string, number>
  sharedMapModel: string
  /** Gemeinsame Kartenansicht; null bis die erste Sync-Karte bewegt wird. */
  sharedView: MapView | null

  /** ParSync-Quelle (Radio-Semantik): Panel-Index oder null. Nicht persistieren. */
  parSyncSource: number | null

  setCursorTime: (t: number) => void
  stepCursor: (hours: number) => void
  setPlaying: (playing: boolean) => void
  setDomain: (d: DomainPreset) => void
  setLockedLocation: (loc: LatLon | null) => void
  updatePanel: (index: number, patch: Partial<PanelConfig>) => void
  togglePanelModel: (index: number, modelId: string) => void
  toggleSync: (index: number) => void
  toggleSharedModel: (modelId: string) => void
  setSharedMapModel: (modelId: string) => void
  setSharedView: (view: MapView) => void
  /** Parameterwahl eines Panels — spiegelt live, wenn das Panel ParSync-Quelle ist. */
  setPanelVariable: (index: number, variable: string) => void
  activateParSync: (index: number) => void
  deactivateParSync: (index: number) => void
}

const DEFAULT_MODELS = ['icon_seamless', 'ecmwf_ifs025', 'gfs_seamless']
const DEFAULT_MAP_MODEL = 'icon_seamless'

const INITIAL_CURSOR = clampToRange(floorToStep(Date.now()))

function defaultSlots(models: string[]): Record<string, number> {
  const slots: Record<string, number> = {}
  models.forEach((m, i) => {
    slots[m] = i
  })
  return slots
}

/** Modell an-/abwählen mit stabiler Slot-Vergabe; null bei Modell-Limit. */
function toggleModel(
  models: string[],
  modelSlots: Record<string, number>,
  modelId: string,
): { models: string[]; modelSlots: Record<string, number> } | null {
  const slots = { ...modelSlots }
  if (models.includes(modelId)) {
    delete slots[modelId]
    return { models: models.filter((m) => m !== modelId), modelSlots: slots }
  }
  if (models.length >= MAX_MODELS_PER_PANEL) return null
  const used = new Set(Object.values(slots))
  let slot = 0
  while (used.has(slot)) slot++
  slots[modelId] = slot
  return { models: [...models, modelId], modelSlots: slots }
}

function makePanel(variable: string): PanelConfig {
  return {
    mode: 'meteogram',
    models: [...DEFAULT_MODELS],
    modelSlots: defaultSlots(DEFAULT_MODELS),
    mapModel: DEFAULT_MAP_MODEL,
    variable,
    ensembleModel: DEFAULT_ENSEMBLE_MODEL,
    ensembleVariable: DEFAULT_ENSEMBLE_VARIABLE,
    sync: true,
    localTime: INITIAL_CURSOR,
  }
}

/**
 * Quelle → alle übrigen Panels spiegeln. Bewusst OHNE Verfügbarkeits-Filter:
 * Panels, deren Modelle den Parameter nicht liefern, zeigen eine Meldung
 * (Meteogram/MapPanel) statt still übersprungen zu werden — und ihre
 * Modellauswahl bleibt unangetastet.
 */
function mirrorVariable(panels: PanelConfig[], sourceIndex: number, variable: string): PanelConfig[] {
  return panels.map((p, i) => (i === sourceIndex || p.variable === variable ? p : { ...p, variable }))
}

const DEFAULT_PANEL_VARIABLES = [
  'temperature_2m',
  'precipitation',
  'wind_speed_10m',
  'cloud_cover',
  'pressure_msl',
  'wind_gusts_10m',
]

export const useWorkbench = create<WorkbenchStore>((set) => ({
  cursorTime: INITIAL_CURSOR,
  domain: DOMAIN_PRESETS[0], // Europa
  lockedLocation: { lat: 52.52, lon: 13.41, label: 'Berlin' },
  runInit: null,
  playing: false,
  panels: DEFAULT_PANEL_VARIABLES.map(makePanel),

  sharedModels: [...DEFAULT_MODELS],
  sharedModelSlots: defaultSlots(DEFAULT_MODELS),
  sharedMapModel: DEFAULT_MAP_MODEL,
  sharedView: null,

  parSyncSource: null,

  setCursorTime: (t) => set({ cursorTime: clampToRange(floorToStep(t)) }),

  stepCursor: (hours) =>
    set((s) => ({ cursorTime: clampToRange(s.cursorTime + hours * STEP_MS) })),

  setPlaying: (playing) =>
    set((s) => {
      // Play am Ende des Horizonts startet vorn
      if (playing && s.cursorTime >= TIME_RANGE.end) {
        return { playing, cursorTime: TIME_RANGE.start }
      }
      return { playing }
    }),

  setDomain: (domain) => set({ domain }),

  setLockedLocation: (lockedLocation) => set({ lockedLocation }),

  updatePanel: (index, patch) =>
    set((s) => {
      const panels = s.panels.slice()
      panels[index] = { ...panels[index], ...patch }
      return { panels }
    }),

  togglePanelModel: (index, modelId) =>
    set((s) => {
      const p = s.panels[index]
      const toggled = toggleModel(p.models, p.modelSlots, modelId)
      if (!toggled) return s
      const panels = s.panels.slice()
      panels[index] = { ...p, ...toggled }
      return { panels }
    }),

  toggleSync: (index) =>
    set((s) => {
      const p = s.panels[index]
      const panels = s.panels.slice()
      if (p.sync) {
        // Aussteigen: gemeinsamen Stand einfrieren — Zeit, Modelle, Kartenmodell
        panels[index] = {
          ...p,
          sync: false,
          localTime: s.cursorTime,
          models: [...s.sharedModels],
          modelSlots: { ...s.sharedModelSlots },
          mapModel: s.sharedMapModel,
        }
      } else {
        panels[index] = { ...p, sync: true }
      }
      return { panels }
    }),

  toggleSharedModel: (modelId) =>
    set((s) => {
      const toggled = toggleModel(s.sharedModels, s.sharedModelSlots, modelId)
      if (!toggled) return s
      return { sharedModels: toggled.models, sharedModelSlots: toggled.modelSlots }
    }),

  setSharedMapModel: (sharedMapModel) => set({ sharedMapModel }),

  setSharedView: (sharedView) => set({ sharedView }),

  setPanelVariable: (index, variable) =>
    set((s) => {
      let panels = s.panels.slice()
      panels[index] = { ...panels[index], variable }
      // Ändert die Quelle ihren Parameter, folgen alle anderen sofort
      if (s.parSyncSource === index) {
        panels = mirrorVariable(panels, index, variable)
      }
      return { panels }
    }),

  activateParSync: (index) =>
    set((s) => {
      // Radio-Semantik: solange eine Quelle aktiv ist, kann keine zweite
      // entstehen (Buttons sind deaktiviert — das hier ist die zweite Linie)
      if (s.parSyncSource !== null) return s
      return {
        parSyncSource: index,
        panels: mirrorVariable(s.panels, index, s.panels[index].variable),
      }
    }),

  deactivateParSync: (index) =>
    set((s) => {
      // Abschalten nur über die Quelle; alle Panels behalten den zuletzt
      // gesetzten Parameter (kein Zurücksetzen — das wäre überraschend)
      if (s.parSyncSource !== index) return s
      return { parSyncSource: null }
    }),
}))

/**
 * Effektive Panel-Config: sync-aktive Panels lesen Modelle/Kartenmodell aus
 * dem gemeinsamen Zustand. Der Parameter ist immer panel-lokal — ParSync
 * spiegelt per Push in die Configs, statt abgeleitet zu werden.
 * Shallow-Vergleich verhindert Re-Renders ohne relevante Änderung.
 */
export function useEffectivePanel(index: number): PanelConfig {
  return useWorkbench(
    useShallow((s) => {
      const p = s.panels[index]
      return {
        ...p,
        models: p.sync ? s.sharedModels : p.models,
        modelSlots: p.sync ? s.sharedModelSlots : p.modelSlots,
        mapModel: p.sync ? s.sharedMapModel : p.mapModel,
      }
    }),
  )
}
