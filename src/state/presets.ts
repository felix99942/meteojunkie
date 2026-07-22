// Speicherbare Panel-Presets — der Mechanismus für die Wetterlagen-Presets
// aus SPEC §13: mitgelieferte Vorlagen passen später als builtin-Presets
// (nicht löschbar) ohne Umbau daneben (BUILTIN_PRESETS unten befüllen).
//
// Gespeichert: Domain, pro Panel Modus/Modellauswahl/Parameter/Sync-Flag,
// parSyncSource, Zoom-Sync-Flag, optional lockedLocation.
// NICHT gespeichert: cursorTime und panel-lokale Zeiten (absolute Zeitpunkte
// sind beim Laden wertlos — die aktuelle Zeit bleibt stehen), runInit,
// Kartenausschnitt (folgt der Domain).
//
// Ablage: localStorage unter eigenem Prefix, getrennt vom IndexedDB-Cache —
// Presets sind klein, IndexedDB wäre Overhead. Zusätzlich Export/Import als
// JSON-Datei (einzeln und als Sammlung): versionierbar im Projektordner,
// überlebt gelöschte Browserdaten, weitergebbar.

import { create } from 'zustand'
import { DOMAIN_PRESETS } from '../config/domains'
import { getModel, isDomainInCoverage, MODELS } from '../config/models'
import { HOURLY_VARIABLES } from '../config/variables'
import {
  useWorkbench,
  type LatLon,
  type PanelConfig,
  type PanelMode,
} from './workbench'

export const PRESET_SCHEMA_VERSION = 1
const STORAGE_KEY = 'meteo-workbench:presets' // eigener Prefix, getrennt vom IDB-Cache

export interface PresetPanel {
  mode: PanelMode
  models: string[]
  modelSlots: Record<string, number>
  mapModel: string
  variable: string
  sync: boolean
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  createdAt: string
  /** für spätere Migrationen */
  schemaVersion: number
  domain: string // DomainPreset-ID
  panels: PresetPanel[]
  parSyncSource: number | null
  /**
   * Zoom-Sync-Flag. Es gibt keinen separaten globalen Zoom-Schalter —
   * Kamera-Sync hängt an den per-Panel-sync-Flags, die mitgespeichert
   * werden. Das Feld wird als Ableitung (irgendein Panel synct) gespeichert
   * und beim Laden von den Panel-Flags abgedeckt.
   */
  zoomSync: boolean
  lockedLocation?: LatLon
}

/** Mitgelieferte Wetterlagen-Vorlagen (SPEC §13) — hier ergänzen, nicht löschbar. */
const BUILTIN_PRESETS: Preset[] = []

// --- Validierung -----------------------------------------------------------

const PANEL_MODES: PanelMode[] = ['map', 'meteogram', 'profile', 'ensemble']

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Strukturvalidierung vor jeder Übernahme (Import/localStorage). null = ok. */
export function validatePresetStructure(u: unknown): string | null {
  if (typeof u !== 'object' || u === null) return 'kein Objekt'
  const p = u as Record<string, unknown>
  if (typeof p.id !== 'string' || !p.id) return 'id fehlt'
  if (typeof p.name !== 'string' || !p.name) return 'name fehlt'
  if (typeof p.schemaVersion !== 'number') return 'schemaVersion fehlt'
  if (p.schemaVersion > PRESET_SCHEMA_VERSION)
    return `schemaVersion ${p.schemaVersion} ist neuer als unterstützt (${PRESET_SCHEMA_VERSION})`
  if (typeof p.domain !== 'string') return 'domain fehlt'
  if (!Array.isArray(p.panels)) return 'panels fehlt'
  for (const [i, pp] of (p.panels as unknown[]).entries()) {
    if (typeof pp !== 'object' || pp === null) return `Panel ${i + 1}: kein Objekt`
    const q = pp as Record<string, unknown>
    if (!PANEL_MODES.includes(q.mode as PanelMode)) return `Panel ${i + 1}: ungültiger Modus`
    if (!isStringArray(q.models)) return `Panel ${i + 1}: models ungültig`
    if (typeof q.mapModel !== 'string') return `Panel ${i + 1}: mapModel fehlt`
    if (typeof q.variable !== 'string') return `Panel ${i + 1}: variable fehlt`
    if (typeof q.sync !== 'boolean') return `Panel ${i + 1}: sync fehlt`
    if (typeof q.modelSlots !== 'object' || q.modelSlots === null)
      return `Panel ${i + 1}: modelSlots fehlt`
  }
  if (p.parSyncSource !== null && typeof p.parSyncSource !== 'number')
    return 'parSyncSource ungültig'
  return null
}

// --- Snapshot (Speichern) ---------------------------------------------------

