# Meteo Workbench — Projekt-Spec

Operationelle Wetter-Workbench mit 6-Panel-Layout auf Basis der Open-Meteo API.
Ziel ist ein Arbeitswerkzeug für Modellvergleich, nicht eine Consumer-Wetter-App.

**Stand:** Phase 1 und 2 umgesetzt. Phase 3 offen.

---

## 1. Kernprinzipien

1. **Modellvergleich ist die Hauptfunktion.** Jedes Panel wählt unabhängig
   Modell, Parameter und Darstellungsmodus.
2. **Synchronisation über Panels hinweg.** Ein globaler Zeit-Cursor steuert alle
   sync-aktiven Panels.
3. **Zwei feste Domains.** Kein viewport-gebundenes Nachladen. Siehe §3.
4. **API-Budget ist die bindende Randbedingung.** Cache und Queue sind
   Architekturbestandteil, kein nachträglicher Feinschliff. Siehe §5.
5. **Karte ist Übersichtsebene, Meteogramm ist Präzisionswerkzeug.** Siehe §4.

---

## 2. Tech-Stack und Umgebung

- **Vite + React 19 + TypeScript** (strict)
- **MapLibre GL JS** für die Kartenbasis
- **uPlot** für Zeitreihen
- **TanStack Query** für Fetching und Caching, **Zustand** für globalen State
- **IndexedDB** als persistenter Cache über Sessions hinweg
- Meteogramme (Punktserien) laufen direkt gegen die Open-Meteo API.
  Kartengitter laufen über einen **serverseitigen Grid-Proxy** (`server/`, v1
  umgesetzt) — holt jeden Modelllauf einmal, cached ihn für alle Clients.
  Upstream swap-bereit (Free-API → Professional/self-hosted). Siehe §5.
  In Dev als Vite-Middleware (gleiche Origin), Standalone-Deployment offen.

**Node 22 LTS liegt unter `~/.local/node`** (lokal installiert, kein sudo).
Vor der Arbeit: `export PATH="$HOME/.local/node/bin:$PATH"`.

---

## 3. Domains

Genau zwei Domains. Die Beschränkung ist bewusst: Jede zusätzliche Domain
multipliziert die Cache-Kombinatorik und verhindert, dass der Cache je warm wird.

| Domain     | BBox (lat_min, lon_min, lat_max, lon_max) | Gitter | ca. Zellgröße |
|------------|-------------------------------------------|--------|---------------|
| Europa     | 35, -12, 70, 40                           | 25×25  | ~150 km       |
| Österreich | 46.3, 9.5, 49.1, 17.2                     | 16×30  | ~19 km        |

Das Österreich-Gitter ist bewusst nicht quadratisch — die Domain ist deutlich
breiter als hoch, ein quadratisches Gitter ergäbe stark verzerrte Zellen.

Domain ist globaler State und gilt für alle Kartenpanels gemeinsam.

---

## 4. Auflösungsgrenze — bewusst akzeptiert

Open-Meteo ist punktbasiert. Ein Gitter wird aus Einzelpunkten rekonstruiert und
ist auf 1000 Punkte pro Request begrenzt. Daraus folgt eine harte Obergrenze,
die deutlich über der nativen Auflösung der Lokalmodelle liegt:

- AROME-AT: nativ 1–2,5 km, im Gitter dargestellt mit ~19 km
- ICON-D2: nativ 2,2 km, im Gitter dargestellt mit ~19 km

**Konsequenz:** Die Karte dient der Übersicht — Großwetterlage, Fronten, grobe
Gradienten. Die Detailarbeit passiert in den Meteogrammen an konkreten Punkten,
dort steht die volle Modellauflösung ohne Kompromiss zur Verfügung.

Echte hochaufgelöste Felder erfordern Self-Hosting des Open-Meteo-Servers, um
direkt auf den Modellgittern zu arbeiten. Das ist der Endzustand, auf den das
Projekt zuläuft, aber kein Thema der aktuellen Phasen.

---

## 5. API-Budget und Caching

### Limits (Free Tier)
600 Calls/Minute, 5.000/Stunde, 10.000/Tag, 300.000/Monat.

