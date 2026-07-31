# Österreich-Klimakarte — Schritt 0: Inventur + Umsetzungsplan

Ergebnis der Repo-Inventur und Live-Prüfung der GeoSphere-API. **Noch kein Code —
Freigabe abwarten.** Grundlage: `oesterreichklimakarteprompt.md`.

## A. Repo-Inventur — was existiert, was wiederverwendbar ist

Die Website ist aktuell eine **Modellvergleichs-Workbench** (Open-Meteo), kein
Stationsdienst. Es gibt **keine bestehende Deutschland-/Stationskarte** zum
1:1-Wiederverwenden — aber viele passende Bausteine:

| Baustein | Datei | Für die AT-Karte |
|---|---|---|
| Kartenrendering | `src/components/MapPanel.tsx` (MapLibre, 519 Z.) | **Nicht** wiederverwenden: MapLibre ist schwer (~1 MB) und im Web-Build ohnehin **deaktiviert** (`VITE_ENABLE_MAP=false`). Die MD will explizit eine *leichte statische* Karte. |
| AT-Umriss | `src/mapdata/austria.basemap.json` (Natural Earth, gebündelt) | **Ja** — Landesgrenze für die statische SVG/Canvas-Karte. |
| Punkt-Marker + Label-Ausdünnung | CITIES-DOM-Marker-Muster in `MapPanel.tsx`, `src/config/cities.ts` | Muster als Vorlage für Stationspunkte + Labels. |
| Farbskalen | `src/config/colorscales.ts` (stepped/linear, `belowMin`) | **Ja** — Registry-Muster für Colorbar/Legende; neue Skalen via `dataviz`-Skill. |
| Zeitreihen-Chart | `src/components/Meteogram.tsx` (uPlot + Cursor-Linie) | uPlot-Setup-Muster für das Stationsdetail wiederverwenden (neue Quelle GeoSphere). |
| Persistenter Cache | `src/api/gridcache.ts` (IndexedDB, Lauf-Bucket-Key) | **Ja** — zu generischem Key-Blob-Cache verallgemeinern; historische Daten für immer cachen. |
| Query-Hooks | `src/api/queries.ts` (TanStack Query) | Muster für `useAtStations` / `useAtMap` / `useAtStationSeries`. |
| Parameter-Registry | `src/config/variables.ts` (`FieldSpec`) | Vorbild für AT-Parameter-Registry. |
| State | `src/state/workbench.ts` (Zustand) | Muster für AT-Sektions-State. |

**Kritischer Architektur-Befund:** Produktion ist eine **statische GitHub-Pages-Seite**
(`build:web`, Karte aus). Der `server/`-Grid-Proxy läuft **nur als Vite-Dev-Plugin** —
**in Produktion gibt es keinen Backend-Prozess.** Die `/api/at/*`-Server-Contracts
aus MD §5 lassen sich so nicht deployen und müssen angepasst werden (siehe C).

## B. Datenquelle — live verifiziert (2026-07-24)

GeoSphere Dataset API v1, `https://dataset.api.hub.geosphere.at/v1`, **kein Key**,
**CORS offen** (`access-control-allow-origin: *`) → **Browser kann direkt abfragen**.

Abweichungen zur MD (verifiziert):

1. **Route der Werte:** `klima-v2-1d` ist ein *Stations*-Datensatz → Werte über
   `/v1/station/historical/klima-v2-1d?...` (die MD-URL `/v1/timeseries/...` gibt 404).
2. **Stationszahl:** **1100** gesamt, **492 aktiv** (`is_active`) — nicht ~250–280.
   Empfehlung: Default nur aktive, Umschalter für historische.
3. **Parameter:** 130 Einträge, davon 65 echte (Rest `*_flag`-Qualitätsflags → filtern).
   Codes termin-basiert; für Klimatologie kuratierte Teilmenge nutzen:
   `tl_mittel`/`tlmax`/`tlmin` (°C), `rr` (mm), `sh` (cm Schnee), `so_h` (Sonnenstunden),
   `rfb_mittel` (% Feuchte) usw.

Verifizierte Antwortform (Bulk über mehrere Stationen in **einem** Request):
```
GET /v1/station/historical/klima-v2-1d?parameters=tl_mittel,rr
    &start=2020-07-01&end=2020-07-03&station_ids=1,5925&output_format=geojson
→ FeatureCollection; top-level timestamps[]; je Feature:
  properties.station = id, properties.parameters.<code>.data[] (an timestamps ausgerichtet)
```
**Gotcha:** GeoSphere-Geometrie ist `[lat, lon]` (nicht GeoJSON-Standard `[lon, lat]`).

4. **`klima-v2-1d` kennt den laufenden Tag NICHT** (live geprüft 2026-07-31):
   Für „heute" liefert der Datensatz durchgehend `null`, der Vortag liegt
   dagegen schon am Folgetag vor (454/462 Stationen). Tagesaggregate entstehen
   erst nach Tagesende. Der laufende Tag kommt deshalb aus
   **`station/historical/klima-v2-10min`** (gleiche Parametercodes
   `tl`/`tlmax`/`tlmin`/`rr`/`so`/`rf`/`sh`, `so` in **Sekunden**), im Browser
   über die 10-Minuten-Werte des Tages aggregiert — vorläufig und ungeprüft,
   deshalb in der UI als solches markiert. Der Datensatz kennt **474 der 492
   aktiven** Klimastationen; unbekannte `station_ids` lassen den GESAMTEN
   Request mit HTTP 400 scheitern → Filter `has10min` aus dem Stations-Ingest.
   Gleiches gilt für `klima-v2-1m` und den laufenden Monat (ebenfalls `null`) —
   dort bisher nicht behandelt.

