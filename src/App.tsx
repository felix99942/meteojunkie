import { lazy, Suspense } from 'react'
import { TopBar } from './components/TopBar'
import { PanelGrid } from './components/PanelGrid'
import { TimeScrubber } from './components/TimeScrubber'
import { AppNav } from './components/AppNav'
import { AtSection } from './components/AtSection'
import { ClassicMeteogram } from './components/ClassicMeteogram'
import { VerifyPanel } from './components/VerifyPanel'
import { FoehnPanel } from './components/FoehnPanel'
import { Impressum } from './components/Impressum'
import { OpenMeteoAttribution } from './components/Attribution'
import { POINT_FORECASTS_ENABLED } from './config/features'
import { isPanelSection, useAppView } from './state/appView'

// Der Radarbereich zieht MapLibre nach — wie die Feld-Karte per `lazy`
// abgetrennt, damit das Hauptbündel der übrigen Bereiche davon frei bleibt.
const RadarPanel = lazy(() => import('./components/RadarPanel').then((m) => ({ default: m.RadarPanel })))

// Panel-Bereiche (Punktprognosen/Ensemble/Profil) teilen dasselbe Gerüst
// (TopBar, Panel-Raster, Zeit-Scrubber) und dieselben Panel-Configs — sie
// unterscheiden sich nur darin, WAS die Panels zeichnen (siehe
// state/appView.ts). Das klassische Meteogramm und die Klimakarte bringen
// ihr eigenes, schlankeres Gerüst mit.
export default function App() {
  const stored = useAppView((s) => s.view)
  /**
   * Sicherheitsnetz: steht der Bereich „Punktprognosen" trotz abgeschalteter
   * Navigation im Zustand (alter Zustand, direkter `setView`-Aufruf), wird
   * das klassische Meteogramm gezeigt statt eines Bereichs, den es in dieser
   * Version nicht gibt.
   */
  const view = !POINT_FORECASTS_ENABLED && stored === 'workbench' ? 'classic' : stored
  return (
    <div className="app">
      <AppNav />
      {isPanelSection(view) ? (
        <>
          <TopBar />
          <PanelGrid />
          <TimeScrubber />
          <OpenMeteoAttribution className="app-attribution" />
        </>
      ) : view === 'classic' ? (
        <ClassicMeteogram />
      ) : view === 'verify' ? (
        <VerifyPanel />
      ) : view === 'foehn' ? (
        <FoehnPanel />
      ) : view === 'radar' ? (
        <Suspense fallback={<div className="panel-placeholder">Lade Radar…</div>}>
          <RadarPanel />
        </Suspense>
      ) : view === 'impressum' ? (
        <Impressum />
      ) : (
        <AtSection />
      )}
    </div>
  )
}
