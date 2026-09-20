// Soundings-Bereich: Ortswahl-Karte links, Skew-T rechts, dazwischen ein
// ZIEHBARER Trenner.
//
// Warum verstellbar und nicht zwei feste Breiten: was man gerade braucht,
// wechselt mit der Frage. Wer den Punkt sucht (Luv oder Lee, welches Tal),
// will die Karte gross; wer das Profil liest, will das Diagramm gross. Das
// ist keine Voreinstellung, die man einmal trifft, sondern ein Handgriff
// mitten in der Arbeit — also gehört er an die Grenzlinie und nicht in ein
// Menü.
//
// Die Breite liegt im STORE und nicht in dieser Komponente: ein
// Bereichswechsel unmountet sie, und eine Breite, die man nach jedem Ausflug
// ins Radar neu einstellt, wäre ärgerlicher als eine feste.

import { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import { PanelGrid } from './PanelGrid'
import { useWorkbench } from '../state/workbench'
import { clampMapWidth, defaultMapWidth } from '../lib/splitWidth'

const ProfileMapPane = lazy(() =>
  import('./ProfileMapPane').then((m) => ({ default: m.ProfileMapPane })),
)

export function ProfileSplit() {
  const mapWidth = useWorkbench((s) => s.profileMapWidth)
  const setMapWidth = useWorkbench((s) => s.setProfileMapWidth)
  const rootRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  // Startbreite einmalig aus der tatsächlichen Fläche, und bei einem
  // Fensterwechsel neu begrenzen — sonst bliebe eine auf dem breiten Schirm
  // gezogene Karte auf dem schmalen stehen und erdrückte das Diagramm.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const fit = () => {
      const total = el.clientWidth
      if (total < 50) return
      setMapWidth((w) => (w == null ? defaultMapWidth(total) : clampMapWidth(w, total)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [setMapWidth])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMapWidth(() => clampMapWidth(e.clientX - rect.left, rect.width))
    },
    [setMapWidth],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  /** Tastaturbedienung: der Trenner ist sonst nur mit der Maus erreichbar. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = rootRef.current
      if (!el) return
      const step = e.shiftKey ? 80 : 20
      if (e.key === 'ArrowLeft') {
        setMapWidth((w) => clampMapWidth((w ?? 0) - step, el.clientWidth))
      } else if (e.key === 'ArrowRight') {
        setMapWidth((w) => clampMapWidth((w ?? 0) + step, el.clientWidth))
      } else if (e.key === 'Home') {
        setMapWidth(() => defaultMapWidth(el.clientWidth))
      } else {
        return
      }
      e.preventDefault()
    },
    [setMapWidth],
  )

  return (
    <div className="profile-split" ref={rootRef}>
      <Suspense fallback={<div className="locmap-loading" style={{ width: mapWidth ?? 420 }}>Karte lädt …</div>}>
        <ProfileMapPane width={mapWidth} />
      </Suspense>
      <div
        className="split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite von Karte und Diagramm — ziehen, Pfeiltasten, Pos1 setzt zurück"
        title="Ziehen verschiebt die Grenze · Doppelklick setzt zurück"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          const el = rootRef.current
          if (el) setMapWidth(() => defaultMapWidth(el.clientWidth))
        }}
      >
        <span className="split-grip" />
      </div>
      <PanelGrid />
    </div>
  )
}
