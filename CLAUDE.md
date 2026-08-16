# Meteo Workbench

Operationelle Wetter-Workbench (6-Panel-Modellvergleich) auf Basis der
Open-Meteo API. Vollständige Anforderungen: **SPEC.md** — vor größeren
Änderungen lesen; offene Punkte werden dort in §13 gepflegt, nicht hier
doppelt. Stand: Phase 1+2 umgesetzt, Phase 3 (Vertikalprofile, Ensembles,
Layout-Presets, Modelllauf-Auswahl) offen.

Leitidee (SPEC §4): **Karte ist Übersichtsebene, Meteogramm ist das
Präzisionswerkzeug.** Das 1000-Punkte-Limit deckelt Kartenfelder auf ~19 km
Zellgröße, obwohl die Lokalmodelle 2,5 km können — bewusst akzeptiert, die
volle Auflösung gibt es punktgenau im Meteogramm. Höher aufgelöste Felder
kämen nur über Backend-Proxy/Self-Hosting (SPEC §5), nicht über größere Gitter.

## Befehle

Node ist lokal installiert unter `~/.local/node` (nicht im Standard-PATH):

```bash
export PATH="$HOME/.local/node/bin:$PATH"

npm run dev       # Vite-Dev-Server (Port 5173)
npm run build     # tsc -b && vite build — auch der Typecheck
npm run lint      # oxlint
npm run preview   # gebautes dist/ servieren
```

`npm run build` ist die Haupt-Verifikation. Für reine Rechenkerne der
Österreich-Klimakarte gibt es Vitest-Tests (`npm test`, `src/**/*.test.ts`).

## Architektur

- `src/config/` — statische Registries: `models.ts` (Modell-Metadaten inkl.
  `forecastHours`/`coverage`, filtert UI-Dropdowns; `modelHorizonEnd()` für
  Horizont-Logik), `variables.ts` (stündliche Variablen), `domains.ts`
  (genau zwei Domains: Europa 25×25, Österreich 16×30 — Gitterdims pro Domain,
  Lat×Lon getrennt für ~quadratische Zellen, plus `recommendedModels`),
  `colors.ts` (Serienfarben), `colorscales.ts` (Karten-Farbskalen mit festen
  Wertebereichen), `time.ts` (gemeinsames Zeitraster).
- `src/state/workbench.ts` — Zustand-Store: globaler Zeit-Cursor, Domain,
  Location-Lock, Panel-Konfigurationen.
- `src/api/openmeteo.ts` — Fetch-Layer: Request-Batching für Punktserien
  (Meteogramme, Anfragen desselben Ticks → ein HTTP-Request pro Punkt, weiter
  DIREKT an Open-Meteo — billige Punktabfragen). **Kartengitter laufen dagegen
  über den serverseitigen Grid-Proxy** (`/api/grid`, siehe `server/` unten):
  `runGridBatch` bündelt die Variablen eines Ticks und holt sie vom Proxy statt
  direkt von Open-Meteo; der Proxy meldet den realen OM-Verbrauch zurück (0 bei
  serverseitigem Cache-Treffer), der Client zählt ihn in `apiUsage`. Nur der
  **Mock-Pfad** (`runGridBatchMock`) fetcht Gitter noch clientseitig
  OM-geformt (deterministische Felder, kein Netz). `src/api/queue.ts`
  (`RateAwareQueue`, Token-Bucket) pacet jetzt SERVERSEITIG im Proxy — der
  Client nutzt sie fürs Gitter nicht mehr. `src/api/gridcache.ts` —
  persistenter IndexedDB-Cache für Felder als zusätzliche Client-Ebene
  (Invalidierung über Modelllauf-Bucket aus `latestRun`, siehe `config/runs.ts`).
  `src/api/queries.ts` — TanStack-Query-Hooks darüber.