**Zählweise:** Ein Call entspricht nicht einer HTTP-Anfrage. Gewichtet wird nach
Anzahl Locations, Variablen, Modellen und Zeitraum, mit Bruchteilen gerechnet.
Ein Gitter mit 480 Punkten zählt in der Größenordnung 480, nicht als 1.
Die exakte Formel ist nicht veröffentlicht.

### Regeln
- **Chunking:** max. 250 Punkte pro HTTP-Request, sonst wird die GET-URL zu lang.
- **Queue:** max. 2 gleichzeitige Requests. Nicht parallel feuern.
- **Persistenter Cache** in IndexedDB, Key aus Domain + Modell + Variable +
  Modelllauf. Invalidierung über `updateIntervalHours` aus der Registry.
  Ein Reload darf keine API-Calls kosten.
- **Lazy Loading:** Gitter nur laden, wenn ein Panel tatsächlich im Kartenmodus
  ist. Nie alle sechs Panels beim Start.
- **`forecast_days`:** Karten 3 Tage, Meteogramme 7 Tage.
- **Eine Variable pro Grid-Request.**
- **Verbrauchszähler** in der TopBar, damit der Verbrauch sichtbar bleibt.
- **Rate-Limit-Fehler** sauber abfangen: Meldung im Panel plus Backoff, statt in
  einer Fehlerschleife weiterzufeuern.

### Tarifentscheidung
Free Tier bleibt. **API Standard wäre ein Rückschritt** — Ensemble-, Historical-,
Climate- und Single-Runs-API sind dort nicht enthalten, im Free Tier aber
verfügbar. Genau diese braucht Phase 3.

Falls später doch nötig: **Professional**, nicht Standard.

### Backend-Proxy (v1 umgesetzt)
Grid-Proxy mit serverseitigem Cache (`server/`). Holt Gitter einmal pro
Modelllauf und bedient daraus alle Clients — entkoppelt Nutzungsfrequenz vom
API-Verbrauch, Pacing/Chunking/Bündelung/429-Backoff zentral, Memory- +
Disk-Cache pro Lauf, Dedup gleichzeitiger Fetches.

Upstream ist **swap-bereit** (Env `OPENMETEO_BASE_URL`/`OPENMETEO_API_KEY`):
- v1 = Free-API → gleiche Domain-Auflösung wie bisher, aber geteilt/gecacht.
- Professional oder self-hosted OM → erst damit werden **native** Vollflächen-
  felder budgettauglich (Free Tier: ein natives AROME-AT-Feld ≈ 66.000
  gewichtete Locations = 6,7× das Tagesbudget, live gemessen).

Offen: Standalone-Deployment (derzeit Vite-Dev-Middleware), und der eigentliche
Nativ-Sprung via `bounding_box` sobald ein zahlender/eigener Upstream steht.
`bounding_box` ist live verifiziert (echtes natives Gitter, kein `run=` nötig),
aber pro nativer Zelle gewichtet — daher nur mit höherem Budget sinnvoll.

---

## 6. Datenbeschaffung

- **Reguläres lat/lon-Gitter über die normale Forecast-API** mit Multi-Location.
  **Nicht** über `bounding_box` der Single-Runs-API — jene liefert native,
  unregelmäßige Modellgitterzellen, verlangt ein fixiertes `run=` und
  funktioniert nicht mit Seamless-Modellen.
- Volle Zeitreihe pro Gitterpunkt einmal holen und cachen, nicht pro Zeitschritt.

### Verifizierte API-Eigenheiten
- **Key-Suffixing:** Multi-Modell-Antworten hängen die Modell-ID an den
  Variablennamen an — `temperature_2m_icon_seamless`.
- **Zeitraster:** 168 Stunden ab heute 00:00 UTC.
- **HTTP 200 bei ungültigen Parametern.** Die API antwortet teils mit Status 200
  und leeren Arrays statt mit einem Fehler. Neue Modelle und Variablen daher
  immer live verifizieren, nie aus der Doku übernehmen.

---

## 7. Modell-Registry

Zentrale Datei `src/config/models.ts`:

```ts
interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  resolutionKm: number;
  updateIntervalHours: number;
  forecastHours: number;
  coverage: BBox | 'global';
  supportsBoundingBox: boolean;
  availableVariables: string[];
}
```

