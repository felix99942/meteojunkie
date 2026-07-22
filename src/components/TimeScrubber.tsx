// Zeit-Scrubber über den gesamten Forecast-Horizont (SPEC §5):
// Slider + Play/Pause + Schrittasten. Tastatur: ←/→ = ±1 h,
// Shift+←/→ = ±6 h, Leertaste = Play/Pause.

import { useEffect, useMemo } from 'react'
import { getModel, modelHorizonEnd } from '../config/models'
import { formatCursorTime, STEP_MS, TIME_RANGE } from '../config/time'
import { useWorkbench } from '../state/workbench'

const PLAY_INTERVAL_MS = 400

export function TimeScrubber() {
  const cursorTime = useWorkbench((s) => s.cursorTime)
  const playing = useWorkbench((s) => s.playing)
  const setCursorTime = useWorkbench((s) => s.setCursorTime)
  const stepCursor = useWorkbench((s) => s.stepCursor)
  const setPlaying = useWorkbench((s) => s.setPlaying)
  const panels = useWorkbench((s) => s.panels)
  const sharedModels = useWorkbench((s) => s.sharedModels)
  const sharedMapModel = useWorkbench((s) => s.sharedMapModel)

  // Bereich markieren, ab dem die aktuell gewählten Modelle keine Daten mehr
  // haben — bei mehreren Modellen zählt der längste Horizont (Registry).
  // Sync-aktive Panels nutzen die gemeinsame Modellauswahl (effektive Config).
  const beyondPct = useMemo(() => {
    let maxHorizon = TIME_RANGE.start
    let hasModels = false
    for (const p of panels) {
      const ids =
        p.mode === 'map'
          ? [p.sync ? sharedMapModel : p.mapModel]
          : p.mode === 'meteogram'
            ? p.sync
              ? sharedModels
              : p.models
            : []
      for (const id of ids) {
        hasModels = true
        maxHorizon = Math.max(maxHorizon, modelHorizonEnd(getModel(id)))
      }
    }
    if (!hasModels) return 0
    const span = TIME_RANGE.end - TIME_RANGE.start
    return Math.min(100, Math.max(0, ((TIME_RANGE.end - maxHorizon) / span) * 100))
  }, [panels, sharedModels, sharedMapModel])

  // Play: Zeitschritte durchsteppen, am Ende wieder von vorn
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const s = useWorkbench.getState()
      if (s.cursorTime >= TIME_RANGE.end) s.setCursorTime(TIME_RANGE.start)
      else s.stepCursor(1)
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [playing])

  // Globale Tastatursteuerung — Pflicht bei operationeller Nutzung (SPEC §5)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      const s = useWorkbench.getState()
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        s.stepCursor(e.shiftKey ? -6 : -1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        s.stepCursor(e.shiftKey ? 6 : 1)
      } else if (e.key === ' ') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <footer className="time-scrubber">
      <div className="scrubber-controls">
        <button type="button" onClick={() => stepCursor(-6)} title="6 Stunden zurück (Shift+←)">
          ‹‹
        </button>
        <button type="button" onClick={() => stepCursor(-1)} title="1 Stunde zurück (←)">
          ‹
        </button>
        <button
          type="button"
          className="play-button"
          onClick={() => setPlaying(!playing)}
          title="Play/Pause (Leertaste)"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" onClick={() => stepCursor(1)} title="1 Stunde vor (→)">
          ›
        </button>
        <button type="button" onClick={() => stepCursor(6)} title="6 Stunden vor (Shift+→)">
          ››
        </button>
      </div>
      <div className="scrubber-track">
        <input
          type="range"
          className="scrubber-slider"
          min={TIME_RANGE.start}
          max={TIME_RANGE.end}
          step={STEP_MS}
          value={cursorTime}
          onChange={(e) => setCursorTime(Number(e.target.value))}
        />
        {beyondPct > 0 && (
          <div
            className="scrubber-beyond"
            style={{ width: `${beyondPct}%` }}
            title="Hinter dem längsten Horizont der aktiven Modelle — keine Daten"
          />
        )}
      </div>
      <span className="scrubber-time">{formatCursorTime(cursorTime)}</span>
    </footer>
  )
}
