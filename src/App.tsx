import { TopBar } from './components/TopBar'
import { PanelGrid } from './components/PanelGrid'
import { TimeScrubber } from './components/TimeScrubber'

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <PanelGrid />
      <TimeScrubber />
    </div>
  )
}
