// Erzeugt die Beschriftung der Modellkarten: Städte, Länder, Meere — weltweit,
// mit deutschen Namen, aus Natural Earth (gemeinfrei).
//
// Aufruf: `node scripts/build-labels.mjs` → src/mapdata/world.labels.json
//
// Je Eintrag ein kompaktes Tupel [Name, Länge, Breite, ab Zoom, Art]. „Ab
// Zoom" ist in MapLibre-Zoom umgerechnet: Natural Earth gibt `MIN_ZOOM` für
// 256-px-Kacheln an, MapLibre rechnet mit 512 px — eine Stufe weniger. Wer
// sich durchsetzt, wenn Beschriftungen sich überlappen, entscheidet die
// Karte zur Laufzeit (`render/worldLabels.ts`); die Datei liefert nur, was
// bei welchem Zoom überhaupt in Frage kommt.
import { writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'

async function load(name) {
  const res = await fetch(BASE + name + '.geojson')
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()).features
}

/** Bis zu welcher Natural-Earth-Stufe Städte mitkommen (7 ≈ Kleinstädte, ~6.400 Orte). */
const CITY_MAX_NE_ZOOM = 7
const r2 = (v) => Math.round(v * 100) / 100
const z = (neZoom) => Math.round(Math.max(0, neZoom - 1) * 10) / 10

// Art: 0 = Stadt, 1 = Hauptstadt, 2 = Land, 3 = Meer
const cities = (await load('ne_10m_populated_places'))
  .map((f) => f.properties)
  // Jenseits ±85° liegt nichts, was die Mercator-Ansichten zeigen könnten —
  // die Südpolstation (−90°) landete dort sonst am oberen Bildrand
  .filter((p) => p.MIN_ZOOM <= CITY_MAX_NE_ZOOM && Math.abs(p.LATITUDE) <= 85)
  .map((p) => [p.NAME_DE || p.NAME, r2(p.LONGITUDE), r2(p.LATITUDE), z(p.MIN_ZOOM), p.ADM0CAP === 1 ? 1 : 0])

const countries = (await load('ne_50m_admin_0_countries'))
  .map((f) => f.properties)
  .filter((p) => p.LABEL_X != null && p.MIN_LABEL != null)
  .map((p) => [p.NAME_DE || p.NAME, r2(p.LABEL_X), r2(p.LABEL_Y), z(p.MIN_LABEL), 2])

/**
 * Beschriftungspunkt eines Meeres: Schwerpunkt seines größten Teilpolygons.
 * Natural Earth liefert für Meere keinen Labelpunkt. Bei sehr verwinkelten
 * Flächen kann der Schwerpunkt neben dem Wasser liegen — für die großen
 * Meere, die bei kleinem Zoom beschriftet werden, ist er gut.
 */
function labelPoint(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let best = null
  for (const poly of polys) {
    const ring = poly[0]
    let a = 0, cx = 0, cy = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]
      const [x1, y1] = ring[i]
      const k = x0 * y1 - x1 * y0
      a += k
      cx += (x0 + x1) * k
      cy += (y0 + y1) * k
    }
    if (a === 0) continue
    if (!best || Math.abs(a) > Math.abs(best.a)) best = { a, x: cx / (3 * a), y: cy / (3 * a) }
  }
  return best && [r2(best.x), r2(best.y)]
}

const seas = (await load('ne_10m_geography_marine_polys'))
  .filter((f) => f.geometry && f.properties.min_label != null && f.properties.min_label <= 5)
  .map((f) => {
    const p = labelPoint(f.geometry)
    return p && [f.properties.name_de || f.properties.name, p[0], p[1], z(f.properties.min_label), 3]
  })
  .filter(Boolean)

const out = { labels: [...countries, ...seas, ...cities] }
const path = new URL('../src/mapdata/world.labels.json', import.meta.url).pathname
const json = JSON.stringify(out)
writeFileSync(path, json)
console.log(
  `world.labels.json: ${countries.length} Länder, ${seas.length} Meere, ${cities.length} Städte, ${Math.round(json.length / 1024)} KB`,
)
