// Orte des Thailand-Tropendiensts — für die Schnellwahl (`config/quickPoints.ts`)
// und die Beschriftung der Modellkarten (`render/worldLabels.ts`).
//
// Koordinaten über das Open-Meteo-Geocoding bestimmt (2026-10-08), nicht aus
// dem Kopf: „Khao Lak" lieferte als zweiten Treffer einen gleichnamigen Berg
// 200 km weiter nördlich, „Ko Tao" eine zweite Insel bei Phang Nga. Die Inseln
// stehen hier, weil Natural Earth sie nicht führt — und an ihnen hängt die
// Frage „Andamanensee oder Golf von Thailand?", die bei Monsun den Unterschied
// zwischen Regenzeit und Badewetter macht.

export interface ThaiPlace {
  lat: number
  lon: number
  label: string
  /** In der Schnellwahl (höchstens acht) */
  quick?: boolean
}

export const THAI_PLACES: ThaiPlace[] = [
  { lat: 13.75, lon: 100.5, label: 'Bangkok', quick: true },
  { lat: 18.79, lon: 98.98, label: 'Chiang Mai', quick: true },
  { lat: 12.93, lon: 100.88, label: 'Pattaya', quick: true },
  { lat: 12.57, lon: 99.96, label: 'Hua Hin', quick: true },
  { lat: 9.54, lon: 99.94, label: 'Ko Samui', quick: true },
  { lat: 7.89, lon: 98.4, label: 'Phuket', quick: true },
  { lat: 8.05, lon: 98.82, label: 'Ao Nang', quick: true },
  { lat: 8.62, lon: 98.24, label: 'Khao Lak', quick: true },
  { lat: 8.07, lon: 98.91, label: 'Krabi' },
  { lat: 7.53, lon: 99.09, label: 'Ko Lanta' },
  { lat: 7.75, lon: 98.78, label: 'Ko Phi Phi' },
  { lat: 9.72, lon: 100.0, label: 'Ko Pha Ngan' },
  { lat: 10.09, lon: 99.84, label: 'Ko Tao' },
  { lat: 12.1, lon: 102.35, label: 'Ko Chang' },
]
