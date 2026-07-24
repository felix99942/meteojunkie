import { TopBar } from './components/TopBar'
import { PanelGrid } from './components/PanelGrid'
import { TimeScrubber } from './components/TimeScrubber'
import { AppNav } from './components/AppNav'
import { AtSection } from './components/AtSection'
import { useAppView } from './state/appView'

export default function App() {
  const view = useAppView((s) => s.view)
  return (
    <div className="app">
      <AppNav />
      {view === 'workbench' ? (
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
