// Kuratierte Punkte für die SCHNELLWAHL der punktbasierten Bereiche
// (klassisches Meteogramm, Ensemble, Soundings).
//
// Herausgezogen aus `config/ensemble.ts`, wo die Liste zuerst entstand: sie
// setzt `lockedLocation`, und das ist ein GLOBALER Zustand — dieselben acht
// Knöpfe gehören deshalb in jeden Bereich, der an diesem Ort rechnet, nicht
// nur in den einen, in dem sie zufällig zuerst gebraucht wurden.
//
// Acht Punkte je REGION, nicht mehr: die Reihe steht neben Modellauswahl und
// Laufangabe in derselben Leiste und darf sie nicht verdrängen. Deshalb eine
// Regionsauswahl davor statt einer längeren Reihe.
//
// Österreich: Landeshauptstädte plus **Sonnblick** — die Bergstation ist
// bewusst dabei, weil an ihr die Höhenabhängigkeit sichtbar wird, an der
// Globalmodelle scheitern (siehe den Höhenbefund in der Verifikation).
//
// Thailand (Tropendienst): die Urlaubsorte an beiden Küsten plus Bangkok und
// Chiang Mai im Norden — aus `config/thaiPlaces.ts` (geokodiert).

import type { LatLon } from '../state/workbench'
import { THAI_PLACES } from './thaiPlaces'

export type QuickRegionId = 'at' | 'th'

export interface QuickRegion {
  id: QuickRegionId
  label: string
  points: LatLon[]
  /** [lonMin, latMin, lonMax, latMax] — liegt der Ort darin, gilt die Region als gewählt */
  bbox: [number, number, number, number]
}

export const QUICK_REGIONS: QuickRegion[] = [
  {
    id: 'at',
    label: 'Österreich',
    bbox: [9.4, 46.3, 17.2, 49.1],
    points: [
      { lat: 48.21, lon: 16.37, label: 'Wien' },
      { lat: 47.07, lon: 15.44, label: 'Graz' },
      { lat: 48.31, lon: 14.29, label: 'Linz' },
      { lat: 47.8, lon: 13.04, label: 'Salzburg' },
      { lat: 47.27, lon: 11.39, label: 'Innsbruck' },
      { lat: 46.62, lon: 14.31, label: 'Klagenfurt' },
      { lat: 47.5, lon: 9.75, label: 'Bregenz' },
      { lat: 47.05, lon: 12.96, label: 'Sonnblick' },
    ],
  },
  {
    id: 'th',
    label: 'Thailand',
    bbox: [97.3, 5.6, 105.7, 20.5],
    points: THAI_PLACES.filter((p) => p.quick).map(({ lat, lon, label }) => ({ lat, lon, label })),
  },
]

/** Österreich-Punkte — die ursprüngliche Schnellwahl. */
export const QUICK_POINTS: LatLon[] = QUICK_REGIONS[0].points

/** Die Region, in der der Ort liegt; sonst Österreich. */
export function regionFor(loc: { lat: number; lon: number } | null | undefined): QuickRegion {
  if (loc) {
    for (const r of QUICK_REGIONS) {
      const [x0, y0, x1, y1] = r.bbox
      if (loc.lon >= x0 && loc.lon <= x1 && loc.lat >= y0 && loc.lat <= y1) return r
    }
  }
  return QUICK_REGIONS[0]
}

/** Toleranz, ab der ein Punkt als „derselbe Ort" gilt (~2 km). */
export const QUICK_POINT_EPS = 0.02
