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

## E. Roadmap (unverändert aus MD, Schritte 1–6)

1. Stationsstammdaten → `stations.json` + Parameterliste (aus `/metadata`).
2. Statische AT-Karte (SVG/Canvas) + Stationspunkte + Hover-Tooltip.
3. Parameter-Registry + Werte-Layer (ein Bulk-Request) + Dropdown + Colorbar (`dataviz`).
4. Stationsdetail/Meteogramm (uPlot-Muster, Quelle GeoSphere).
5. Normale/Anomalien/Rekorde (vorberechnet) + divergierende Colormaps.
6. Feinschliff, Cache-Abnahme (1 Auswahl = 1 Request, Wiederholung = 0), Tests, Visual-Checks.
