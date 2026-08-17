// Oberste Ansichts-Navigation der Website. Bewusst ein eigener, minimaler Store
// (kein react-router, keine Kopplung an den komplexen Workbench-State).
//
// Vier Bereiche: Meteogramm/Karte, Ensemble, Vertikalprofil und die
// Österreich-Klimakarte. Ensemble und Profil waren früher Panel-MODI innerhalb
// der Workbench; als eigene Bereiche sind sie leichter zu finden und der
// Modus-Dropdown im Panel-Kopf bleibt auf die zwei Fälle beschränkt, zwischen
// denen man wirklich hin und her springt (Meteogramm ↔ Karte).
//
// Die drei erstgenannten teilen sich EINE Panel-Sammlung (state/workbench.ts):
// PanelConfig führt Meteogramm-, Ensemble- und Profil-Einstellungen ohnehin in
// getrennten Feldern, deshalb überlebt jede Einstellung den Bereichswechsel.

import { create } from 'zustand'

export type AppView = 'workbench' | 'ensemble' | 'profile' | 'at-klima'

/** Bereiche, die das Panel-Raster benutzen (alles außer der Klimakarte). */
export type PanelSection = 'workbench' | 'ensemble' | 'profile'

export function isPanelSection(view: AppView): view is PanelSection {
  return view !== 'at-klima'
}

/** Aktive Panel-Sektion; außerhalb des Rasters (Klimakarte) gilt 'workbench'. */
export function activePanelSection(): PanelSection {
  const v = useAppView.getState().view
  return isPanelSection(v) ? v : 'workbench'
}

interface AppViewStore {
  view: AppView
  setView: (view: AppView) => void
}

export const useAppView = create<AppViewStore>((set) => ({
  view: 'workbench',
  setView: (view) => set({ view }),
}))
