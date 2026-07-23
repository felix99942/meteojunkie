// TanStack-Query-Hooks über dem Batching-Layer. Cache-Key ist die einzelne
// Serie (Punkt × Modell × Variable) — so teilen sich Panels mit gleichem Punkt
// Serien aus dem Cache, und neue Serien werden vom Batcher gebündelt geholt.
// Lange staleTime: Modellläufe ändern sich nur alle 1–6 h (SPEC §6).

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { fetchGridField, fetchHourlySeries, type GridField, type HourlySeries } from './openmeteo'
import type { DomainPreset } from '../config/domains'
import { getModel } from '../config/models'
import type { LatLon } from '../state/workbench'

export const SERIES_STALE_TIME_MS = 30 * 60 * 1000 // 30 min
export const SERIES_GC_TIME_MS = 6 * 60 * 60 * 1000 // 6 h

/** Eine Query pro Modell — alle im selben Tick gestartet, damit der Batcher sie zu einem Request bündelt. */
export function useMeteogramSeries(
  location: LatLon | null,
  models: string[],
  variable: string,
): UseQueryResult<HourlySeries>[] {
  return useQueries({
    queries: models.map((model) => ({
      queryKey: [
        'hourly',
        location ? location.lat.toFixed(4) : null,
        location ? location.lon.toFixed(4) : null,
        model,
        variable,
      ],
      queryFn: () => fetchHourlySeries(location!.lat, location!.lon, model, variable),
      // Modelle ohne diese Variable gar nicht erst anfragen (kostet Budget);
      // die UI zeigt „n. v." statt einer leeren Serie
      enabled: location !== null && getModel(model).availableVariables.includes(variable),
      staleTime: SERIES_STALE_TIME_MS,
      gcTime: SERIES_GC_TIME_MS,
      // Punktserien gehen direkt an Open-Meteo; unter Last kommt „service is
      // overloaded". Ein paar gestaffelte Retries fangen die transiente Überlast ab.
      retry: 3,
      retryDelay: (attempt: number) => Math.min(8000, 1000 * 2 ** attempt),
    })),
  })
}

/**
 * Kartenfeld (volle Zeitreihe fürs ganze Gitter) — lazy: der Hook wird nur von
 * gemounteten Karten-Panels aufgerufen, und `enabled` gattet Coverage/Skala.
 * Felder sind groß (~1–2 MB), daher kürzere gcTime als bei Punktserien.
 */
export function useGridField(
  domain: DomainPreset,
  model: string,
  variable: string,
  enabled: boolean,
): UseQueryResult<GridField> {
  return useQuery({
    queryKey: ['grid', domain.id, `${domain.gridLat}x${domain.gridLon}`, model, variable],
    queryFn: () => fetchGridField(domain, model, variable),
    enabled,
    staleTime: SERIES_STALE_TIME_MS,
    gcTime: 60 * 60 * 1000, // 1 h
    // kein Query-Retry: Backoff bei Rate-Limits macht der Fetch-Layer selbst,
    // ein Retry obendrauf würde erneut das volle Gitter-Budget kosten
    retry: false,
  })
}