## C. Empfohlene Architektur (statisch, ohne Live-Server)

Da Produktion statisch ist und GeoSphere CORS-offen + keyless ist:

1. **Ingest-/Build-Skript** (Node, lokal oder in CI) berechnet **statische JSON-Assets**
   vor und legt sie ins Repo/`public/` — Laufzeitkosten = 0:
   - `stations.json` (id, name, lat, lon, höhe, zeitraum, is_active, params)
   - `normals.json` (langjährige Mittel 1991–2020 je Station/Parameter — aus
     `klima-v2-1m` aggregiert, nicht täglich)
   - `records.json` (min/max je Station + national)
2. **Laufzeit = Browser → GeoSphere direkt** für tages-/monatsaktuelle Werte &
   Detail-Zeitreihen. **Ein Bulk-Request pro Kartenansicht** über alle `station_ids`.
   IndexedDB-Cache (`gridcache.ts`-Muster verallgemeinert); historisch = für immer.
3. Die MD-§5-Endpunkte werden **client-seitige Funktionen** in `src/api/geosphere.ts`
   (semantisch identisch: bulk + cache), statt Server-Routen. Kein Backend nötig.

## D. Getroffene Entscheidungen (Freigabe 2026-07-24)

- **Architektur:** **statisch-direkt** — Build-Skript für Stammdaten/Normale/Rekorde,
  Laufzeitwerte client-seitig direkt von GeoSphere + IndexedDB-Cache. Kein Backend.
- **Navigation:** **View-Switch im Zustand-Store** (kein react-router).
- **Stationsumfang:** Default **nur aktive** (492), Umschalter für alle (1100).

## E. Roadmap — Umsetzungsstand

1. ✅ Stationsstammdaten → `public/at/stations.json` (1100/492 aktiv) + `parameters.json`.
   Loader `src/api/geosphere.ts`. Ingest: `scripts/at-ingest-stations.mjs`.
2. ✅ Statische AT-Karte (Canvas) + Stationspunkte + Hover-Tooltip. `render/atmap.ts`,
   `components/AtClimateMap.tsx`. View-Switch: `state/appView.ts` + `AppNav`.
3. ✅ Parameter-Registry (`config/atParameters.ts`) + Werte-Layer (ein Bulk-Request,
   `fetchStationSeries`) + Dropdown. **Statt Colorbar: Werte direkt in der Karte**
   (Nutzer-Feedback). IndexedDB-Cache `api/atcache.ts`.
4. ✅ Stationsdetail (`AtStationDetail.tsx`, uPlot): 12-Monats-Zeitreihe + Kennzahlen.
5. ✅ Zeitbezug Tag/Monat/Jahr (`api/atValues.ts`) + Normale 1991–2020
   (`at-ingest-normals.mjs` → `normals.json`, 806 Stationen) + Anomalien (Temp K,
   Niederschlag/Sonne % vom Normal, divergierende RdBu/BrBG-Skalen). Rekorde
   (`at-ingest-records.mjs` → `records.json`, 1094 Stationen) im Detailpanel.
6. ✅ Vitest-Tests (`*.test.ts`: aggregate/anomaly/colorForValue). Ladezustände +
   Fehleranzeigen vorhanden. Build + Lint grün.
7. ✅ Laufender Tag live aus `klima-v2-10min` + „Aktuell"-Knopf (springt auf den
   neuesten Stand, holt heute am TTL-Cache vorbei).
8. ✅ Rangliste der Extremwerte (`AtRankList`, Kern `atRank.ts` + Tests) mit
   Karten-Highlight beim Hover; MOS-Punktvorhersage beim Klick auf eine
   Vorhersagestation (`AtForecastDetail`, Ausrichtung über `alignSeries` + Tests).
9. ✅ Schnellansicht ↔ maximiert für Rangliste und Detail; sortierbare
   Volltabelle mit Suche und Kennzahlen; tagesgenaue Rekorde für Tmax/Tmin
   (`api/atRecords.ts` + Tests, aus dem Tagesdatensatz nachgeladen);
   Parameter- und Rekord-Beschreibungen in der UI.

## F. Betrieb & bewusste Grenzen

- **Daten-Refresh:** `npm run ingest:at` / `ingest:at:normals` / `ingest:at:records`
  regenerieren die statischen JSON-Assets aus GeoSphere. Historische Daten sind
  statisch — ein Refresh ist nur nötig, wenn neue Monate/Normalperioden gewünscht
  sind. Ideal vor dem Build in CI ausführen.
- **Caching-Abnahme:** `fetchStationSeries` cached je (Datensatz|Parameter|Zeitraum|
  Stations-IDs) in IndexedDB → eine Auswahl = ein Request, Wiederholung = 0.
- **Grenzen (bewusst):** Rekorde ab **1900** (die wenigen Reihen bis ins 18. Jh.
  bleiben außen vor). Schnee (`sh`) nur im Tag-Modus (kein Monatswert). Feuchte
  monatlich als `rf_mittel` (Tag: `rfb_mittel`). Fehlwert-Sentinels (−1 bei rr/sh)
  werden gefiltert. Nur im Monatsdatensatz vorhandene Stations-IDs bekommen
  Normale/Rekorde (der Hub 403t sonst den ganzen Request).