**Verfügbarkeit wird abgeleitet, nicht gepflegt:** Ein Modell ist für eine Domain
wählbar, wenn `coverage` die Domain-BBox vollständig enthält. Globale Modelle
sind immer wählbar. Damit verschwinden Lokalmodelle automatisch aus der
Europa-Auswahl, ohne zwei Listen synchron zu halten.

Zusätzlich pro Domain eine Liste empfohlener Defaults:

- **Europa:** ECMWF IFS, GFS, ICON global. Auswahlkriterium ist Unabhängigkeit
  der Rechenzentren, nicht Auflösung — bei ~150 km Zellgröße ist die native
  Modellauflösung ohnehin irrelevant.
- **Österreich:** GeoSphere Austria AROME (lokale Referenz), ICON-D2 (zweite
  hochaufgelöste Meinung), ICON-EU (Brücke in die Mittelfrist), ECMWF
  (synoptischer Hintergrund).

Parameter-Dropdown wird auf die Schnittmenge der gewählten Modelle gefiltert.
Coverage-Warnung im Dropdown, wenn der Standort außerhalb der Abdeckung liegt.

---

## 8. Vorhersagehorizont

Die Horizonte unterscheiden sich stark: AROME-AT ~60 h, ICON-D2 ~48 h,
ICON-EU ~120 h, ICON global 180 h, ECMWF IFS 360 h, GFS/best_match 384 h.
Das Zeitraster läuft über **16 Tage** — das API-Maximum (`forecast_days=16`),
also so weit wie das längste verfügbare Modell. Kürzere Modelle enden früher.

`forecastHours` zählt ab der **Init-Zeit des Laufs**, nicht ab Rasterbeginn:
`modelHorizonEnd()` rechnet deshalb vom geschätzten Lauf (§7 / `config/runs.ts`)
aus und deckelt auf das Rasterende. Alle Werte sind live gemessen, nicht aus
der Doku übernommen.

