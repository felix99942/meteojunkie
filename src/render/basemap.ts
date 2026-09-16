// Gemeinsamer Kartenhintergrund für alle MapLibre-Karten der Seite
// (Feld-Karte der Punktprognosen, Radar).
//
// Basemap ist komplett LOKAL — bewusst kein externer Tile-Dienst: kein
// API-Key, kein fremdes Rate-Limit, und MapLibres `load`-Event hängt nicht an
// Requests, die uns nicht gehören. Unter einem eingefärbten Feld oder einem
// Radarbild wäre eine volle Basemap ohnehin visuelles Rauschen.
//
// Herausgezogen aus `components/MapPanel.tsx`, damit Radar und Feld-Karte
// NICHT zwei Fassungen derselben Linienfarben pflegen — der Style ist eine
// gestalterische Entscheidung (Casing-Paare, Strichart als Hierarchie), keine
// Panel-Eigenschaft.

import type { FeatureCollection } from 'geojson'
import type { StyleSpecification } from 'maplibre-gl'
import europeBasemapUrl from '../mapdata/europe.basemap.json?url'
import austriaBasemapUrl from '../mapdata/austria.basemap.json?url'

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// Lokaler Style: nur Hintergrund + GeoJSON-Linien, keine externen Ressourcen.
//
// Grenzen als CASING-Paare (breite dunkle Linie unten, schmaler heller Kern
// darüber): eine einzelne Linienfarbe funktioniert gegen eine divergierende
// Farbskala nie überall — mit dunkler UND heller Kante bleibt jede Grenze
// über hellen wie dunklen Feldbereichen lesbar (gleiches Prinzip wie der
// Label-Halo). Hierarchie über STRICHART, nicht über Helligkeit:
// Staatsgrenzen/Küsten durchgezogen, Bundeslandgrenzen gestrichelt.
//
// Achtung: line-dasharray skaliert mit line-width — Casing und Kern brauchen
// unterschiedliche dasharray-Werte, damit die Strichelung physisch deckungs-
// gleich bleibt (Ziel ~3 px Strich / 2 px Lücke).
//
// Reihenfolge bottom→top: Hintergrund → Feld (vor 'graticule' eingefügt) →
// Gradnetz → Bundeslandgrenzen → Küsten → Staatsgrenzen; Städte/Labels sind
// DOM-Marker und liegen immer zuoberst.
const CASING_COLOR = '#0c0d0f'
const CORE_COLOR = '#b4b9c2'

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    coast: { type: 'geojson', data: EMPTY_FC },
    borders: { type: 'geojson', data: EMPTY_FC },
    admin1: { type: 'geojson', data: EMPTY_FC },
    graticule: { type: 'geojson', data: EMPTY_FC },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#131418' } },
    {
      id: 'graticule',
      type: 'line',
      source: 'graticule',
      paint: { 'line-color': '#585c66', 'line-width': 0.6, 'line-opacity': 0.35 },
    },
    // Bundeslandgrenzen: gestrichelt, Casing ~2 px / Kern ~0.8 px
    {
      id: 'admin1-casing',
      type: 'line',
      source: 'admin1',
      paint: {
        'line-color': CASING_COLOR,
        'line-width': 2,
        'line-opacity': 0.85,
        'line-dasharray': [1.5, 1], // ×2 px = 3 px Strich / 2 px Lücke
      },
    },
    {
      id: 'admin1',
      type: 'line',
      source: 'admin1',
      paint: {
        'line-color': CORE_COLOR,
        'line-width': 0.8,
        'line-opacity': 0.9,
        'line-dasharray': [3.75, 2.5], // ×0.8 px = 3 px Strich / 2 px Lücke
      },
    },
    // Küsten und Staatsgrenzen: durchgezogen, Casing ~3 px / Kern ~1.5 px
    {
      id: 'coast-casing',
      type: 'line',
      source: 'coast',
      paint: { 'line-color': CASING_COLOR, 'line-width': 3, 'line-opacity': 0.85 },
    },
    {
      id: 'coast',
      type: 'line',
      source: 'coast',
      paint: { 'line-color': CORE_COLOR, 'line-width': 1.5 },
    },
    {
      id: 'borders-casing',
      type: 'line',
      source: 'borders',
      paint: { 'line-color': CASING_COLOR, 'line-width': 3, 'line-opacity': 0.85 },
    },
    {
      id: 'borders',
      type: 'line',
      source: 'borders',
      paint: { 'line-color': CORE_COLOR, 'line-width': 1.5 },
    },
  ],
}

/** Ein Overlay (Feld, Radarbild) liegt unter Gradnetz und allen Grenz-Layern. */
export const OVERLAY_INSERT_BEFORE = 'graticule'

// --- Basemap-Daten (gebündelt, lazy geladen und gecacht) -------------------

export interface BasemapData {
  coast: FeatureCollection
  borders: FeatureCollection
  /** Bundesland-/Regionsgrenzen — nur in der Österreich-Domain gebündelt. */
  admin1?: FeatureCollection
}

const BASEMAP_URLS: Record<string, string> = {
  europe: europeBasemapUrl,
  austria: austriaBasemapUrl,
}

const basemapCache = new Map<string, Promise<BasemapData>>()

export function loadBasemap(domainId: string): Promise<BasemapData> {
  let cached = basemapCache.get(domainId)
  if (!cached) {
    cached = fetch(BASEMAP_URLS[domainId]).then((r) => {
      if (!r.ok) throw new Error(`Basemap ${domainId}: HTTP ${r.status}`)
      return r.json() as Promise<BasemapData>
    })
    basemapCache.set(domainId, cached)
  }
  return cached
}


/**
 * Gradnetz über eine BBox (+ Rand). Der Rand ist bewusst grosszügig: beim
 * Verschieben der Karte soll das Netz nicht an der Datenkante aufhören.
 */
export function buildGraticuleBox(
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  step: number,
): FeatureCollection {
  const ext = 2 * step
  const { latMin, latMax, lonMin, lonMax } = bbox
  const features: FeatureCollection['features'] = []
  for (let lon = Math.ceil((lonMin - ext) / step) * step; lon <= lonMax + ext; lon += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, Math.max(latMin - ext, -85)],
          [lon, Math.min(latMax + ext, 85)],
        ],
      },
    })
  }
  for (let lat = Math.ceil((latMin - ext) / step) * step; lat <= latMax + ext; lat += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [lonMin - ext, lat],
          [lonMax + ext, lat],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
