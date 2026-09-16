// Oberste Ansichts-Navigation der Website. Bewusst ein eigener, minimaler Store
// (kein react-router, keine Kopplung an den komplexen Workbench-State).
//
// Bereiche der Tab-Reihe: das klassische Meteogramm (EIN Ort, EIN Modell, gestapelte
// Standardgrößen — `ClassicMeteogram`), Punktprognosen (der frühere
// „Meteogramm"-Bereich: freie Variable/Modellwahl, Karte, bis zu 6 Panels —
// intern weiter `workbench`, nur umbenannt), Ensemble, Vertikalprofil und die
// Österreich-Klimakarte und die Verifikation (Vorhersage gegen Messung).
// Ensemble und Profil waren früher Panel-MODI innerhalb
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
export type AppView =
  | 'classic'
  | 'workbench'
  | 'ensemble'
  | 'profile'
  | 'at-klima'
  /**
   * Verifikation: was wurde vorhergesagt, was ist eingetroffen. Eigener
   * Bereich, weil er als einziger BEIDE Welten der Seite zusammenbringt —
   * Open-Meteo-Modellläufe und gemessene GeoSphere-Stationswerte — und weil er
   * rückwärts blickt, während alles andere nach vorn schaut.
   */
  | 'verify'
  /**
   * Föhn-Diagnose: Druckdifferenz über den Alpenhauptkamm (Modelle und
   * Ensemble), Kammwind, Lee-Station und ein Kriterien-Streifen. Eigenes
   * Gerüst wie das klassische Meteogramm — die Punkte sind durch die
   * Föhnachse fest vorgegeben, `lockedLocation` spielt hier keine Rolle.
   */
  | 'foehn'
  /**
   * Niederschlagsradar (DWD-Komposit RV, 5-Minuten-Bilder plus 2-h-Nowcast).
   * Eigener Bereich mit eigenem Gerüst: er hängt an KEINER der übrigen
   * Datenquellen — keine Open-Meteo-Abrufe, kein Zeitraster der Workbench,
   * kein Panel-Modell —, sondern holt fertige Karten beim DWD (siehe
   * `config/radar.ts`). Dort liegt auch die gemessene Abdeckungsgrenze.
   */
  | 'radar'
  /**
   * Impressum/Offenlegung. Kein Werkzeug-Bereich — steht nicht in der
   * Tab-Reihe, sondern hinter dem kleinen Link am rechten Rand der Navigation
   * (siehe AppNav). Als AppView geführt, weil die Anbieterkennzeichnung
   * „leicht erkennbar, unmittelbar erreichbar und ständig verfügbar" sein
   * muss: aus jedem Bereich ein Klick, ohne Router und ohne Modal, das man
   * wegklickt und nicht wiederfindet.
   */
  | 'impressum'

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
  /**
   * Startbereich: das klassische Meteogramm. Es war früher `workbench`, und
   * das wäre in der veröffentlichten Version ein Start in einem Bereich, den
   * die Navigation gar nicht mehr zeigt (`POINT_FORECASTS_ENABLED`). „Wie
   * man's kennt" ist ohnehin der bessere erste Blick.
   */
  view: 'classic',
  setView: (view) => set({ view }),
}))