/** Effektive Panel-Configs einfrieren (WYSIWYG: sync-Panels lesen shared). */
function snapshotPanels(): PresetPanel[] {
  const s = useWorkbench.getState()
  return s.panels.map((p) => ({
    mode: p.mode,
    models: p.sync ? [...s.sharedModels] : [...p.models],
    modelSlots: { ...(p.sync ? s.sharedModelSlots : p.modelSlots) },
    mapModel: p.sync ? s.sharedMapModel : p.mapModel,
    variable: p.variable,
    sync: p.sync,
  }))
}

export function createPresetFromState(name: string, includeLocation: boolean): Preset {
  const s = useWorkbench.getState()
  return {
    id: crypto.randomUUID(),
    name,
    builtin: false,
    createdAt: new Date().toISOString(),
    schemaVersion: PRESET_SCHEMA_VERSION,
    domain: s.domain.id,
    panels: snapshotPanels(),
    parSyncSource: s.parSyncSource,
    zoomSync: s.panels.some((p) => p.sync),
    ...(includeLocation && s.lockedLocation ? { lockedLocation: s.lockedLocation } : {}),
  }
}

// --- Laden mit Panel-weiser Validierung -------------------------------------

const modelExists = (id: string) => MODELS.some((m) => m.id === id)
const variableExists = (id: string) => HOURLY_VARIABLES.some((v) => v.id === id)

/**
 * Ein Preset-Panel wiederherstellen. Ungültige Einträge werden weder still
 * verworfen noch durch Defaults ersetzt: das Panel lädt, soweit möglich
 * (fehlende Teile behalten den bisherigen Wert), und `presetWarning` sagt
 * deutlich, was fehlte. Ein ungültiges Panel bricht das Laden nie ab.
 */
function restorePanel(pp: PresetPanel, current: PanelConfig, now: number): PanelConfig {
  const issues: string[] = []

  const models = pp.models.filter((id) => {
    if (modelExists(id)) return true
    issues.push(`Modell „${id}“ existiert nicht mehr`)
    return false
  })
  const modelSlots: Record<string, number> = {}
  for (const id of models) {
    if (typeof pp.modelSlots[id] === 'number') modelSlots[id] = pp.modelSlots[id]
  }

  let mapModel = pp.mapModel
  if (!modelExists(mapModel)) {
    issues.push(`Kartenmodell „${pp.mapModel}“ existiert nicht mehr — bisheriges beibehalten`)
    mapModel = current.mapModel
  }

  let variable = pp.variable
  if (!variableExists(variable)) {
    issues.push(`Parameter „${pp.variable}“ unbekannt — bisheriger beibehalten`)
    variable = current.variable
  }

  return {
    mode: pp.mode,
    models,
    modelSlots,
    mapModel,
    variable,
    sync: pp.sync,
    localTime: now, // Zeiten werden nicht persistiert — aktuelle Zeit bleibt
    presetWarning: issues.length > 0 ? issues.join(' · ') : undefined,
  }
}

/**
 * Preset in den Workbench-State übernehmen. Die dadurch ausgelösten
 * Gitterabrufe laufen automatisch durch Queue + Cache (fetchGridField);
 * jedes Panel zeigt seinen eigenen Ladezustand.
 */
export function applyPreset(preset: Preset): void {
  const s = useWorkbench.getState()
  const now = s.cursorTime

  const domain = DOMAIN_PRESETS.find((d) => d.id === preset.domain)
  const panels = s.panels.map((current, i) => {
    const pp = preset.panels[i]
    if (!pp) return current // Preset hat weniger Panels → Rest unangetastet
    const restored = restorePanel(pp, current, now)
    if (!domain) {
      restored.presetWarning = [
        `Domain „${preset.domain}“ existiert nicht mehr — aktuelle beibehalten`,
        restored.presetWarning,
      ]
        .filter(Boolean)
        .join(' · ')
    } else if (
      restored.mode === 'map' &&
      !isDomainInCoverage(getModel(restored.mapModel), domain.bbox)
    ) {
      // Coverage-Hinweis zeigt das MapPanel selbst — hier nur laden
    }
    return restored
  })

  // shared-Zustand aus dem ersten sync-aktiven Panel rekonstruieren
  // (beim Speichern waren die effektiven Werte aller sync-Panels identisch)
  const firstSync = panels.find((p) => p.sync)
  const parSyncSource =
    preset.parSyncSource !== null &&
    preset.parSyncSource >= 0 &&
    preset.parSyncSource < panels.length
      ? preset.parSyncSource
      : null

  useWorkbench.setState({
    ...(domain ? { domain } : {}),
    panels,
    parSyncSource,
    ...(firstSync
      ? {
          sharedModels: [...firstSync.models],
          sharedModelSlots: { ...firstSync.modelSlots },
          sharedMapModel: firstSync.mapModel,
        }
      : {}),
    sharedView: null, // Kartenausschnitt folgt der Domain (fitBounds)
    ...(preset.lockedLocation ? { lockedLocation: preset.lockedLocation } : {}),
  })
}

