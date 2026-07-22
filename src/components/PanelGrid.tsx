import { useWorkbench } from '../state/workbench'
import { Panel } from './Panel'

export function PanelGrid() {
  const panelCount = useWorkbench((s) => s.panels.length)
  return (
    <main className="panel-grid">
      {Array.from({ length: panelCount }, (_, i) => (
        <Panel key={i} index={i} />
      ))}
    </main>
  )
}
