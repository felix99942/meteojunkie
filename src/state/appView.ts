// Oberste Ansichts-Navigation der Website. Bewusst ein eigener, minimaler Store
// (kein react-router, keine Kopplung an den komplexen Workbench-State): die
// Seite hat zwei eigenständige Bereiche — die Modellvergleichs-Workbench und die
// Österreich-Klimakarte.

import { create } from 'zustand'

export type AppView = 'workbench' | 'at-klima'

interface AppViewStore {
  view: AppView
  setView: (view: AppView) => void
}

export const useAppView = create<AppViewStore>((set) => ({
  view: 'workbench',
  setView: (view) => set({ view }),
}))