// --- Vergleich für die „geändert“-Markierung --------------------------------

function comparableOfPreset(p: Preset): string {
  return JSON.stringify({
    domain: p.domain,
    panels: p.panels,
    parSyncSource: p.parSyncSource,
    lockedLocation: p.lockedLocation ?? null,
  })
}

/** Aktuellen Zustand in dieselbe Vergleichsform bringen wie das Preset. */
export function comparableOfCurrentState(preset: Preset): string {
  const s = useWorkbench.getState()
  return JSON.stringify({
    domain: s.domain.id,
    panels: snapshotPanels(),
    parSyncSource: s.parSyncSource,
    lockedLocation: preset.lockedLocation ? s.lockedLocation : null,
  })
}

export function isPresetDirty(preset: Preset): boolean {
  return comparableOfPreset(preset) !== comparableOfCurrentState(preset)
}

// --- Store + localStorage ---------------------------------------------------

function loadStored(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((p): p is Preset => validatePresetStructure(p) === null)
  } catch {
    return []
  }
}

function persist(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.filter((p) => !p.builtin)))
  } catch {
    // Speicher voll/blockiert — Presets leben dann nur in der Session
  }
}

export interface ImportResult {
  imported: number
  errors: string[]
}

interface PresetStore {
  presets: Preset[]
  activePresetId: string | null
  addPreset: (preset: Preset) => void
  overwritePreset: (id: string) => void
  renamePreset: (id: string, name: string) => void
  deletePreset: (id: string) => void
  setActivePresetId: (id: string | null) => void
  importPresets: (data: unknown) => ImportResult
}

export const usePresets = create<PresetStore>((set) => ({
  presets: [...BUILTIN_PRESETS, ...loadStored()],
  activePresetId: null,

  addPreset: (preset) =>
    set((s) => {
      const presets = [...s.presets, preset]
      persist(presets)
      return { presets, activePresetId: preset.id }
    }),

  overwritePreset: (id) =>
    set((s) => {
      const existing = s.presets.find((p) => p.id === id)
      if (!existing || existing.builtin) return s
      const updated: Preset = {
        ...createPresetFromState(existing.name, existing.lockedLocation !== undefined),
        id: existing.id,
        createdAt: existing.createdAt,
      }
      const presets = s.presets.map((p) => (p.id === id ? updated : p))
      persist(presets)
      return { presets }
    }),

  renamePreset: (id, name) =>
    set((s) => {
      const presets = s.presets.map((p) =>
        p.id === id && !p.builtin ? { ...p, name } : p,
      )
      persist(presets)
      return { presets }
    }),

  deletePreset: (id) =>
    set((s) => {
      // builtin-Presets sind nicht löschbar
      const target = s.presets.find((p) => p.id === id)
      if (!target || target.builtin) return s
      const presets = s.presets.filter((p) => p.id !== id)
      persist(presets)
      return {
        presets,
        activePresetId: s.activePresetId === id ? null : s.activePresetId,
      }
    }),

  setActivePresetId: (activePresetId) => set({ activePresetId }),

  importPresets: (data) => {
    // Einzel-Preset, Array oder Sammlung { presets: [...] }
    const list: unknown[] = Array.isArray(data)
      ? data
      : typeof data === 'object' && data !== null && Array.isArray((data as { presets?: unknown[] }).presets)
        ? (data as { presets: unknown[] }).presets
        : [data]

    const errors: string[] = []
    const valid: Preset[] = []
    for (const [i, raw] of list.entries()) {
      const err = validatePresetStructure(raw)
      if (err) {
        errors.push(`Eintrag ${i + 1}: ${err}`)
        continue
      }
      // importierte Presets sind nie builtin (sonst unlöschbar)
      valid.push({ ...(raw as Preset), builtin: false })
    }

    if (valid.length > 0) {
      set((s) => {
        const presets = [...s.presets]
        for (const p of valid) {
          const idx = presets.findIndex((x) => x.id === p.id && !x.builtin)
          if (idx >= 0) presets[idx] = p // Re-Import aktualisiert
          else presets.push(presets.some((x) => x.id === p.id) ? { ...p, id: crypto.randomUUID() } : p)
        }
        persist(presets)
        return { presets }
      })
    }
    return { imported: valid.length, errors }
  },
}))

// --- Export als Datei -------------------------------------------------------

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '')

export function exportPreset(preset: Preset): void {
  download(`preset-${slug(preset.name)}.json`, JSON.stringify(preset, null, 2))
}

export function exportAllPresets(): void {
  const presets = usePresets.getState().presets.filter((p) => !p.builtin)
  download(
    'meteo-workbench-presets.json',
    JSON.stringify({ schemaVersion: PRESET_SCHEMA_VERSION, presets }, null, 2),
  )
}
