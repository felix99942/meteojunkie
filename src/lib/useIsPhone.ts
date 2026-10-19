// Handy-Ansicht: erkannt an der BILDSCHIRMBREITE, nicht am Gerät.
//
// Unter `PHONE_MAX_PX` gilt die Handy-Ansicht — alle Smartphones auch im
// Hochformat der großen Modelle; Tablets und Desktop liegen darüber. Ein
// Desktopfenster, das man so schmal zieht, bekommt sie ebenfalls, und das ist
// richtig: dort passt sie genauso besser. Die DESKTOP-ANSICHT bleibt dadurch
// unberührt — jede Handy-Regel hängt an derselben Grenze, im CSS als
// `@media (max-width: 760px)`.

import { useSyncExternalStore } from 'react'

export const PHONE_MAX_PX = 760
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const snapshot = () => window.matchMedia(PHONE_QUERY).matches

/** true in der Handy-Ansicht; reagiert auf Drehen und Größenänderung. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
