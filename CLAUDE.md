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

## Bereichsdokumentation

**Vor Arbeit an einem Bereich die zugehörige Datei in `docs/` lesen.** Neue
Befunde, Messungen und Entscheidungen zu einem Bereich gehören DORT hinein,
nicht in diese Datei — hier steht nur, was bereichsübergreifend gilt. Die
Texte sind wörtlich aus dieser Datei ausgelagert; wo dort „oben"/„unten" auf
einen anderen Abschnitt verweist, kann er in einer anderen Datei stehen.

| Datei | Inhalt |
|---|---|
| [`docs/klima-oesterreich.md`](docs/klima-oesterreich.md) | **Österreich-Klimakarte** — Klimakarte AT, Klimaarchiv-Fragebox, Rekorde, HISTALP, Jetzt-Werte, CARTO-Untergrund |
| [`docs/tawes.md`](docs/tawes.md) | **TAWES** — Messnetz AT im 10-Minuten-Takt |
| [`docs/klima-deutschland.md`](docs/klima-deutschland.md) | **Klimamonitor Deutschland** — DWD-Klimadaten, Rekorde, Gebietsmittel |
| [`docs/mos.md`](docs/mos.md) | **MOS-Vorhersage** — DWD MOSMIX, DACH-Stationen |
| [`docs/ensemble.md`](docs/ensemble.md) | **Ensemble** — Plume, Quantil-Säulen, Wahrscheinlichkeitsleiste |
| [`docs/foehn.md`](docs/foehn.md) | **Föhn** — Föhndiagnose, Querschnitt ICON-D2 |
| [`docs/meteogramm.md`](docs/meteogramm.md) | **Klassisches Meteogramm** — Meteogramm, ChartStack/chartDef-Bausteine, Schneevorhersage |
| [`docs/soundings.md`](docs/soundings.md) | **Soundings / Skew-T** — Ortswahl-Karte, Drucklevel, Skew-T, θe, DCAPE, Radiosonden |
| [`docs/radar.md`](docs/radar.md) | **Niederschlagsradar** — DWD-WMS, Blitze, MTG-Blitze, RADOLAN, DMax/VIL, 3D-Radar |
| [`docs/satellit.md`](docs/satellit.md) | **Satellitenbilder** — EUMETView, Vorrat/Kacheln in R2, MTG HD |
| [`docs/thailand.md`](docs/thailand.md) | **Thailand-Tropendienst** — Himawari über GIBS, IFS Asien |
| [`docs/luftqualitaet.md`](docs/luftqualitaet.md) | **Luftqualität** — CAMS, EEA-Messwerte, Ampel |
| [`docs/modellkarten.md`](docs/modellkarten.md) | **Modellkarten** — Globus/Panels, Ingests ECMWF/ICON/AROME, Kacheln, Isolinien, Partikel, Polkappe, Alpen 3D |
| [`docs/varda.md`](docs/varda.md) | **Varda (KI, 1 km)** — Varda-Ingest auf der Laptop-GPU, Timer, Weckfunktion |
| [`docs/verifikation.md`](docs/verifikation.md) | **Verifikation** — Vorhersage gegen GeoSphere-Messung |
| [`docs/recht.md`](docs/recht.md) | **Impressum, Datenschutz, Login** — Impressum/Datenschutz, Build-Variablen, Sammellogin |
| [`docs/oberflaeche.md`](docs/oberflaeche.md) | **Oberfläche und Navigation** — Punktprognosen ausgeblendet, Startseite, Bereiche/Navigation |

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

