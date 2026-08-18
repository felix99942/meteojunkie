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
//
// Layout (6er/4er/2er/1er, Standard 4): NUR eine Anzeigefrage. Es gibt immer alle sechs
// Panel-Configs; die reduzierten Layouts zeigen die ERSTEN N und blenden den
// Rest aus, statt zu löschen — zurückschalten stellt jede Config unverändert
// wieder her. Bewusst ohne Auswahl, welches Panel wohin kommt: Modus, Modell
// und Parameter stellt man ohnehin im Panel selbst ein, ein zweiter Weg dahin
// wäre nur eine Bedienstelle mehr. Nebeneffekt und Absicht zugleich:
// ausgeblendete Panels rendern nicht und fetchen deshalb nichts
// (SPEC §1 — API-Sparsamkeit).

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { DOMAIN_PRESETS, type DomainPreset } from '../config/domains'
import {
  DEFAULT_ENSEMBLE_MODEL,
  DEFAULT_ENSEMBLE_VARIABLE,
  getEnsembleModel,
  type EnsembleAccumView,
} from '../config/ensemble'
import { getModel, modelHorizonEnd } from '../config/models'
import { MAX_MODELS_PER_PANEL } from '../config/colors'
import type { AccumView } from '../config/variables'
import { clampToRange, floorToStep, STEP_MS, TIME_RANGE } from '../config/time'
import { activePanelSection, isPanelSection, useAppView, type PanelSection } from './appView'

export interface LatLon {
  lat: number
  lon: number
  label?: string
}

export interface MapView {
  center: [number, number] // [lon, lat]
  zoom: number
}

/**
 * Modus INNERHALB des Meteogramm-Bereichs. Ensemble und Vertikalprofil sind
 * seit der Bereichs-Navigation eigene Bereiche (state/appView.ts) und keine
 * Panel-Modi mehr — dieselbe PanelConfig führt ihre Einstellungen in eigenen
 * Feldern weiter, der Bereichswechsel verliert also nichts.
 */
export type PanelMode = 'map' | 'meteogram'

/** Anzahl gleichzeitig sichtbarer Panels. 6 = Vollraster, darunter Fokuslayouts. */
export type PanelLayout = 6 | 4 | 2 | 1

export const PANEL_LAYOUTS: { value: PanelLayout; label: string; title: string }[] = [
  { value: 6, label: '6', title: 'Sechs Panels (3×2) — der volle Modellvergleich' },
  { value: 4, label: '4', title: 'Vier Panels (2×2) — Standard beim Laden' },
  { value: 2, label: '2', title: 'Zwei Panels nebeneinander — direkter Zweiervergleich' },
  { value: 1, label: '1', title: 'Ein Panel über die volle Fläche' },
]

/**
 * Layout beim Laden der Seite. Vier Panels sind der Arbeitsalltag; die beiden
 * übrigen Configs bleiben erhalten und sind einen Klick entfernt. Nebeneffekt:
 * ihre Serien werden beim Kaltstart gar nicht erst geholt (SPEC §1).
 */
export const DEFAULT_LAYOUT: Record<PanelSection, PanelLayout> = {
  workbench: 4,
  // Profile sind datenschwer (~100 Level-Variablen je Panel) — zwei Panels
  // sind hier der sinnvolle Start, mehr ist einen Klick entfernt. Ensemble
  // startet bei EINEM Panel: das Plume-Diagramm braucht selbst schon viel
  // Breite (51+ Member, mehrere Modelle) und ist bei zwei nebeneinander kaum
  // lesbar — anders als bei den schmalen Meteogramm-Panels.
  ensemble: 1,
  profile: 2,
}

/** Fixe Panelzahl — das Raster ist auf sechs Configs ausgelegt (SPEC §1). */
export const PANEL_COUNT = 6

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
  /**
   * Darstellung von Summengrößen (Niederschlag/Schneefall) im Meteogramm:
   * Rate in mm/h oder kumulierte Summe. Für alle übrigen Variablen wirkungslos,
   * bleibt aber erhalten — so ist die Wahl nach einem Ausflug zur Temperatur
   * noch da. Bewusst panel-lokal und NICHT von SYNC gekoppelt: die beiden
   * Sichten nebeneinander in zwei Panels ist ein sinnvoller Vergleich.
   */
  accumView: AccumView
  /**
   * Dasselbe fürs Ensemble, aber mit eigenen Werten: dort ist die Rate als 51
   * Spaghetti unlesbar, sinnvoll sind kumulierte Summe oder 6-h-Mengen.
   */
  ensembleAccumView: EnsembleAccumView
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

  /**
   * Sichtbare Panelzahl JE BEREICH — reine Anzeige, die Configs bleiben immer
   * alle sechs. Pro Bereich getrennt, weil vier Ensembles etwas ganz anderes
   * kosten als vier Meteogramme.
   */
  layouts: Record<PanelSection, PanelLayout>

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
  setLayout: (layout: PanelLayout) => void
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

// Meteogramme starten mit GENAU EINEM Modell: IFS als Referenzlauf. Weitere
// Modelle kommen per Modellwähler dazu — vorausgewählte Vergleiche kosten
// beim Laden Budget für Serien, die man vielleicht gar nicht sehen wollte
// (SPEC §1). Die Karte hat davon unabhängig ihr eigenes Einzelmodell.
const DEFAULT_MODELS = ['ecmwf_ifs025']
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
    accumView: 'rate',
    ensembleAccumView: 'sum',
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

