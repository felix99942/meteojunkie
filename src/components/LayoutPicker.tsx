// Layout-Umschalter: 6er-Vollraster ↔ 4er ↔ 2er ↔ 1er. Gezeigt werden immer die
// ERSTEN N Panels; welche Daten darin stehen, stellt man im Panel selbst ein
// (Modus/Modell/Parameter) — ein zweiter Weg dahin wäre nur eine Bedienstelle
// mehr. Die ausgeblendeten Configs bleiben unangetastet, siehe workbench.ts.
//
// Der Wert gilt JE BEREICH (Meteogramm/Ensemble/Profil): vier Ensembles kosten
// etwas ganz anderes als vier Meteogramme.
import { isPanelSection, useAppView } from '../state/appView'
import { PANEL_LAYOUTS, useWorkbench, type PanelLayout } from '../state/workbench'

export function LayoutPicker() {
  const view = useAppView((s) => s.view)
  const section = isPanelSection(view) ? view : 'workbench'
  const layout = useWorkbench((s) => s.layouts[section])
  const setLayout = useWorkbench((s) => s.setLayout)

  return (
    <div
      className="layout-picker"
      title="Sichtbare Panels — ausgeblendete behalten ihre Einstellungen und holen keine Daten"
    >
      <span className="label-muted">Layout</span>
      <div className="layout-buttons">
        {PANEL_LAYOUTS.map((l) => (
          <button
            key={l.value}
            type="button"
            className={layout === l.value ? 'active' : undefined}
            title={l.title}
            aria-pressed={layout === l.value}
            onClick={() => setLayout(l.value as PanelLayout)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}
