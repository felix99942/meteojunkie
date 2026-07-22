// Erzeugt gebündelte Basemap-Daten: Natural Earth 1:50m Küstenlinien +
// Landesgrenzen, zugeschnitten auf die beiden Domains, Koordinaten gerundet.
import { writeFileSync, mkdirSync } from 'node:fs'

const SOURCES = {
  coast: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson',
  borders: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson',
  // Bundesland-/Regionsgrenzen: 1:10m für ausreichende Detailtreue —
  // wird nur für die Österreich-Domain ausgegeben (in Europa wäre es Rauschen)
  admin1: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson',
}

const DOMAINS = {
  europe: { latMin: 35, lonMin: -12, latMax: 70, lonMax: 40, margin: 4, layers: ['coast', 'borders'] },
  austria: { latMin: 46.3, lonMin: 9.5, latMax: 49.1, lonMax: 17.2, margin: 3, layers: ['coast', 'borders', 'admin1'] },
}

const round = (v) => Math.round(v * 1000) / 1000

function clipLines(geojson, bbox) {
  const inside = ([lon, lat]) =>
    lat >= bbox.latMin - bbox.margin && lat <= bbox.latMax + bbox.margin &&
    lon >= bbox.lonMin - bbox.margin && lon <= bbox.lonMax + bbox.margin
  const features = []
  for (const f of geojson.features) {
    if (!f.geometry) continue // Natural Earth 10m enthält Features mit null-Geometrie
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []
    for (const line of lines) {
      const keep = line.map(inside)
      let run = []
      for (let i = 0; i < line.length; i++) {
        // Punkt behalten, wenn er oder ein Nachbar innerhalb liegt (Übergänge erhalten)
        if (keep[i] || keep[i - 1] || keep[i + 1]) {
          run.push([round(line[i][0]), round(line[i][1])])
        } else if (run.length) {
          if (run.length >= 2) features.push(run)
          run = []
        }
      }
      if (run.length >= 2) features.push(run)
    }
  }
  return {
    type: 'FeatureCollection',
    features: features.map((coords) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    })),
  }
}

const raw = {}
for (const [key, url] of Object.entries(SOURCES)) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
  raw[key] = await res.json()
  console.log(`geladen: ${key} (${raw[key].features.length} Features)`)
}

const outDir = new URL('../src/mapdata/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })
for (const [id, bbox] of Object.entries(DOMAINS)) {
  const out = {}
  for (const layer of bbox.layers) {
    // admin1 eng zuschneiden: 10m-Detail über die volle Marge würde die
    // Datei aufblähen — die Linien sind Orientierung, nicht Inhalt
    const clip = layer === 'admin1' ? { ...bbox, margin: 0.5 } : bbox
    out[layer] = clipLines(raw[layer], clip)
  }
  const path = `${outDir}${id}.basemap.json`
  const json = JSON.stringify(out)
  writeFileSync(path, json)
  const counts = bbox.layers.map((l) => `${l} ${out[l].features.length}`).join(' / ')
  console.log(`${id}: ${counts} Linien, ${Math.round(json.length / 1024)} KB`)
}