- **Hosting: Cloudflare-Worker `meteojunkie`** (seit 2026-10-28, vorher GitHub
  Pages — das deckelt bei 1 GB, die Seite lag bei ~980 MB; wo unten noch
  „Pages" steht, ist der alte Stand gemeint). `worker/index.ts` +
  `wrangler.jsonc`: die App kommt als statische Dateien aus `dist/`, die im
  Deploy erzeugten Daten (`nwp/`, `de/`, `mos/forecast/`, `sondes/`) aus dem
  R2-Bucket `meteojunkie-daten` — unter DENSELBEN Pfaden, das Frontend kennt
  keinen zweiten Host. Hochgeladen wird per `scripts/upload-data.sh` (rclone
  `--checksum`: nur Geändertes, R2-Schreibvorgänge sind das knappe
  Freikontingent mit 1 Mio./Monat; `meta.json` erst nach den Bildern, auf die
  sie verweist; synchronisiert wird nur, was im Lauf GÜLTIG erzeugt wurde —
  sonst räumte ein halbfertiger Ingest den letzten Stand weg). Laufdateien
  der Modellkarten sind `immutable`, `meta.json` 60 s, Rest 5 min.
  **Abrufprotokolle des Workers sind AUS** (`observability`) — die
  Datenschutzerklärung sagt „kein Zugriff auf Protokolldaten". `www`
  leitet per Redirect Rule auf die Hauptdomain. Mail der Domain läuft weiter
  über United Domains (MX/SPF im Cloudflare-DNS). Kosten: Workers Paid 5 $
  im Monat (für die Rechenzeit der geplanten Radar-Komposite), alles andere
  im Freikontingent. Lokal bleibt `npm run dev` mit Daten aus `public/`.
  **Cron alle 5 Minuten** (`scheduled` in `worker/index.ts`,
  `triggers.crons` in `wrangler.jsonc`): eigene Radarbilder
  (`worker/radar.ts`, jedes Mal), MTG-Einzelblitze (`worker/flashes.ts`, jedes Mal) und Satelliten-Vorrat
  (`worker/satellite.ts`, jedes zweite Mal) — beschrieben bei Radar bzw.
  Satellit. Lokal testen: `wrangler dev --test-scheduled`, dann
  `curl localhost:<port>/__scheduled?cron=*/5+*+*+*+*` (wartet, bis der
  Lauf durch ist; die R2-Ablage liegt im `--persist-to`-Verzeichnis).

- `src/config/` — statische Registries: `models.ts` (Modell-Metadaten inkl.
  `forecastHours`/`coverage`, filtert UI-Dropdowns; `modelHorizonEnd()` für
  Horizont-Logik), `variables.ts` (stündliche Variablen), `domains.ts`
  (genau zwei Domains: Europa 25×25, Österreich 16×30 — Gitterdims pro Domain,
  Lat×Lon getrennt für ~quadratische Zellen, plus `recommendedModels`),
  `colors.ts` (Serienfarben), `colorscales.ts` (Karten-Farbskalen mit festen
  Wertebereichen), `time.ts` (gemeinsames Zeitraster).
- `src/state/workbench.ts` — Zustand-Store: globaler Zeit-Cursor, Domain,
  Location-Lock, Panel-Konfigurationen, **Layout** (SPEC §9).
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
- **Die Label-Ausdünnung der Canvas-Karte hängt an der KARTE, nicht am
  Bildschirm** (`drawStationLabels` in `render/atmap.ts`, Test in
  `atmap.test.ts`): bei dichten Netzen (Deutschland, MOS) bekommt je
  Rasterzelle nur die erste Station ihre Zahl. Lag das Raster in
  Bildschirmkoordinaten, wanderten die Stationen beim Ziehen über die
  Zellgrenzen, in jedem Frame gewann eine andere, und die Werte FLACKERTEN
  (gemeldet). Die Zelle wird deshalb aus der Projektion OHNE Verschiebung
  gerechnet; die Auswahl ändert sich nur beim Zoomen.
- **Mit der Maus ablesen, mit dem Klick navigieren** — gilt in Punktprognosen
  (`Meteogram.tsx`) UND Ensemble (`EnsemblePanel.tsx`): ein `setCursor`-Hook
  führt `hoverIdx`, Legende bzw. Ablesezeile zeigen den ÜBERFAHRENEN
  Zeitschritt und fallen beim Verlassen auf die Panel-/Cursor-Zeit zurück; der
  KLICK setzt weiterhin `cursorTime`. Lesen und Navigieren sind bewusst zwei
  Handgriffe — sonst verstellte jedes Überfahren den globalen Zeit-Cursor und
  damit alle synchronisierten Panels. Beide Anzeigen nennen die ZEIT, zu der
  die Werte gehören, und markieren sie als „(Zeiger)", wenn sie am Mauszeiger
  hängt: ohne die Zeitangabe sagt ein Wert nicht, wofür er gilt.
- `src/state/presets.ts` — speicherbare Panel-Presets (localStorage unter
  `meteo-workbench:presets`, getrennt vom IDB-Cache; Export/Import als JSON).
  Mechanismus für die Wetterlagen-Presets aus SPEC §13: `BUILTIN_PRESETS`
  dort befüllen (`builtin: true` = nicht löschbar), `schemaVersion` für
  Migrationen. Zeiten werden bewusst NICHT gespeichert; das Layout schon
  (`layout`, optionales Feld — ältere Presets laden als 6er). Beim Laden wird
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
  **`?mock=foehn` ist `?mock=1` plus einer Föhnorkan-Episode**
  (`api/mockFoehn.ts`, reiner Kern mit Tests): das glatte Grundfeld liefert
  über die Föhnachsen nur ~0,2 hPa Druckunterschied — der Föhn-Bereich zeigt
  mit `?mock=1` also NIE Föhn und ist nicht ansehbar. Die Episode ist
  GEOGRAFISCH gebaut, nicht pro Punkt: alles hängt an der Lage relativ zum
  Alpenhauptkamm (`crestLat`, interpoliert durch die Kammpunkte der echten
  Achsen), deshalb gilt sie für BEIDE Achsen und jeden weiteren Punkt ohne
  Sonderfälle, und die Lee-Größen passen automatisch zum Lee-Punkt der
  Richtung. Südföhn mit ΔP ~16 hPa (Tirol) bzw. ~20 (Schweiz), Kamm 115 km/h
  aus 205°, Lee 16 % rF und 142 km/h Böen (Orkan ≥ 118). **Nordföhn zeigt
  damit korrekt KEINEN Föhn** — eigener Testfall, kein Mangel.
  `mockFoehn.test.ts` rechnet die ECHTEN `foehnCriteria` darauf und verlangt
  4/4 auf beiden Achsen über die ganze Temperaturspanne des Grundfelds: ein
  Testdatensatz, der die Kriterien nicht erfüllt, ist wertlos, und das sieht
  man den Zahlen nicht an. Zwei Lücken fielen dabei auf und sind mitbehoben —
  **`surface_pressure` fehlte im Mock ganz** (fiel in den Default ±10, Δθ war
  daraus Unsinn, ohne dass irgendwo etwas fehlte), und die **Member-Streuung
  des Ensembles hing nicht vom ORT ab**: sie war an zwei Punkten identisch und
  kürzte sich in ΔP exakt weg, alle Member lagen als eine Linie aufeinander
  und die Wahrscheinlichkeit sprang 0 → 100. Jetzt gemeinsamer PLUS
  ortsabhängiger Anteil (der gemeinsame bleibt der größere — ein Ensemble ist
  im Gradienten besser bestimmt als im absoluten Niveau). Die Memberzahl kommt
  außerdem aus der Registry des angefragten Modells statt fester 51.
- `src/render/fieldImage.ts` — Gitterfeld → ImageData: Mercator-Vorverzerrung
  (Zeile → Latitude via inverser Projektion), bilineare Interpolation,
  Farbskalen-LUT; NaN → transparent.
- `src/components/` — `Panel`/`PanelHeader` (Grid-Zelle mit Modus/Modell/
  Parameter/Sync), `Meteogram` (uPlot), `MapPanel` (MapLibre, per React.lazy
  code-gesplittet), `TimeScrubber`, `TopBar`/`LocationPicker`.
  Die **Ortssuche sucht BEIM TIPPEN** (`LocationPicker`, 250 ms entprellt, ab
  zwei Zeichen): das Geocoding liefert schon für Präfixe brauchbare Treffer
  („salzb" → Salzburg), Enter übernimmt nur noch den obersten. Zwei Fallen
  sind dabei behandelt: eine laufende Nummer verwirft ÜBERHOLTE Antworten
  (beim Tippen überholen sich Requests regelmäßig, sonst überschreibt die
  langsame ältere Antwort die neuere Liste), und Eingaben, die mit einer Ziffer
  beginnen, werden gar nicht erst geokodiert — eine halb getippte Koordinate
  ist kein Ortsname. Geocoding läuft über plain `fetch`, NICHT über `apiGet`:
  es zählt nicht ins Forecast-Budget.
- **Basemap ist komplett lokal** (Ausnahme: die CARTO-Kacheln unter der
  Klima-/MOS-Karte, Begründung dort; die Topografie der Modellkarten kommt aus R2) — bewusst KEIN externer Tile-Dienst (kein
  API-Key, kein Fremd-Rate-Limit; MapLibres `load`-Event hinge sonst an
  fremden Tile-Requests, an denen das ganze Panel gegated ist).
  Layer bottom→top: Hintergrund → Feld → Gradnetz → Bundeslandgrenzen
  (admin1, nur Österreich-Domain und Radarfläche) → Küsten → Staatsgrenzen → Städte/Labels
  (DOM, immer zuoberst). **Grenzen sind Casing-Paare** (breite dunkle Linie +
  schmaler heller Kern) — eine einzelne Linienfarbe ist gegen divergierende
  Farbskalen nie überall lesbar. Hierarchie über Strichart, nicht Helligkeit:
  Staatsgrenzen/Küsten durchgezogen, Bundesländer gestrichelt. Achtung:
  `line-dasharray` skaliert mit `line-width` — Casing und Kern brauchen
  unterschiedliche Werte für deckungsgleiche Strichelung. Daten: Natural
  Earth (Küsten/Grenzen 1:50m, admin1 1:10m eng zugeschnitten), gebündelt in
  `src/mapdata/*.basemap.json`; Regeneration mit
  `node scripts/build-basemap.mjs [domain …]` — OHNE Argument werden alle
  Bündel neu geschrieben, also auch gegen einen inzwischen geänderten
  Natural-Earth-Stand; mit Argument nur das genannte (`dach`). Ein Bündel muss
  nicht alle Ebenen führen: `dach` trägt nur admin1 für die Radarkarte, die
  den Rest aus `europe` nimmt — `BasemapData.coast`/`borders` sind deshalb
  optional. Städte kuratiert in `src/config/cities.ts`
  (`domains` + `priority` 1–5; kleine Panels dünnen Labels aus und lassen die
  Punkte stehen, die BILDKARTEN blenden den ganzen Marker aus — Begründung im
  Radar-Abschnitt).
  Stadt-Labels sind DOM-Marker mit Text-Halo — MapLibre-Symbol-Layer würden
  eine externe Glyphs-Quelle brauchen.

## Konventionen

- **Memo-Schlüssel über die IDENTITÄT der Daten, nicht über „geladen
  ja/nein"** (`lib/dataKey.ts`, `seriesKey`/`refId`, mit Tests). TanStack
  Query gibt jede Renderrunde NEUE Query-Objekte zurück; ein `useMemo` über
  sie rechnete bei jedem Render neu, und die Panels keyten deshalb auf ein
  billiges `loadedKey` = „geladen ja/nein je Serie". **Das war zu wenig und
  hat drei Panels still falsch gemacht**: Wien → Sonnblick → Wien ergibt
  dreimal denselben Schlüssel `1111…`, sobald beide Punkte im Cache liegen —
  der Memo rechnete beim dritten Klick nicht neu, und auf dem Schirm blieb
  das Profil des Sonnblicks stehen. Gemessen (2026-09-30, klassisches
  Meteogramm): 12 Plot-Neuaufbauten beim ersten Besuch einer Stadt, **null**
  bei der Rückkehr, und die Pixelsignatur blieb nachweislich die der vorigen
  Station. Beim schnellen Durchklicken besucht man Städte zwangsläufig
  erneut — so entstand der Eindruck, die Knöpfe reagierten träge.
  Geschrieben wird jetzt die IDENTITÄT der Datenobjekte (laufende Nummer je
  Referenz aus einer `WeakMap`): TanStack teilt Strukturen, ein
  unveränderter Abruf liefert dieselbe Referenz, ein geänderter eine neue —
  der Schlüssel ändert sich also genau dann, wenn sich die Daten geändert
  haben. **Bewusst NICHT der Ort im Schlüssel** (das `dataKey`-Muster aus
  `VerifyPanel`): das übersähe einen Hintergrund-Refetch mit neuen Werten am
  selben Ort. Betroffen waren `ClassicMeteogram`, `Meteogram` und
  `SkewTPanel` — am Sounding ist es die unauffälligste Art, falsch zu sein.
  **Die Rechenzeit war nie das Problem**, auch wenn es so aussah: ein
  Ortswechsel kostet gemessen 135 ms insgesamt (Netz ~120 ms, erster
  Plot-Aufbau nach 45 ms leer, zweiter nach 130 ms mit Daten), eine Rückkehr
  aus dem Cache jetzt 30–45 ms. Dass `ChartRow` den uPlot bei Datenänderung
  neu BAUT statt `setData` zu rufen, ist damit gemessen kein Engpass — nicht
  ohne neue Messung refactorn. Die leere Zwischenrunde bleibt ausserdem
  absichtlich: das vorige Bild stehen zu lassen wäre dieselbe falsche
  Aussage, die hier gerade behoben wurde (vgl. „lieber nichts zeigen" im
  Satellitenbereich).
- **HANDY-ANSICHT unter 760 px** (`lib/useIsPhone.ts`, CSS-Block
  `@media (max-width: 760px)` am Ende von `index.css`): JEDE Handy-Regel hängt
  an dieser einen Grenze, die Desktop-Ansicht bleibt dadurch unberührt — Regeln
  nie in die Grundregeln schreiben. Geprüft wird das per Pixelvergleich des
  Desktops bei Pixeldichte 1 gegen `master` (muss identisch sein). Stand
  (Meteogramm): Navigation als EINE wischbare Zeile, kompakte Leiste,
  Schnellwahl als Auswahlliste, Zeitraum 2/3/7 Tage, feste Zeilenhöhen
  (`PHONE_ROW_BASE`) und der Bereich `.meteo` scrollt — geteilte Fensterhöhe
  ließ der Temperatur ~20 px. Übrige Bereiche sind noch nicht angepasst.
- **Diagramm-Plugins zeichnen in CSS-PIXELN** (`inCssPixels` in
  `ChartStack.tsx`): uPlot liefert `bbox` und `valToPos(…, true)` in
  GERÄTEpixeln, die Plugins rechnen Schrift, Abstände und Radien aber in
  CSS-Pixeln. Auf Retina (2) und iPhone (3) war alles Gezeichnete zwei- bis
  dreimal zu klein, und das Datum rutschte in die Stundenzeile. Jeder
  Zeichen-Hook sieht jetzt eine Sicht in CSS-Pixeln auf eine skalierte
  Zeichenfläche; bei Pixeldichte 1 wird nichts umgeleitet (Desktop
  pixelgleich). Neue Plugins brauchen dafür nichts zu tun.
- **Sync-Semantik**: Der SYNC-Button eines Panels koppelt Zeit-Cursor,
  Kartenzoom (`sharedView`) und Modellauswahl (`sharedModels`/`sharedMapModel`).
  Sync-aktive Panels LESEN die gemeinsamen Werte über `useEffectivePanel()` —
  Komponenten dürfen nicht direkt `panels[i]` rendern. Beim Aussteigen wird
  der gemeinsame Stand in die lokale Config eingefroren. Kamera-Sync läuft
  über `sharedView` mit `applyingViewRef`-Guard gegen Echo-Schleifen.
- **Die BUILD-KENNUNG steht unten rechts neben dem Impressum**
  (`config/build.ts`, Werte aus `vite.config.ts` über `define`): kurzer
  Commit-Hash, das Commit-Datum mit Uhrzeit nur im Tooltip (seit 2026-11-02
  auf Wunsch, sichtbar war vorher auch das Datum). Der Zweck ist
  Vergleichbarkeit — „ist das schon der neue Stand?" war an diesem Projekt
  mehrfach nicht zu beantworten, ohne das ausgelieferte Bundle zu durchsuchen:
  beim Re-Run eines ALTEN Laufs (#287 baute den Stand von gestern), beim leeren
  Impressum, bei einer gecachten `index.html`. **Aus GIT, nicht aus
  `package.json`**: eine gepflegte Versionsnummer driftet, der Commit kann
  nicht lügen. In GitHub Actions liefert `GITHUB_SHA` den Stand, lokal `git
  rev-parse`; fehlt beides (Tarball ohne `.git`), steht „unbekannt" da — eine
  erfundene Nummer wäre schlimmer als keine. Das **`+`** hinter dem Hash
  markiert einen Build aus einem GEÄNDERTEN Arbeitsbaum: der gehört zu keinem
  Commit und ist gegen `git log` nicht prüfbar. Gezeigt wird das
  COMMIT-Datum, nicht die Bauzeit — ein Re-Run baut denselben Stand neu, und
  dann identifiziert nur das Commit-Datum den Stand. Dieselbe Angabe steht als
  eigener Abschnitt „Stand dieser Seite" im Impressum, wo man sie zuerst
  sucht.
- **Attribution ist Lizenzbedingung, nicht Höflichkeit** (`Attribution.tsx`,
  `.attribution` in `index.css`): Open-Meteo (CC BY 4.0), GeoSphere (CC BY 4.0),
  DWD (GeoNutzV) und EUMETSAT verlangen Namensnennung, SPEC §13 führte das als
  offen.
  Jeder Bereich trägt jetzt eine Quellenzeile mit Links. Die Anbieterliste der
  Vorhersagebereiche wird aus der Registry ABGELEITET (`ModelDef.provider`),
  nicht gepflegt — ein neues Modell bringt seinen Anbieter mit. Für eine Seite,
  die Modelle nebeneinanderstellt, ist das nicht nur Pflicht, sondern die
  Information selbst: wer ICON gegen IFS vergleicht, sollte wissen, dass da DWD
  gegen ECMWF steht.
- **Der Code ist NICHT Open Source** (seit 2026-11-05 `LICENSE`, „alle Rechte
  vorbehalten"; `package.json` `UNLICENSED`): das Repository ist öffentlich einsehbar,
  die Nutzung aber nicht freigegeben. Rechteinhaber steht bewusst nur als „Betreiber von
  meteojunkie.com", der Klarname gehört nicht ins Repo. Der Hinweis „© 2026 meteojunkie"
  steht unten rechts in jedem Bereich und auf der Startseite.
- **Layout 6/4/2/1 gilt JE BEREICH** (`layouts: Record<PanelSection, PanelLayout>`
  im Store, Standard `DEFAULT_LAYOUT` = {workbench: 4, ensemble: 1, profile: 1};
  das Profil hat gar keine Wahl mehr, siehe `FIXED_PANEL_COUNT` beim
  Soundings-Abschnitt —
  vier Ensembles kosten etwas ganz anderes als vier Meteogramme, und ein
  Plume-Diagramm braucht selbst schon viel Breite (51+ Member), zu zweit kaum
  lesbar;
  `LayoutPicker` in der TopBar, Rasterklassen `.panel-grid.layout-N`): reine ANZEIGEFRAGE — es gibt immer
  sechs Panel-Configs, die reduzierten Layouts blenden aus statt zu löschen.
  `visiblePanelIndices()` ist die einzige Quelle dafür, welche Panels gerendert
  werden: immer die ERSTEN N. Bewusst ohne Auswahl, welche Config wohin kommt —
  das stellt man im Panel selbst ein. Ausgeblendete Panels rendern nicht und
  **fetchen nichts**, das ist Budget und kein Zufall. Wird die parsync-Quelle
  ausgeblendet, schaltet parsync ab (`parSyncAfterLayout`), sonst blieben die
  Parameter-Dropdowns der übrigen Panels für immer gesperrt. Getestet in
  `state/workbench.test.ts`.
- **Die Pfeiltasten bewegen den Zeitschieber — und zwar OHNE ihn
  anzuklicken** (`lib/globalKeys.ts`, mit Tests): ←/→ ein Schritt, Shift
  sechs. Der Zeit-Scrubber der Panel-Bereiche konnte das schon, die
  MOS-Vorhersage nicht — dort war der Regler ein `input[type=range]`, das
  die Tasten NUR mit dem Fokus darauf annimmt; wer die Karte, das
  Parameter-Dropdown oder eine Station angeklickt hatte, drückte ins Leere.
  `globalKeyAllowed(e)` ist die eine Regel dazu und nimmt genau zwei Fälle
  aus, beide waren vorher falsch. **(1) Ein BUTTON darf NICHT sperren**: die
  alte Liste im Scrubber schloss ihn mit ein, obwohl Pfeiltasten auf einem
  Knopf nichts tun — wer im Soundings-Bereich eine Stadt aus der
  Schnellwahl anklickte, ließ den Fokus dort stehen, und danach war die
  Zeitsteuerung tot, ohne dass man sah, warum. Eingabefeld, Auswahlliste und
  Schieberegler bleiben dagegen ausgenommen: dort ist die native Wirkung die
  richtige (Textcursor, Auswahl, ein `step` weiter). **(2)
  `defaultPrevented` sperrt**: der Trenner zwischen Karte und Skew-T
  (`ProfileSplit`) verschiebt sich mit den Pfeiltasten und ruft
  `preventDefault()`, sein Ereignis steigt aber weiter bis zum `window` —
  ohne den Riegel rückte zusätzlich der Zeit-Cursor vor, ein Tastendruck mit
  zwei Wirkungen. Der Riegel gilt damit auch für jeden künftigen lokalen
  Handler. Radar und Satellit haben eigene Zeitleisten und bleiben vorerst
  bei ihrem Regler.
- **Schnellwahl des Orts** (`config/quickPoints.ts`, `components/QuickPoints.tsx`):
  acht Knöpfe — Landeshauptstädte plus **Sonnblick** — die `lockedLocation`
  setzen. Sie stehen in JEDEM punktbasierten Bereich: klassisches Meteogramm
  und Ensemble in deren eigener Werkzeugleiste, Soundings in der TopBar
  (`view === 'profile'`), weil das Skew-T eine reine Zeichenfläche ohne eigene
  Leiste ist. Entstanden sind sie im Ensemble-Panel (`ENSEMBLE_QUICK_POINTS`)
  und sind von dort herausgezogen: der Ort ist GLOBALER Zustand, drei
  Fassungen derselben Reihe wären drei Gelegenheiten auseinanderzulaufen. Der
  Sonnblick ist bewusst dabei — an ihm wird die Höhenabhängigkeit sichtbar, an
  der Globalmodelle scheitern (siehe den Höhenbefund in der Verifikation). In
  der TopBar steht die Reihe NUR im Profil-Bereich: Ensemble hat seine eigene,
  und zweimal dieselben acht Knöpfe übereinander wären Platzverschwendung.
- **Vorgabe-Ort ist SALZBURG** (`lockedLocation` in `state/workbench.ts`), und
  das ist keine Geschmacksfrage: die frühere Vorgabe Berlin liegt AUSSERHALB
  der Abdeckung sämtlicher Lokalmodelle dieser Workbench — AROME Austria und
  ICON-CH1/CH2 antworten dort mit Fehler bzw. leeren Reihen (live geprüft
  2026-09-16). Beim ersten Laden war damit ausgerechnet das ausgegraut, worum
  es hier geht: 1–2,5-km-Lokalmodell gegen 25-km-Global. Salzburg liegt in
  jeder Abdeckung und nahe am Alpenrand, wo der Auflösungsunterschied
  überhaupt sichtbar wird. Das Feld gilt für ALLE punktbasierten Bereiche —
  klassisches Meteogramm, Punktprognosen, Ensemble und Vertikalprofil teilen
  es sich. Die Verifikation hat davon getrennt eine STATION (Wien Hohe Warte),
  weil sie GeoSphere-Messwerte braucht und nicht eine Koordinate.
- **Meteogramm-Default ist EIN Modell** (`DEFAULT_MODELS = ['ecmwf_ifs025']`):
  IFS als Referenzlauf, weitere kommen per Modellwähler dazu. Nicht wieder auf
  mehrere vorausgewählte Modelle stellen — das kostet beim Laden Budget für
  Serien, die niemand angefordert hat.
- **Summengrößen (Niederschlag/Schneefall) haben umschaltbare Darstellungen.**
  Meteogramm (`accumView`, `config/variables.ts` → `accum`/`sumUnit`): Rate in
  mm/h als **Stufen** (`uPlot.paths.stepped({align: -1})` + Füllung — der Wert
  gilt für die VORANGEGANGENE Stunde) oder kumulierte Summe (`accumulateSeries`).
  Ensemble (`ensembleAccumView`, `config/ensemble.ts`): kumulierte Summe oder
  **6-h-Mengen je Mitglied** (`bucketMembers`, Stützstellen auf 00/06/12/18 UTC,
  unvollständige Fenster → kein Punkt). Beide Felder sind panel-lokal und NICHT
  an SYNC gekoppelt — zwei Sichten nebeneinander ist ein sinnvoller Vergleich.
  **Die Ansicht wird über das Parameter-Dropdown gewählt**, nicht über einen
  Umschalter daneben: `variableOptions()`/`ensembleVariableOptions()` erzeugen je
  Summengröße zwei Einträge mit zusammengesetztem Wert `id:view`, zerlegt von
  `parseVariableValue()`/`parseEnsembleVariableValue()`. Auf der Karte werden
  KEINE Ansichten erzeugt (ein Zeitschritt hat keinen Summenzeitraum).
  **Wichtig zum Verständnis der Daten:** Open-Meteo verteilt bei 3-stündlichen
  Modellen (ECMWF IFS/AIFS) die 3-h-Summe GLEICHMÄSSIG AUF DREI STUNDEN (live
  geprüft gegen `daily=precipitation_sum`). Die drei gleichen Werte sind je ein
  Drittel — nicht dreimal derselbe Blockwert. Mengen sind deshalb vergleichbar,
  Spitzenintensitäten nicht.
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
- **`selectable: false` blendet ein Modell aus ALLEN Auswahlen aus**
  (`SELECTABLE_MODELS`), ohne es aus der Registry zu nehmen — gespeicherte
  Presets lösen die ID weiter auf (`modelExists` prüft gegen `MODELS`, nicht
  gegen die Auswahlliste), und das Wiedereinschalten ist ein Wort. Abgeschaltet
  ist nur `ukmo_uk_deterministic_2km`: es LIEFERT Daten (live geprüft
  2026-08-31, London 73 h), scheitert außerhalb Großbritanniens aber komplett —
  in Österreich antwortet der Request nicht einmal mit JSON, und für diese
  Workbench liegt jeder interessante Punkt dort.
- **Neue Modelle/Variablen IMMER live gegen die API verifizieren, nie nur aus
  der Doku übernehmen** (SPEC §6): Open-Meteo antwortet teils mit HTTP 200 und
  leeren Arrays statt mit einem Fehler. Bereits live verifiziert:
  `geosphere_arome_austria` (ID, alle Variablen, 60 h/3 h) und `icon_eu`
  (120 h Horizont — nicht die ~78 h, die teils kursieren).
- **KI-Modelle sind vollständig durchprobiert** (2026-08-17, 27 IDs gegen beide
  APIs): es gibt genau ZWEI. `ecmwf_aifs025_single` auf der Forecast-API
  (Meteogramm/Karte, ohne Böen und CAPE — beide durchgehend null) und
  `ecmwf_aifs025` auf der Ensemble-API. Die IDs sind NICHT austauschbar: jede
  liefert auf der jeweils anderen API nur null. `gfs_graphcast025` ist eine
  gültige ID mit ausschließlich null (tot); Pangu, FuXi, Aurora, GenCast und
  FourCastNet existieren unter keinem Namen. Nicht erneut aus der Doku ergänzen.
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
  Sync aus). **Der Zeit-Cursor reicht so weit wie das längste AKTIVE Modell**
  (`activeHorizonEnd`/`cursorRangeEnd` in `state/workbench.ts`, nur sichtbare
  Panels): Ensembles laufen über das deterministische 16-Tage-Raster hinaus
  (GEFS ~34 Tage), die Forecast-API deckelt aber bei 16 — deshalb ist
  `TIME_RANGE.end` NICHT die Cursor-Obergrenze. Store-Clamp, Scrubber-Regler,
  Play-Schleife und der Zeitklick in der Plume müssen alle dieselbe Quelle
  benutzen, sonst zeigt der Regler ein Ende, das der Cursor nicht annehmen
  kann. Nach unten bleibt es immer bei mindestens `TIME_RANGE.end` — kürzere
  Modelle werden schraffiert, nicht abgeschnitten. Jenseits davon: keine Extrapolation — Karte zeigt Meldung statt
  Feld, Meteogramm-Serien enden (Maskierung + Endlinien im Chart, Legende „—"),
  Scrubber schraffiert den Bereich hinter dem längsten aktiven Horizont.
- **Der Modelllauf steht in JEDEM Vorhersagebereich** (`config/runs.ts`):
  geholt wird immer der neueste verfügbare Lauf (die Forecast-API liefert von
  sich aus den neuesten Seamless-Lauf), ausgewiesen wird er in Punktprognosen
  (Legende), Karte, klassischem Meteogramm, Ensemble, Vertikalprofil und Föhn
  (Detailmodell UND Ensemble getrennt — verschiedene Takte, also verschieden
  alt). **Die Init-Zeit ist GESCHÄTZT, nicht gemeldet**: die API nennt sie
  nicht, `run=` wird mit HTTP 400 abgelehnt und `model_run=` still ignoriert
  (SPEC §6) — `latestRun()` rechnet sie aus Lauftakt und typischer
  Bereitstellungsverzögerung (`AVAILABILITY_LAG_H`). Diese Einschränkung steht
  als EINE Konstante `RUN_TITLE` im Tooltip jeder Laufanzeige, nicht je
  Bereich neu formuliert. **Mit Tagesbezug** (`formatRunLong`: „heute 06 UTC",
  „gestern 18 UTC", sonst „13.09. 12 UTC") — die kompakte Form `formatRun` ist
  in einer Legende richtig, als einzige Angabe aber zweideutig: um 01 UTC ist
  „18 UTC" der Lauf von gestern, und genau dann ist die Frage nach dem Alter
  akut. `latestRun` nimmt `RunnableModel` (`id` + `updateIntervalHours`), nicht
  `ModelInfo`, damit die Ensemble-Registry ihren Lauf genauso ausweisen kann;
  die Föhn-Ensembles führen keinen eigenen Takt und rechnen über ihr
  `deterministicModel` — EPS und Hauptlauf laufen im gleichen Rhythmus, das EPS
  ist aber typisch etwas später fertig, was der Tooltip dort sagt. Getestet in
  `runs.test.ts`. Die MOS-Vorhersage ist der einzige Bereich mit einer ECHTEN
  Laufangabe (`meta.run` aus dem Ingest).
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
  als eine Wetteranomalie (±12 K). **Die Anomaliefarbe muss zur GRÖSSE passen,
  nicht nur zum `anomalyKind`**: Niederschlag nutzt BrBG (braun = trocken,
  türkis = nass), Sonnenschein eine EIGENE Rampe (graublau = trüb → gelb →
  orange, `SUN_ANOM_SCALE`/`SUN_CLIMATE_SCALE` über das Feld
  `climateAnomalyScale`). Mit der gemeinsamen Prozentskala sah „viel Sonne" aus
  wie „viel Regen". Die
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