- **Karte:** Liegt die Panel-Zeit hinter dem Horizont, klare Meldung im Panel
  („Modell endet bei +60 h"). Kein eingefrorenes Feld, keine Extrapolation.
  Kopfleiste bleibt bedienbar, damit man den Zustand wieder verlassen kann.
- **Meteogramm:** Serie endet am Horizont. Legendenwerte dahinter als „—".
- **Scrubber:** Bereich hinter dem Horizont der gewählten Modelle markieren, bei
  mehreren Modellen den längsten Horizont als Grenze.

Ableitung aus `forecastHours` und der jeweils gültigen Panel-Zeit — global bei
aktivem Sync, lokal sonst.

---

## 9. Panel-Struktur

3×2-Grid. Kopfleiste je Panel: Modus, Modell (Mehrfachauswahl), Parameter,
Sync-Toggle.

### Modus: Karte
Feld zum aktuellen Zeitschritt als Canvas-Overlay auf MapLibre, eingehängt als
image-Source mit den Domain-Eckkoordinaten.

**Mercator-Vorverzerrung:** MapLibre rechnet in Web Mercator, das Gitter ist
regulär in lat/lon. Beim Erzeugen des Rasters wird pro Ziel-Pixel die Latitude
über die inverse Mercator-Projektion bestimmt und erst dann im Gitter gesampelt.
Ohne diesen Schritt ist die Darstellung bei großen Domains merklich verschoben.

Bilineare Interpolation zwischen Gitterpunkten. Fehlende Werte transparent, nicht
als Farbwert.

### Modus: Meteogramm
Zeitreihe an einem Punkt, mehrere Modelle überlagert. Kern des Modellvergleichs.

- **Drag-Zoom ist deaktiviert** (`cursor.drag` komplett aus). Panel-lokaler Zoom
  widerspricht dem Sync-Konzept.
- Klick setzt den Zeitpunkt. Gestrichelte vertikale Linie markiert die
  Cursor-Zeit in allen sync-aktiven Panels.
- Farb-Slots pro Panel sind stabil: Abwählen eines Modells ändert die Farben der
  übrigen nicht.

### Modus: Vertikalprofil *(Phase 3)*
Druckflächen-Variablen (`temperature_1000hPa`, `geopotential_height_500hPa`,
`wind_speed_850hPa` …).

### Modus: Ensemble *(umgesetzt)*
ECMWF-Ensemble am Punkt: Plume aus 51 Mitgliedern, P10–P90-Band, Median,
Kontrolllauf und — als eigener Abruf — der deterministische Hauptlauf.
Eigene 15-Tage-Achse, Mausrad-Zoom, Zeit-Cursor als Markerlinie.

**Punktbasiert, bewusst ohne Kartenvariante.** Live gemessen: ein Punkt kostet
~5 gewichtete Locations (Mitglied ≈ Variable), ein Österreich-Gitter mit 480
Punkten käme auf ~7.200 Calls = 72 % des Tagesbudgets pro Feld und würde das
Minutenlimit sofort reißen. Verfügbar sind `ecmwf_ifs025` und `ecmwf_aifs025`
(je 51 Mitglieder, 15 Tage); `ecmwf_ifs04` liefert nur noch ein Mitglied, die
9-km-Europa-Ensembles der Doku sind über die freie API nicht erreichbar.

---

## 10. Globaler State

```ts
interface WorkbenchState {
  cursorTime: Date;
  domain: DomainPreset;          // 'europa' | 'oesterreich'
  lockedLocation: LatLon | null;
  runInit: Date | null;
  panels: PanelConfig[];         // 6 Einträge, je mit localTime
}
```

Zeit-Scrubber unter dem Grid: Slider, Play/Pause, ±1h/±6h, Tastatur (←/→, Shift,
Leertaste).

**Bekannte Einschränkung:** Das Zeitraster ist session-fixiert. Bleibt der Tab
über Mitternacht UTC offen, passt das Fenster nicht mehr zum aktuellen Lauf.
Bisher nicht behandelt.

---

## 11. Farbskalen

`src/config/colorscales.ts`, pro Parameter definiert.

**Feste Wertebereiche, kein Auto-Scaling.** Sonst sind zwei Panels mit
unterschiedlichen Modellen nicht mehr vergleichbar — das widerspricht dem Zweck
der Workbench.

- Temperatur divergierend um 0 °C
- Niederschlag in abgestuften Klassen, nicht linear
- Wind sequenziell

Kompakte Legende in jedem Kartenpanel.

**Offen:** Die konkreten Wertebereiche und Schwellen sind noch nicht festgelegt.

---

## 12. Design-Richtung

Dunkles UI (Panel-Fläche `#18191b`), hohe Informationsdichte, minimale Chrome.
Referenz sind operationelle Meteorologen-Werkzeuge, nicht Consumer-Apps.

Serienpalette ist auf CVD-Separation und Kontrast ≥ 3:1 gegen die Panel-Fläche
geprüft.

---

## 13. Stand und nächste Schritte

**Umgesetzt:** Phase 1 (Panel-Grid, State, Scrubber, API-Layer, Meteogramme mit
Modellvergleich) und Phase 2 (Karten, zwei Domains, Rate-Limit-Umbau,
Horizontbehandlung).

**Phase 3 — offen**
- ~~Vertikalprofile~~ (umgesetzt)
- ~~Ensemble-Plumes~~ (umgesetzt, §9: ECMWF punktbasiert)
- Layout-Presets: gespeicherte Panel-Konfigurationen für konkrete Wetterlagen
  (Föhn, Konvektion, Winterniederschlag, Sturm) statt manuellem Zusammenklicken
- Modelllauf-Auswahl über die Single-Runs-API
- Kuratiertes Stationsset Österreich (Talstationen, Passlagen, Föhnstationen)
  als feste Punkte für Meteogramme

**Weitere offene Punkte**
- Backend-Proxy mit serverseitigem Cache (§5)
- Farbskalen-Wertebereiche festlegen (§11)
- **Attribution:** Die Daten stehen unter CC BY 4.0, Namensnennung ist
  Lizenzbedingung. Noch nicht in der UI umgesetzt.
- Verhalten des session-fixierten Zeitrasters über Mitternacht UTC (§10)
- Isolinien-Rendering statt reiner Rasterfelder
- Persistierung der Layouts: localStorage oder JSON-Export
