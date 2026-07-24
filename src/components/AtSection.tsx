// Österreich-Bereich: Umschalter zwischen Klima (TAWES, Österreich) und
// Vorhersage (MOSMIX/MOS, DACH-Raum). Bewusst lokaler State — die beiden Modi
// nutzen unterschiedliche Stationsnetze, Karten und Datenquellen.

import { useState } from 'react'
import { AtClimatePanel } from './AtClimatePanel'
import { AtForecastPanel } from './AtForecastPanel'

type Mode = 'klima' | 'vorhersage'

export function AtSection() {
  const [mode, setMode] = useState<Mode>('klima')
  return (
    <div className="atsection">
      <div className="atsection-tabs">
        <button
          type="button"
          className={mode === 'klima' ? 'is-active' : ''}
          onClick={() => setMode('klima')}
        >
          Klima
        </button>
        <button
          type="button"
          className={mode === 'vorhersage' ? 'is-active' : ''}
          onClick={() => setMode('vorhersage')}
        >
          Vorhersage
        </button>
      </div>
      {mode === 'klima' ? <AtClimatePanel /> : <AtForecastPanel />}
    </div>
  )
}
