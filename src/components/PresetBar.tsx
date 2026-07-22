// Preset-Verwaltung in der TopBar: Dropdown + Speichern (mit Namensabfrage
// und „Standort mitspeichern“-Haken), Überschreiben/Umbenennen/Löschen mit
// Rückfrage, Export (einzeln/Sammlung) und Import mit Strukturvalidierung.

import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  applyPreset,
  createPresetFromState,
  exportAllPresets,
  exportPreset,
  isPresetDirty,
  usePresets,
} from '../state/presets'
import { useWorkbench } from '../state/workbench'

export function PresetBar() {
  const presets = usePresets((s) => s.presets)
  const activePresetId = usePresets((s) => s.activePresetId)
  const addPreset = usePresets((s) => s.addPreset)
  const overwritePreset = usePresets((s) => s.overwritePreset)
  const renamePreset = usePresets((s) => s.renamePreset)
  const deletePreset = usePresets((s) => s.deletePreset)
  const setActivePresetId = usePresets((s) => s.setActivePresetId)
  const importPresets = usePresets((s) => s.importPresets)

  // Für die „geändert“-Markierung alle preset-relevanten Teile abonnieren
  // (bewusst ohne cursorTime — der Play-Modus soll hier keine Renders treiben)
  const relevant = useWorkbench(
    useShallow((s) => ({
      domain: s.domain,
      panels: s.panels,
      parSyncSource: s.parSyncSource,
      lockedLocation: s.lockedLocation,
      sharedModels: s.sharedModels,
      sharedModelSlots: s.sharedModelSlots,
      sharedMapModel: s.sharedMapModel,
    })),
  )

  const domainLabel = relevant.domain.label
  const active = presets.find((p) => p.id === activePresetId) ?? null
  // `relevant` ist nur als Render-Trigger abonniert — der Vergleich selbst
  // liest den Store direkt; Neuberechnung pro Render ist billig (~KB stringify)
  const dirty = active !== null && isPresetDirty(active)

  const [saveName, setSaveName] = useState('')
  const [saveLocation, setSaveLocation] = useState(false)
  const saveDetailsRef = useRef<HTMLDetailsElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const defaultName = `${domainLabel} · ${new Date().toLocaleDateString('de-DE')}`

  function submitSave(e: React.FormEvent) {
    e.preventDefault()
    const name = saveName.trim() || defaultName
    addPreset(createPresetFromState(name, saveLocation))
    setSaveName('')
    if (saveDetailsRef.current) saveDetailsRef.current.open = false
  }

  function onSelect(id: string) {
    if (!id) {
      setActivePresetId(null)
      return
    }
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    applyPreset(preset)
    setActivePresetId(id)
  }

  // Das Dropdown ist controlled — die erneute Anwahl des bereits aktiven
  // Presets feuert kein change-Event. Der Laden-Button wendet deshalb das
  // gewählte Preset IMMER an (auch zum Verwerfen von „geändert“).
  function onReload() {
    if (active) applyPreset(active)
  }

  function onOverwrite() {
    if (!active || active.builtin) return
    if (confirm(`Preset „${active.name}“ mit dem aktuellen Zustand überschreiben?`)) {
      overwritePreset(active.id)
    }
  }

  function onRename() {
    if (!active || active.builtin) return
    const name = prompt('Neuer Name:', active.name)
    if (name?.trim()) renamePreset(active.id, name.trim())
  }

  function onDelete() {
    if (!active || active.builtin) return
    if (confirm(`Preset „${active.name}“ löschen?`)) deletePreset(active.id)
  }

  async function onImportFile(file: File) {
    try {
      const result = importPresets(JSON.parse(await file.text()))
      const parts = [`${result.imported} Preset(s) importiert`]
      if (result.errors.length > 0) parts.push(`übersprungen: ${result.errors.join('; ')}`)
      alert(parts.join(' — '))
    } catch {
      alert('Import fehlgeschlagen: Datei ist kein gültiges JSON.')
    }
  }

  const canModify = active !== null && !active.builtin

  return (
    <div className="preset-bar">
      <select
        value={activePresetId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        title="Gespeicherte Presets — Auswahl lädt das Preset"
      >
        <option value="">— Preset —</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.builtin ? '★ ' : ''}
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!active}
        onClick={onReload}
        title="Gewähltes Preset laden bzw. auf den gespeicherten Stand zurücksetzen"
      >
        ↺
      </button>
      {active && dirty && (
        <span className="preset-dirty" title="Aktueller Zustand weicht vom gespeicherten Preset ab">
          geändert
        </span>
      )}

      <details className="preset-save" ref={saveDetailsRef}>
        <summary title="Aktuellen Zustand als neues Preset speichern">＋</summary>
        <form className="preset-save-form" onSubmit={submitSave}>
          <input
            type="text"
            value={saveName}
            placeholder={defaultName}
            onChange={(e) => setSaveName(e.target.value)}
            autoFocus
          />
          <label>
            <input
              type="checkbox"
              checked={saveLocation}
              onChange={(e) => setSaveLocation(e.target.checked)}
            />
            Standort mitspeichern
          </label>
          <button type="submit">Speichern</button>
        </form>
      </details>

      <button type="button" disabled={!canModify} onClick={onOverwrite} title="Preset mit aktuellem Zustand überschreiben">
        💾
      </button>
      <button type="button" disabled={!canModify} onClick={onRename} title="Preset umbenennen">
        ✎
      </button>
      <button type="button" disabled={!canModify} onClick={onDelete} title="Preset löschen (builtin-Presets sind geschützt)">
        🗑
      </button>
      <button type="button" disabled={!active} onClick={() => active && exportPreset(active)} title="Aktives Preset als JSON-Datei exportieren">
        ⤓
      </button>
      <button type="button" onClick={exportAllPresets} title="Alle eigenen Presets als Sammlung exportieren">
        ⤓⃰
      </button>
      <button type="button" onClick={() => fileInputRef.current?.click()} title="Presets aus JSON-Datei importieren (einzeln oder Sammlung)">
        ⤒
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onImportFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
