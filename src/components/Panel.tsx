import { lazy, Suspense } from 'react'
import { isPanelSection, useAppView } from '../state/appView'
import { useEffectivePanel, useWorkbench } from '../state/workbench'
import { PanelHeader } from './PanelHeader'
import { Meteogram } from './Meteogram'
import { SkewTPanel } from './SkewTPanel'
import { EnsemblePanel } from './EnsemblePanel'

// MapLibre (~1 MB) nur laden, wenn ein Panel im Kartenmodus ist. Der Env-Check
// steht DIREKT hier (nicht über features.ts), damit Vite ihn zur Build-Zeit
// inlint und Rollup bei deaktivierter Karte den import() als toten Zweig
// entfernt → MapPanel + MapLibre + Basemaps fallen ganz aus dem Web-Build.
const MapPanel =
  import.meta.env.VITE_ENABLE_MAP === 'false'
    ? null
    : lazy(() => import('./MapPanel').then((m) => ({ default: m.MapPanel })))

export function Panel({ index }: { index: number }) {
  // sync-aktive Panels lesen Modelle/Kartenmodell aus dem gemeinsamen Zustand
  const panel = useEffectivePanel(index)
  // Was gezeichnet wird, entscheidet der BEREICH — nur im Meteogramm-Bereich
  // wählt das Panel selbst zwischen Zeitreihe und Karte (siehe appView.ts).
  const view = useAppView((s) => s.view)
  const section = isPanelSection(view) ? view : 'workbench'
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
        {section === 'ensemble' ? (
          <EnsemblePanel panel={panel} />
        ) : section === 'profile' ? (
          <SkewTPanel panel={panel} />
        ) : panel.mode === 'map' ? (
          MapPanel ? (
            <Suspense fallback={<div className="panel-placeholder">Lade Karte…</div>}>
              <MapPanel panel={panel} />
            </Suspense>
          ) : (
            <div className="panel-placeholder">
              Kartenansicht ist in dieser Version noch deaktiviert — Meteogramm wählen
            </div>
          )
        ) : (
          <Meteogram panel={panel} />
        )}
      </div>
    </section>
  )
}