- `server/` — **Grid-Proxy (SPEC §5)**: zentralisiert die Open-Meteo-Gitter-
  Beschaffung, holt jeden Modelllauf EINMAL und cached ihn für ALLE Clients —
  entkoppelt Nutzungsfrequenz vom API-Verbrauch. `gridSource.ts` (Multi-Location
  + 250er-Chunks + 10er-Variablenbündel + `RateAwareQueue`-Pacing + 429-Backoff,
  wandert aus dem Browser hierher), `fieldCache.ts` (Memory + Disk-Cache pro Lauf,
  Dedup gleichzeitiger Fetches), `gridHandler.ts` (HTTP, framework-neutral),
  `upstream.ts` (**swap-bereit**: Env `OPENMETEO_BASE_URL`/`OPENMETEO_API_KEY`
  schalten auf self-hosted OM bzw. Professional — erst damit werden native
  Vollflächenfelder budgettauglich), `plugin.ts` (Vite-Dev-Middleware, lädt den
  Handler per `ssrLoadModule`). v1-Upstream = Free-API, holt dasselbe
  Domain-Gitter wie bisher (kein Nativ — dafür Upstream wechseln).
  Typecheck: `tsconfig.server.json` (Node-Types, Bundler-Resolution).
- **Österreich-Klimakarte** (`AT-KLIMAKARTE-PLAN.md`) — eigener Bereich neben der
  Workbench, umgeschaltet über `state/appView.ts` (`AppNav`). Statisch-direkt:
  kein Backend, GeoSphere Austria ist **CORS-offen + keyless**, der Browser fragt
  direkt. Stammdaten/Normale/Rekorde sind vorgenerierte Assets unter `public/at/`
  (`scripts/at-ingest-*.mjs`, npm `ingest:at*`); tages-/monatsaktuelle Werte holt
  `api/geosphere.ts`/`api/atValues.ts` in EINEM Bulk-Request über alle Stationen
  (IndexedDB-Cache `api/atcache.ts`, historisch = für immer). **Der laufende Tag
  kommt NICHT aus `klima-v2-1d`** (das aggregiert erst nach Tagesende und liefert
  für heute durchgehend null), sondern aus `klima-v2-10min`: `fetchLiveDayValues()`
  fasst die 10-Minuten-Werte des Tages zusammen (`liveCode`/`liveAgg`/`liveFactor`
  je Parameter in `config/atParameters.ts`), TTL-Cache 5 min, `PeriodValues.source`
  = `'live'` → UI markiert den Wert als vorläufig samt Messzeitpunkt. Nur Stationen
  mit `has10min` dürfen in den Request — eine unbekannte ID lässt den GANZEN
  Bulk-Request mit HTTP 400 scheitern. Karte ist ein
  leichtes **Canvas** (`render/atmap.ts`, feste equirect-Projektion — NICHT
  MapLibre), Werte stehen direkt beschriftet in der Karte (keine Colorbar, so
  gewünscht). Registry `config/atParameters.ts` (Tag→`klima-v2-1d`,
  Monat/Jahr→`klima-v2-1m`; Anomalien vs. Normal 1991–2020). „Aktuell"-Knopf
  springt auf den neuesten Stand (Tag = heute; Monat/Jahr = letzte
  ABGESCHLOSSENE Periode) und holt den laufenden Tag mit `force` am TTL-Cache
  vorbei. **Rangliste** (`AtRankList` + Rechenkern `atRank.ts`) reiht die
  geladenen Kartenwerte (auch Anomalien) — rein clientseitig, kein zusätzlicher
  Request; Hover markiert die Station in der Karte (`highlightIdx`), Klick
  öffnet ihr Detail. Rangliste und Stationsdetail haben beide **zwei Größen**
  (Schnellansicht in der Ecke ↔ maximiert über den Kartenbereich, CSS-Modifier
  `.is-max`): maximiert zeigt die Rangliste eine sortierbare Volltabelle
  (Rang bleibt IMMER global — Suche/Sortierung ändern nur die Anzeige) und das
  Detail alle Rekordebenen als Tabelle mit Datum. **Rekordtage** (`api/
  atRecords.ts`): die Assets kennen nur Monat/Jahr, aber bei `tlmax`/`tlmin`
  IST der Monatswert ein Tagesextrem („Monats-Maximum aus 24-h-Maxima") — ein
  Tagesabruf über den Rekordzeitraum liefert den exakten Tag (für immer
  gecacht). Bei Mittel-/Summenparametern gibt es bewusst KEINE Auflösung, dort
  existiert kein Rekordtag; `DAY_RESOLVABLE` ist die Whitelist. Absolute
  Rekorde lösen sich beim Öffnen auf, die übrigen 32 Zeilen erst auf Klick.
  Parameter-Klartext steht als `description` in der Registry. Reine Rechenkerne
  sind mit Vitest getestet (`*.test.ts`, `npm test`).
  **Klimaperioden** (`config/atNormals.ts`, `AT_NORMAL_PERIODS`): vierter
  Zeitbezug neben Tag/Monat/Jahr — das langjährige Mittel einer WMO-Normalperiode
  (1991–2020, 1961–1990), wahlweise Jahresmittel oder ein Kalendermonat (z. B.
  „durchschnittlicher Jahresniederschlag 1961–1990"). Die Werte stehen in den
  vorberechneten Assets `public/at/normals-<periode>.json`
  (`scripts/at-ingest-normals.mjs <periode>`), dieser Zeitbezug kostet also KEINEN
  Request. Im Abweichungsmodus vergleicht er die beiden Perioden MITEINANDER
  (`comparePeriod`, Bezug = nächstältere Periode) statt Wetter gegen Normal.
  **Deckungsregel**: ein Normal entsteht nur aus ≥ 24 der 30 Jahre und ein Jahr
  zählt nur mit allen 12 Monaten — deshalb hat lange nicht jede Station eines
  (1991–2020: 300, 1961–1990: 280 Stationen), und die alte Datei `normals.json`
  mit 806 Stationen ist bewusst weg: die zusätzlichen Werte stammten aus
  Teilreihen. Für ältere Perioden zeigt erst der Haken „Historische" das volle
  Netz.
- **MOS-Vorhersage** (DACH) — zweiter Modus des Österreich-Bereichs (`AtSection`
  schaltet Klima↔Vorhersage). Quelle: **DWD MOSMIX** (echtes MOS), 3060 Stationen
  im DACH-Raum (`public/mos/stations.json`, aus dem DWD-Katalog; Koordinaten sind
  Grad+Dezimalminuten → umgerechnet). DWD hat **kein CORS** → die Daten werden
  NICHT im Browser geholt, sondern per **Ingest im Deploy-Workflow** (`scripts/
  mos-ingest-forecast.mjs`, KMZ→KML-Parser `scripts/lib/mosmix.mjs`, kein externes
  Paket) zu kompakten Pro-Parameter-JSONs (`public/mos/forecast/*.json`, **gitignored**,
  im Build erzeugt) verarbeitet; der Browser lädt sie same-origin (`api/mosApi.ts`).
  `deploy.yml` läuft dafür zusätzlich alle 3 h (Cron). T2m/Niederschlag/Sonne/
  Bewölkung/Wind stündlich (+72 h, Zeitschieber), Tmin/Tmax täglich. Karte:
  `AtClimateMap` mit `DACH_VIEW` + `europe.basemap` + Label-Ausdünnung. Registry
  `config/atForecast.ts`. Klick auf eine Station → `AtForecastDetail`:
  Punktvorhersage mit allen Parametern als uPlot-Stapel (T2m, Niederschlag als
  Balken, Bewölkung/Sonne in %, Wind) plus Tmin/Tmax-Karten; der Kartenschieber
  setzt dort eine Marker-Linie. Kostet nichts extra — beim ersten Klick werden
  die übrigen Parameter-JSONs einmal nachgeladen (`loadForecast` cached
  modulweit). Die Reihen werden über ihre TERMINE ausgerichtet
  (`alignSeries`), nicht über den Index. Klimadaten bleiben davon unberührt
  (Österreich/TAWES).
- **Ensemble-Modus** (`EnsemblePanel`, `config/ensemble.ts`, Kern `render/plume.ts`,
  Parsing `api/ensembleParse.ts`) — vierter Panel-Modus, **punktbasiert**.
  Eigener Endpunkt (`ensemble-api.open-meteo.com`), aber derselbe `apiGet`-Pfad
  (mock-fähig, im Verbrauchszähler sichtbar). Nur ECMWF: `ecmwf_ifs025` und
  `ecmwf_aifs025`, je 51 Mitglieder, 15 Tage. Die suffixlose Reihe der Antwort
  ist der **Kontrolllauf**, NICHT der Hauptlauf — der kommt als eigener
  deterministischer Abruf dazu (1 Call). Eigene Modell- UND Variablenregistry
  (u.a. 850 hPa / 500 hPa), eigene Zeitachse über den vollen Horizont, Zoom per
  Mausrad. **Keine Kartenvariante**: ein Punkt kostet ~5 gewichtete Locations,
  ein AT-Gitter käme auf ~7.200 Calls pro Feld (Rechnung in `config/ensemble.ts`).
- `src/state/presets.ts` — speicherbare Panel-Presets (localStorage unter
  `meteo-workbench:presets`, getrennt vom IDB-Cache; Export/Import als JSON).
  Mechanismus für die Wetterlagen-Presets aus SPEC §13: `BUILTIN_PRESETS`
  dort befüllen (`builtin: true` = nicht löschbar), `schemaVersion` für
  Migrationen. Zeiten werden bewusst NICHT gespeichert. Beim Laden wird
  panel-weise validiert: Fehlendes wird nie still ersetzt, sondern als
  `presetWarning` im Panel angezeigt; ein ungültiges Panel bricht das Laden
  nicht ab. UI: `PresetBar` in der TopBar (Speichern mit Standort-Haken,
  Überschreiben/Umbenennen/Löschen mit Rückfrage, „geändert“-Markierung).
- `src/state/apiUsage.ts` — Session-Zähler für verbrauchte API-Locations
  (getrennt nach Gitter/Meteogramm, Reset für Einzelmessungen), zentral in
  `apiGet()` gepflegt; Cache-Treffer und Mock zählen nicht. Anzeige + Tooltip
  in der TopBar.
- **Mock-Modus** (`src/api/mock.ts`): Entwicklung ohne API-Verbrauch.
  `?mock=1` (bzw. `?mock=ratelimit`, `?mock=empty` für Fehlerpfade) oder
  `VITE_MOCK=1`; im Produktions-Build ohne `VITE_MOCK` hart aus. Eingehängt
  in `apiGet()` im API-Layer — Antworten haben exakt die echte API-Form
  (inkl. Key-Suffixing), der reale Parsing-Pfad läuft mit. Felder sind
  seed-deterministisch, zeitlich stetig, pro Modell unterscheidbar und
  respektieren `forecastHours`; mehrskaliges fBm-Rauschen liefert echte
  Feinstruktur statt Weichzeichnung. `?mockres=N` übersteuert die
  Gitterauflösung (N = Punkte der längeren km-Achse, Seitenverhältnis bleibt,
  Obergrenze 256 mit Warnung) — nur im Mock, Default bleibt Realauflösung.
  Mock umgeht den IndexedDB-Cache in beide Richtungen (nie mit echten Daten
  verwechselbar) und zeigt ein Badge in der TopBar inkl. aktiver Auflösung.
  Für Debug-Läufe im Headless-Browser immer `?mock=1` verwenden.
- `src/render/fieldImage.ts` — Gitterfeld → ImageData: Mercator-Vorverzerrung
  (Zeile → Latitude via inverser Projektion), bilineare Interpolation,
  Farbskalen-LUT; NaN → transparent.
- `src/components/` — `Panel`/`PanelHeader` (Grid-Zelle mit Modus/Modell/
  Parameter/Sync), `Meteogram` (uPlot), `MapPanel` (MapLibre, per React.lazy
  code-gesplittet), `TimeScrubber`, `TopBar`/`LocationPicker`.
- **Basemap ist komplett lokal** — bewusst KEIN externer Tile-Dienst (kein
  API-Key, kein Fremd-Rate-Limit; MapLibres `load`-Event hinge sonst an
  fremden Tile-Requests, an denen das ganze Panel gegated ist).
  Layer bottom→top: Hintergrund → Feld → Gradnetz → Bundeslandgrenzen
  (admin1, nur Österreich-Domain) → Küsten → Staatsgrenzen → Städte/Labels
  (DOM, immer zuoberst). **Grenzen sind Casing-Paare** (breite dunkle Linie +
  schmaler heller Kern) — eine einzelne Linienfarbe ist gegen divergierende
  Farbskalen nie überall lesbar. Hierarchie über Strichart, nicht Helligkeit:
  Staatsgrenzen/Küsten durchgezogen, Bundesländer gestrichelt. Achtung:
  `line-dasharray` skaliert mit `line-width` — Casing und Kern brauchen
  unterschiedliche Werte für deckungsgleiche Strichelung. Daten: Natural
  Earth (Küsten/Grenzen 1:50m, admin1 1:10m eng zugeschnitten), gebündelt in
  `src/mapdata/*.basemap.json`; Regeneration mit
  `node scripts/build-basemap.mjs`. Städte kuratiert in `src/config/cities.ts`
  (`domains` + `priority`; kleine Panels dünnen Labels aus, Punkte bleiben).
  Stadt-Labels sind DOM-Marker mit Text-Halo — MapLibre-Symbol-Layer würden
  eine externe Glyphs-Quelle brauchen.

## Konventionen

- **Sync-Semantik**: Der SYNC-Button eines Panels koppelt Zeit-Cursor,
  Kartenzoom (`sharedView`) und Modellauswahl (`sharedModels`/`sharedMapModel`).
  Sync-aktive Panels LESEN die gemeinsamen Werte über `useEffectivePanel()` —
  Komponenten dürfen nicht direkt `panels[i]` rendern. Beim Aussteigen wird
  der gemeinsame Stand in die lokale Config eingefroren. Kamera-Sync läuft
  über `sharedView` mit `applyingViewRef`-Guard gegen Echo-Schleifen.
- **parsync** (Parameter-Sync) ist davon getrennt und hat **Radio-Semantik**:
  `parSyncSource: number | null` im Store, KEIN Boolean pro Panel. Das
  Quellpanel spiegelt seinen Parameter live per Push in die übrigen Configs
  (`mirrorVariable`); beim Abschalten bleiben die Werte stehen. Andere
  parsync-Buttons und die Parameter-Dropdowns der Folge-Panels sind währenddessen
  sichtbar deaktiviert; Modell/Modus/SYNC bleiben frei. Ist der Parameter in
  einem Panel nicht verfügbar, zeigt es eine Meldung — NIE automatisch die
  Modellauswahl ändern. Verfügbarkeit gatet auch die Fetches (Meteogramm pro
  Modell, Karte ganz), damit gespiegelte Parameter kein Budget für Modelle
  verbrennen, die sie gar nicht liefern.
- **Zeit:** intern immer Epoch-Millisekunden in UTC, Schrittweite 1 h. Das
  Zeitraster (`TIME_RANGE`, `timeGridMs()` in `config/time.ts`) wird beim Laden
  fixiert und von Scrubber, Meteogrammen und API-Requests geteilt. uPlot
  arbeitet in Sekunden — Umrechnung nur an der uPlot-Grenze.
  **`FORECAST_DAYS` = 16** (API-Maximum, so weit wie das längste Modell);
  Karten holen weiter nur `MAP_FORECAST_DAYS` = 3, Vertikalprofile
  `PROFILE_FORECAST_DAYS` = 7 (100 Level-Variablen × 16 Tage wären sinnlos
  groß). Panels, deren Daten früher enden, zeigen eine Meldung — nie
  stillschweigend den letzten verfügbaren Zeitschritt.
- **API-Sparsamkeit ist Architektur** (SPEC §1/§6): neue Datenpfade gehen durch
  den Batcher in `openmeteo.ts` und durch TanStack Query mit langer `staleTime`
  (30 min) — kein direktes `fetch` in Komponenten.
- **Serienfarben** (`config/colors.ts`): feste Slot-Reihenfolge, validiert für
  CVD-Sicherheit und Kontrast auf `#18191b` — nicht umsortieren, nicht ad hoc
  neue Farben erfinden. Slots werden pro Panel beim Hinzufügen vergeben und
  bleiben beim Abwählen anderer Modelle stabil (Farbe folgt dem Modell, nicht
  dem Rang). Max. 8 Modelle pro Panel.
- **Neue Modelle/Variablen IMMER live gegen die API verifizieren, nie nur aus
  der Doku übernehmen** (SPEC §6): Open-Meteo antwortet teils mit HTTP 200 und
  leeren Arrays statt mit einem Fehler. Bereits live verifiziert:
  `geosphere_arome_austria` (ID, alle Variablen, 60 h/3 h) und `icon_eu`
  (120 h Horizont — nicht die ~78 h, die teils kursieren).
- **Tarif-Entscheidung** (SPEC §5): Free Tier bleibt. API Standard wäre ein
  Rückschritt — Ensemble-, Historical- und Single-Runs-API fehlen dort, Phase 3
  braucht genau diese. Falls je Upgrade, dann Professional.
- **Modellverfügbarkeit pro Domain wird abgeleitet, nicht gepflegt**:
  wählbar, wenn `coverage` die Domain-BBox vollständig enthält
  (`isDomainInCoverage`); globale Modelle immer. `recommendedModels` der
  Domain ist nur Dropdown-Priorisierung, keine Verfügbarkeitsliste.
- **Vorhersagehorizont**: `forecastHours` zählt **ab der Init-Zeit des Laufs**,
  nicht ab Rasterbeginn — `modelHorizonEnd(model, now)` rechnet deshalb vom
  geschätzten Lauf (`config/runs.ts`) aus und deckelt auf `TIME_RANGE.end`.
  Vorher war der Bezug der Rasterbeginn, was aus einem 12-UTC-Lauf 13 Stunden
  vorhandener Vorhersage weggeschnitten hat. Die Werte sind live gemessen
  (best_match 384 h, ECMWF 360 h — die alten 168/240 waren deutlich zu klein),
  ebenso die Laufverzögerungen (UKMO global braucht ~13 h, nicht 7).
  Geprüft wird gegen die gültige Panel-Zeit (global bei Sync an, lokal bei
  Sync aus). Jenseits davon: keine Extrapolation — Karte zeigt Meldung statt
  Feld, Meteogramm-Serien enden (Maskierung + Endlinien im Chart, Legende „—"),
  Scrubber schraffiert den Bereich hinter dem längsten aktiven Horizont.
- **UI-Sprache ist Deutsch**, Code/Bezeichner Englisch. Dunkles Theme,
  Design-Tokens als CSS-Variablen in `src/index.css`.
- TypeScript strict; `verbatimModuleSyntax` verlangt `import type` für reine
  Typ-Importe; `erasableSyntaxOnly` verbietet Enums.

## Stolperfallen

- Multi-Modell-Antworten von Open-Meteo suffixen die Hourly-Keys mit dem
  Modellnamen (`temperature_2m_icon_seamless`), Ein-Modell-Antworten nicht —
  das Parsing in `runBatch()` hängt daran.
- Kartengitter laufen über **Multi-Location an der normalen Forecast-API**
  (kommaseparierte Koordinatenlisten, Antwort = Array in Request-Reihenfolge) —
  serverseitig im Grid-Proxy (`server/gridSource.ts`).
  Max. 250 Punkte pro GET, sonst wird die URL zu lang (~15 KB bei 961 Punkten).
- **`bounding_box` (natives Gitter) — live geprüft, bewusst NICHT genutzt:**
  liefert echtes natives Modellgitter (AROME/ICON-D2 ~2 km, ICON-EU 7 km),
  braucht KEIN `run=` (die SPEC-Annahme war veraltet), aber wird PRO NATIVER
  ZELLE gewichtet: ein Vollflächenfeld kostet 3–47× das Tagesbudget in EINEM
  Request (AROME-Österreich ~66.000 Zellen), und nicht jedes Modell kann es
  (`gfs_global` → „Bounding box calls not supported"). Deshalb client-seitig
  auf dem Free Tier tot — nativ wird erst mit Professional-/self-hosted-Upstream
  im Proxy budgettauglich (siehe `server/upstream.ts`). Nur kleine Zoom-
  Ausschnitte wären affordabel.
- **Genau zwei Domains ist eine bewusste Entscheidung** (SPEC §3): jede
  weitere multipliziert die Cache-Kombinatorik und verhindert, dass der Cache
  je warm wird. Keine Domains ergänzen, ohne dass die SPEC das hergibt.
- **Zeitraster ist session-fixiert** (Start = heute 00:00 UTC beim Laden).
  Bleibt der Tab über Mitternacht UTC offen, passt das Fenster nicht mehr zum
  aktuellen Lauf — bekannte, bisher unbehandelte Einschränkung (SPEC §10).
- **Rate-Limit**: Open-Meteo gewichtet nach Locations, Variablen (in
  Bruchteilen, Größenordnung „~10 Variablen ≈ 1 Call“), Modellen und
  Zeitraum (600/min, 5.000/h, 10.000/Tag) — ein Gitter zählt ~ Punktzahl,
  NICHT als 1 Call. Deshalb: Gitterdims pro Domain klein halten,
  `MAP_FORECAST_DAYS` = 3 (Meteogramme bleiben bei 7); Pacing + Chunking +
  Bündelung passieren jetzt SERVERSEITIG im Grid-Proxy (`server/gridSource.ts`,
  `RateAwareQueue`: Token-Bucket 500/min mit Marge unter 600, Concurrency-Cap 2
  — ein volles Gitter allein reißt sonst das Minutenlimit, weil
  Location-Gewicht ≈ Punktzahl), 429-Backoff serverseitig, Grid-Query
  `retry: false` (Backoff macht der Proxy), plus serverseitiger Feld-Cache
  (`fieldCache.ts`) UND Client-IDB-Cache gegen Reload-Kosten. **Gitter-Requests
  werden gebündelt** (`runGridBatch` → Proxy): alle im selben Tick angeforderten
  Variablen desselben (Domain, Modell)-Paars gehen als EIN
  Multi-Variablen-Request (≤ 10 Vars) raus — NICHT zurück auf
  Einzelvariablen-Requests refactorn, das war der große Budget-Hebel für die
  Synoptik-Presets. Cache-Treffer je Variable verkleinern das Bündel vorab.
  Der TopBar-Zähler zeigt den geschätzten Session-Verbrauch
  (`estimateWeight`); Gittergröße nie erhöhen, ohne das Budget zu rechnen.
- **Farbskalen haben feste Wertebereiche** (kein Auto-Scaling!) — sonst sind
  Panels mit unterschiedlichen Modellen nicht vergleichbar. Neue Karten-
  Variablen brauchen einen Eintrag in `colorscales.ts`, sonst tauchen sie im
  Karten-Dropdown nicht auf (Windrichtung ist bewusst ausgenommen). In der
  AT-Klimakarte hängt die Skala zusätzlich am ZEITBEZUG (`scaleFor` in
  `config/atParameters.ts`): Summenparameter wachsen von mm/Tag auf mm/Jahr um
  Größenordnungen, mit einer Skala läge jede Jahreskarte im obersten Band —
  ebenfalls feste Bereiche, nur je Zeitbezug einer. Analog `anomalyScaleFor`: der
  Vergleich zweier Klimaperioden (~1 K, wenige %) braucht eine feinere Stufung
  als eine Wetteranomalie (±12 K). Die
  konkreten Bereiche/Schwellen sind laut SPEC §11 noch nicht final festgelegt —
  die Werte in `colorscales.ts` sind ein Arbeitsstand.
- Die MapLibre-image-Source spannt Bilder linear im **Web-Mercator**-Raum auf;
  `fieldImage.ts` verzerrt das lat/lon-Gitter deshalb beim Rendern vor. Nicht
  „vereinfachen“, sonst verschiebt sich die Darstellung bei großen Domains.
- Domain teilweise außerhalb der Modellabdeckung → der Multi-Location-Request
  schlägt komplett fehl; deshalb gattet `isDomainInCoverage` den Fetch und das
  Panel zeigt einen Hinweis. Coverage-BBoxen in der Registry sind Näherungen.
- **CSS-Spezifität gegen MapLibre**: `maplibre-gl.css` wird mit dem lazy
  geladenen MapPanel NACH `index.css` injiziert; MapLibre stempelt dem
  Container `.maplibregl-map { position: relative }` auf. Eigene Regeln auf
  dem Kartencontainer brauchen deshalb ≥ 2 Klassen Spezifität
  (`.map-panel .map-container`), sonst kollabiert der Container auf Höhe 0 —
  das war die Ursache der „schwarzen Karten“.
- **Debug-Läufe im Headless-Browser**: SwiftShader-Flags setzen
  (`--enable-unsafe-swiftshader`) und `webgl2` prüfen, sonst reproduziert man
  ein schwarzes Canvas, das nichts mit dem Bug zu tun hat. Persistentes
  `userDataDir` verwenden (IDB-Cache!) oder Open-Meteo per Request-
  Interception mocken — Iterationsschleifen mit kaltem Cache reißen sonst
  das Stunden-Rate-Limit. `[field]`-/`[grid]`-Console-Logs sagen, ob Daten
  und gemalte Pixel da sind; ein Screenshot allein sagt nur „schwarz“.