/**
 * Sichtbare Panel-Indizes in Anzeigereihenfolge — immer die ersten `layout`.
 * Einzige Quelle dafür, welche Panels gerendert werden; Store und UI leiten
 * beide hierüber ab.
 */
export function visiblePanelIndices(layout: PanelLayout): number[] {
  return Array.from({ length: Math.min(layout, PANEL_COUNT) }, (_, i) => i)
}

/** Zustandsausschnitt, aus dem sich der aktive Horizont ergibt. */
type HorizonState = Pick<
  WorkbenchStore,
  'panels' | 'layouts' | 'sharedModels' | 'sharedMapModel'
>

/**
 * Ende des am weitesten reichenden AKTIVEN Modells. Nur SICHTBARE Panels des
 * AKTIVEN BEREICHS zählen — ausgeblendete holen keine Daten, ihr Horizont wäre
 * ein Versprechen auf nichts. Im Ensemble-Bereich kommt der Horizont tagesgenau
 * ab Rasterbeginn aus der Ensemble-Registry (so zählt `forecast_days`), sonst
 * über `modelHorizonEnd` ab der Lauf-Init. Profile bringen keinen eigenen
 * Horizont ein (sie zeigen einen Zeitschritt, keine Reihe).
 * Gibt `null` zurück, wenn gar kein Modell aktiv ist.
 */
export function activeHorizonEnd(s: HorizonState): number | null {
  const section = activePanelSection()
  let maxHorizon: number | null = null
  const take = (t: number) => {
    maxHorizon = maxHorizon === null ? t : Math.max(maxHorizon, t)
  }
  for (const i of visiblePanelIndices(s.layouts[section])) {
    const p = s.panels[i]
    if (!p) continue
    if (section === 'ensemble') {
      const days = getEnsembleModel(p.ensembleModel).forecastDays
      take(TIME_RANGE.start + (days * 24 - 1) * STEP_MS)
      continue
    }
    if (section === 'profile') continue
    const ids = p.mode === 'map' ? [p.sync ? s.sharedMapModel : p.mapModel] : p.sync ? s.sharedModels : p.models
    for (const id of ids) take(modelHorizonEnd(getModel(id)))
  }
  return maxHorizon
}

/**
 * Obergrenze des Zeit-Cursors. Reicht ein aktives Modell über das
 * deterministische 16-Tage-Raster hinaus (nur Ensembles können das — die
 * Forecast-API deckelt bei 16), wandert der Regler mit; sonst bleibt es beim
 * Raster. Bewusst NIE kürzer als `TIME_RANGE.end`: der Bereich hinter kürzeren
 * Modellen wird schraffiert, nicht abgeschnitten — sonst spränge die
 * Reglerlänge bei jedem Modellwechsel.
 */
export function cursorRangeEnd(s: HorizonState): number {
  const horizon = activeHorizonEnd(s)
  return horizon === null ? TIME_RANGE.end : Math.max(TIME_RANGE.end, horizon)
}

/**
 * ParSync abschalten, wenn die Quelle nicht mehr sichtbar ist: abschalten geht
 * laut Radio-Semantik nur über die Quelle, ein ausgeblendetes Quellpanel würde
 * die übrigen Parameter-Dropdowns dauerhaft sperren. Die zuletzt gespiegelten
 * Werte bleiben stehen — wie beim normalen Abschalten.
 */
function parSyncAfterLayout(parSyncSource: number | null, layout: PanelLayout): number | null {
  if (parSyncSource === null) return null
  return parSyncSource < layout ? parSyncSource : null
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

  layouts: { ...DEFAULT_LAYOUT },

  sharedModels: [...DEFAULT_MODELS],
  sharedModelSlots: defaultSlots(DEFAULT_MODELS),
  sharedMapModel: DEFAULT_MAP_MODEL,
  sharedView: null,

  parSyncSource: null,

  // Alle drei clampen gegen den AKTIVEN Horizont, nicht gegen TIME_RANGE.end —
  // sonst endet der Regler mitten in einer Ensemble-Plume (GEFS: ~34 Tage).
  setCursorTime: (t) =>
    set((s) => ({ cursorTime: clampToRange(floorToStep(t), cursorRangeEnd(s)) })),

  stepCursor: (hours) =>
    set((s) => ({
      cursorTime: clampToRange(s.cursorTime + hours * STEP_MS, cursorRangeEnd(s)),
    })),

  setPlaying: (playing) =>
    set((s) => {
      // Play am Ende des Horizonts startet vorn
      if (playing && s.cursorTime >= cursorRangeEnd(s)) {
        return { playing, cursorTime: TIME_RANGE.start }
      }
      return { playing }
    }),

  setDomain: (domain) => set({ domain }),

  setLockedLocation: (lockedLocation) => set({ lockedLocation }),

  // Layout gilt je Bereich: vier Ensembles kosten etwas ganz anderes als vier
  // Meteogramme, eine gemeinsame Zahl wäre für beide falsch.
  setLayout: (layout) =>
    set((s) => {
      const section = activePanelSection()
      return {
        layouts: { ...s.layouts, [section]: layout },
        parSyncSource: parSyncAfterLayout(s.parSyncSource, layout),
      }
    }),

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

/** Sichtbare Panel-Indizes als Hook; Shallow-Vergleich gegen leere Re-Renders. */
export function useVisiblePanels(): number[] {
  const view = useAppView((s) => s.view)
  const section = isPanelSection(view) ? view : 'workbench'
  return useWorkbench(useShallow((s) => visiblePanelIndices(s.layouts[section])))
}

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
