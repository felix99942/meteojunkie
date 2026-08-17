import { TopBar } from './components/TopBar'
import { PanelGrid } from './components/PanelGrid'
import { TimeScrubber } from './components/TimeScrubber'
import { AppNav } from './components/AppNav'
import { AtSection } from './components/AtSection'
import { isPanelSection, useAppView } from './state/appView'

// Drei der vier Bereiche teilen sich dasselbe Gerüst (TopBar, Panel-Raster,
// Zeit-Scrubber) und dieselben Panel-Configs — sie unterscheiden sich nur
// darin, WAS die Panels zeichnen (siehe state/appView.ts). Die Klimakarte
// bringt ihr eigenes Gerüst mit.
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
      ) : (
        <AtSection />
      )}
    </div>
  )
}
