import { isPanelSection, useAppView } from '../state/appView'
import { useWorkbench, useVisiblePanels } from '../state/workbench'
import { Panel } from './Panel'

// Gerendert werden nur die sichtbaren Panels — die Configs der ausgeblendeten
// bleiben im Store, ihre Daten werden aber nicht geholt (API-Budget, SPEC §1).
// `key` ist der Panel-Index, nicht die Slot-Position: sonst würde ein
// Fokuswechsel die Komponente recyceln statt neu zu montieren (uPlot/MapLibre
// hängen an ihrer Instanz).
export function PanelGrid() {
  const view = useAppView((s) => s.view)
  const section = isPanelSection(view) ? view : 'workbench'
  const layout = useWorkbench((s) => s.layouts[section])
  const visible = useVisiblePanels()
  return (
    <main className={`panel-grid layout-${layout}`}>
      {visible.map((index) => (
        <Panel key={index} index={index} />
      ))}
    </main>
  )
}
