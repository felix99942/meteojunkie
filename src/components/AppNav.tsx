// Oberste Bereichs-Navigation: Umschalter zwischen Meteogramm-Workbench und
// Österreich-Klimakarte (siehe state/appView.ts). Der View-Key bleibt
// 'workbench' (State/Presets hängen daran), nur die Beschriftung sagt
// „Meteogramm" — darunter fallen Meteogramm, Karte, Profil und Ensemble.

import { useAppView, type AppView } from '../state/appView'

const TABS: { id: AppView; label: string }[] = [
  { id: 'workbench', label: 'Meteogramm' },
  { id: 'at-klima', label: 'Österreich-Klima' },
]

export function AppNav() {
  const view = useAppView((s) => s.view)
  const setView = useAppView((s) => s.setView)
  return (
    <nav className="appnav">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`appnav-tab${view === t.id ? ' is-active' : ''}`}
          onClick={() => setView(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
