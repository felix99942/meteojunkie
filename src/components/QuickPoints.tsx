// Schnellwahl des Orts — eine Reihe Städteknöpfe, die `lockedLocation` setzen.
//
// EIN Baustein für alle punktbasierten Bereiche (klassisches Meteogramm,
// Ensemble, Soundings): der Ort ist globaler Zustand, die Liste steht in
// `config/quickPoints.ts`, und drei Fassungen derselben Knopfreihe wären drei
// Gelegenheiten, sie auseinanderlaufen zu lassen. Entstanden ist sie im
// Ensemble-Panel, wo sie vorher inline stand.

import { QUICK_POINTS, QUICK_POINT_EPS } from '../config/quickPoints'
import { useWorkbench } from '../state/workbench'

export function QuickPoints({ caption = 'Punkt' }: { caption?: string }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)
  return (
    <>
      <span className="quickpt-cap label-muted">{caption}</span>
      {QUICK_POINTS.map((p) => (
        <button
          key={p.label}
          type="button"
          className={
            location &&
            Math.abs(location.lat - p.lat) < QUICK_POINT_EPS &&
            Math.abs(location.lon - p.lon) < QUICK_POINT_EPS
              ? 'quickpt is-active'
              : 'quickpt'
          }
          onClick={() => setLockedLocation(p)}
          title={`${p.label} — ${p.lat.toFixed(2)}°N ${p.lon.toFixed(2)}°O`}
        >
          {p.label}
        </button>
      ))}
    </>
  )
}
