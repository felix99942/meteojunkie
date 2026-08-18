// Oberste Bereichs-Navigation (siehe state/appView.ts). Ensemble und
// Vertikalprofil sind eigene Bereiche statt Panel-Modi — sie beantworten andere
// Fragen als der Modellvergleich und waren im Modus-Dropdown zu gut versteckt.
// Alle drei Panel-Bereiche teilen sich dieselben sechs Panel-Configs, es geht
// beim Wechseln also nichts verloren.

import { useAppView, type AppView } from '../state/appView'

const TABS: { id: AppView; label: string; title: string }[] = [
  {
    id: 'classic',
    label: 'Meteogramm',
    title: 'Klassisches Meteogramm — Temperatur, Niederschlag, Wolken, Wind auf einen Blick',
  },
  {
    id: 'workbench',
    label: 'Punktprognosen',
    title: 'Modellvergleich als Zeitreihe und Karte, frei wählbare Variablen',
  },
  {
    id: 'ensemble',
    label: 'Ensemble',
    title: 'Plume-Diagramme am Punkt — Streuung der Mitglieder',
  },
  {
    id: 'profile',
    label: 'Vertikalprofil',
    title: 'Skew-T am Punkt — Schichtung der Atmosphäre',
  },
  { id: 'at-klima', label: 'Österreich-Klima', title: 'Klimakarte und MOS-Vorhersage' },
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
          title={t.title}
          aria-pressed={view === t.id}
          onClick={() => setView(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
