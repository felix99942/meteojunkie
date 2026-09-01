// Ingest der GeoSphere-Stationsstammdaten (Österreich-Klimakarte, Schritt 1).
//
// Zieht die Metadaten des Datensatzes `klima-v2-1d` (Stations-Stammdaten +
// verfügbare Parameter) EINMAL vom GeoSphere Data Hub und legt zwei statische
// Assets unter public/at/ ab:
//
// WICHTIG — GeoSphere führt jede Messreihe DOPPELT: einmal als `INDIVIDUAL`
// (ein physischer Standort) und einmal als `COMBINED` (die fortgeführte Reihe
// über alle Standorte hinweg, `group_id` verweist von Kind auf Elternteil).
// Ohne Filter stand jede verlegte Station zweimal in der Karte — „Salzburg
// Flughafen" als Standort ab 1939 UND als Reihe ab 1874, mit identischen
// aktuellen Werten. Hier bleibt deshalb je Gruppe NUR die COMBINED-Reihe; ihre
// Standortgeschichte wandert als `sites` in den Eintrag, sonst sähe „Salzburg
// Flughafen seit 1874" nach einem Datenfehler aus (Flughäfen gab es 1874
// nicht). Stationen ohne Gruppe bleiben unverändert.
//
// Geprüft (2026-09-01): 216 COMBINED + 298 gruppenlose INDIVIDUAL = 514 statt
// 1100 Einträge; die 587 gruppierten Standorte sind echte Dubletten. KEIN
// Verlust an Live-Abdeckung: jeder gruppierte Standort mit 10-Minuten-Daten
// hat einen Elternteil, der sie ebenfalls hat (240 → 0 Verluste). Die
// Verlegungen sind klein genug, dass die eine Koordinate der COMBINED-Reihe
// trägt: Median 1,0 km / 11 m Höhenunterschied, p90 3,1 km / 58 m, Maximum
// 6,2 km (Wien Hohe Warte) bzw. 346 m.
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
  // Standortgeschichte je COMBINED-Reihe: die Kinder ihrer Gruppe, chronologisch.
  // `to: null` = läuft weiter (GeoSphere kodiert das als 2100-12-31).
  const sitesByGroup = new Map()
  for (const s of rawStations) {
    if (s.type !== 'INDIVIDUAL' || s.group_id == null) continue
    if (!sitesByGroup.has(s.group_id)) sitesByGroup.set(s.group_id, [])
    sitesByGroup.get(s.group_id).push({
      id: s.id,
      name: s.name,
      from: s.valid_from ? s.valid_from.slice(0, 7) : null,
      to: s.valid_to && !s.valid_to.startsWith('2100') ? s.valid_to.slice(0, 7) : null,
    })
  }
  for (const list of sitesByGroup.values()) list.sort((a, b) => String(a.from).localeCompare(String(b.from)))

  const stations = rawStations
    // Gruppierte Einzelstandorte fallen weg — ihre Daten stecken vollständig
    // in der COMBINED-Reihe derselben Gruppe (live gegen klima-v2-1m geprüft:
    // identische Werte, die Reihe reicht nur weiter zurück).
    .filter((s) => !(s.type === 'INDIVIDUAL' && s.group_id != null))
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
      // Nur bei zusammengeführten Reihen gesetzt: die Standorte, die sie
      // fortführt. Erklärt den frühen Reihenbeginn und gehört ins Detail.
      ...(sitesByGroup.has(s.id) ? { sites: sitesByGroup.get(s.id) } : {}),
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

  // Plausibilitätsprüfung (nach der Zusammenführung: 514 Einträge, ~290 aktiv).
  const active = stations.filter((s) => s.isActive)
  const outOfBox = stations.filter(
    (s) =>
      s.lat < AT_BBOX.latMin ||
      s.lat > AT_BBOX.latMax ||
      s.lon < AT_BBOX.lonMin ||
      s.lon > AT_BBOX.lonMax,
  )
  const live = active.filter((s) => s.has10min)
  const merged = stations.filter((s) => s.sites)
  process.stdout.write(
    `Stationen: ${stations.length} gesamt, ${active.length} aktiv ` +
      `(davon ${live.length} mit 10-Minuten-Daten) · ` +
      `${merged.length} zusammengeführte Reihen über ` +
      `${merged.reduce((n, s) => n + s.sites.length, 0)} Standorte · ` +
      `Parameter (ohne Flags): ${parameters.length}\n`,
  )
  // Dublettenprobe — der Grund, aus dem hier überhaupt gefiltert wird. Zwei
  // Einträge mit gleichem Namen an derselben Stelle sind fast immer ein nicht
  // erkanntes COMBINED/INDIVIDUAL-Paar. Bekannt und in Ordnung sind zwei
  // Fälle, die GeoSphere NICHT gruppiert: reine Niederschlagsmessstellen neben
  // der Klimastation (live geprüft — sie liefern nur `rr`). Sie zu verwerfen
  // hieße, eine eigene Messreihe wegzuwerfen, nur weil sie am selben Ort steht.
  const KNOWN_SAME_SITE = new Set(['Dornbirn', 'Hochfilzen'])
  const seen = new Map()
  for (const s of stations) {
    const key = `${s.name}|${s.lat.toFixed(4)}|${s.lon.toFixed(4)}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const dups = [...seen]
    .filter(([, n]) => n > 1)
    .map(([k]) => k.split('|')[0])
    .filter((n) => !KNOWN_SAME_SITE.has(n))
  if (dups.length > 0) {
    process.stdout.write(
      `Warnung: ${dups.length} Station(en) doppelt an derselben Stelle — ` +
        `vermutlich ein nicht gefiltertes COMBINED/INDIVIDUAL-Paar: ${dups.join(', ')}\n`,
    )
  }

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
