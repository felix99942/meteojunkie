// Session-Zähler für den API-Verbrauch, zentral im API-Layer gepflegt
// (openmeteo.ts/apiGet), nicht in Komponenten. Gezählt werden angefragte
// Locations pro Request — Open-Meteo gewichtet nach Locations (SPEC §5).
// Cache-Treffer und Mock-Antworten zählen NICHT: der Zähler zeigt, was
// tatsächlich rausgeht. Reset erlaubt das Messen einzelner Aktionen.

import { create } from 'zustand'

export type UsageKind = 'grid' | 'point'

interface ApiUsageStore {
  /** Locations aus Gitter-Requests (Karten). */
  gridLocations: number
  /** Locations aus Punkt-Requests (Meteogramme). */
  pointLocations: number
  /** Abgesetzte HTTP-Requests. */
  requests: number
  addUsage: (locations: number, kind: UsageKind) => void
  reset: () => void
}

export const useApiUsage = create<ApiUsageStore>((set) => ({
  gridLocations: 0,
  pointLocations: 0,
  requests: 0,
  addUsage: (locations, kind) =>
    set((s) => ({
      gridLocations: s.gridLocations + (kind === 'grid' ? locations : 0),
      pointLocations: s.pointLocations + (kind === 'point' ? locations : 0),
      requests: s.requests + 1,
    })),
  reset: () => set({ gridLocations: 0, pointLocations: 0, requests: 0 }),
}))
