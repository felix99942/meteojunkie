// Bereich „Modellkarten": Globusansicht (Globus, Europa, Alpen …) oder Panel-
// Ansicht mit 4 bzw. 6 Karten. Der Umschalter steht in der Leiste der
// jeweiligen Ansicht, damit er dort ist, wo man ihn sucht — ganz vorn.

import { useState } from 'react'
import { GlobePanel } from './GlobePanel'
import { GlobeMultiPanel } from './GlobeMultiPanel'

type Mode = 'single' | 4 | 6

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'single', label: 'Globusansicht', title: 'Eine große Karte — Globus, Europa, Alpen, Thailand' },
  { id: 4, label: '4 Panels', title: 'Vier Karten nebeneinander: Modellvergleich (ParSync) oder Synoptik (ModSync)' },
  { id: 6, label: '6 Panels', title: 'Sechs Karten nebeneinander: Modellvergleich (ParSync) oder Synoptik (ModSync)' },
]

export function ModelMapsSection() {
  const [mode, setMode] = useState<Mode>('single')
  const modeSwitch = (
    <span className="globe-seg" role="group" aria-label="Ansicht">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.title}
          className={m.id === mode ? 'is-active' : ''}
          aria-pressed={m.id === mode}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </span>
  )
  return mode === 'single' ? <GlobePanel modeSwitch={modeSwitch} /> : <GlobeMultiPanel count={mode} modeSwitch={modeSwitch} onCount={setMode} />
}
