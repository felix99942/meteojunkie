// Layout- und Horizontlogik des Workbench-Stores. Getestet wird der reine
// Zustandsteil (Zustand läuft ohne DOM) — „welche Panels sind sichtbar, wie
// weit reicht der Zeit-Cursor und was passiert dabei mit parsync" ist genau
// das, was man beim Umbauen kaputt macht.

import { beforeEach, describe, expect, it } from 'vitest'
import { STEP_MS, TIME_RANGE } from '../config/time'
import { useAppView, type AppView } from './appView'
import {
  activeHorizonEnd,
  cursorRangeEnd,
  DEFAULT_LAYOUT,
  PANEL_COUNT,
  useWorkbench,
  visiblePanelIndices,
} from './workbench'

const initial = useWorkbench.getState()

/** Bereich umschalten — der Store liest ihn über appView (siehe workbench.ts). */
function setView(view: AppView) {
  useAppView.getState().setView(view)
}

beforeEach(() => {
  setView('workbench')
  useWorkbench.setState({
    layouts: { workbench: 6, ensemble: 2, profile: 2 },
    parSyncSource: null,
    cursorTime: initial.cursorTime,
    panels: initial.panels.map((p) => ({ ...p })),
  })
})

describe('visiblePanelIndices', () => {
  it('zeigt immer die ersten N Panels', () => {
    expect(visiblePanelIndices(6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(visiblePanelIndices(4)).toEqual([0, 1, 2, 3])
    expect(visiblePanelIndices(2)).toEqual([0, 1])
    expect(visiblePanelIndices(1)).toEqual([0])
  })

  it('startet im Meteogramm-Bereich mit vier Panels', () => {
    expect(DEFAULT_LAYOUT.workbench).toBe(4)
    // Ensemble startet bei einem Panel (Plume-Diagramm braucht selbst schon
    // viel Breite), Profil bei zwei (datenschwer, aber schmaler lesbar).
    expect(DEFAULT_LAYOUT.ensemble).toBe(1)
    expect(DEFAULT_LAYOUT.profile).toBe(2)
  })
})

describe('setLayout', () => {
  it('gilt je Bereich und lässt die übrigen unberührt', () => {
    setView('ensemble')
    useWorkbench.getState().setLayout(4)
    expect(useWorkbench.getState().layouts).toEqual({ workbench: 6, ensemble: 4, profile: 2 })
  })

  it('lässt alle sechs Panel-Configs unangetastet', () => {
    // Kernzusage des Layouts: es blendet aus, es löscht nicht
    const before = JSON.stringify(useWorkbench.getState().panels)
    useWorkbench.getState().setLayout(1)
    expect(JSON.stringify(useWorkbench.getState().panels)).toBe(before)
    useWorkbench.getState().setLayout(6)
    expect(JSON.stringify(useWorkbench.getState().panels)).toBe(before)
    expect(useWorkbench.getState().panels).toHaveLength(PANEL_COUNT)
  })
})

describe('Zeit-Cursor und Modellhorizont', () => {
  const gefsEnd = TIME_RANGE.start + (35 * 24 - 1) * STEP_MS

  function setEnsembleModel(id: string) {
    const panels = useWorkbench.getState().panels.map((p) => ({ ...p, ensembleModel: id }))
    useWorkbench.setState({ panels })
  }

  it('reicht im Ensemble-Bereich bis ans Ende des längsten Ensembles', () => {
    setView('ensemble')
    setEnsembleModel('gfs_seamless')
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(gefsEnd)
    expect(gefsEnd).toBeGreaterThan(TIME_RANGE.end)
  })

  it('bleibt beim 16-Tage-Raster, wenn alle Modelle kürzer sind', () => {
    // ECMWF ENS reicht 15 Tage — der Regler wird deshalb NICHT kürzer, der
    // Bereich dahinter wird schraffiert statt abgeschnitten
    setView('ensemble')
    setEnsembleModel('ecmwf_ifs025')
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(TIME_RANGE.end)
  })

  it('zählt den Ensemble-Horizont NICHT im Meteogramm-Bereich', () => {
    // dort werden die Ensembles gar nicht geholt — ihr Horizont wäre ein
    // Versprechen auf Daten, die dieser Bereich nie anfragt
    setEnsembleModel('gfs_seamless')
    setView('workbench')
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(TIME_RANGE.end)
  })

  it('zählt nur sichtbare Panels', () => {
    setView('ensemble')
    const panels = useWorkbench.getState().panels.map((p, i) => ({
      ...p,
      ensembleModel: i === 5 ? 'gfs_seamless' : 'ecmwf_ifs025',
    }))
    useWorkbench.setState({ panels, layouts: { workbench: 6, ensemble: 6, profile: 2 } })
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(gefsEnd)
    // Panel 6 ausgeblendet → sein Horizont zählt nicht mehr
    useWorkbench.setState({ layouts: { workbench: 6, ensemble: 2, profile: 2 } })
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(TIME_RANGE.end)
  })

  it('lässt den Cursor in den Ensemble-Bereich hinter Tag 16 laufen', () => {
    setView('ensemble')
    setEnsembleModel('gfs_seamless')
    useWorkbench.getState().setCursorTime(gefsEnd)
    expect(useWorkbench.getState().cursorTime).toBe(gefsEnd)
    // und clamped sauber am Ende, statt darüber hinaus zu laufen
    useWorkbench.getState().stepCursor(24)
    expect(useWorkbench.getState().cursorTime).toBe(gefsEnd)
  })

  it('deckelt ohne langes Ensemble weiter beim Raster', () => {
    setView('ensemble')
    setEnsembleModel('ecmwf_ifs025')
    useWorkbench.getState().setCursorTime(gefsEnd)
    expect(useWorkbench.getState().cursorTime).toBe(TIME_RANGE.end)
  })

  it('meldet im Profil-Bereich keinen Horizont', () => {
    // Profile zeigen einen Zeitschritt, keine Reihe — sie bringen nichts ein
    setView('profile')
    expect(activeHorizonEnd(useWorkbench.getState())).toBeNull()
    expect(cursorRangeEnd(useWorkbench.getState())).toBe(TIME_RANGE.end)
  })
})

describe('parsync und Sichtbarkeit', () => {
  it('schaltet parsync ab, wenn die Quelle ausgeblendet wird', () => {
    // sonst blieben die Parameter-Dropdowns der übrigen Panels gesperrt:
    // abschalten geht laut Radio-Semantik nur über die Quelle
    useWorkbench.getState().activateParSync(4)
    expect(useWorkbench.getState().parSyncSource).toBe(4)
    useWorkbench.getState().setLayout(4) // sichtbar sind 0…3
    expect(useWorkbench.getState().parSyncSource).toBeNull()
  })

  it('behält parsync, wenn die Quelle sichtbar bleibt', () => {
    useWorkbench.getState().activateParSync(0)
    useWorkbench.getState().setLayout(1)
    expect(useWorkbench.getState().parSyncSource).toBe(0)
  })

  it('behält den gespiegelten Parameter auch in ausgeblendeten Panels', () => {
    // parsync schaltet zwar ab, setzt aber nichts zurück — sonst wäre nach
    // einem Layoutwechsel unklar, was die Panels eigentlich zeigen
    const { activateParSync, setPanelVariable, setLayout } = useWorkbench.getState()
    activateParSync(0)
    setPanelVariable(0, 'cloud_cover')
    setLayout(1)
    expect(useWorkbench.getState().panels.every((p) => p.variable === 'cloud_cover')).toBe(true)
  })
})
