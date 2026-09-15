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
  Monat/Jahr→`klima-v2-1m`; Anomalien vs. Normal 1991–2020). Sechs Zeitbezüge:
  Tag · Monat · Saison · Jahr · Klimaperiode · Allzeit (s. u.) — die letzten
  beiden lesen vorberechnete Assets und kosten keinen Request. „Aktuell"-Knopf
  springt auf den neuesten Stand — Tag = heute; Monat/Saison = der LAUFENDE
  Zeitraum als Teilsumme aus Tageswerten bis zum letzten abgeschlossenen Tag
  (`fetchRunningMonthPartial`/`PeriodCoverage.partial`, s. u.); Jahr bleibt bei
  der letzten ABGESCHLOSSENEN Periode (s. `latestPeriods()` in
  `AtClimatePanel.tsx` für die Begründung) — und holt den laufenden Tag mit
  `force` am TTL-Cache vorbei.
  **Eine verlegte Station ist EINE Station** (`scripts/at-ingest-stations.mjs`):
  GeoSphere führt jede Messreihe DOPPELT — als `INDIVIDUAL` (ein physischer
  Standort) und als `COMBINED` (die fortgeführte Reihe über alle Standorte,
  `group_id` zeigt vom Kind auf den Elternteil). Ungefiltert stand jede
  verlegte Station zweimal in Karte und Rangliste, mit identischen aktuellen
  Werten: „Salzburg Flughafen" als Standort ab 1939 UND als Reihe ab 1874. Der
  Ingest behält je Gruppe nur die COMBINED-Reihe → **514 statt 1100 Einträge**
  (216 zusammengeführte Reihen über 587 Standorte + 298 gruppenlose). Geprüft:
  identische Werte in der Überlappung, die Reihe reicht nur weiter zurück;
  **kein Verlust an Live-Abdeckung** (alle 240 gruppierten Standorte mit
  10-Minuten-Daten haben einen Elternteil, der sie ebenfalls hat) und **kein
  verlorenes Normal** (alle 94 wegfallenden Normal-Stationen sind durch ihre
  Gruppenreihe ersetzt). Die eine Koordinate der Reihe trägt, weil die
  Verlegungen klein sind: Median 1,0 km / 11 m Höhe, p90 3,1 km / 58 m, Maximum
  6,2 km (Wien Hohe Warte) bzw. 346 m. Die Standortgeschichte wandert als
  `AtStation.sites` in den Eintrag und steht im Stationsdetail — ohne sie sähe
  „Salzburg Flughafen seit 1874" nach einem Datenfehler aus (Flughäfen gab es
  1874 keine); die Reihe beginnt bei der Station „Salzburg" (1874–1903), geht
  über das Lehrerseminar (1903–1941) zum Flughafen. **Zwei Dubletten bleiben
  bewusst**: Dornbirn und Hochfilzen führen neben der Klimastation eine
  ungruppierte reine Niederschlagsmessstelle am selben Punkt (live geprüft: nur
  `rr`, alles andere null) — die wegzuwerfen hieße, eine eigene Messreihe zu
  verlieren. Der Ingest warnt, wenn WEITERE Namensdubletten am selben Punkt
  auftauchen; das wäre ein nicht gefiltertes COMBINED/INDIVIDUAL-Paar.
  **Die COMBINED-Reihe ist NICHT immer die Vereinigung ihrer Standorte** — das
  ist der eine Preis der Zusammenführung und muss bekannt sein. Bei 8 der 216
  Gruppen reicht ein Vorgängerstandort weiter zurück als die Reihe, gemessen an
  den Rekordjahren der alten Assets: Gmunden (Reihe ab 1930, Standort ab 1901),
  Martinsberg/Gutenbrunn (1948 ↔ 1936), Neusiedl am See (1936 ↔ 1926), Bad
  Goisern (1938 ↔ 1929), Weiz (1944 ↔ 1937), Fischbach (1982 ↔ 1976), Bad Ischl
  (1936 ↔ 1931), Klagenfurt Flughafen (1953 ↔ 1950). Diese Frühjahre fehlen
  seither in „Allzeit" und in Monats-/Jahreskarten vor ~1950 — an 8 von 514
  Stationen. Die NORMALE sind praktisch nicht betroffen (sie beginnen 1961, und
  alle acht Reihen laufen da längst). Bewusst NICHT selbst zusammengesetzt: ob
  GeoSphere diese Segmente absichtlich aus der fortgeführten Reihe hält (weil
  sie nicht vergleichbar sind) oder die Metadaten nur uneinheitlich sind, lässt
  sich über die API nicht entscheiden — und Reihen über einen Standortwechsel
  hinweg selbst zu verketten ist genau der Schritt, den man ohne Homogenisierung
  nicht tun sollte. Wer es doch will: der Rekord-Ingest kennt über
  `stations.json` → `sites` die IDs der Vorgängerstandorte und könnte deren
  Monatsreihen vor der Rekordbildung dazunehmen.
  Nebenwirkung: die Abwertung stillgelegter Stationen in der Stationssuche
  (`climateAsk`) verliert ihren Hauptfall — die Station „Salzburg" 1874–1903
  steht gar nicht mehr in der Liste. Die Regel bleibt für die 199 stillgelegten
  Einzelstationen richtig.
  **Quellenangabe im Klartext** (`.atclima-attribution`): „klima-v2-1d" ist ein
  API-Bezeichner und sagt niemandem etwas. Dort stehen jetzt die offiziellen
  Titel („Stationsdaten-v2", qualitätsgeprüfte Messwerte österreichischer
  Klimastationen) mit Links auf die Datensatzseiten des GeoSphere Data Hub,
  Auflösung und Reihenbeginn im Tooltip, dazu die Lizenz CC BY 4.0. **Ausdrücklich
  dabei: das ist NICHT HISTALP.** HISTALP ist ein eigener Datensatz am selben
  Hub (`histalp-v1-1y`, homogenisierte bruchbereinigte Langzeitreihen des
  Alpenraums) — für die Messwerte selbst laufen hier die qualitätsgeprüften,
  aber NICHT homogenisierten Stationsdaten. Das ist die naheliegende
  Verwechslung und passt zur COMBINED-Frage oben: eine fortgeführte Reihe ist
  keine homogenisierte. Für den PERIODENVERGLEICH wird HISTALP inzwischen
  verwendet (s. u.) — dort ist es die richtige Quelle.
  **Frage ans Klimaarchiv** (`AtAskBox` + Rechenkern `climateAsk.ts`,
  Einstieg gleichrangig NEBEN „Rangliste & Stationssuche" links oben in der
  Karte, gemeinsame Reihe `.atmap-tools`): die Rangliste beantwortet „welche
  Station", das Archiv „welcher Wert" — beide gehören nebeneinander. Beide
  Fenster gehen an derselben Stelle auf und schließen sich gegenseitig aus, wie
  bisher schon Knopf und Rangliste denselben Platz belegen: eine Frage in Alltagssprache („was war das
  tagesmaximum im juli seit messbeginn in salzburg?") wird in
  {Gebiet, Größe, Zeitraum, Extremum} übersetzt und aus den VORHANDENEN Assets
  beantwortet — Rekorde (`records/<id>.json`) bzw. Normale. **Kostet keinen
  Request.** Bewusst OHNE Sprachmodell: die Seite ist statisch (GitHub Pages),
  ein API-Key wäre im Frontend öffentlich, und ein Modell, das aus eigenem
  Wissen antwortet, erfindet bei genau solchen Fragen selbstbewusst Zahlen —
  gebraucht wird kein Sprachverständnis, sondern Wissen über DIESE Registry.
  Das Fenster zeigt das Verstandene als ÄNDERBARE Auswahl statt als Fließtext:
  „Salzburg" heißen acht Stationen, „Temperatur" kann Mittel, Maximum oder
  Minimum sein; ein Fehlgriff soll einen Klick kosten, keine falsche Zahl.
  **Die Fallen sind alle kurze Wörter im unscharfen Vergleich** (jede als Test
  festgehalten): „seit" liegt einen Tippfehler von „sept" entfernt, „Linz" von
  „Lenz", und ein einzelnes „war" traf über den Namensanfang die Station
  „Warth" — daher Stoppwortliste, Präfix-Vergleich für kurze Tokens,
  Ähnlichkeitsschwelle 0,80 und keine Ein-Wort-Fenster in der Stationssuche.
  Distanzmaß ist DAMERAU-Levenshtein: vertauschte Nachbarn („salzbrug") sind
  der häufigste Tippfehler und kosten sonst zwei Fehler. **Stillgelegte
  Stationen werden abgewertet, und das ist Korrektheit, keine Kosmetik**: die
  Station namens „Salzburg" maß 1874–1903, ihr Allzeitmaximum sind 34,8 °C von
  1900 — richtig sind 37,7 °C (Flughafen, der die Reihe fortführt). Bei gleich
  gutem Namenstreffer gewinnt die LÄNGERE Messreihe. Beide Regeln sind seither
  entschärft, aber nicht überflüssig: die Station „Salzburg" ist in die
  Flughafen-Reihe zusammengeführt und steht gar nicht mehr in der Liste, und
  „in Salzburg" fragt ohnehin den ORT (→ 38,6 °C, Freisaal). Für stillgelegte
  EINZELstationen und für die Auswahl in der Stationsliste gelten sie weiter.
  **Gefragt wird nach EINER Station, nach einem ORT oder nach GANZ ÖSTERREICH**
  (`AskQuery.area`, Auswahl „Gebiet" im Fenster): „höchste je gemessene
  Temperatur in Österreich" → 41,2 °C, Bad Deutsch-Altenburg.
  **Der ORT ist der Normalfall einer Frage in Alltagssprache** und war der
  Anlass: „höchste Temperatur in Wien" antwortete mit der Hohen Warte
  (39,8 °C), obwohl Wien ZWÖLF Stationen hat und Stammersdorf 41,0 °C misst —
  zwischen den Wiener Stationen liegen fast 5 K. Gefragt ist der Ort, welche
  seiner Stationen den Rekord hält, ist die ANTWORT. `resolvePlace()`
  entscheidet das daran, WIE VIEL vom Stationsnamen die Frage genannt hat: die
  führenden Namenswörter, die in der Frage vorkommen, bilden den Ortsschlüssel
  — „Wien" (1 von 3 Wörtern) ist ein Ort, „Wien Hohe Warte" (3 von 3) ist eine
  Station. Der Namensvergleich läuft über den Anfang PLUS Leerzeichen, nicht
  über einen blossen Präfix: sonst fielen „Wiener Neustadt" und „Wiener
  Neudorf" unter „Wien" (`'wiener neustadt'.startsWith('wien ')` ist falsch,
  `startsWith('wien')` wäre wahr — daran hängt es). Zusammengeführt wird mit
  `mergeRecords()`: je Ebene und Richtung der beste Wert, die haltende Station
  als `s`/`n` dazu — dieselbe Form wie die nationalen Rekorde, deshalb läuft
  `answerFromRecords` unverändert weiter. Ein Ort kostet ein Dutzend kleine
  statische Abrufe (~10 KB je Station), danach nichts mehr. Trägt ein Ortsname
  nur EINE Station, bleibt es eine Stationsfrage. Der Landesfall
  ist KEIN Sonderweg — `_national.json` hat dieselbe Form wie eine
  Stationsdatei (`abs`/`mon`/`sea`), nur trägt dort jeder Extremwert `s`/`n`,
  die Station, die ihn hält; derselbe `answerFromRecords` beantwortet beides,
  und das WO wird dann Teil der Antwort (bei einer Stationsfrage stünde es
  doppelt da). Der Ingest schreibt die nationalen Rekorde deshalb auf allen
  drei Ebenen statt nur absolut: „wärmster Juli, den Österreich je hatte" ist
  die häufigere Frage. **Ohne erkannten Ort ist die Frage eine LANDESfrage**,
  nicht eine unbeantwortbare — „höchste je gemessene Temperatur" blieb vorher
  einfach leer. **Beim langjährigen MITTEL gibt es österreichweit bewusst keine
  eine Zahl** (`answerFromNormalsAustria`): ein Flächenmittel ist eine
  räumliche Größe, und ein ungewichteter Mittelwert über ~300 ungleich
  verteilte, ungleich hoch gelegene Stationen wäre von den Bergstationen
  dominiert und schlicht falsch. Geantwortet wird stattdessen die SPANNE — das
  gefragte Ende samt Station, als Notiz das andere Ende und die Stationszahl
  („2.420 mm Rudolfshütte … bis 484 mm Retz"). Die Auswahl „gesucht" hat
  deshalb im Landesfall zwei Mittel-Einträge (höchste/tiefste Station), bei
  einer Station nur den einen.
  **Der Zeitraum hat eine EBENE, und die Frage entscheidet welche**: „höchster
  Jahresniederschlag in Salzburg" meint die höchste JAHRESSUMME (1.835 mm,
  1912), nicht den nassesten MONAT (404 mm, Juli 1954) — genau das kam vorher
  heraus, weil die Rekord-Assets überhaupt keine Jahresebene kannten. Sie haben
  jetzt vier: `abs` (bester Einzelmonat der Reihe), `ann` (bester JAHRESwert,
  nur aus vollständigen Jahren — dieselbe 12-Monats-Regel wie beim
  Normal-Ingest), `mon[12]`, `sea`. Bei Maximum-/Minimum-Größen fallen `abs`
  und `ann` zusammen (das höchste Jahresmaximum IST das absolute Maximum), bei
  Summen und Mitteln liegen sie um eine Größenordnung auseinander.
  `AskQuery.annual` erkennt die Vorsilbe „Jahres…" (auch getrennt geschrieben)
  und das blosse „Jahr" — Letzteres steht als Funktionswort auf der
  Stoppwortliste und wird deshalb auf der VOLLEN Tokenliste geprüft, mit
  Ausnahme von „im Jahr 1954": folgt eine Jahreszahl, ist ein Zeitpunkt gemeint.
  Ein engerer Zeitraum schlägt den Jahresbezug („nassester Juli" bleibt eine
  Monatsfrage). Dieselbe Trennung hat die Karte im Zeitbezug „Allzeit"
  („Bester Einzelmonat" ↔ „Jahreswert", `Period.annual`, Skala folgt der Ebene).
  **Ein Superlativ über einen ganzen Zeitraum OHNE Größenwort meint das
  MITTEL**: das wärmste Jahr Österreichs ist 2024 mit 14,3 °C Jahresmittel —
  nicht 2013, weil damals an einem Augusttag 40,5 °C fielen. „Wärmstes Jahr",
  „kältester Winter", „wärmster Juli" schalten deshalb auf `tl_mittel` statt auf
  die Vorgabe `tlmax`. Nennt die Frage die Größe ausdrücklich („höchste
  TEMPERATUR im Juli", „Tagesmaximum"), bleibt es beim Extremwert — das ist die
  Grenze, und sie hängt daran, ob überhaupt ein Größenwort gefunden wurde.
  **Deutsche KOMPOSITA zählen als Treffer** (enthaltenes Parameterwort ab
  sechs Zeichen): „durchschnittlicher Jahresniederschlag" ist die normale Form
  der Frage, liegt von „niederschlag" aber sechs Zeichen entfernt (Ähnlichkeit
  0,67) und wurde vorher still als Temperatur beantwortet. Ab sechs Zeichen,
  weil kürzere Fragmente zufällig in vielen Wörtern stecken; der exakte
  Listentreffer geht weiter vor („höchsttemperatur" bleibt `tlmax`).
  „In der Karte zeigen"
  springt auf den Zeitraum DER ANTWORT (Rekordjahr und -monat), nicht auf das
  laufende Jahr. Gegen die echte Stationsliste gemessen: 14 von 14
  Beispielfragen richtig.
  **Rangliste** (`AtRankList` + Rechenkern `atRank.ts`) reiht die
  geladenen Kartenwerte (auch Anomalien) — rein clientseitig, kein zusätzlicher
  Request; Hover markiert die Station in der Karte (`highlightIdx`), Klick
  öffnet ihr Detail. Der Einstieg ist ein prominenter Knopf **links oben IN der
  Karte** (`.atmap-rankbtn`) — genau dort, wo die Liste danach aufgeht; er
  verschwindet, solange sie offen ist (sie belegt denselben Platz und schließt
  über ihr eigenes ✕). Das Suchfeld bekommt beim Öffnen den Fokus.
  **Die Suche geht immer über die GANZE Reihung**
  (`searchRanked`), nicht nur über die angezeigten Zeilen — sonst wäre eine
  Station auf Rang 87 in der Schnellansicht unauffindbar, weil dort nur die
  Extreme stehen; bei aktiver Suche treten die Extremlisten deshalb hinter die
  Trefferliste zurück. Treffer OHNE Wert werden getrennt mit „—" gezeigt statt
  verschwiegen („gibt es nicht" ist eine andere Aussage als „hat hier keinen
  Wert"). Der Rang bleibt dabei immer der globale.
  Rangliste und Stationsdetail haben beide **zwei Größen**
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
  **Was die Karte zeigt, steht GROSS in der Karte** (`.atmap-headline`, zentral
  unter der Werkzeugleiste, `pointer-events: none`) — Größe, Parameter,
  Zeitbezug und im Abweichungsmodus die Lesart der Prozentwerte. Klein in der
  Werkzeugleiste hat es niemand gelesen, und genau diese Zeile entscheidet, wie
  die Farben zu deuten sind. Die Statuszeile trägt nur noch den Ladezustand.
  **Laufende Zeiträume rechnen GLEITEND** (`PeriodCoverage` in `atValues.ts`):
  der Monatsdatensatz aggregiert erst nach Monatsende, der laufende Monat wird
  deshalb aus TAGESwerten zusammengefasst und mitgezählt — über den gemeinsamen
  Kern `fetchRunningMonthPartial`, sowohl wenn Saison/Jahr ihn als Teil-Monat
  mitzählen als auch bei DIREKTER Monatsauswahl (sonst zeigte z. B. „August"
  bis zum Monatsende schlicht nichts, obwohl derselbe August in der
  Sommer-Saison längst anteilig auftauchte). Entscheidend ist der
  Bezug: die Abweichung geht gegen das Normal GENAU DIESES Zeitraums
  (`partialNormal`) — abgeschlossene Monate voll, der laufende bei `sum`
  anteilig nach Tagen, bei `mean` voll (ein Monatsmittel hat keine Tageszahl).
  Bei `max`/`min` ist kein Teil-Normal ableitbar → keine Abweichung plus
  Hinweis. **Ohne das war die Karte grob falsch**: Sommer 2026 im August zeigte
  bei der Sonnenscheindauer 74–81 % vom Normal (zwei Monate Messung gegen drei
  Monate Normal), richtig sind 113–124 %. Die Überschrift markiert laufende
  Zeiträume mit „● läuft noch — bisher Jun + Jul + Aug 1.–17.".
  **Klick auf eine Station zeigt die Perioden-Historie** statt der Tagesreihe,
  sobald der Zeitbezug nicht „Tag" ist (`AtPeriodHistory` + Rechenkern
  `atHistory.ts`): dieselbe Größe wie in der Karte über die letzten
  `HISTORY_SPAN` (15) Perioden, im Abweichungsmodus als zweifarbige Balken um
  die Neutrallinie (0 bzw. 100 %) gegen DASSELBE Normal wie die Karte. Bei der
  Klimaperiode läuft die Reihe über die Periode selbst. Unvollständige Perioden
  bleiben LEER (Saison = 3 Monate, Jahr = 12) — ein halber Sommer stünde sonst
  als trockener Sommer im Diagramm. Ein Request je Station, gecacht.
  Parameter-Klartext steht als `description` in der Registry; das Dropdown zeigt
  `paramOptionLabel()` = „Kategorie – Kurzname (Einheit)" (`shortLabel` statt
  `label`, sonst stünde dort „Temperatur – Temperatur Mittel"). **Der
  Abweichungsmodus hat ZWEI Lesarten und muss sie beschriften** (`anomalyDisplay()`):
  `delta` ist eine vorzeichenbehaftete Differenz („Δ +2,3 K"), `percent` dagegen
  der ANTEIL am Normal („143 % vom Normal" = das 1,43-Fache, 100 % = Normal) —
  Prozentwerte deshalb NIE mit Vorzeichen rendern, das läse sich als
  Prozentpunkte über dem Normal. Die Rechnung dazu steht in `anomaly()`.
  **Was in der Karte steht, sagt `valueCaption(spec, kind, scope, extreme)`** —
  Zeitbezug und Aggregat ergeben zusammen etwas anderes als der Parametername:
  „Temperatur Maximum" + Klimaperiode + Jahr ist NICHT ein Höchstwert, sondern
  das MITTEL der 30 Jahreshöchstwerte (Kette: Tageswerte → `agg` → Monatswert →
  `annualAgg` → Jahreswert → Mittel über die Jahre). Der Text steht in der
  Statuszeile und im Ranglisten-Titel; `periodLabel` benennt nur noch den
  Zeitraum („Jahr 1991–2020"), nicht mehr die Größe. Reine Rechenkerne
  sind mit Vitest getestet (`*.test.ts`, `npm test`).
  **Kenntage** (`countRule`, Kategorie „Kenntage"): Anzahl von Tagen, die eine
  Schwelle erfüllen — Sommertage (Tmax ≥ 25), Hitzetage (≥ 30), Frosttage
  (Tmin < 0), Eistage (Tmax < 0), Niederschlagstage (≥ 1 mm). GeoSphere liefert
  sie FERTIG im Monatsdatensatz (`tage_sommer` …, 462 Stationen — die beste
  Abdeckung aller Kandidaten, weil aus der Temperatur abgeleitet); der LAUFENDE
  Monat zählt sie über `agg: 'count'` selbst aus den Tageswerten von
  `countRule.source`, sonst bliebe ein angefangener August leer. **Im Tag-Modus
  gesperrt** (`isParamAvailable`): ein Kenntag für EINEN Tag wäre 0 oder 1 und
  als Karte sinnlos. **`code` ist der Identitätsschlüssel der Registry**
  (Dropdown-Wert, `getAtParameter`, gespeicherter Zustand) — Kenntage tragen
  deshalb ihren MONATScode als `code` und nennen den Tagesrohwert nur in
  `countRule.source`; mit `code: 'tlmax'` verdeckten sie still den echten
  Temperaturparameter (ein Test hält die Codes eindeutig). Farbskalen kommen aus
  `countScale(max, ramp)` statt fester Konstanten: Frosttage erreichen im Jahr
  250, Gewittertage 50 — mit einer gemeinsamen Skala läge die eine Karte
  durchgehend im obersten, die andere im untersten Band; die Bereiche bleiben
  trotzdem fest. Rekorde gibt es seit der Rekord-Erweiterung auch dafür
  („meiste Frosttage, die ein Jänner je hatte"). Plausibilitätsprobe der Normale
  1991–2020 gegen 1961–1990: Median +15 Sommertage, +7 Hitzetage,
  −15 Frosttage, −7 Eistage.
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
  (1991–2020: 207, 1961–1990: 181 Stationen — vor der Zusammenführung der
  Stationsdubletten waren es 301 bzw. 282, dieselben Reihen unter zwei IDs),
  und die alte Datei `normals.json` mit 806 Stationen ist bewusst weg: die
  zusätzlichen Werte stammten aus Teilreihen. Für ältere Perioden zeigt erst der Haken „Historische" das volle
  Netz.
  **Allzeit** (Zeitbezug `record`, `Period` in `api/atValues.ts`): der
  STATIONSREKORD über die gesamte Messreihe, aus denselben vorberechneten
  Rekord-Assets wie das Stationsdetail — **kostet keinen Request**. Die Ebene
  ist wählbar: „Bester Einzelmonat" (Extremum über alle Monatswerte) ↔
  „Jahreswert" (`Period.annual`, Extremum über die Jahreswerte) ↔ Kalendermonat
  ↔ Jahreszeit. Die ersten beiden auseinanderzuhalten ist keine Feinheit: der
  nasseste Monat und das nasseste Jahr unterscheiden sich um eine
  Größenordnung, und `valueCaption` benennt die Ebene deshalb im Text
  (Ausschnitt `series` vs. `year`). Er ist der
  einzige Zeitbezug, der eine RICHTUNG braucht (`extreme: 'max' | 'min'`):
  „Temperatur Maximum" hat einen höchsten je gemessenen Tageswert UND einen
  tiefsten Monatshöchstwert, beides ist ein Rekord, und nur `valueCaption(spec,
  'record', scope, extreme)` hält sie auseinander. Voreinstellung je Parameter
  über `defaultRecordExtreme` (Tiefstwert nur bei `agg: 'min'`); eine einmal
  getroffene Wahl bleibt dann stehen. Ausschnitt wie bei der Klimaperiode:
  ganze Reihe, Kalendermonat oder Saison. **Abweichung gibt es hier nicht** —
  ein Einzelereignis hat kein Normal (`normalFor` liefert null, der Knopf ist
  gesperrt und sagt warum). Die zugrunde liegenden Werte sind MONATS- bzw.
  SAISONextreme, nie Jahreswerte: die Farbskala nimmt deshalb `span` =
  `month`/`season`, mit der Jahresskala läge ein Summenparameter um eine
  Größenordnung daneben. Die Karte trägt den Hinweis „Rekord, Reihenlänge
  beachten": ein Rekord hängt an der LÄNGE der Reihe, eine Station seit 1990
  kann die Nachbarstation seit 1900 nicht schlagen, ohne dass es dort je heißer
  gewesen sein müsste — die Karte zeigt „was wurde wo je gemessen", nicht „wo
  ist es am extremsten"; der Haken „Historische" holt gerade die Träger der
  alten Rekorde dazu.
  **Der Rekord-Ingest deckt jetzt ALLE Monatsparameter der Registry**
  (`scripts/at-ingest-records.mjs`, 11 Codes statt 5 — dazu `rf_mittel` und die
  fünf `tage_*`; einzige Ausnahme bleibt die Schneehöhe, die gar keinen
  Monatsdatensatz hat). `RECORD_CODES`/`hasRecords()` in `api/atValues.ts` ist
  die EINE Wahrheit darüber, welcher Parameter Rekorde hat — Stationsdetail,
  Zeitbezug „Allzeit" und ein Test gegen die Registry hängen daran.
  `_national.json` führt die österreichweiten Rekorde jetzt auf ALLEN drei
  Ebenen (`abs`/`mon`/`sea`, `NationalRecords = Record<string, ParamRecords>`),
  je Eintrag mit der haltenden Station — das Klimaarchiv beantwortet damit
  Landesfragen; das Stationsdetail zeigt weiter nur die absolute Ebene. Neben den
  Stationsdateien schreibt der Ingest je Parameter einen **Karten-Index**
  `public/at/records/_map-<code>.json` (`loadRecordIndex`/`recordLevel`): die
  Stationsdatei hat alle Parameter EINER Station, der Index eine Größe über
  ALLE Stationen — genau die Richtung, die eine Karte braucht (~80–175 KB je
  Parameter, Parallel-Arrays über `ids`). Bewusst NUR Werte, kein Datum: die
  Karte beschriftet Zahlen, das Datum steht (tagesgenau aufgelöst) im
  Stationsdetail, das ohnehin die Stationsdatei lädt. **Die Chunkgröße des
  Ingests folgt jetzt dem 1.000.000-Datenpunkte-Limit von GeoSphere** statt
  einer festen 80 — mit elf Codes über 126 Jahre riss die alte Konstante sofort
  in HTTP 400 („data slice too large").
  **Der Periodenvergleich läuft auf HISTALP, nicht auf den Stationsdaten**
  (`scripts/at-ingest-histalp.mjs` → `public/at/histalp-normals.json`,
  `loadHistalpNormals`/`histalpCovers`, Umschalter in der Werkzeugleiste). Der
  Abweichungsmodus im Zeitbezug „Klimaperiode" ist eine TRENDaussage, und
  Trends sind genau das, was inhomogene Reihen verfälschen: klima-v2 ist
  qualitätsgeprüft, aber nicht bruchbereinigt — ein Standortwechsel ins Grüne
  bleibt als künstlicher Abkühlungssprung in der Reihe stehen. **Gemessen**
  (2026-09-01, Stationen mit vollem Normal in beiden Quellen): Erwärmung
  1961–1990 → 1991–2020 im Median HISTALP **+1,27 K**, klima-v2 **+1,17 K**;
  je Station bis 0,77 K Unterschied (Rauris +0,96 K statt +1,55 K — knapp zwei
  Drittel des Signals). Die ABSOLUTwerte beider Quellen stimmen dagegen
  praktisch überein (Median-Differenz 0,003 K im Jahresmittel) — deshalb
  wechselt NUR der Periodenvergleich die Quelle, Absolutkarten, Rekorde und
  alles Übrige bleiben bei klima-v2.
  **Der Preis ist die Abdeckung, und deshalb ist es ein UMSCHALTER**: HISTALP
  liegt am Hub nur JÄHRLICH vor (`histalp-v1-1y`), mit genau zwei Größen
  (`T01`→`tl_mittel`, `R01`→`rr`), und die österreichischen Temperaturreihen
  enden überwiegend zwischen 2001 und 2012 — für 1961–1990 ↔ 1991–2020 bleiben
  **34 Temperatur- und 40 Niederschlagsstationen statt 207**. `histalpCovers()`
  gattet das: außerhalb (Tmax, Sonnenschein, Kenntage, Monats-/Saison-Ausschnitt)
  fällt die Karte auf klima-v2 zurück und sagt es. Beide Perioden kommen IMMER
  aus derselben Quelle — eine aus HISTALP und die andere aus klima-v2 wäre
  schlimmer als beide aus klima-v2, weil der Quellenversatz unbesehen im Trend
  landete. Zuordnung HISTALP↔Klimastation über KOORDINATEN (≤ 3 km, ≤ 120 m
  Höhenunterschied), nicht über Namen: HISTALP nutzt Synop-IDs und eigene
  Schreibweisen („Wien-Schwechat" ↔ „Schwechat Flughafen"), namentlich trafen
  nur 54 von 85, geografisch 72. Die sechs `Region_AT_*`-Einträge sind keine
  Stationen, sondern HISTALPs regionale Mittelreihen (lat/lon = 0) — gefiltert,
  aber der naheliegende Kandidat, falls je ein echtes Flächenmittel gebraucht
  wird (siehe `answerFromNormalsRange`, wo es aus Stationsdaten bewusst keines
  gibt).
  **Gefühlte Temperatur** (`config/apparentTemperature.ts`, AU-BOM/Steadman-
  Formel, dieselbe wie Open-Meteos `apparent_temperature`) ist der erste
  ABGELEITETE Parameter — kein GeoSphere-Feld, sondern aus Temperatur +
  Wasserdampfdruck (aus rel. Feuchte) + Wind berechnet. `AtParameterSpec.
  derived` markiert das; `isParamAvailable` lässt ihn NUR am laufenden Tag zu,
  weil GeoSphere weder ein Monats-/Jahresprodukt dafür führt noch der
  Tagesdatensatz einen zeitgleichen Termin-Wind hat (nur Tagesmittel) — einzig
  der 10-Minuten-Datensatz liefert Temperatur/Feuchte/Wind zeitgleich
  (`fetchLiveApparentTemperature` in `atValues.ts`, Multi-Parameter-Request
  über `fetchStationSeriesMulti`). Zeigt den AKTUELLSTEN Wert (`agg:'last'`,
  wie Schneehöhe), kein Tagesmittel. `AtStationDetail` zeigt für abgeleitete
  Parameter keine Jahresreihe (die gäbe es nicht historisch) und keine
  Perioden-Historie, nur den Live-Wert mit Messzeitpunkt.
- **MOS-Vorhersage** (DACH) — zweiter Modus des Österreich-Bereichs (`AtSection`
  schaltet Klima↔Vorhersage). Quelle: **DWD MOSMIX** (echtes MOS), 3060 Stationen
  im DACH-Raum (`public/mos/stations.json`, aus dem DWD-Katalog; Koordinaten sind
  Grad+Dezimalminuten → umgerechnet). DWD hat **kein CORS** → die Daten werden
  NICHT im Browser geholt, sondern per **Ingest im Deploy-Workflow** (`scripts/
  mos-ingest-forecast.mjs`, KMZ→KML-Parser `scripts/lib/mosmix.mjs`, kein externes
  Paket) zu kompakten Pro-Parameter-JSONs (`public/mos/forecast/*.json`, **gitignored**,
  im Build erzeugt) verarbeitet; der Browser lädt sie same-origin (`api/mosApi.ts`).
  `deploy.yml` läuft dafür zusätzlich alle 3 h (Cron). T2m/Niederschlag/Sonne/
  Bewölkung/Wind/**Gefühlte Temperatur** stündlich (+72 h, Zeitschieber),
  Tmin/Tmax täglich. Gefühlte Temperatur wird BEIM INGEST berechnet (dieselbe
  AU-BOM-Formel wie bei den Klimastationen, dupliziert in reinem JS im Skript
  — kein TS-Cross-Import ins Node-Ingest, siehe Kommentar dort), aus `TTT` +
  Taupunkt `Td` (Element klein geschrieben, GROSS `TD` liefert nichts — live
  gegen die KML geprüft) + `FF` in m/s (nicht die schon nach km/h umgerechnete
  Wind-Kopie). Anders als am Tagesdatensatz der Klimastationen sind hier alle
  drei Rohgrößen stündlich ZEITGLEICH vorhanden, keine Näherung nötig. Karte:
  `AtClimateMap` mit `DACH_VIEW` + `europe.basemap` + Label-Ausdünnung. Registry
  `config/atForecast.ts`. Klick auf eine Station → `AtForecastDetail`:
  Punktvorhersage mit allen Parametern als uPlot-Stapel (T2m, Niederschlag als
  Balken, Bewölkung/Sonne in %, Wind) plus Tmin/Tmax-Karten; der Kartenschieber
  setzt dort eine Marker-Linie. Kostet nichts extra — beim ersten Klick werden
  die übrigen Parameter-JSONs einmal nachgeladen (`loadForecast` cached
  modulweit). Die Reihen werden über ihre TERMINE ausgerichtet
  (`alignSeries`), nicht über den Index. Klimadaten bleiben davon unberührt
  (Österreich/TAWES).
- **Mit der Maus ablesen, mit dem Klick navigieren** — gilt in Punktprognosen
  (`Meteogram.tsx`) UND Ensemble (`EnsemblePanel.tsx`): ein `setCursor`-Hook
  führt `hoverIdx`, Legende bzw. Ablesezeile zeigen den ÜBERFAHRENEN
  Zeitschritt und fallen beim Verlassen auf die Panel-/Cursor-Zeit zurück; der
  KLICK setzt weiterhin `cursorTime`. Lesen und Navigieren sind bewusst zwei
  Handgriffe — sonst verstellte jedes Überfahren den globalen Zeit-Cursor und
  damit alle synchronisierten Panels. Beide Anzeigen nennen die ZEIT, zu der
  die Werte gehören, und markieren sie als „(Zeiger)", wenn sie am Mauszeiger
  hängt: ohne die Zeitangabe sagt ein Wert nicht, wofür er gilt.
- **Ensemble-Modus** (`EnsemblePanel`, `config/ensemble.ts`, Kern `render/plume.ts`,
  Parsing `api/ensembleParse.ts`) — vierter Panel-Modus, **punktbasiert**.
  **Startparameter ist `temperature_850hPa`, nicht T2m** (`DEFAULT_ENSEMBLE_
  VARIABLE`): die Plume ist ein synoptisches Werkzeug, auf 850 hPa liegt das
  Signal des Luftmassenwechsels — T2m wird von der bodennahen Grenzschicht
  (Inversion, Schneedecke, Modellorografie) überlagert, die Streuung zeigt dort
  eher Modellrauschen als Wetterlage.
  Eigener Endpunkt (`ensemble-api.open-meteo.com`), aber derselbe `apiGet`-Pfad
  (mock-fähig, im Verbrauchszähler sichtbar). Modelle: `ecmwf_ifs025` und
  `ecmwf_aifs025` (je 51 Member, 15 Tage) plus `gfs_seamless` (NOAA GEFS,
  31 Member, ~34 Tage — der einzige Weg über 15 Tage hinaus; bis +240 h 0,25°,
  danach 0,5°, deshalb genau EIN GEFS-Eintrag statt gfs025/gfs05 daneben).
  **Eine KI-Version des GFS gibt es nicht** — `gfs_graphcast025` liefert auf
  beiden APIs durchgehend null, die übrigen Namen sind ungültige IDs; nicht
  erneut aus der Doku übernehmen. **`deterministicDays` ist getrennt von
  `forecastDays`**: die Forecast-API deckelt bei 16 Tagen, mit dem
  Ensemble-Horizont (GEFS 35) scheitert der Hauptlauf-Abruf komplett.
  Die suffixlose Reihe der Antwort
  ist der **Kontrolllauf**, NICHT der Hauptlauf — der kommt als eigener
  deterministischer Abruf dazu (1 Call). Eigene Modell- UND Variablenregistry
  (u.a. 850 hPa / 500 hPa), eigene Zeitachse über den vollen Horizont, Zoom per
  Mausrad. **Keine Kartenvariante**: ein Punkt kostet ~5 gewichtete Locations,
  ein AT-Gitter käme auf ~7.200 Calls pro Feld (Rechnung in `config/ensemble.ts`).
- **Föhn** (`FoehnPanel.tsx`, Kern `foehn.ts` mit Tests, Registry
  `config/foehn.ts`, AppView `foehn`) — Föhndiagnose entlang fester
  FÖHNACHSEN (Bozen–Innsbruck, Lugano–Zürich). **Nur Lokalmodelle (≤ 2,5 km)**,
  auf Wunsch: ein 25-km-Global glättet genau weg, worum es geht. Aufbau:
  Kriterien-Streifen über die volle Breite, darunter ein **2×3-Kachelraster**
  (links ΔP Süd − Nord der Modelle · ΔP je Ensemble-Member · Wahrscheinlichkeit;
  rechts Kamm 700 hPa + Stau · Lee-Talstation · Δθ Tal − 700 hPa). Als EIN
  Stapel waren sieben Diagramme so gestaucht (88 px Zeichenfläche), dass sich
  nichts ablesen ließ — nicht dahin zurück. Beide Spalten sind gleich breit,
  die Zeitachsen stehen also auch zwischen den Spalten deckungsgleich; ein
  Cursor für alle Kacheln. Die Zeitachse endet am längsten Horizont der
  gewählten Modelle/des Ensembles. **+ = Südföhn.**
  **ΔP wird JE MEMBER gebildet**, nicht aus den Medianen: Member n ist an beiden
  Punkten derselbe Lauf, die Differenz also eine echte Realisierung; die
  Wahrscheinlichkeit ist der Anteil der Member über der Schwelle (keine Zahl
  unter der halben Memberzahl). Die Wahrscheinlichkeits-Kachel ist nach
  STÄRKE eingefärbt statt in zwei gleichrangige Linien geteilt: die Fläche ist
  ocker bis zum Anteil der Member ≥ 4 hPa und ROT, soweit die Member ≥ 8 hPa
  liegen. Der rote Anteil ist im ockerfarbenen ENTHALTEN (wer 8 hPa
  überschreitet, überschreitet auch 4) — deshalb ein STREIFEN zwischen den
  beiden Kurven (`Curve.fillTo`) und kein Stapel: die Achse bleibt eine
  Wahrscheinlichkeit von 0 bis 100 %, und beide Kanten sind an ihr ablesbar
  (Oberkante = Anteil ≥ 4 hPa, Trennkante = Anteil ≥ 8 hPa). Ein Stapel wäre
  hier falsch, er zählte die starken Member doppelt und brauchte eine Achse
  bis 200 %. Als zwei gleichrangige Linien ging der starke Anteil unter, weil
  er meist klein ist.
  **Jede Kachel graut den Bereich hinter IHREM Horizont aus** (`ChartDef.veil`,
  Kante aus `horizonEdge()`): die Zeitachse reicht bis zum längsten gewählten
  Modell, bei ICON-CH1 (33 h) auf einer 120-h-Achse ist der Rest sonst leere
  Fläche, in der Gitter und Schwellenlinien weiterlaufen und sich wie Daten
  lesen. Die Kante kommt aus den REIHEN, nicht aus `forecastHours` — so stimmt
  sie auch, wenn ein Modell kürzer liefert als die Registry angibt. **Kriterien-STREIFEN statt Index** — eine
  Gewichtung wäre gesetzt, nicht gemessen. Kriterien sind 1/0/null, „nicht
  verfügbar" hat eine eigene Markierung (sonst sähe ein Modell ohne 700 hPa
  aus wie „kein Föhn"). Das Lee wechselt mit der Richtung: Südföhn Innsbruck
  bzw. **Altdorf** (Kloten liegt im Mittelland, keine Föhnstation), Nordföhn
  Bozen bzw. Lugano.
  **Die Schwellen sind FAUSTREGELN, nicht kalibriert** (±4/±8 hPa, Kamm
  ≥ 30 km/h aus SO–WSW bzw. WNW–NO, rF ≤ 50 %, Δθ ≥ −3 K) und stehen so in der
  UI; offen ist eine Kalibrierung gegen gemessene Föhnstunden (GeoSphere
  10-min Innsbruck).
  **Live geprüft (2026-09-14, alle sieben Achsenpunkte)**: ICON-CH1 (1 km,
  33 h), AROME France (1,5 km, 51 h), ICON-CH2 (2,1 km, 120 h), ICON-D2 (2,2 km,
  48 h), AROME Austria (2,5 km, 60 h) liefern `pressure_msl`/`surface_pressure`/
  Bodengrößen; **700 hPa nur ICON-D2 und AROME France** (`FOEHN_UPPER_AIR_
  MODELS`, die übrigen durchgehend null) — deshalb ICON-D2 als Detailmodell.
  `meteofrance_arome_france_hd` liefert KEIN `pressure_msl` und fehlt deshalb.
  Lokal-Ensembles: ICON-CH2-EPS (21 Member, +120 h, Voreinstellung),
  ICON-D2-EPS (20), ICON-CH1-EPS (11) — über `useEnsembleSeriesFor` mit
  expliziter Tages-/Memberzahl, weil `getEnsembleModel` unbekannte IDs still
  auf IFS abbildet (15 Tage, 51 Member). **ICON-CH1/CH2 stehen mit
  `selectable: false` in der Registry**: nur die Größen des Föhn-Bereichs sind
  geprüft (kein `weather_code`, keine Bewölkung, keine Drucklevel) — für andere
  Bereiche erst live prüfen. Ihre Coverage ist eine Näherung.
  `config/levels.ts` führt ICON-D2 für das Skew-T weiter als nicht
  drucklevelfähig; zumindest für 700 hPa ist das widerlegt.
  `usePointSeries` holt Serien OHNE Registry-Gate (Drucklevel,
  `surface_pressure` stehen nicht in `availableVariables`), mit demselben
  Query-Key und Batcher wie `useMeteogramSeries`. Kosten je Achse: ein
  Request je Punkt (Tirol 3 — Lee fällt mit Nord zusammen, Schweiz 4) plus
  zwei Ensemble-Abrufe. Dafür neu in `ChartStack`/`chartDef`: `flagRows`
  (Kriterien-Streifen), `Curve.quiet` (Member ohne Werteanzeige/Legende),
  `symmetricMin` (Achse symmetrisch um 0) und `yInclude` (Bezugswerte, die
  die Achse immer enthält). Die Stundenbeschriftung kommt aus
  `getUTCHours`: de-DE formatiert eine reine Stunde als „06 Uhr".
- **Klassisches Meteogramm** (`ClassicMeteogram.tsx`, AppView `classic`) — der
  „Meteogramm, wie man's kennt"-Bereich: EIN Ort (teilt sich `lockedLocation`
  mit Punktprognosen/Ensemble/Profil), EIN wählbares Modell (Default
  `ecmwf_ifs025`), Aufbau nach dem **etablierten Schema der Wetterdienste**
  (DWD/ZAMG/ECMWF-Meteogramm), von oben nach unten: **Wettersymbole**
  (WMO-`weather_code`) · **Bewölkung in ACHTELN** (WMO-Stationskreis 0/8–8/8,
  je Zeitschritt ein Kreis, vier Zeilen untereinander: Gesamt/Hoch/Mittel/Tief)
  · Temperatur + **Taupunkt** +
  gefühlte Temperatur mit markierter **0-°C-Linie** und beschrifteten
  **Tagesmaxima und -minima** (`ChartDef.marks` = Sätze von Punktmarken, Punkt
  + Zahl; Maximum in der Kurvenfarbe über dem Punkt, Minimum blau darunter —
  `MarkSet.place`, gespiegelt wenn dort kein Platz ist; angeschnittene Fenster
  werden verworfen — am Modellhorizont wäre das „Maximum" der letzten paar
  Stunden sonst eine falsche Aussage). **Die beiden haben VERSCHIEDENE
  Suchfenster** (`ExtremeWindow`): das Maximum den Kalendertag 00–00 UTC —
  dort schneidet die Tagesgrenze durch kein Extremum, und bei INVERSEM
  Tagesgang kann der Höchstwert überall im Tag liegen, auch nachts. Das
  Minimum dagegen die **synoptische Nacht 18–06 UTC**: über den Kalendertag
  gerechnet stand vor UND nach Mitternacht je ein Minimum, obwohl es eine
  Nacht mit einem Minimum ist — die Tagesgrenze schneidet genau durch den
  Tiefpunkt. Nicht auf ein gemeinsames Fenster zurückdrehen. Der Punkt sitzt
  exakt auf dem Zeitpunkt, nur die ZAHL wird über
  `PointMark.spanStart/spanEnd` in ihr Fenster hineingezogen, damit sie nicht
  über dessen Rand steht und dem Nachbarfenster zugeordnet wird. Die y-Achse
  läuft über `yStep: 5` in **5-K-Schritten** (5/10/15/20 …): feste `incrs` plus
  auf Vielfache aufgezogene Skala, sonst lägen die Ticks auf krummen Werten
  wie 3,7/8,7. Dazu MUSS `ySpace` klein genug sein (16 statt 30) — uPlot nimmt
  die nächstgröbere erlaubte Schrittweite, sobald zwei Ticks enger als `space`
  beieinanderlägen, und die Achse sprang bei üblicher Zeilenhöhe auf 10-K-
  Schritte zurück; beim Wind aus demselben Grund 18 · Niederschlag getrennt
  nach **Regen/Schnee** plus **Wahrscheinlichkeit** auf eigener rechter Achse ·
  Wind mit **Windfiedern** (Windbarbs in Knoten) + Böen · **Luftdruck (MSL)**.
  Über allen Zeilen liegt die **Tag/Nacht-Schattierung** aus dem Modellfeld
  `is_day` (ortsgenau — die Achse selbst bleibt UTC). Diese Zeilen sind bewusst
  NICHT konfigurierbar: das ist der erwartete Kanon, freie Parameterwahl gibt
  es im Bereich „Punktprognosen". Zeilenhöhen über `ChartDef.flex` gewichtet
  (Symbolzeile ganz schmal, Temperatur/Niederschlag breit). Die
  **Symbolzeile trägt weder Stundenachse noch Datumsstreifen
  (`ChartDef.hideXAxis`) noch Kopfzeile**: die Uhrzeiten stehen unter jedem
  anderen Parameter ohnehin, und „Wetter" über einer Reihe Wettersymbole sagt
  nichts — beides fraß nur die Höhe, die die Parameter darunter besser
  brauchen. Die Tagesgrenz-Linie bleibt. Symbolabstände (Wettersymbole, Achtel-Kreise, Windfiedern) rasten
  über `symbolStep()` auf RUNDE Stundenvielfache (1/2/3/6/12/24) statt auf
  einen aus der Breite gerechneten krummen Schritt — sonst wanderten die
  Symbole über die Uhrzeiten und stünden zwischen den Zeilen senkrecht
  versetzt. Symbolzeichnung:
  `render/wxsymbols.ts` (Wettersymbole, Achtel-Kreis, Windfiedern — reine
  Canvas-Primitive, weil ein DOM-Overlay beim Resize nie deckungsgleich mit der
  Zeitachse bliebe), Code→Klasse/Klartext: `config/wmo.ts`. `weather_code` und
  `is_day` stehen als `chartOnly` in `config/variables.ts` — sie sind
  Diagrammbausteine, keine wählbaren Parameter, und werden aus den
  Dropdowns gefiltert. **`precipitation_probability` gibt es NICHT überall**
  (live geprüft 2026-08-30: ARPEGE, AROME FR/AT, UKMO global/UK und AIFS
  liefern durchgehend null) — deshalb pro Modell gepflegt (`PROB_VAR`), nicht
  in `BASE_VARS`. Bewusst NICHT Teil des Panel-Rasters
  (kein `PanelSection`) — ein gestapeltes Meteogramm mit mehreren Modellen
  übereinander wäre visuell Chaos, deshalb ein eigenes schlankes Gerüst wie die
  Klimakarte, kein Sync/Layout/Multi-Modell. Holt 16 Einzelserien (1 Modell
  × Variable) über `useMeteogramSeries` — der Request-Batcher in `openmeteo.ts`
  bündelt sie trotzdem zu EINEM Request pro Punkt, wie bei mehreren
  gleichzeitig sichtbaren Punktprognosen-Panels; der Stapel kostet also einen
  Abruf, nicht sechzehn. `apparent_temperature` ist
  dafür neu in `HOURLY_VARIABLES`/`BASE_VARS` aufgenommen (live gegen mehrere
  Modelle verifiziert, s. `config/variables.ts`/`config/models.ts`).
  **`ChartStack.tsx`** (Komponente) + **`config/chartDef.ts`** (Typen/Helfer,
  bewusst GETRENNT — eine Komponentendatei darf für React Fast Refresh nur
  Komponenten exportieren) ist der gemeinsame Baustein für „Stapel aus kleinen
  Zeitreihen-Diagrammen mit gemeinsamer Zeitachse", aus `AtForecastDetail.tsx`
  herausgezogen (MOS-Punktvorhersage nutzt ihn jetzt auch). Enthält den
  Cursor-Sync über mehrere `ChartRow`-Instanzen hinweg (`uPlot.sync`-Key als
  Prop) — ein Hover in einer Zeile zeigt das Fadenkreuz in allen Zeilen des
  Stapels. **Windfiedern** (Windbarbs) sind ein Canvas-Draw-Hook, kein uPlot-Seriencode:
  Kurven mit gesetztem `direction`-Feld bekommen einen FESTEN Streifen am
  oberen Rand des Diagramms (`windBarbStripPlugin` → `drawWindBarb`)
  — bewusst NICHT entlang der schwankenden Geschwindigkeitslinie (bei Flaute
  kaum lesbar, bei Sturm überdeckt von der Linie). Der Streifen deckt sich
  dafür mit einer eigenen Fläche ab (`--bg-panel`-Farbe), damit die Linie nie
  hindurchläuft; Dichte an der Breite orientiert
  (`ChartDef.barbGap`, Standard 34 px Mindestabstand), sonst Symbolteppich bei
  vielen Stunden. **Die Fiedernlänge folgt dem TATSÄCHLICHEN Abstand**, nicht
  einer festen Zahl: bei dichter Reihung liefen 30-px-Fiedern ineinander, die
  Fahnen stehen quer zum Schaft und brauchen rundum Platz. Der Föhn-Kamm setzt
  `barbGap: 10` — dort ist die RICHTUNG das Kriterium (Sektor SO–WSW bzw.
  WNW–NO) und ein Wechsel über wenige Stunden entscheidet, also so dicht wie
  lesbar statt im 6-h-Standardabstand. Unter ~9 px (`MIN_BARB_GAP`) wird eine
  Fieder zum Strich, deshalb dort ein Boden; der Abstand rastet weiter auf
  runde Stundenvielfache. Die Fieder ersetzt den früheren Richtungspfeil, weil sie
  Richtung UND Stärke in einem Symbol trägt: Schaft in die Richtung, AUS der
  der Wind kommt (`wind_direction_10m` ist meteorologisch genau diese
  Herkunftsrichtung — hier also KEIN +180° wie beim alten Pfeil), Fahnen im
  Uhrzeigersinn zum Schaft (Nordhalbkugel-Konvention), Wimpel = 50 kt, ganze
  Fieder = 10 kt, halbe = 5 kt, gerundet auf 5 kt, < 2,5 kt = Kreis
  (Windstille); Umrechnung km/h → kt im Zeichner. **uPlot lässt das
  Strichmuster der zuletzt gezeichneten Serie im Canvas-Kontext stehen** — die
  gestrichelten Böen färbten damit die Fiedern gestrichelt ein. Jeder eigene
  Draw-Hook setzt deshalb als Erstes `ctx.setLineDash([])`; das gilt für alle
  Zeichner in `render/wxsymbols.ts` und die Plugins in `ChartStack.tsx`.
  **Die Werteanzeige ist das LETZTE Plugin und liegt damit ganz oben.** Alle
  Zeichner (Fiedern, Achtel-Kreise, Kriterienzellen, Symbole, Schleier) laufen
  im `draw`-Hook, die Registrierungsreihenfolge in `ChartStack` IST die
  Zeichenreihenfolge — stand die Anzeige vorher, verschwanden ihre Kästchen
  unter den Kriterienzellen und den Achtel-Kreisen, also genau in den Zeilen,
  deren Werte man nur dort ablesen kann. Nicht nach vorn sortieren.
  **Die senkrechte Achsen-Chrome zahlt man JE ZEILE, deshalb ist sie knapp
  gesetzt**: `X_AXIS_SIZE` = 20 statt uPlots Vorgabe 30 (die ist für eine
  Achse mit Datumsbeschriftung gedacht; hier stehen zwei Ziffern in 10-px-
  Schrift) und `DAY_STRIP_H` = 16. Über sechs Zeilen sind die gesparten ~14 px
  eine halbe Diagrammhöhe, die vorher zwischen den Kurven leer stand. Dazu
  `.meteo-stack` mit 2 px Abstand und eine Kopfzeile mit `line-height: 1.2`.
  Die Mindesthöhen der Zeilen (inline in `ClassicMeteogram`, 88 px bzw. 46 für
  die Symbolzeile) sind NUR das Sicherheitsnetz für kleine Fenster — zu groß
  gesetzt reißt ihre Summe über die Fensterhöhe, `.meteo-stack` scrollt, und
  dann wächst KEINE Zeile mehr per Flex, obwohl Platz da wäre.
  **Alle Zeilen eines Stapels reservieren links UND rechts dieselbe
  Achsenbreite** (`Y_AXIS_SIZE`/`RIGHT_AXIS_SIZE`, blind beschriftet, wo nichts
  steht) — Achsen einfach auszublenden (`show: false`) hat die Zeitachsen der
  Zeilen gegeneinander verschoben, und ein Meteogramm liest man senkrecht.
  **Die Zeitachse endet am Horizont des GEWÄHLTEN Modells**, nicht am
  16-Tage-Raster (`gridMs` filtert auf `modelHorizonEnd(model)`): das
  klassische Meteogramm zeigt genau EIN Modell, und eine Achse, die vier
  Fünftel leer bleibt, weil AROME nach 60 h endet, sieht aus wie ein Fehler und
  drückt die interessanten zweieinhalb Tage in einen schmalen Streifen links.
  In den Punktprognosen ist das bewusst ANDERS — dort liegen mehrere Modelle
  übereinander, die gemeinsame Achse muss das längste tragen und die kürzeren
  werden schraffiert. Die Kopfzeile nennt den Horizont in Stunden, damit die
  unterschiedliche Achsenlänge erklärt ist.
  Die **Datumskennzeichnung steht unter JEDER Zeile** (`dayRow`, gezeichnet
  vom `dayMarkPlugin`): der Trennstrich bei 00 UTC läuft durch die
  Diagrammfläche UND weiter bis in den Datumsstreifen darunter, das Datum
  steht links daneben — also am Anfang des Tages, den es benennt. Nur unter
  der untersten Zeile war es unübersichtlich: wer die Windzeile liest, müsste
  über vier Diagramme hinweg nach unten suchen, welcher Tag gilt. Bewusst ein
  PLUGIN und keine Achsenbeschriftung — uPlot zentriert Achsentexte auf dem
  Tick, das Datum soll aber am Strich anliegen; die Achse reserviert nur die
  Höhe (`DAY_STRIP_H`). Die Tagesgrenzen werden EINMAL beim Plot-Aufbau aus
  dem Zeitraster bestimmt (`dayMarks`) — die Stunde je Punkt über `Intl` zu
  prüfen kostete bei jedem Neuzeichnen tausende Formatierungen. Schrift hell
  und fett (`DAY_FONT`, 13 px), bei schmalem Fenster fällt sie auf den
  Wochentag allein zurück (Breite je Tag aus `u.bbox`/`u.scales.x`). Gezeichnet
  wird im `drawAxes`-Hook, damit der Strich UNTER den Kurven liegt.
  Die **Nachtschattierung** ist kräftig und leicht ins Blaue gezogen
  (`NIGHT_FILL`) — der Farbstich unterscheidet schneller als reines
  Abdunkeln — und bekommt an den Wechseln eine feine Kantenlinie
  (`NIGHT_EDGE`), sonst liegt der Übergang unscharf im Verlauf.
  **Die y-Skalen sind DYNAMISCH, aber nach unten gedeckelt**
  (`ChartDef.minTop` bei `zeroBased`-Zeilen, Niederschlag 2 mm/h, Wind
  25 km/h): ein Starkregenereignis zieht die Achse frei mit, ohne den Boden
  liefe sie aber bei 0,2 mm/h Nieselregen bis 0,22 und ein Hauch Sprühregen
  sähe aus wie ein Wolkenbruch.
  **Fläche ZWISCHEN zwei Kurven** (`Curve.fillTo` → Index einer anderen Kurve,
  Plugin `bandPlugin`): gefüllt wird der Streifen hinunter zu jener Kurve statt
  bis zur Nulllinie — beide behalten ihre echten Werte, es wird nichts addiert.
  Damit lässt sich eine Größe nach INEINANDER liegenden Klassen einfärben (Föhn:
  ocker bis „≥ 4 hPa", rot soweit „≥ 8 hPa"). Muss ein eigener Zeichner sein,
  weil uPlots `fillTo` nur EINEN Skalar als Boden nimmt; mit `fill` bis zur
  Nulllinie überdeckte die obere Fläche die untere. Läuft im `drawAxes`-Hook
  NACH den Bezugslinien — über Gitter und Linien, unter den Kurven, damit beide
  Kanten sichtbar bleiben. **Kein Stapeln**: ein früherer `stackOn`-Versuch
  addierte die Kurven und brauchte damit eine Achse über 100 % — bei
  geschachtelten Klassen ist das die falsche Rechnung.
  **Bereich jenseits des Modellhorizonts ausgrauen** (`ChartDef.veil`, Plugin
  `veilPlugin`): Schleier + feine Schraffur + Kante am Horizont, im `draw`-Hook
  und als LETZTES Plugin registriert — der Schleier soll alles dämpfen, was
  dort hineinragt (Gitter, Bezugslinien, Fiedern, Kriterienzellen). Die
  Schraffur ist nicht Zierde: sie unterscheidet „keine Daten" von „Wert null",
  ein flacher Nullverlauf sähe sonst genauso leer aus. Beschriftung nur, wenn
  sie ganz hineinpasst (schmale Kacheln, niedrige Kriterienleiste → weg).
  Weitere Bausteine in `ChartDef`: `night` (Tag/Nacht-Fläche, `drawClear` —
  also unter Gitter und Kurven), `refLines` (0-°C-Linie, Standarddruck
  1013,25 hPa; `drawAxes`), `minSpan`/`ySpace` (Mindestspanne und Tickdichte
  der y-Achse — der Luftdruck schwankt über Tage um wenige hPa, uPlot legte
  dafür eine Achse mit einer EINZIGEN Beschriftung an),
  `rightAxis` + `Curve.rightAxis` (zweite Größe mit eigener Einheit, z. B.
  Niederschlagswahrscheinlichkeit in % neben mm/h), `symbols` (Wettersymbol-
  zeile), `Bands.octas` (Achtel-Kopfzeile). **Zeitachse ist UTC, NICHT die Ortszeit des
  gewählten Punkts** (steht auch so in der Kopfzeile) — `openmeteo.ts` fragt
  überall explizit `timezone: 'UTC'` ab, eine echte Ortszeit bräuchte einen
  zusätzlichen Zeitzonen-Lookup je Koordinate, den es im Projekt nicht gibt.
  `ChartRow` bekommt dafür einen eigenen `formatTick`/`xSpace` (Stundenachse
  zeigt nur noch „06"/„12" etc.) PLUS `dayRow` — eine echte ZWEITE x-Achse
  (uPlot erlaubt mehrere Achsen zur selben Scale, hier zwei mit `scale:'x'`),
  deren `filter` nur Tagesgrenzen (00 UTC) durchlässt: eigene Zeile mit
  Wochentag+Datum UND eine durchgehende Trennlinie über die volle Höhe DIESER
  Zeile (jede Zeile bekommt ihre eigene, da jede ein unabhängiges
  uPlot-Canvas ist — dieselbe Wiederholung wie die Stundenachse schon hat;
  beschriftet wird über `dayRow`/`dayGrid` aber nur die unterste).
  **Bewölkung ist geschichtet, nicht als Summe** (`cloud_cover_low/mid/high`
  plus die Gesamtbedeckung `cloud_cover`) und wird NICHT als Linie gezeichnet,
  sondern als ZWEI Ebenen übereinander (`ChartDef.octaRows` statt `curves`,
  gerendert vom `octaRowsPlugin` — reiner Canvas-Draw-Hook, uPlot bekommt nur
  eine leere Dummy-Serie fürs x-Scale-Setup): darunter die **Schattierung je
  Stunde und Höhenniveau** (lückenloser Verlauf, zeigt WO die Bewölkung
  sitzt), darüber in gröberem Abstand der **Achtel-Kreis** (sagt „5 von 8"
  genau, wo die Fläche nur „ungefähr" sagt). Vier Zeilen von oben
  nach unten: Gesamt, dann Hoch/Mittel/Tief in der Reihenfolge, in der die
  Schichten am Himmel stehen. **SONNIG = HELL, BEDECKT = DUNKEL**
  (`CLOUD_SHADE_CLEAR/OVERCAST`, 128 → 42) — die Fläche zeigt, wie der Himmel
  aussieht, und muss nicht übersetzt werden. Das dunkle Ende bleibt bewusst
  ÜBER der Panelfläche (~25): läge „bedeckt" genau darauf, wäre es von „kein
  Wert" nicht zu unterscheiden. **Der Preis ist die Symbolfarbe** — sie kann
  nicht fest sein: ein helles Symbol verschwindet über „sonnig", ein dunkles
  über „bedeckt". **Der Achtelkreis hat deshalb ZWEI Farben**
  (`drawOctaSymbol(..., cloudInk, clearInk)`): der bewölkte Sektor dunkel, der
  freie Himmel hell — bei 6/8 also drei Viertel dunkel, ein Viertel hell,
  dieselbe Leserichtung wie die Fläche darunter. Mit EINER Farbe stünde „hell"
  je nach Stufe einmal für Wolke und einmal für freien Himmel. Das Symbol trägt
  seinen Kontrast selbst und braucht keine Anpassung an den Untergrund: ein
  heller Ring sichert die Silhouette auf DUNKLEM Grund (8/8 auf bedeckter
  Fläche), die Umrandung in `cloudInk` die Kante auf HELLEM (0/8 auf sonniger).
  Nur die Achtel-ZAHL daneben liegt direkt auf der Fläche und dreht ihre Farbe
  über `octaInk()` am Grauwert unter ihr (nicht je Zeile — die Helligkeit
  wechselt von Stunde zu Stunde). Die Achtel-ZAHL steht nur
  in der Gesamtzeile (`withNumber`) — viermal beziffert wäre die Fläche wieder
  zugestellt. Die **Zeilenbeschriftung kommt aus der linken y-Achse** (Splits
  auf den Zeilenmitten, y-Range = Zeilenanzahl), nicht aus dem Plugin: so steht
  sie außerhalb der Fläche und verdeckt keine Symbole. Symboldichte an der
  Breite orientiert (~30 px Mindestabstand), Radius zusätzlich am Abstand
  gedeckelt, damit sich die Kreise nie berühren.
- **Verifikation** (`VerifyPanel.tsx`, Kern `verify.ts`, AppView `verify`) — der
  einzige Bereich, der beide Welten der Seite zusammenbringt (Open-Meteo-Läufe
  UND gemessene GeoSphere-Stationswerte) und der einzige, der rückwärts schaut:
  „wie gut war die Vorhersage?" Verglichen werden TAGESEXTREM (Tmax/Tmin) und
  TAGESNIEDERSCHLAG — Größen, die `klima-v2-1d` direkt führt, auf der Messseite
  also ohne Näherung.
  **Kein eigenes Archiv nötig** (`fetchPastRuns`, eigener Endpunkt
  `historical-forecast-api.open-meteo.com`, aber derselbe `apiGet`-Pfad wie das
  Ensemble): Variablen-Suffixe `_previous_dayN` liefern zu einem vergangenen
  Zeitpunkt das, was N Tage FRÜHER dafür vorhergesagt worden war. Live geprüft
  (2026-09-01) und alles davon nicht-offensichtlich: die Suffixe gibt es **nur
  stündlich** (`temperature_2m_max_previous_day1` → HTTP 400, Tagesextreme
  rechnet `verify.ts` selbst); N = 1…7, **N = 8 ist durchgehend null**; auf der
  NORMALEN Forecast-API liefern dieselben Suffixe HTTP 200 mit lauter null (die
  Falle aus SPEC §6) — nur der historische Endpunkt trägt sie; das Archiv
  reicht mindestens bis Mitte 2024. **`previous_dayN` ist ein früherer LAUF zum
  selben Zeitpunkt, keine Zeitverschiebung** — gemessen: RMS gegen den besten
  Wert 0,98 K (N=1) bzw. 1,52 K (N=2) beim selben Zeitstempel, gegen den um
  24 h verschobenen 2,99 K.
  **WAS `previous_dayN` ist, wurde gemessen — und die erste Herleitung war
  falsch.** Es ist der Stand, den die Vorhersage **n·24 Stunden VOR dem
  jeweiligen Zeitpunkt** hatte: ein GLEITENDER Vorlauf, kein fester Modelllauf.
  **Gleitender Vorlauf als Referenz** — und je nach Zeitpunkt und Modell steckt
  dahinter ein ANDERER Lauf, denn die Modelle laufen unterschiedlich oft (AROME
  Austria und ICON-D2 alle 3 h, IFS alle 6 h, andere alle 12 h; die Registry
  führt das als `updateIntervalHours`). Zwei unabhängige Messungen: die Reihe
  springt an der Tagesgrenze nicht
  (Stundenänderung über 00 UTC 0,69 K gegen 0,92 K sonst — genau wie die
  durchgehende Reihe), und der Fehler ist über den Tagesverlauf flach
  (0,82/0,83/0,81/0,90 K je Sechs-Stunden-Block). Ein fester 00-UTC-Lauf müsste
  beides zeigen: Sprung um Mitternacht, über den Tag wachsender Fehler. Die
  frühere Deutung („Lauf von 00 UTC des Vortags, +24–47 h") war allein aus den
  Modellhorizonten hergeleitet und hielt der direkten Messung nicht stand. Aus
  WELCHEM konkreten Lauf (00/06/12/18 UTC) der Stand stammt, gibt die API nicht
  preis, und ein bestimmter Lauf lässt sich auch nicht anfordern: `run` wird
  auf allen drei Endpunkten mit HTTP 400 abgelehnt, `model_run` wird STILL
  IGNORIERT (zwei sehr verschiedene Läufe liefern identische Daten — wieder die
  Falle aus SPEC §6). Der gleitende Vorlauf hat dafür einen methodischen
  Vorzug: jeder Tag wird beim GLEICHEN Vorhersagealter verglichen, während ein
  fester 00-UTC-Lauf über den Tag hinweg 24 bis 47 Stunden Vorlauf mischt.
  **Welche n es gibt, ist davon getrennt** und folgt empirisch
  `forecastHours ≥ n·24 + 24` (`leadsFor`): AROME Austria (60 h) und ICON-D2
  (48 h) nur n=1, ICON-EU (120 h) n=1–4, IFS (360 h) und GFS (384 h) n=1–7 —
  immer vollständig oder gar nicht, nie teilweise. Das ist eine
  Verfügbarkeitsregel der API und lässt sich aus dem gleitenden Vorlauf NICHT
  herleiten (bei 48 h Vorlauf läge AROME mit 60 h Horizont im Rahmen) — deshalb
  als gemessene Regel geführt. Leere Spalten werden gar nicht erst geholt, und
  die Beschriftung sagt „Stand 24 h vorher" statt des irreführenden
  „Lauf vom Vortag".
  **Verglichen wird die DETERMINISTISCHE Punktprognose, kein MOS.** Rohe
  Modellausgabe, auf den Punkt interpoliert. Statistisch korrigierte
  Punktvorhersagen führt die Seite zwar (DWD MOSMIX im Bereich
  „Österreich-Klima → Vorhersage"), sie lassen sich hier aber NICHT
  verifizieren: MOSMIX hat kein öffentliches Archiv vergangener Läufe, genau
  deshalb läuft die Verifikation über Open-Meteo.
  **Die Stationshöhe wird mitgegeben** (`elevation`), und das ist kein Detail:
  Open-Meteo rechnet die Temperatur auf die Höhe herunter, die sein
  Geländemodell an der Koordinate annimmt — am Sonnblick 2962 statt 3109 m.
  Gemessen (ECMWF IFS, 20 Tage, Vorlauf 1): der Bias fällt von +2,02 auf
  +1,06 K, der MAE von 2,08 auf 1,62. An Flachlandstationen ändert sich fast
  nichts (Hohe Warte 1,71 → 1,66; Salzburg unverändert) — die Korrektur
  schadet also nirgends und rettet die Bergstationen davor, einen
  Höhenunterschied als Modellfehler auszuweisen. Gilt auch für die
  `_previous_dayN`-Reihen (live geprüft).
  **Der Tag ist der KLIMATAG 18–18 UTC auf BEIDEN Seiten, NICHT 00–24 UTC.**
  GeoSphere bildet die Tagesextreme von 19 MEZ des Vortags bis 19 MEZ, also
  18:00 UTC (D−1) bis 18:00 UTC (D) — die deutsch-österreichische Konvention,
  in keiner API-Doku vermerkt. GEMESSEN (2026-09-03, `tlmax`/`tlmin` aus
  klima-v2-1d gegen die selbst gebildeten Extreme der 10-Minuten-Reihe, 5
  Stationen × 60 Tage = 298 Stationstage): mit 18–18 UTC bleibt ein mittlerer
  Restfehler von 0,18 K (tlmax) bzw. 0,06 K (tlmin) — das ist nur noch die
  10-Minuten-Abtastung gegen ein stetiges Extremum; mit 00–24 UTC sind es
  0,35/0,36 K im Mittel und **7,3 K im Extremfall**. Das Optimum ist scharf,
  jedes benachbarte Fenster deutlich schlechter. Die Grenze ist halboffen:
  18:00 zählt zum FOLGENDEN Tag (`climateDay` in `verify.ts`, gemessen).
  **Ohne das war die Verifikation an Frontdurchgangstagen grob falsch, und
  zwar bei ALLEN Modellen gleichzeitig im selben Vorzeichen** — genau das
  Muster, an dem man einen Definitionsfehler von einem Modellfehler
  unterscheidet: an den meisten Tagen fallen beide Fenster zusammen (das
  Maximum liegt gegen 13–15 UTC), sie laufen aber auseinander, wenn nach einem
  heißen Tag eine Front durchgeht — der Abend des Vortags ist dann wärmer als
  der ganze Folgetag und setzt dessen Klima-Tagesmaximum. Wien Hohe Warte,
  29.08.2026: Klima-Tagesmaximum 29,5 °C (aus dem Abend des 28.), Maximum über
  den Kalendertag nur 26,2 °C; die Abweichungen der fünf Standardmodelle
  standen dadurch bei −1,4…−2,6 K statt richtig −0,1…+1,8 K. Über 60 Tage
  sinkt der MAE dadurch z. B. von 0,97 auf 0,84 K (best_match) und der
  Kaltbias um ~0,2 K. Konsequenz für die Abfrage: die Vorhersagereihe wird
  einen Tag FRÜHER geholt (`fcStart`), sonst fehlten dem ersten Klimatag seine
  sechs Abendstunden und die erste Zeile bliebe leer. Ein Tag zählt nur mit
  ≥ 20 Stundenwerten; angeschnittene Ränder ergäben sonst Scheinextreme.
  **Der NIEDERSCHLAGSTAG ist ein anderer: 06–06 UTC, und er läuft VORWÄRTS.**
  Nicht dieselbe Konstante mit anderem Vorzeichen zu erwarten ist der zweite
  Fallstrick — GeoSphere führt `rr` als 24-Stunden-Summe zum Termin 06 UTC, Tag
  D umfasst also [D 06:00 UTC, D+1 06:00 UTC): der Regen des frühen Morgens von
  D+1 zählt noch zu D (Ablesung 07 MEZ, der Vortag bekommt sie). Ebenso
  gemessen (nur nasse Tage, n = 126): 06–06 UTC lässt 0,03 mm Restfehler stehen
  (größter 1,10 mm), 00–24 UTC 1,14 mm (16,0 mm) und das Extremtag-Fenster
  18–18 UTC 3,66 mm (26,6 mm). An TROCKENEN Tagen bleibt eine Differenz von
  ~0,9 mm, die kein Fenstereffekt ist: die 10-Minuten-Reihe zählt Tau- und
  Störimpulse mit, die der geprüfte Tageswert auf 0 setzt — deshalb wird nur
  über nasse Tage gemessen. Das Fenster steht deshalb in der Zielgrößen-Registry
  (`Target.offsetH`) und NICHT in einer gemeinsamen Konstante; die 06-UTC-Grenze
  fällt auf ein Vielfaches von 3 h, die IFS/AIFS-Dreistundenblöcke werden also
  nicht angeschnitten. Konsequenz für die Abfrage: bei Extremwerten reicht sie
  einen Tag FRÜHER, beim Niederschlag einen Tag SPÄTER (`fcStart`/`fcEnd`).
  **Die Darstellung ist TAG FÜR TAG, nicht Modell × Vorlauf.** Die naheliegende
  Matrix aus Fehlermaßen braucht lange Reihen, um überhaupt etwas zu sagen —
  über 14 Tage (Wien Hohe Warte, live) SANK der IFS-Fehler mit LÄNGEREM Vorlauf
  (2,01 K bei +1 d, 1,84 K bei +5 d), reines Rauschen; erst über 90 Tage wächst
  er bei jedem Modell monoton (IFS 1,69 → 2,51 K, AROME Austria gewinnt auf
  +1 Tag mit 0,95 K, wie man es vom Lokalmodell erwartet). Die tägliche Frage
  ist aber „wie lief es diese Woche", und darauf antworten die konkreten Tage
  nebeneinander: Messung, Vorhersage je Modell, Differenz — Fehlermaße nur als
  eine Fußzeile. Drei Zeiträume, 5 (Voreinstellung) / 10 / 20 Tage,
  nach oben bewusst gedeckelt: ein belastbarer Vergleich bräuchte Monate, und
  die Legende stuft das ab (unter `ROUGH_DAYS` „kein Modellvergleich", darüber
  „grobe Reihung"). Bei 20 Zeilen klebt der Tabellenkopf mit (Modellnamen
  dürfen umbrechen statt die Spalte breitzuziehen). **GENAU EIN
  Scroll-Container**, nämlich `.verify-body`: ein zweiter, geschachtelter mit
  eigener `max-height` verschluckte bei 20 Tagen die untersten Zeilen, und die
  klebende Fußzeile legte sich zusätzlich darüber — sie klebt deshalb nicht
  mehr. Die Tabelle ist inhaltsbreit (`align-self: flex-start`), nicht über die
  Seite gezogen.
  **Über der Tabelle steht in einem Satz, WAS gemessen wurde**: Größe, Station
  samt Seehöhe, das Zeitfenster (Klimatag 18–18 UTC), der Zeitraum mit Jahr und die
  Zahl der Messtage — eine Zahlenmatrix ohne diesen Bezug ist nicht lesbar. Die
  Tagesspalte trägt das volle Datum inklusive Jahr. Das Diagramm hat KEINE
  Tagesleiste: die ist für stündliche Reihen gedacht und sagt bei Tageswerten
  nichts, was die Datums-Ticks nicht schon zeigen.
  **Der bloße Fehlerbetrag beantwortet die Frage nicht, die man hat** — deshalb
  zwei Skill Scores (`verify.ts`, mit Vitest getestet). **Skill gegen die
  PERSISTENZ** (`skillScore`, `persistenceForecast`): `1 − MSE(Modell)/MSE(„wie
  gestern")`. „MAE 1,5 K" ist in einer stabilen Hochdrucklage schwach und in
  einer Woche mit drei Frontdurchgängen gut — die Zahl allein sagt nicht, wie
  schwer die Aufgabe war. Persistenz ist die ehrlichste verfügbare Referenz:
  kostet keine zusätzlichen Daten und ist an JEDER Station definiert, anders
  als eine Klimatologie (die gäbe es nur für die ~207 Stationen mit vollem
  Normal). Ihre Grenze steht in der Beschriftung: bei +7 Tagen schlägt sie
  jedes Modell mühelos, ein hoher Wert heißt dort „besser als raten". Dafür
  wird die Messung einen Tag früher geholt als gezeigt (`obsStart`) — sonst
  verlöre der Score die erste Zeile. Ist die Referenz fehlerfrei (zwei trockene
  Tage hintereinander), gibt es KEINE Zahl statt einer 0.
  **Beim Niederschlag ist der mittlere Fehler in mm fast wertlos**, und das ist
  der Grund für die **kategorische Bewertung** (`contingency`/`pod`/`far`/
  `frequencyBias`/`ets`, Block unter der Tabelle): gemessen sind 174 von 300
  Stationstagen trocken — ein Modell, das NIE Regen ansagt, bekommt damit einen
  glänzenden MAE und hat nichts geleistet. Dazu die doppelte Bestrafung (ein
  Schauer zwölf Stunden zu früh zählt als verpasst UND als Fehlalarm). Gefragt
  ist deshalb nicht „wie viele mm daneben", sondern „hat es Regen angesagt, und
  kam welcher": Vierfeldertafel über eine wählbare Schwelle (0,1 / 1 / 5 /
  10 mm), daraus Trefferquote (POD), Fehlalarmanteil (FAR), Häufigkeitsbias und
  **ETS** (Gilbert). Der ETS ist die Kennzahl, wegen der es den Block gibt: er
  zieht die Treffer ab, die bei gleicher Ansagehäufigkeit schon durch Zufall
  zustande kämen — in einem trockenen Zeitraum trifft „selten Regen" oft genug
  zufällig, und ohne die Korrektur sähe das nach Können aus. Live gemessen
  (Wien Hohe Warte, 60 Tage, Vorlauf 1, ≥ 1 mm, 11 Regentage): der MAE trennt
  die fünf Modelle kaum (2,00–2,40 mm), der ETS trennt sie fast 2:1
  (ICON-EU 0,38 … AROME Austria 0,20) — und IFS fällt mit Häufigkeitsbias 1,45
  als zu nass auf, was im MAE gar nicht sichtbar ist. **Die ZÄHLUNGEN stehen
  mit in der Tabelle**, nicht nur im Tooltip: ein ETS von 0,6 aus vier
  Regentagen ist eine andere Aussage als einer aus vierzig. Unter `MIN_EVENTS`
  (10) eingetretenen Ereignissen warnt der Block sichtbar — dafür gibt es jetzt
  auch einen **60-Tage-Zeitraum** (rund 25 Regentage statt 8 bei 20 Tagen).
  Die Zelleinfärbung hat Stufen JE GRÖSSE (`Target.errSteps`): 2,6 K sind ein
  grober Fehlgriff, 2,6 mm Tagesniederschlag sind Alltag.
  **Geladene Daten hängen an Zielgröße UND Station** (`dataKey`, siehe
  `VerifyPanel`): sonst deutet die Tabelle für die Dauer des Nachladens die
  ALTEN Daten nach der NEUEN Regel. Beim Sprung Temperatur → Niederschlag war
  das nicht subtil — `mode: 'sum'` summierte die noch geladenen 24
  Stundenwerte von ~20 °C zu „480 mm" Tagesniederschlag, aufgetragen gegen
  eine Messung von 3 mm. Beim Stationswechsel ist derselbe Fehler
  heimtückischer, weil das Ergebnis plausibel aussieht. Alles Abgeleitete
  verwirft den Zustand, solange der Schlüssel nicht passt: lieber „—" als eine
  Zahl, die zu etwas anderem gehört.
  **DASS IFS UND AIFS BEIM TAGESMAXIMUM SCHLECHT DASTEHEN, IST ECHT** — dreimal
  gegengeprüft (2026-09-03), weil es wie ein Fehler aussieht und keiner ist.
  (a) Die eigene Tagesreduktion stimmt exakt mit Open-Meteos `daily=
  temperature_2m_max` überein (Δ 0,00 K über 13 Tage × 3 Modelle). (b) Kein
  3-Stunden-Artefakt: die Reihen sind echt stündlich (keine wiederholten
  Differenzen), und die Tagesmaxima liegen nicht gehäuft auf dem 3-h-Raster
  (22 von 60 = Zufallsniveau, wie bei den stündlichen Modellen auch). (c) Keine
  Höhenfrage: Open-Meteo rechnet JEDES Modell auf sein eigenes 90-m-DEM herunter
  und meldet für alle Modelle dieselbe Punkthöhe — die mitgegebene Stationshöhe
  ändert an diesen Stationen ±0,1 K.
  Der MECHANISMUS ist die gestauchte TAGESAMPLITUDE. Mittleres Tmax−Tmin über
  60 Tage gegen die Messung: AIFS 9,1–10,5 K gegen gemessene 12,5–13,9 K, also
  ein Viertel bis ein Drittel des Tagesgangs verloren — bei jeder der fünf
  geprüften Stationen der kleinste Wert aller Modelle. Das erklärt das
  Vorzeichenmuster: AIFS ist beim Tmax das SCHLECHTESTE Modell (Wien Bias
  −1,42 K) und beim Tmin das BESTE (+0,68 K, MAE 1,10). Es wird nach Westen
  dramatisch schlimmer — Tmax-Bias Wien −1,4 / Salzburg −3,1 / Graz −3,0 /
  Klagenfurt −3,7 / **Innsbruck −4,9 K**, und MAE = |Bias| an jeder Station,
  also ein reiner Sockel und kein Streuen. IFS zeigt dasselbe abgeschwächt
  (Wien −1,27, Innsbruck −2,49).
  **ZWEI URSACHEN, und die VORLAUFZEIT trennt sie** — eine Verwischung durch
  die Verlustfunktion WÄCHST mit dem Vorlauf, ein Auflösungsproblem ist
  KONSTANT. Gemessen über die Vorläufe 1–6 Tage:
  IFS ist flach (Wien −1,27 → −0,95, Innsbruck −2,49 → −2,60) — reine
  REPRÄSENTATIVITÄT, ein Gitterkasten gegen einen Messplatz. AIFS wächst
  monoton (Wien −1,42 → −2,65, Innsbruck −4,87 → −5,84) bei gleichzeitig
  schrumpfender Amplitude (Innsbruck 9,09 → 8,49 K). AIFS hat also BEIDES: den
  großen konstanten Sockel — 0,25° gegen die nativen ~9 km von IFS, dazu die
  schon geglättete ERA5-Trainingsbasis — PLUS rund 0,2 K je Vorlauftag
  Verwischung, die IFS nicht zeigt. Die ist das bekannte Verhalten
  gitterpunktweise MSE-trainierter KI-Modelle: der Vorhersagewert, der den
  erwarteten quadratischen Fehler minimiert, ist der ERWARTUNGSWERT der
  Verteilung, nicht eine plausible Einzelrealisierung — glatte Felder,
  gedämpfte Extreme, und ein Tagesmaximum ist ein Extremwert. (ECMWF hat für
  die Ensemble-Variante genau deshalb auf eine CRPS-Verlustfunktion
  umgestellt.) **Der DOMINANTE Term ist aber die Auflösung, nicht die
  Verlustfunktion** — in Innsbruck sind von −4,9 K bei +1 Tag etwa −2,5 K das,
  was IFS auch hat; die Verwischung legt bis +6 Tage knapp 1 K drauf. Die
  frühere Notiz hier hatte das umgedreht.
  In den Alpen ist ein 0,25°-Global am Talboden schlicht nicht auflösbar; die
  Lokalmodelle liegen dort um Größenordnungen besser (AROME Austria Innsbruck
  −0,13 K). **Nicht erneut als Bug untersuchen** — wer es doch tut, fängt bei
  (a)–(c) an.
  **Markiert wird das beste Modell ÜBER DEN ZEITRAUM, nie je Tag.** Je Tag das
  im Nachhinein nächstliegende Modell zu zeigen ist kein Vergleich, sondern
  Rosinenpicken: gemessen (Wien Hohe Warte, 20 Tage, Vorlauf 1) käme man damit
  auf **0,59 K** statt 1,16 K des besten Einzelmodells — eine Zahl, die niemand
  im Voraus hätte haben können. `best_match` (Open-Meteos eigene Mischung) ist
  als Bezug voreingestellt und lag dort NICHT vorn (1,33 K gegen 1,16 K von
  GFS). **Das Abweichungsdiagramm neben der Tabelle ist RAUS**
  (auf Wunsch): die Verläufe standen schon als Spalten daneben, und der Platz
  gehört jetzt der kategorischen Bewertung darunter. `verify-swatch` und der
  `ChartRow`-Import sind mit weggefallen.
  Die Stationsauswahl ist ein **Suchfeld mit `datalist`**, kein Dropdown: 290
  Stationen findet man scrollend nicht, und die native Variante filtert beim
  Tippen ohne eigenes Widget. Beim TIPPEN greift nur der exakte Name (so
  übernimmt ein Klick in der Vorschlagsliste sofort), beim VERLASSEN und bei
  Enter wird der Text aufgelöst: exakt → Namensanfang → Teiltreffer, sonst
  zurück auf die geltende Auswahl. **Kein Effekt darf ein leeres Feld
  nachfüllen** — genau das kämpfte gegen jedes Löschen an: die Rücktaste stellte
  sofort wieder „Wien Hohe Warte" her, und man kam nie dazu, „Graz" zu tippen.
  Vorbelegt wird deshalb EINMAL über ein Ref, nicht reaktiv.
  Die Modell-Auswahlliste zeigt nur Modelle, die den gewählten Vorlauf tragen
  können — bei +3 Tagen fallen AROME Austria und ICON-D2 heraus, statt als
  leere Spalten zum Fehlschluss einzuladen.
  **Unter der Tabelle steht kein Fließtext mehr.** Was die Zahlen bedeuten,
  steht dort, wo sie stehen: die Spaltenköpfe tragen „Wert / Δ", die
  Fußzeile ihre Tageszahl, die Erklärungen samt Warnung zur Reihenlänge sitzen
  in den Tooltips, und ein Merker in der Werkzeugleiste („⚠ kein
  Modellvergleich") warnt bei kurzen Reihen sichtbar. Ein Absatz Erklärung
  unter einer Tabelle wird nicht gelesen.
  **Vergangene Läufe werden GECACHT, und das ist Budget, keine Optimierung**
  (`api/pastRuns.ts` = reiner Kern mit Tests, Cache in `fetchPastRuns`): was
  vor drei Tagen für vorgestern vorhergesagt wurde, ändert sich nie mehr —
  einmal holen und für immer behalten ist die richtige Semantik. Ohne das
  kostete JEDER Handgriff die volle Runde: einen Haken bei einem weiteren
  Modell zu setzen holte ALLE Modelle neu, ein Blick auf einen anderen
  Zeitraum und zurück ebenso; bei neun Modellen über 60 Tage der Unterschied
  zwischen einem und neununddreißig gewichteten Requests. ZWEI Stufen: exakter
  Treffer (IndexedDB, überlebt den Reload — derselbe Store wie `atcache.ts`,
  Schlüsselpräfix `verify|`) und **überdeckender** Treffer, bei dem ein schon
  geholter GRÖSSERER Zeitraum zugeschnitten wird (`sliceRuns`) — wer von 60 auf
  20 Tage zurückgeht, zahlt nichts. Der Bereichsindex dazu lebt nur in der
  Sitzung. TTL nur, wenn der Zeitraum den HEUTIGEN Tag einschließt (die
  Niederschlagsabfrage reicht bis heute 06 UTC und ist noch nicht fertig);
  alles, was vorher endet, gilt für immer. `sliceRuns` schneidet ALLE Reihen
  über DIESELBEN Indizes — eine gegen die Zeitachse verrutschte Lead-Reihe
  sähe plausibel aus und wäre um Stunden verschoben.
  **Die Modell-Liste ist nach SKALA gruppiert, nicht alphabetisch**
  (`modelScale`/`groupModelsByScale`/`compareModelsByScale` in `config/
  models.ts`, mit Tests): Lokalmodelle (regional, ≤ 4 km) · Regionalmodelle ·
  Globalmodelle · Mischungen, darin nach Gitterweite fein → grob. Interessant
  ist der Vergleich 2,5-km-Lokalmodell gegen 25-km-Global — und der Anbieter
  als Stichentscheid bei gleicher Auflösung sorgt dafür, dass `ecmwf_ifs025`
  und `ecmwf_aifs025_single` NEBENEINANDER stehen und GFS mit denselben 25 km
  nicht dazwischenrutscht (ein Test hält das fest). Die **Auflösung steht
  sichtbar an jedem Eintrag** und in jedem Modell-Tooltip (`resolutionLabel`,
  `resolutionKm = 0` → „variabel"): ohne sie ist nicht zu sehen, warum ein
  Globalmodell im Alpental danebenliegt — siehe der AIFS-Befund oben.
  Der **Bias** steht klein unter jedem Wert: derselbe Fehlerbetrag bedeutet bei
  +2 K Schieflage etwas anderes (systematisch, korrigierbar) als bei 0 K (streut
  nur). Darin steckt auch der Unterschied zwischen Modellgitterzelle und
  Messplatz — genau deshalb ist er stationsweise interessant. Ein Request je
  Modell (alle Vorlaufzeiten in einem), Messung ein GeoSphere-Bulk-Request, für
  immer gecacht.
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
- **Attribution ist Lizenzbedingung, nicht Höflichkeit** (`Attribution.tsx`,
  `.attribution` in `index.css`): Open-Meteo (CC BY 4.0), GeoSphere (CC BY 4.0)
  und DWD (GeoNutzV) verlangen Namensnennung, SPEC §13 führte das als offen.
  Jeder Bereich trägt jetzt eine Quellenzeile mit Links. Die Anbieterliste der
  Vorhersagebereiche wird aus der Registry ABGELEITET (`ModelDef.provider`),
  nicht gepflegt — ein neues Modell bringt seinen Anbieter mit. Für eine Seite,
  die Modelle nebeneinanderstellt, ist das nicht nur Pflicht, sondern die
  Information selbst: wer ICON gegen IFS vergleicht, sollte wissen, dass da DWD
  gegen ECMWF steht.
- **Impressum ist Pflicht, nicht Beiwerk** (`Impressum.tsx`, AppView
  `impressum`, `.legal*` in `index.css`): Rechtsrahmen ist DEUTSCHLAND, private
  nicht kommerzielle Seite. **Welche Norm gilt, entscheidet den Umfang, und der
  naheliegende Schluss ist falsch**: § 5 DDG (seit Mai 2024 an der Stelle des
  früheren § 5 TMG) gilt nur für GESCHÄFTSMÄSSIGE, gegen Entgelt angebotene
  Dienste — greift hier nicht. Pflicht ist trotzdem **§ 18 Abs 1 MStV**: Name
  und Anschrift für alle Telemedien, die „nicht ausschließlich persönlichen oder
  familiären Zwecken" dienen, und eine öffentlich erreichbare Wetterseite tut
  das nicht. Nicht kommerziell heißt also NICHT impressumsfrei. § 18 Abs 2 MStV
  (inhaltlich Verantwortlicher) entfällt — kein journalistisch-redaktionelles
  Angebot —, steht aber ausdrücklich im Text, weil es sonst die Rückfrage ist.
  **KEINE Postadresse des Anbieters steht im Quellcode** — und das gilt auch
  für die einer IMPRESSUMSVERTRETUNG, nicht nur für eine Wohnadresse: das
  Repository ist öffentlich, die Pflichtangabe gehört auf die ausgelieferte
  Seite, aber nicht in einen öffentlichen Git-Verlauf, aus dem man sie nur mit
  einem History-Rewrite wieder herausbekommt (und bis dahin kann geforkt oder
  gespiegelt sein). Name, Zustellzusatz, Straße, Ort und E-Mail kommen erst
  beim BAUEN herein (`VITE_IMPRESSUM_NAME`/`_CAREOF`/`_STREET`/`_CITY`/
  `_EMAIL`, typisiert in `src/env.d.ts`): lokal aus `.env.local` (gitignored
  über `*.local`, Vorlage `.env.example`), im Deploy aus
  GitHub-Actions-Secrets (`IMPRESSUM_*`, gesetzt in `deploy.yml`). Im fertigen
  Bundle stehen sie im Klartext — richtig so, eine Pflichtangabe muss lesbar
  sein; verborgen werden sie nur vor dem Repository. Fehlt eine Angabe, baut
  die Seite trotzdem und zeigt SELBST eine Warnung (`DETAILS_MISSING`) —
  dieselbe Regel wie beim Preset-Laden: Fehlendes wird nie still übergangen.
  `_CAREOF` ist optional und löst keine Warnung aus (nicht jeder Anbieter hat
  eine Vertretung); eine Kundennummer darin gehört ZUR Adresse, ohne sie kommt
  dort keine Post an. Geprüft: ohne Secrets kommt die Anschrift im Bundle
  nicht vor (nur der Warntext), mit Secrets schon. **Der Preis der Trennung**:
  was die Seite als Anschrift zeigt, steht nicht mehr im Code, sondern in der
  Deploy-Konfiguration — ein falsch GESETZTES Secret ersetzt sie still, ohne
  dass ein Diff es zeigt; dagegen hilft nur ein Blick auf die ausgelieferte
  Seite nach dem Deploy.
  **Bewusst KEINE einzelne Landes-Aufsichtsbehörde genannt**: Art. 77 DSGVO
  eröffnet die Beschwerde bei der Behörde des Aufenthalts, des Arbeitsplatzes
  ODER des Orts des Verstoßes, eine bestimmte zu benennen ist Praxis, aber
  nicht vorgeschrieben. Die Zuständigkeit folgt der tatsächlichen
  Niederlassung, NICHT der Zustelladresse — eine nach der Zustelladresse
  gewählte Behörde wäre die falsche, und die richtige hätte das Bundesland
  verraten, das die Vertretung gerade verdeckt. Verlinkt ist die Liste des
  BfDI. **Kein Werkzeug-Tab**, sondern ein
  stiller Link am rechten Rand der `AppNav` (`.appnav-legal`,
  `margin-left: auto`): gleichrangig neben Meteogramm und Klimakarte wäre
  falsch, schwer erreichbar wäre rechtswidrig („leicht erkennbar, unmittelbar
  erreichbar und ständig verfügbar").
  Inhaltlich ist der PFLICHTBLOCK der uninteressante Teil — der wichtige ist
  der **Haftungshinweis**: die Seite zeigt rohe Modellausgaben und ist kein
  Warndienst, für sicherheitsrelevante Entscheidungen gelten die amtlichen
  Warnungen (verlinkt: DWD, GeoSphere, MeteoSchweiz, lawinen.report). Deshalb
  hebt `.legal-emph` ihn hervor statt ihn ins Kleingedruckte zu setzen; dazu
  die Linkhaftung nach §§ 7–10 DDG.
  Die **Datenschutzerklärung ist AUS DEM CODE abgeleitet**, nicht aus einem
  Generator: keine Cookies/Tracker/Fremdfonts (geprüft), Hosting GitHub Pages
  (USA-Übermittlung, Art. 6 Abs 1 lit. f), der Browser kontaktiert
  `open-meteo.com` und `hub.geosphere.at` DIREKT — IP, Koordinaten und
  Suchbegriffe gehen dorthin, der Preis dafür, dass es keinen eigenen
  Zwischenserver gibt. MOSMIX dagegen nicht (Ingest im Build). **IndexedDB und
  localStorage brauchen eine Begründung, kein Banner**: sie fallen unter
  § 25 Abs 2 Nr. 2 TDDDG (unbedingt erforderlich) — ohne die Caches belastete
  jeder Handgriff die Kontingente der Datenanbieter erneut; das ist genau das
  Argument und steht so im Text. Aufsichtsbehörde folgt dem Sitz des
  Verantwortlichen (Konstante `DPA`).
  Der einzige Bereich mit FLIESSTEXT: `.legal-body` setzt die Grundschrift von
  12 auf 14 px hoch und deckelt die Satzbreite auf 78ch — die Dichte der
  Workbench ist für Prosa falsch. Ein Scroll-Container, wie in der Verifikation.
- **Eigene Bereiche statt Panel-Modi** (`state/appView.ts`, `AppNav`):
  Meteogramm (klassisch, `classic`) · Punktprognosen (`workbench` — der frühere
  „Meteogramm"-Bereich, nur umbenannt) · Ensemble · Vertikalprofil · Föhn ·
  Österreich-Klima · Verifikation. Ensemble und Profil waren früher Panel-MODI und sind jetzt
  eigene Bereiche — `PanelMode` kennt nur noch `'meteogram' | 'map'` (Panel
  zeigt Linienchart vs. Feld-Karte — ACHTUNG, andere Bedeutung als die
  AppView-Id `classic`; deshalb bewusst NICHT `'meteogram'` als AppView-Id
  benutzt, das wäre mit `PanelMode` verwechselbar gewesen). Die drei
  Panel-Bereiche teilen sich DIESELBEN sechs
  `PanelConfig`s: die Felder für Meteogramm (`models`/`variable`), Ensemble
  (`ensembleModel`/`ensembleVariable`) und Profil (`models`) sind ohnehin
  getrennt, ein Bereichswechsel verliert also nichts. Was gezeichnet wird,
  entscheidet `Panel.tsx` am Bereich, nicht mehr am Modus. Ältere Presets mit
  `mode: 'ensemble'|'profile'` werden NICHT verworfen: `restorePanel` lädt sie
  als Meteogramm und sagt es im `presetWarning`.
- **Layout 6/4/2/1 gilt JE BEREICH** (`layouts: Record<PanelSection, PanelLayout>`
  im Store, Standard `DEFAULT_LAYOUT` = {workbench: 4, ensemble: 1, profile: 2} —
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
