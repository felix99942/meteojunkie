// Kuratierte Punkte für die SCHNELLWAHL der punktbasierten Bereiche
// (klassisches Meteogramm, Ensemble, Soundings).
//
// Herausgezogen aus `config/ensemble.ts`, wo die Liste zuerst entstand: sie
// setzt `lockedLocation`, und das ist ein GLOBALER Zustand — dieselben acht
// Knöpfe gehören deshalb in jeden Bereich, der an diesem Ort rechnet, nicht
// nur in den einen, in dem sie zufällig zuerst gebraucht wurden.
//
// Acht Punkte, nicht mehr: die Reihe steht neben Modellauswahl und Laufangabe
// in derselben Leiste und darf sie nicht verdrängen. Landeshauptstädte plus
// **Sonnblick** — die Bergstation ist bewusst dabei, weil an ihr die
// Höhenabhängigkeit sichtbar wird, an der Globalmodelle scheitern (siehe den
// Höhenbefund in der Verifikation).

import type { LatLon } from '../state/workbench'

export const QUICK_POINTS: LatLon[] = [
  { lat: 48.21, lon: 16.37, label: 'Wien' },
  { lat: 47.07, lon: 15.44, label: 'Graz' },
  { lat: 48.31, lon: 14.29, label: 'Linz' },
  { lat: 47.8, lon: 13.04, label: 'Salzburg' },
  { lat: 47.27, lon: 11.39, label: 'Innsbruck' },
  { lat: 46.62, lon: 14.31, label: 'Klagenfurt' },
  { lat: 47.5, lon: 9.75, label: 'Bregenz' },
  { lat: 47.05, lon: 12.96, label: 'Sonnblick' },
]

/** Toleranz, ab der ein Punkt als „derselbe Ort" gilt (~2 km). */
export const QUICK_POINT_EPS = 0.02
