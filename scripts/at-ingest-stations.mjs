// Ingest der GeoSphere-Stationsstammdaten (Österreich-Klimakarte, Schritt 1).
//
// Zieht die Metadaten des Datensatzes `klima-v2-1d` (Stations-Stammdaten +
// verfügbare Parameter) EINMAL vom GeoSphere Data Hub und legt zwei statische
// Assets unter public/at/ ab:
//   - stations.json    kuratierte Stationsliste (id, name, state, lat, lon,
//                       höhe, zeitraum, is_active, has_sunshine/-radiation)
//   - parameters.json   alle „echten" Parameter (ohne *_flag-Qualitätsflags),
//                       je code → long_name/unit — Quelle der Wahrheit fürs Label-Mapping
//
// Stammdaten ändern sich selten; dieses Skript läuft manuell (oder in CI vor dem
// Build), nicht zur Laufzeit. Kein API-Key, CORS offen, Lizenz CC BY 4.0.
//
//   node scripts/at-ingest-stations.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const META_URL =
  'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1d/metadata'
// Der 10-Minuten-Datensatz trägt den LAUFENDEN Tag (klima-v2-1d aggregiert erst
// nach Tagesende). Er kennt nicht alle Klimastationen — welche, wird hier als
// `has10min` mitgeschrieben: unbekannte IDs lassen den ganzen Wert-Request mit
// HTTP 400 scheitern, das Frontend muss vorher filtern können.
const META_10MIN_URL =
  'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-10min/metadata'

// Österreich-Bounding-Box (grob, mit Puffer) — Plausibilitätsprüfung der Koordinaten.
const AT_BBOX = { latMin: 46.0, latMax: 49.2, lonMin: 9.3, lonMax: 17.3 }

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')

async function main() {
  process.stdout.write(`Lade Metadaten … ${META_URL}\n`)
  const res = await fetch(META_URL)
  if (!res.ok) throw new Error(`Metadaten-Fetch fehlgeschlagen: HTTP ${res.status}`)
  const meta = await res.json()

  process.stdout.write(`Lade Metadaten … ${META_10MIN_URL}\n`)
  const res10 = await fetch(META_10MIN_URL)
  if (!res10.ok) throw new Error(`10min-Metadaten-Fetch fehlgeschlagen: HTTP ${res10.status}`)
  const ids10min = new Set(((await res10.json()).stations ?? []).map((s) => s.id))

  const rawStations = meta.stations ?? []
  const rawParams = meta.parameters ?? []

  // Stationen kuratieren. GeoSphere liefert Koordinaten als [lat, lon] — hier
  // in benannte Felder überführen, damit im Frontend keine Reihenfolge-Verwechslung
  // (GeoJSON wäre [lon, lat]) passieren kann.
  const stations = rawStations
    .map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state ?? null,
      lat: s.lat,
      lon: s.lon,
      altitude: s.altitude ?? null,
      validFrom: s.valid_from ?? null,
      validTo: s.valid_to ?? null,
      isActive: Boolean(s.is_active),
      hasSunshine: Boolean(s.has_sunshine),
      hasRadiation: Boolean(s.has_global_radiation),
      has10min: ids10min.has(s.id),
    }))
    .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')

  // Parameter: die reinen Messgrößen behalten, Qualitätsflags (*_flag) verwerfen.
  const parameters = rawParams
    .filter((p) => !String(p.name).endsWith('_flag'))
    .map((p) => ({
      code: p.name,
      label: p.long_name ?? p.name,
      unit: p.unit ?? '',
    }))

  // Plausibilitätsprüfung (MD Schritt 1: ~250–280 erwartet — real 1100/492 aktiv).
  const active = stations.filter((s) => s.isActive)
  const outOfBox = stations.filter(
    (s) =>
      s.lat < AT_BBOX.latMin ||
      s.lat > AT_BBOX.latMax ||
      s.lon < AT_BBOX.lonMin ||
      s.lon > AT_BBOX.lonMax,
  )
  const live = active.filter((s) => s.has10min)
  process.stdout.write(
    `Stationen: ${stations.length} gesamt, ${active.length} aktiv ` +
      `(davon ${live.length} mit 10-Minuten-Daten) · ` +
      `Parameter (ohne Flags): ${parameters.length}\n`,
  )
  if (outOfBox.length > 0) {
    process.stdout.write(
      `Warnung: ${outOfBox.length} Station(en) außerhalb der AT-Bounding-Box, z.B. ` +
        `${outOfBox
          .slice(0, 3)
          .map((s) => `${s.name}(${s.lat},${s.lon})`)
          .join(', ')}\n`,
    )
  }
  if (stations.length < 200) throw new Error('Unerwartet wenige Stationen — Abbruch')

  const generatedFrom = { source: META_URL, dataset: 'klima-v2-1d', license: 'CC BY 4.0' }

  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'stations.json'),
    JSON.stringify({ meta: generatedFrom, stations }, null, 0),
  )
  await writeFile(
    join(outDir, 'parameters.json'),
    JSON.stringify({ meta: generatedFrom, parameters }, null, 2),
  )
  process.stdout.write(`Geschrieben: public/at/stations.json, public/at/parameters.json\n`)
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
