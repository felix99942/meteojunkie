// Feste Domain-Presets (SPEC §3). Der Datenabruf für Karten-Panels hängt an
// genau diesen Domains — kein freies Viewport-Fetching, weil das
// 1000-Punkte-Budget die Auflösung an die Domaingröße koppelt.
//
// Beschafft wird ein reguläres lat/lon-Gitter über Multi-Location-Requests an
// die normale Forecast-API (NICHT bounding_box der Single-Runs-API).
//
// Gittergröße ist PRO DOMAIN konfiguriert (nicht global), Lat × Lon getrennt,
// damit die Zellen annähernd quadratisch sind. Open-Meteo gewichtet das
// Rate-Limit nach Locations — Punktzahl im Blick behalten (< 1000, praktisch
// deutlich darunter).
//
// Modellverfügbarkeit wird NICHT pro Domain gepflegt, sondern abgeleitet:
// wählbar, wenn die Modell-coverage die Domain-BBox vollständig enthält
// (isDomainInCoverage in models.ts); globale Modelle immer.
// recommendedModels ist nur eine kurze Empfehlungsliste fürs Dropdown.

import type { BBox } from './models'

export interface DomainPreset {
  id: string
  label: string
  bbox: BBox
  approxResolutionKm: number
  /** Gitterpunkte auf der Breiten-Achse (Süd → Nord). */
  gridLat: number
  /** Gitterpunkte auf der Längen-Achse (West → Ost). */
  gridLon: number
  /** Empfohlene Default-Modelle, Reihenfolge = Priorität. */
  recommendedModels: string[]
  /** Gradnetz-Abstand in Grad (Kartenpanel). */
  graticuleDeg: number
}

export const DOMAIN_PRESETS: DomainPreset[] = [
  {
    id: 'europe',
    label: 'Europa',
    bbox: { latMin: 35, lonMin: -12, latMax: 70, lonMax: 40 },
    approxResolutionKm: 150,
    gridLat: 25, // 25×25 = 625 Punkte
    gridLon: 25,
    // Auswahlkriterium: Unabhängigkeit der Rechenzentren, nicht Auflösung (SPEC §7)
    recommendedModels: ['ecmwf_ifs025', 'gfs_global', 'icon_global'],
    graticuleDeg: 5,
  },
  {
    id: 'austria',
    label: 'Österreich',
    bbox: { latMin: 46.3, lonMin: 9.5, latMax: 49.1, lonMax: 17.2 },
    approxResolutionKm: 19,
    gridLat: 16, // 16×30 = 480 Punkte, Zellen ~19 km annähernd quadratisch
    gridLon: 30,
    // lokale Referenz · zweite hochaufgelöste Meinung · Brücke in die
    // Mittelfrist · synoptischer Hintergrund (SPEC §7)
    recommendedModels: ['geosphere_arome_austria', 'icon_d2', 'icon_eu', 'ecmwf_ifs025'],
    graticuleDeg: 1,
  },
]
