import { lazy, Suspense } from 'react'
import { useEffectivePanel, useWorkbench } from '../state/workbench'
import { PanelHeader } from './PanelHeader'
import { Meteogram } from './Meteogram'

// MapLibre (~1 MB) nur laden, wenn tatsächlich ein Panel im Kartenmodus ist
const MapPanel = lazy(() =>
  import('./MapPanel').then((m) => ({ default: m.MapPanel })),
)

export function Panel({ index }: { index: number }) {
  // sync-aktive Panels lesen Modelle/Kartenmodell aus dem gemeinsamen Zustand
  const panel = useEffectivePanel(index)
  const parSyncSource = useWorkbench((s) => s.parSyncSource)
  const updatePanel = useWorkbench((s) => s.updatePanel)

  // Quelle deutlich, Folge-Panels dezent markieren — auf einen Blick muss
  // klar sein, wer steuert
  const parSyncClass =
    parSyncSource === index
      ? ' parsync-source'
      : parSyncSource !== null
        ? ' parsync-follower'
        : ''

  return (
    <section className={`panel${parSyncClass}`}>
      <PanelHeader index={index} panel={panel} />
      {panel.presetWarning && (
        <div className="preset-warning">
          <span>⚠ Preset unvollständig geladen: {panel.presetWarning}</span>
          <button
            type="button"
            title="Hinweis ausblenden"
            onClick={() => updatePanel(index, { presetWarning: undefined })}
          >
            ✕
          </button>
        </div>
      )}
      <div className="panel-body">
        {panel.mode === 'meteogram' ? (
          <Meteogram panel={panel} />
        ) : panel.mode === 'map' ? (
          <Suspense fallback={<div className="panel-placeholder">Lade Karte…</div>}>
            <MapPanel panel={panel} />
          </Suspense>
        ) : (
          <div className="panel-placeholder">Kommt in Phase 3</div>
        )}
      </div>
    </section>
  )
}
