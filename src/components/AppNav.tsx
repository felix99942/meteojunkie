// Oberste Bereichs-Navigation: Umschalter zwischen Workbench und
// Österreich-Klimakarte (siehe state/appView.ts).

import { useAppView, type AppView } from '../state/appView'

const TABS: { id: AppView; label: string }[] = [
  { id: 'workbench', label: 'Workbench' },
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
