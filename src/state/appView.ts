// Oberste Ansichts-Navigation der Website. Bewusst ein eigener, minimaler Store
// (kein react-router, keine Kopplung an den komplexen Workbench-State).
//
// Fünf Bereiche: das klassische Meteogramm (EIN Ort, EIN Modell, gestapelte
// Standardgrößen — `ClassicMeteogram`), Punktprognosen (der frühere
// „Meteogramm"-Bereich: freie Variable/Modellwahl, Karte, bis zu 6 Panels —
// intern weiter `workbench`, nur umbenannt), Ensemble, Vertikalprofil und die
// Österreich-Klimakarte. Ensemble und Profil waren früher Panel-MODI innerhalb
// der Workbench; als eigene Bereiche sind sie leichter zu finden und der
// Modus-Dropdown im Panel-Kopf bleibt auf die zwei Fälle beschränkt, zwischen
// denen man wirklich hin und her springt (Punktprognosen ↔ Karte).
//
// „workbench“/ensemble/profile teilen sich EINE Panel-Sammlung
// (state/workbench.ts): PanelConfig führt Meteogramm-, Ensemble- und
// Profil-Einstellungen ohnehin in getrennten Feldern, deshalb überlebt jede
// Einstellung den Bereichswechsel. `classic` (das klassische Meteogramm)
// braucht dieses Panel-Raster NICHT — eigenes, schlankes Gerüst wie die
// Klimakarte, nur `lockedLocation` wird geteilt (siehe ClassicMeteogram).

import { create } from 'zustand'

// 'classic' statt 'meteogram': PanelConfig.mode kennt bereits ein 'meteogram'
// (Panel-MODUS: Linienchart vs. Karte, siehe workbench.ts) — ein zweites,
// andersartiges 'meteogram' als AppView-Id wäre verwechselbar.
export type AppView = 'classic' | 'workbench' | 'ensemble' | 'profile' | 'at-klima'

/** Bereiche, die das Panel-Raster benutzen (Klimakarte UND klassisches Meteogramm nicht). */
export type PanelSection = 'workbench' | 'ensemble' | 'profile'

export function isPanelSection(view: AppView): view is PanelSection {
  return view === 'workbench' || view === 'ensemble' || view === 'profile'
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
