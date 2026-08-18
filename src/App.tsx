import { TopBar } from './components/TopBar'
import { PanelGrid } from './components/PanelGrid'
import { TimeScrubber } from './components/TimeScrubber'
import { AppNav } from './components/AppNav'
import { AtSection } from './components/AtSection'
import { ClassicMeteogram } from './components/ClassicMeteogram'
import { isPanelSection, useAppView } from './state/appView'

// Panel-Bereiche (Punktprognosen/Ensemble/Profil) teilen dasselbe Gerüst
// (TopBar, Panel-Raster, Zeit-Scrubber) und dieselben Panel-Configs — sie
// unterscheiden sich nur darin, WAS die Panels zeichnen (siehe
// state/appView.ts). Das klassische Meteogramm und die Klimakarte bringen
// ihr eigenes, schlankeres Gerüst mit.
export default function App() {
  const view = useAppView((s) => s.view)
  return (
    <div className="app">
      <AppNav />
      {isPanelSection(view) ? (
        <>
          <TopBar />
          <PanelGrid />
          <TimeScrubber />
        </>
      ) : view === 'classic' ? (
        <ClassicMeteogram />
      ) : (
        <AtSection />
      )}
    </div>
  )
}
