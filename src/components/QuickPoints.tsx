// Schnellwahl des Orts — eine Reihe Städteknöpfe, die `lockedLocation` setzen.
//
// EIN Baustein für alle punktbasierten Bereiche (klassisches Meteogramm,
// Ensemble, Soundings): der Ort ist globaler Zustand, die Liste steht in
// `config/quickPoints.ts`, und drei Fassungen derselben Knopfreihe wären drei
// Gelegenheiten, sie auseinanderlaufen zu lassen. Entstanden ist sie im
// Ensemble-Panel, wo sie vorher inline stand.
//
// Davor eine REGIONSAUSWAHL (Österreich · Thailand): die Region folgt dem
// gewählten Ort — wer auf der Karte oder per Suche nach Phuket springt, sieht
// danach die Thai-Knöpfe —, lässt sich aber auch ohne Ortswechsel umschalten.

import { useEffect, useState } from 'react'
import { QUICK_POINT_EPS, QUICK_REGIONS, regionFor, type QuickRegionId } from '../config/quickPoints'
import { useWorkbench } from '../state/workbench'

export function QuickPoints({ caption = 'Punkt' }: { caption?: string }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const setLockedLocation = useWorkbench((s) => s.setLockedLocation)
  const [regionId, setRegionId] = useState<QuickRegionId>(() => regionFor(location).id)
  // Ort wechselt in eine andere Region → die Knöpfe ziehen mit. Nur wenn der
  // Ort IN einer Region liegt — ein Punkt irgendwo sonst lässt die Wahl stehen.
  useEffect(() => {
    const hit = QUICK_REGIONS.find((r) => inside(location, r.bbox))
    if (hit) setRegionId(hit.id)
  }, [location])
  const region = QUICK_REGIONS.find((r) => r.id === regionId) ?? QUICK_REGIONS[0]
  return (
    <>
      <span className="quickpt-cap label-muted">{caption}</span>
      <select
        className="quickpt-region"
        value={regionId}
        onChange={(e) => {
          setRegionId(e.target.value as QuickRegionId)
          // Fokus abgeben: die Pfeiltasten gehören der Zeit
          e.currentTarget.blur()
        }}
        title="Region der Schnellwahl"
      >
        {QUICK_REGIONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {region.points.map((p) => (
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

function inside(loc: { lat: number; lon: number } | null, [x0, y0, x1, y1]: [number, number, number, number]): boolean {
  return !!loc && loc.lon >= x0 && loc.lon <= x1 && loc.lat >= y0 && loc.lat <= y1
}
