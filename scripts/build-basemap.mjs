// Erzeugt gebündelte Basemap-Daten: Natural Earth 1:50m Küstenlinien +
// Landesgrenzen, zugeschnitten auf die Domains, Koordinaten gerundet.
//
// Aufruf: `node scripts/build-basemap.mjs [domain …]` — ohne Argument alle,
// sonst nur die genannten (z. B. `dach`).
import { writeFileSync, mkdirSync } from 'node:fs'

const SOURCES = {
  coast: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson',
  borders: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson',
  // Bundesland-/Regionsgrenzen: 1:10m für ausreichende Detailtreue — nur für
  // die Österreich-Domain und den Radarbereich (über ganz Europa wäre es Rauschen)
  admin1: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson',
  // Landflächen (Polygone) für den Globus: Land hebt sich vom Meer ab. Sichtbar
  // nur, wo das Feld durchsichtig ist (kein Niederschlag, klarer Himmel,
  // außerhalb der Regionalmodelle). 1:50m wie die Küstenlinie, damit die
  // Flächenkante exakt unter der Linie liegt.
  land: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
}

const DOMAINS = {
  europe: { latMin: 35, lonMin: -12, latMax: 70, lonMax: 40, margin: 4, layers: ['coast', 'borders'] },
  austria: { latMin: 46.3, lonMin: 9.5, latMax: 49.1, lonMax: 17.2, margin: 3, layers: ['coast', 'borders', 'admin1'] },
  // Radarbereich: NUR admin1 — Küsten und Staatsgrenzen holt sich die
  // Radarkarte weiter aus dem Europa-Bündel, das sie ohnehin lädt. Fläche =
  // die des DWD-Radarprodukts (lon 1,5–18,7 / lat 45,7–56,2).
  dach: { latMin: 45.7, lonMin: 1.5, latMax: 56.2, lonMax: 18.7, margin: 0.5, layers: ['admin1'] },
  // Globus: die ganze Erde, Küsten und Staatsgrenzen in 1:50m. Gerundet auf
  // 0,01° (~1 km) statt 0,001° — 1:50m ist ohnehin nicht genauer, und mit
  // drei Nachkommastellen wäre das Bündel fast doppelt so groß.
  world: { latMin: -90, lonMin: -180, latMax: 90, lonMax: 180, margin: 0, layers: ['coast', 'borders', 'land'], decimals: 2 },
}

/**
 * Für admin1 werden nur DIESE Länder ausgegeben: Bundesländer und Kantone des
 * D-A-CH-Raums. Ungefiltert kämen die Regionen Frankreichs, Italiens,
 * Tschechiens und Polens mit in die Radarfläche — Linien, die dort niemand
 * sucht, und die das Bündel vervielfachen. Leer = kein Filter.
 */
const ADMIN1_COUNTRIES = new Set(['DEU', 'AUT', 'CHE'])

function clipLines(geojson, bbox, keepFeature = () => true) {
  const f = 10 ** (bbox.decimals ?? 3)
  const round = (v) => Math.round(v * f) / f
  const inside = ([lon, lat]) =>
    lat >= bbox.latMin - bbox.margin && lat <= bbox.latMax + bbox.margin &&
    lon >= bbox.lonMin - bbox.margin && lon <= bbox.lonMax + bbox.margin
  const features = []
  for (const f of geojson.features) {
    if (!f.geometry) continue // Natural Earth 10m enthält Features mit null-Geometrie
    if (!keepFeature(f)) continue
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

/**
 * Polygone nur runden, nicht zuschneiden — es gibt sie nur im Welt-Bündel.
 * Aufeinanderfolgende gleiche Punkte (nach dem Runden) fallen weg; Ringe, die
 * dabei unter vier Punkte schrumpfen (winzige Inseln), entfallen ganz.
 */
function roundPolygons(geojson, decimals) {
  const f = 10 ** decimals
  const round = (v) => Math.round(v * f) / f
  const ring = (r) => {
    const out = []
    for (const [lon, lat] of r) {
      const p = [round(lon), round(lat)]
      const last = out[out.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
    }
    return out.length >= 4 ? out : null
  }
  const features = []
  for (const feat of geojson.features) {
    const g = feat.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) {
      const outer = ring(poly[0])
      if (!outer) continue
      const holes = poly.slice(1).map(ring).filter(Boolean)
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outer, ...holes] } })
    }
  }
  return { type: 'FeatureCollection', features }
}

const needed = new Set(
  Object.entries(DOMAINS)
    .filter(([id]) => process.argv.length <= 2 || process.argv.slice(2).includes(id))
    .flatMap(([, d]) => d.layers),
)

const raw = {}
for (const [key, url] of Object.entries(SOURCES)) {
  if (!needed.has(key)) continue
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
  raw[key] = await res.json()
  console.log(`geladen: ${key} (${raw[key].features.length} Features)`)
}

const outDir = new URL('../src/mapdata/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })
// Ohne Argumente alle Domains; sonst nur die genannten — so lässt sich ein
// neues Bündel erzeugen, ohne die vorhandenen gegen einen inzwischen
// geänderten Natural-Earth-Stand neu zu schreiben.
const only = process.argv.slice(2)
for (const [id, bbox] of Object.entries(DOMAINS)) {
  if (only.length > 0 && !only.includes(id)) continue
  const out = {}
  for (const layer of bbox.layers) {
    // admin1 eng zuschneiden: 10m-Detail über die volle Marge würde die
    // Datei aufblähen — die Linien sind Orientierung, nicht Inhalt
    const clip = layer === 'admin1' ? { ...bbox, margin: 0.5 } : bbox
    const keep =
      layer === 'admin1' && ADMIN1_COUNTRIES.size > 0
        ? (f) => ADMIN1_COUNTRIES.has(f.properties?.ADM0_A3)
        : undefined
    out[layer] = layer === 'land' ? roundPolygons(raw[layer], bbox.decimals ?? 3) : clipLines(raw[layer], clip, keep)
  }
  const path = `${outDir}${id}.basemap.json`
  const json = JSON.stringify(out)
  writeFileSync(path, json)
  const counts = bbox.layers.map((l) => `${l} ${out[l].features.length}`).join(' / ')
  console.log(`${id}: ${counts} Linien, ${Math.round(json.length / 1024)} KB`)
}
