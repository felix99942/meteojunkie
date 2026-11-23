# Österreich-Klimakarte

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

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
  Bulk-Request mit HTTP 400 scheitern. **DASSELBE gilt für den MONATSdatensatz**
  (`hasMonthly`, gefiltert über `monthlyIds()`), und das hat lange gefehlt:
  klima-v2-1m kennt nicht jede Station aus klima-v2-1d — gemessen
  (2026-09-15) genau EINE der 513, die stillgelegte 610 „Meires" (1971–1974) —
  und GeoSphere lehnt deswegen den ganzen Bulk-Request mit **HTTP 403**
  („Violation for station_ids") ab. Damit war JEDER Monats-, Saison- und
  Jahresabruf der Klimakarte tot, nicht nur diese eine Station; live bestätigt,
  dass die gefilterte Liste 200 mit 512 Stationen liefert. Das Feld ist
  OPTIONAL und gefiltert wird nur auf ein ausdrückliches `false`, damit eine
  älter erzeugte `stations.json` sich wie bisher verhält statt die Karte zu
  leeren. Wer einen weiteren Datensatz anbindet, braucht dieselbe Prüfung —
  das ist kein Einzelfall, sondern die Hausregel dieser API. Karte ist ein
  leichtes **Canvas** (`render/atmap.ts`, feste WEB-MERCATOR-Projektion — NICHT
  MapLibre), Werte stehen direkt beschriftet in der Karte (keine Colorbar, so
  gewünscht).
  **Darunter liegt eine Karte: CARTO „Dark Matter"** auf OpenStreetMap-Daten
  (`render/osmTiles.ts`, `basemaps.cartocdn.com`, auf Wunsch statt des
  schwarzen Hintergrunds; gilt für Klima UND MOS, beide zeichnen über
  `AtClimateMap`). Das ist die EINE Ausnahme von „Basemap ist komplett
  lokal" — die Begründung dort (MapLibres `load`-Event hinge an fremden
  Kacheln) trifft auf ein eigenes Canvas nicht zu: fehlt eine Kachel, bleibt
  sie dunkel, und alles andere steht. **Deshalb Mercator statt der früheren
  equirect-Projektion mit fester cos(φ)-Korrektur**: die Kacheln sind
  EPSG:3857, und im DACH-Ausschnitt (45,6–55,2 °N) ändert sich der
  Mercator-Massstab um ein Viertel — die Stationen lägen am Rand sichtbar
  neben ihrem Ort. `atmap.test.ts` prüft die Lage gegen die Kachelformel aus
  dem OSM-Wiki, nicht gegen die eigene Projektion. **Dark Matter statt des
  OSM-Standardstils** (der war die erste Fassung): der Standardstil ist hell
  und bunt, Wald-Grün und Seen-Blau sind auch Farben der Skalen, und
  entsättigt plus abgedunkelt sah er matschig aus. Dark Matter ist von sich
  aus farbarm — die Werte bleiben die einzige Farbe, ohne Nachbearbeitung.
  **Hohe Pixeldichte über `@2x`-Kacheln DERSELBEN Stufe**
  (`setRetinaTiles`), nicht über eine feinere Stufe: die hätte die
  Schärfe, aber Ortsnamen und Linien in halber Grösse. Zoomstufe ~1:1
  (`tileZoom`, gerundet — aufgerundet wären es bis zu viermal so viele
  Abrufe), geholt wird nur der sichtbare Ausschnitt, nichts vorgeladen
  (kostenlos bis 75.000 Kartenaufrufe im Monat); solange eine Kachel lädt,
  springt eine gröbere ein. Gescheiterte Kacheln bleiben gemerkt, sonst
  fragte jedes Neuzeichnen sie erneut an. **Namensnennung „© OpenStreetMap-
  Mitwirkende © CARTO" steht AUF der Karte** (`.atmap-osm`,
  Lizenzbedingung), `basemaps.cartocdn.com` in der Datenschutzerklärung.
  **CARTO ist seit September 2026 SCHLÜSSELPFLICHTIG** — ohne `?key=` kommt
  HTTP 200 mit einem Wasserzeichen „API KEY REQUIRED" statt der Karte,
  gleiches Format, gleiche Grösse für jede Kachel; man sieht es nur im Bild.
  Kostenlos, ohne Konto, nicht kommerziell bis 5 Mio. Abrufe im Monat
  (carto.com/basemaps/apikey). Eingespeist wie die Impressum-Angaben:
  `VITE_CARTO_KEY` lokal in `.env.local`, im Deploy die Repository-Variable
  `CARTO_KEY`. **Fehlt er, wird GAR NICHTS geholt** (`TILES_AVAILABLE`),
  auch die Namensnennung entfällt — ein dunkler Hintergrund ist die
  ehrlichere Anzeige als ein Wasserzeichenteppich. Registry `config/atParameters.ts` (Tag→`klima-v2-1d`,
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
  Einstieg links oben in der Karte, gemeinsame Reihe `.atmap-tools` mit
  „Rangliste & Stationssuche"): beide Fenster gehen an derselben Stelle auf
  und schließen sich gegenseitig aus, weil sie denselben Platz belegen. Eine
  Frage in Alltagssprache („was war das
  tagesmaximum im juli seit messbeginn in salzburg?") wird in
  {Gebiet, Größe, Zeitraum, Extremum} übersetzt und aus den VORHANDENEN Assets
  beantwortet — Rekorde (`records/<id>.json`) bzw. Normale. **Kostet keinen
  Request** (Ausnahme sind der exakte Rekordtag und die WERTfrage nach einem
  benannten Zeitraum, s. u. — beide einen, beide für immer gecacht).
  Bewusst OHNE Sprachmodell: die Seite ist statisch (GitHub Pages),
  ein API-Key wäre im Frontend öffentlich, und ein Modell, das aus eigenem
  Wissen antwortet, erfindet bei genau solchen Fragen selbstbewusst Zahlen —
  gebraucht wird kein Sprachverständnis, sondern Wissen über DIESE Registry.
  **Der Einstieg ist ein echtes SUCHFELD und steht ÜBER der Rangliste**
  (`.atmap-ask`, darunter der kleinere `.atmap-toolbtn`) — vorher waren es zwei
  gleich große Knöpfe nebeneinander, und das wurde der Sache nicht gerecht: die
  Rangliste beantwortet „welche Station" zu dem, was ohnehin schon in der Karte
  steht, das Archiv „welcher Wert" über die ganze Messgeschichte. Letzteres ist
  die Frage, mit der man herkommt, also die Hauptfunktion dieses Bereichs. Ein
  Feld sagt außerdem „hier tippen", wo ein Knopf nur „hier klicken" sagt —
  deshalb MUSS das Tippen dort auch funktionieren: das erste Zeichen öffnet das
  Fenster und wird als `askSeed`/`AtAskBox.initial` MITGENOMMEN, sonst wäre ein
  Feld, in dem nichts stehen bleibt, ein Etikettenschwindel. Der Fokus springt
  mit dem Cursor ans ENDE des Mitgebrachten (Ref statt `autoFocus`; sonst
  landet je nach Browser der zweite Buchstabe vor dem ersten). Fenster und Feld
  sind GENAU gleich breit (500 px), damit das Öffnen aussieht, als wüchse das
  Feld nach unten auf. Der Platzhalter trägt eine echte Beispielfrage
  („wärmster Sommer in Graz") und muss ganz hineinpassen — ein abgeschnittener
  Platzhalter sagt gerade nicht, was man fragen kann.
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
  **Das BUNDESLAND ist das vierte Gebiet** (`AskArea` = `station | place |
  state | austria`, `AtStation.state` ist der Schlüssel): „wie viele Hitzetage
  hatte die Steiermark 2024" ist eine Frage, die sich aus den vorhandenen
  Daten beantworten lässt, und sie fiel vorher auf „ganz Österreich" zurück.
  Ausgewertet wird wie beim Ort — dieselbe Stationsmenge, derselbe
  `mergeRecords`/`answerFromNormalsRange`-Pfad. **Zwei Namen sind doppelt
  vergeben**, und dort hat der ORT Vorrang: „Salzburg" und „Wien" heißen Land
  UND Stadt, „höchste Temperatur in Wien" ist seit jeher die Frage an die
  Stadt. Erkannt wird das daran, dass der Landesname ein Stationsname oder
  dessen ANFANG ist („Wien Hohe Warte") — NICHT daran, ob `resolvePlace` einen
  Ort gebildet hat: den gibt es erst ab zwei gleichnamigen Stationen, und an
  einer einzelnen kippte die Frage sonst still aufs Land. Umgekehrt steckt
  „Tirol" in Stationsnamen, ohne ein Ortsname zu sein: nennt die Frage AUSSER
  dem Landesnamen noch ein Wort dieser Station („Kirchdorf in Tirol"), ist die
  Station gemeint, sonst das Land. „Bundesland"/„ganz" schlägt beides
  („im Bundesland Salzburg"). Der Preis steht nur beim REKORD an: er braucht
  die Stationsdateien (Niederösterreich 117 × ~13 KB), Werte und Normale
  kommen mit einem Abruf bzw. einer Datei aus — deshalb lädt das Fenster die
  Dateien auch nur im Rekordfall. Die neun Länder stehen IMMER in der Auswahl,
  nicht nur das erkannte: der Sprung vom Ort aufs Land soll ein Klick sein.
  **Zwei davon tragen einen Artikel** (`areaIn`/`areaFor`) — „in DER
  Steiermark", „im Burgenland" —, aus demselben Grund wie die
  handgeschriebenen Superlative: aus dem Namen folgt er nicht, und ohne die
  Tabelle stand da „meiste Hitzetage in Steiermark".
  **Die dritte Frageform ist der gemessene WERT eines benannten Zeitraums**
  (`AskScope` = `record | normal | value`, `askValuePeriod`/`answerFromPeriod`):
  „anzahl der frosttage in innsbruck im jänner 2024" → 22 d, Innsbruck
  Flughafen. Eine Jahreszahl macht die Frage dazu; „seit Messbeginn" schlägt
  sie („höchste Temperatur seit 1900" bleibt eine Rekordfrage). Nennt die Frage
  keinen engeren Zeitraum, gilt das ganze Jahr, sonst Monat oder Jahreszeit —
  der Zeitraum ist dieselbe `Period`, die die Karte benutzt.
  **Das ist der EINZIGE Pfad dieses Fensters, der einen Abruf kostet**, und
  zwar genau einen: `fetchPeriodValues` holt den Zeitraum als Bulk-Request
  über ALLE Stationen, legt ihn für immer in den IndexedDB-Cache und benutzt
  denselben Schlüssel wie die Karte — wer den Zeitraum dort schon angesehen
  hat, zahlt hier nichts. Bewusst über alle Stationen statt über das Gebiet:
  ein zugeschnittener Request wäre ein zweiter Cache-Eintrag für dieselben
  Daten. Derselbe Handel wie beim exakten Rekordtag (`resolveExtremeDay`) —
  ohne ihn bliebe die Frage unbeantwortbar, obwohl die Karte die Zahl längst
  zeigt. Über eine Stationsmenge gibt es auch hier bewusst KEINE eine Zahl,
  sondern die SPANNE (Steiermark 2024: 52 Hitzetage in Bad Radkersburg … 0 in
  Fischbach, 41 Stationen) — dieselbe Begründung wie beim Flächenmittel. Wer
  von Hand auf „gemessener Wert" umschaltet, bekommt als Vorgabe das letzte
  ABGESCHLOSSENE Jahr: das laufende wäre eine Teilsumme und sähe bei Kenntagen
  und Niederschlag wie ein Rekordtief aus.
  **Kenntage stehen in `PARAM_WORDS` VOR ihrer Rohgröße**, und das ist eine
  Reihenfolgeregel, keine Kosmetik: die Suche nimmt den ersten Treffer, und
  „niederschlagstage" ENTHÄLT „niederschlag" (die Kompositum-Regel greift ab
  sechs Zeichen). Stünde `rr` davor, käme auf „meiste Niederschlagstage" eine
  Zahl in mm statt in Tagen — und beides sieht plausibel aus.
  **„DURCHSCHNITTLICHE MAXIMA" IST EINE EIGENE GRÖSSE — drei Zahlen sehen
  plausibel aus, nur eine stimmt.** Live gemessen für Salzburg Flughafen,
  September 1991–2020 (klima-v2-1m): `tl_mittel` **14,3 °C** (Monatsmittel),
  `tlmax_mittel` **20,0 °C** (Mittel der TAGESmaxima), `tlmax` **27,6 °C**
  (Mittel der MONATSmaxima, also des jeweils heißesten Septembertags).
  Gefragt ist die mittlere; geantwortet wurde die erste, weil „Maxima"
  überhaupt kein Größenwort war und die Frage auf die Vorgabe zurückfiel.
  Die dritte ist die gefährliche: sie wäre herausgekommen, hätte man „Maxima"
  bloß auf `tlmax` abgebildet, und sie beantwortet eine andere Frage — genau
  davor warnt die Notiz zur Verifikation, die die Normal-Assets ausdrücklich
  NICHT als Tagesklimatologie benutzt.
  **`tlmax_mittel` und `tlmin_mittel` sind deshalb neu in der Registry**
  („Mittleres Tagesmaximum/-minimum"). Die Größen gab es bei GeoSphere schon
  immer (klima-v2-1m, „Mittelwert der Maximalwerte") — sie fehlten nur hier.
  Die Normal-Assets sind für beide Perioden neu erzeugt (`ingest:at:normals`,
  ~10 Requests); der Wert für Salzburg/September steht seither mit exakt den
  gemessenen 20,0 °C darin. **REKORDE haben sie noch NICHT**: der
  Rekord-Ingest läuft beide Pässe, rund 20 Minuten, 290 MB und 22 % des
  Stundenbudgets. Ein Test nennt die zwei Ausnahmen namentlich, statt die
  Regel „jeder Monatsparameter hat Rekorde" stillschweigend aufzuweichen.
  Im Tag-Modus sind sie gesperrt (`monthlyOnly`): über einen einzelnen Tag
  gemittelt IST das Tagesmaximum das Tagesmaximum, und GeoSphere führt die
  Größe im Tagesdatensatz gar nicht.
  **Und der Antworttext nennt jetzt die GRÖSSE.** Die Spannen-Fassung
  (`answerFromNormalsRange`) sagte nur „höchstes langjähriges Mittel in
  Salzburg – September" — bei drei ähnlich aussehenden Temperaturmitteln ist
  das keine Auskunft. Beide Fassungen setzen die Größe jetzt NACH VORN
  („Mittleres Tagesmaximum – höchstes langjähriges Mittel in Salzburg,
  September"): umgekehrt stottert es, sobald die Größe selbst ein Mittel ist
  („langjähriges Mittel Mittleres Tagesmaximum"). Dieselbe Falle wie bei den
  Rekorden, wo sie zu den handgeschriebenen Superlativen geführt hat.
  **Umgeschaltet wird über den SCOPE, nicht über ein eigenes Wort**
  (`MEAN_OF_EXTREMES`): fragt die Frage nach einem Mittel — und genau diese
  Wörter haben `scope` schon auf `normal` gestellt —, dann meint eine
  Extremgröße das Mittel der Tageswerte. Wer wirklich den „im Mittel
  heißesten Tag" will, stellt die Größe im Fenster um; dafür ist die
  änderbare Auswahl da. Zwei Kleinigkeiten mussten dafür mit: **„mittleres"
  war kein Mittelwort** (`hasAny` vergleicht ab vier Zeichen mit Ähnlichkeit
  ≥ 0,85, „mittleres" gegen „mittel" liegt bei 0,67 — die Beugungen stehen
  jetzt einzeln da), und **ein generisches Größenwort beendet die Suche nicht
  mehr**: „durchschnittliche TEMPERATUR MAXIMA" traf zuerst „temperatur", das
  ausdrücklich als `generic` markiert ist, brach ab und antwortete mit dem
  Monatsmittel. Ein generischer Treffer wird jetzt nur gemerkt, die Frage
  aber weiter abgesucht; ein bestimmtes Wort gewinnt, egal wo es steht.
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
  **Der einzelne TAG ist eine eigene EBENE** (`AskQuery.daily`, beantwortet aus
  `ParamRecords.day`): „höchste Regensumme an einem Tag in Salzburg" gab
  38,6 °C aus — zwei Fehler in einer Frage. Erstens wurde `regensumme` nicht
  als Größenwort erkannt (siehe `measureStem` unten) und fiel auf die Vorgabe
  `tlmax`. Zweitens, und das war der größere: auch das erkannte „höchster
  Tagesniederschlag" antwortete aus `abs`, dem besten MONAT — 404 mm (Juli
  1954) statt des nassesten TAGES. Eine Größenordnung daneben, und anders als
  bei den 38,6 °C sieht man das der Zahl nicht an. Der Tagespass des Ingests
  bildet deshalb auch `rr` (nur die NASS-Richtung: der trockenste Tag ist
  überall 0 mm). Richtig ist jetzt **135 mm am 08.07.1954** — und der Tag liegt
  im Rekordmonat Juli 1954, was die Rechnung gleich mit bestätigt.
  **Bei EXTREMgrößen ist die Tagesebene gegenstandslos und wird unterdrückt**
  (`dailyLevelApplies`): der Monatswert von `tlmax`/`tlmin` IST ein
  Tagesextrem, `abs` also schon die Antwort auf „heißester Tag". Ohne diese
  Ausnahme las sich die Beispielfrage „was war das TAGESMAXIMUM im Juli seit
  Messbeginn" als Tagesfrage und griff in den Tagesblock, wo für `tlmax` nur
  die GEGENrichtung liegt — die Antwort wäre der kälteste Tag gewesen (vier
  Tests brachen sofort, der Fall steht jetzt als Regression fest). Gebraucht
  wird die Ebene nur, wo der Monatswert eine SUMME oder ein MITTEL ist.
  **Messgrößen-Komposita werden über eine REGEL getrennt, nicht über eine
  Wortliste** (`measureStem`): `…summe`, `…menge`, `…höhe`, `…dauer`,
  `…anzahl`, `…wert` sind im Deutschen produktiv, jede Aufzählung wäre
  unvollständig. „regensumme" → „regen", „niederschlagssumme" →
  „niederschlag" (Fugen-s fällt mit). Nötig, weil die Kompositum-Regel unten
  erst ab sechs Zeichen greift und „regen" fünf hat — die Ähnlichkeit zu
  „regenmenge" liegt bei 0,60.
  **Beim Tagesniederschlag NICHT gefiltert, nur berichtet**: wo der
  Tagesrekord den Monatsrekord übersteigt, stimmt etwas nicht zusammen — aber
  dasselbe Signal kommt von einer LÜCKE in der Monatsreihe, und beides ist
  nicht unterscheidbar. Gemessen: genau eine von 494 Stationen (Podersdorf
  Strandbad, Messbeginn 22.07.2014, Tagesrekord am 30.07.2014 — der Juli ist
  ein Teilmonat und fehlt im Monatsdatensatz). Ein Filter hätte dort einen
  echten Rekord weggeworfen; der Ingest gibt solche Fälle deshalb als HINWEIS
  aus. Ebenso bewusst behalten: der nationale Tagesrekord von **353 mm
  (26.11.1998)** stammt von Sonnblick Fensterhütte, einer Messstelle auf
  3105 m mit nur fünf Jahren Reihe (1996–2001), die alle zwölf Monatsrekorde
  hält — intern konsistent (353 mm Tag < 1441 mm Monat) und genau der Fall,
  für den die Karte „Rekord, Reihenlänge beachten" sagt.
  **Deutsche KOMPOSITA zählen als Treffer** (enthaltenes Parameterwort ab
  sechs Zeichen): „durchschnittlicher Jahresniederschlag" ist die normale Form
  der Frage, liegt von „niederschlag" aber sechs Zeichen entfernt (Ähnlichkeit
  0,67) und wurde vorher still als Temperatur beantwortet. Ab sechs Zeichen,
  weil kürzere Fragmente zufällig in vielen Wörtern stecken; der exakte
  Listentreffer geht weiter vor („höchsttemperatur" bleibt `tlmax`).
  **Bei Extremgrößen ist nur EINE Richtung ein echtes Tagesextrem**
  (`directionDerivable`/`directionNote`) — die Gegenrichtung beantwortet eine
  andere Frage, und das war ein echter Fehler. Die Rekord-Assets stammen aus
  dem MONATSdatensatz: dort ist `tlmax` das höchste Tagesmaximum und `tlmin`
  das tiefste Tagesminimum des Monats. Das Extremum über die Monate in der
  Gegenrichtung ist damit etwas anderes: „wärmste Nacht in Salzburg"
  antwortete mit **13,4 °C (August 2024)** — dem höchsten Monats-TIEFSTWERT,
  also dem August, dessen kälteste Nacht die wärmste war; Salzburg hat längst
  Tropennächte über 20 °C gehabt. Symmetrisch hätte „kältester Tag" −0,4 °C
  geliefert (Jänner 1940): den Monat, dessen wärmster Tag am kältesten blieb.
  Diese Werte sind KEIN Datenfehler — die Karte im Zeitbezug „Allzeit" zeigt
  sie bewusst und `valueCaption` benennt sie korrekt als Monats-Höchst-/
  Tiefstwerte; nur als ANTWORT auf eine Frage nach einem Tag oder einer Nacht
  sind sie falsch. Die Fragebox gibt dort deshalb KEINE Zahl, sondern die
  Erklärung: „keine Daten" wäre ebenfalls unzutreffend, die Daten sind da und
  beantworten etwas anderes. Bei Summen, Mitteln und Kenntagen sind beide
  Richtungen sinnvoll (nassester UND trockenster Monat). **Das fehlende
  Gegenstück gibt es auch nicht unter anderem Namen** — geprüft (2026-09-15,
  420 Parameter in klima-v2-1m): es gibt `tlmin`, `tlmax` und die Mittel
  `tlmin_mittel`/`tlmax_mittel`, aber kein „monatlich höchstes Tagesminimum".
  Deshalb hat der Rekord-Ingest einen **ZWEITEN PASS aus dem TAGESdatensatz**
  (`DAY_CODES`/`dailyPass` in `scripts/at-ingest-records.mjs`): er bildet die
  fehlende Richtung je Station auf denselben vier Ebenen und schreibt sie als
  `ParamRecords.day` in die Stationsdateien und nach `_national.json`. Der
  Block hat ABSICHTLICH dieselbe Form wie der Monatsblock, obwohl nur eine
  Richtung besetzt ist — so liest `extremeOf` ihn ohne Sonderlogik; einziger
  Unterschied ist `d` als EXAKTES Datum (`YYYY-MM-DD` statt `YYYY-MM`), womit
  für diese Rekorde auch die nachträgliche Tagesauflösung im Browser entfällt.
  `formatRecordWhen` unterscheidet die beiden Genauigkeiten an der LÄNGE, nicht
  an einem Flag. `mergeRecords` verschmilzt den Block mit — sonst hätte eine
  ORTSfrage („wärmste Nacht in Salzburg" = acht Stationen) ihn nicht — legt ihn
  aber nur an, wenn mindestens eine Station ihn führt: ein leerer Block sähe
  wie „vorhanden, aber ohne Wert" aus und verdeckte die Erklärung. Fehlt er
  (Assets von vor dem Tagespass), bleibt es bei `directionNote`.
  **Der Tagespass ist billiger, als er klingt**, weil GeoSphere DATENPUNKTE
  deckelt und nicht Stationen: ein Chunk trägt ~10 Stationen über 126 Jahre.
  Gemessen (2026-09-16): 925.580 Punkte, 5,6 MB, 19,6 s je Chunk → 52 Requests
  für 513 Stationen, rund 20 Minuten, ~290 MB und 22 % des Stundenbudgets von
  240. Der ganze Ingest (Monatspass ~10 + Tagespass 52 Requests) bleibt damit
  klar im Limit. Gegenprobe an Salzburg Flughafen: wärmste Nacht
  **23,8 °C am 3. Juli 1905**, kältester Tag **−19,5 °C am 10. Februar 1956** —
  vorher stand dort fälschlich 13,4 °C.
  **Der Tagespass braucht eine PLAUSIBILITÄTSPRÜFUNG, und zwar nachweislich**:
  ein Tag, an dem das Minimum ÜBER dem Maximum liegt, ist in sich
  widersprüchlich und darf in keinen Rekord. Ohne sie stand als „wärmste Nacht
  Österreichs" **37,8 °C am 09.05.1968** (Ybbs Persenbeug) in den Assets — als
  Tagesminimum im Mai unmöglich, bei `tlmax` = 20,5 °C DESSELBEN Tages und
  Nachbartagen von 3,8 und 6,5 °C. **Das Qualitätsflag ist dabei LEER** —
  GeoSpheres QC fängt es nicht, darauf kann man sich also nicht verlassen.
  Bewusst diese Regel und KEINE absolute Schwelle: sie braucht kein geratenes
  Limit, gilt an jeder Station und in jeder Jahreszeit und prüft die Daten
  gegen sich selbst; ihre Grenze ist, dass beide Werte vorliegen müssen.
  Gemessen: **50 verworfene Tage**, davon fast alle an Station 5320
  (1968–1969) — dort steckt offenbar ein systematischer Fehler jener Jahre.
  Der Ingest gibt die verworfenen Tage NAMENTLICH aus: es sind Archivfehler,
  keine Programmfehler, und wächst die Zahl, hat sich am Datensatz etwas
  geändert. Danach sind die nationalen Werte plausibel — wärmste Nacht
  **27,3 °C am 29.06.2026** (Wien Jubiläumswarte), kältester Tag **−33,2 °C am
  14.02.1940** (Sonnblick), und der Monatsverlauf ist glatt (Jän 13,6 → Jun
  27,3 → Dez 13,9, Winterwerte von Föhnstationen).
  **Eine NACHT ist ein ZEITRAUM über zwei Kalendertage, und die Antwort muss
  das sagen** (`AskQuery.nightly`, `formatNightSpan`, `nightNote`): GeoSphere
  bildet die Tagesextreme von 19 MEZ des Vortags bis 19 MEZ (18–18 UTC, in
  `verify.ts` gemessen) — das Minimum des Klimatags D gehört damit zur Nacht
  von **D−1 auf D**, nicht von D auf D+1. Genau dafür existiert die Konvention:
  über den Kalendertag gerechnet schnitte die Tagesgrenze mitten durch den
  Tiefpunkt und eine Nacht hätte zwei Minima (dieselbe Überlegung wie die
  synoptische Nacht 18–06 UTC im klassischen Meteogramm). Die Antwort lautet
  deshalb „Nacht vom 11. auf den 12. Jänner 1940"; über Monats- und
  Jahresgrenzen beidseitig voll ausgeschrieben, sonst läse sich „Nacht vom 31.
  auf den 1. Jänner" als der 31. Jänner.
  **Der Vorbehalt gilt nur in EINER Richtung — das überrascht beim
  Nachrechnen.** Geantwortet wird mit dem Minimum des KLIMATAGS, nicht mit dem
  eines eigenen Nachtfensters (18–06 UTC); ein solches ist aus dem Archiv nicht
  ableitbar (die Rekorde sind Monatswerte, eine eigene Nachtauswertung
  bräuchte die 10-Minuten-Reihen, die erst 1992 beginnen). Bei der **wärmsten**
  Nacht ist das beweisbar unkritisch: gesucht ist das HÖCHSTE Tagesminimum,
  fiel es ausnahmsweise am Tag (Kaltfront nachmittags), war die Nacht NOCH
  wärmer — der Wert ist dann eine untere Schranke und die Aussage bleibt
  richtig. Bei der **kältesten** Nacht ist es umgekehrt: das tiefste
  Tagesminimum KANN ein Nachmittagswert sein und gehört dann gar nicht in die
  Nacht. Deshalb trägt nur diese Richtung einen Vorbehalt; ein Test hält die
  Asymmetrie fest.
  **Die NACHT ist auch eine eigene GRÖSSE**, und das war ein echter Fehlgriff: „kälteste
  Nacht in Salzburg" fand gar kein Größenwort, fiel auf die Vorgabe `tlmax`
  zurück und antwortete mit dem tiefsten Tages-MAXIMUM — dem kältesten TAG
  statt der kältesten Nacht. „Nacht" steht deshalb in `PARAM_WORDS` mit
  `tlmin`, aber OHNE Richtung: sie bestimmt die Größe, nicht das Vorzeichen —
  „wärmste Nacht" ist das HÖCHSTE Tagesminimum (die Tropennacht), dieselbe
  Messgröße andersherum. `tropennacht`/`frostnacht` tragen ihre Richtung selbst.
  **Der Antworttext braucht handgeschriebene Superlative**
  (`superlativeText`/`SUPERLATIVE`): vorher stand dort `richtung + spec.label`
  mit einem immer maskulinen „höchster"/„tiefster" vor einem Registry-
  BEZEICHNER — heraus kam „tiefster Temperatur Maximum". Deutsche Grammatik
  lässt sich daraus nicht ableiten: jede Größe hat ihr Genus („die Schneehöhe",
  „das Tagesminimum") und ihren passenden Superlativ („längste"
  Sonnenscheindauer, nicht „höchste"; „meiste" Frosttage). Ein Test hält die
  Tabelle gegen alle Codes vollständig, die das Parsen erzeugen kann — sonst
  rutscht still die Ersatzformulierung („Tiefstwert von …") durch.
  **Die Antwort nennt das EXAKTE DATUM, nicht nur „Jänner 1940"**
  (`askDayRange` + `resolveExtremeDay`): die Assets kennen nur Monat und Jahr,
  bei `tlmax`/`tlmin` IST der Monatswert aber ein Tagesextrem — der Tag steht
  in der Tagesreihe und kostet EINEN Request, für immer gecacht. Gesucht wird
  im engsten bekannten Fenster (genannter Monat → Saison → ganzes Jahr; beim
  absoluten Rekord liefert das Asset den Monat mit). Bei Summen und Mitteln
  gibt es keinen Rekordtag; die Whitelist `DAY_RESOLVABLE` bleibt die eine
  Wahrheit dazu, `resolveExtremeDay` lehnt andere Codes ohne Request ab — es
  braucht also keine zweite Liste im Frageteil. Kommt der Wert an mehreren
  Tagen vor (`ties`), steht „(erstmals)" dabei. Der Effekt hängt an einem
  SCHLÜSSEL aus Primitiven, nicht an `query`: das Objekt wird jede Renderrunde
  neu gebaut und der Effekt lief sonst in einer Endlosschleife (`dataKey`-Muster
  aus `VerifyPanel`).
  „In der Karte zeigen"
  springt auf den Zeitraum DER ANTWORT (Rekordjahr und -monat), nicht auf das
  laufende Jahr.
  **Die Station wird dabei STARK markiert** (`markedIdx` in `AtClimateMap`,
  `drawStationPoints`/`drawStationLabels`): Ring um den Punkt, der Wert groß
  (22 px) in einem Kästchen mit Akzentrand, ZULETZT gezeichnet und damit über
  den Nachbarlabels. In einem Netz aus bis zu 500 gleich aussehenden Zahlen
  war die bisherige Hervorhebung — gelbe Schrift in normaler Größe — nicht zu
  finden. Zwei Feinheiten, beide Absicht: die markierte Station behält ihre
  WERTFARBE (der Hover ersetzt sie durch Gelb, hier nähme das genau die
  Information weg, wegen der man hingesprungen ist), und der Kasten klappt
  nach UNTEN, wenn die Station zu nah am oberen Kartenrand steht.
  **Die Markierung überlebt das Schließen des Detailfensters** (eigener
  Zustand `marked` neben `selected` in `AtClimatePanel`): das Fenster liegt
  über der Karte, man macht es genau deshalb zu. Weggeräumt wird sie erst,
  wenn eine ANDERE Station angeklickt wird — die ist dann selbst markiert,
  solange ihr Detail offen ist. **Ein Klick in der Rangliste bzw.
  Stationssuche markiert DAUERHAFT wie „In der Karte zeigen"**: auch dort
  sucht man eine Station, um sie in der Karte zu finden; nur der Klick
  direkt in die Karte markiert bloss für die Dauer des Details — die
  Station steht dort ja schon unter dem Zeiger. Der Hover in der Rangliste bleibt davon
  getrennt die leichte Hervorhebung (`highlightIdx`): sonst überschriebe
  jedes Überfahren gerade die Markierung, die man sucht. Gegen die echte Stationsliste gemessen: 14 von 14
  Beispielfragen richtig.
  **HÖHENFILTER: alle / nur Bergstationen / ohne Bergstationen**
  (`AskTerrain`, Auswahl „Lage" im Fenster). Bei etlichen Größen ist er der
  Unterschied zwischen einer Auskunft und einer Trivialität — „meiste
  Eistage in Österreich" beantwortet sich sonst jedes Mal mit dem Sonnblick.
  Gemessen über die Rekord-Assets (höchster Jahreswert): Eistage **292 d**
  (Sonnblick 3109 m) gegen **112 d** ohne Bergstationen (Präbichl),
  Frosttage 351 gegen 227 (St. Jakob i. D.), Niederschlag 4.167 mm
  (Feuerkogel) gegen 3.451 mm (Loibl Tunnel) — Hitzetage dagegen
  UNVERÄNDERT 57 d (Bad Deutsch-Altenburg): die Gegenprobe, wo die Berge
  ohnehin nicht gewinnen, ändert der Filter nichts.
  **Die Grenze ist ein reiner HÖHENschnitt bei 1500 m** (`MOUNTAIN_M`),
  keine topografische Einteilung, und am Rand zwangsläufig willkürlich:
  Galtür (1587 m) ist ein Talort und zählt als Berg, der Schöckl (1443 m)
  ist ein Gipfel und zählt nicht. Eine saubere Trennung Gipfel/Talboden
  geben die Stammdaten nicht her. 1500 m, weil dort die Dauersiedlung endet;
  von 513 Stationen liegen 44 (9 %) darüber, ab 1000 m wären es 109 (21 %).
  Eine Station OHNE bekannte Höhe zählt als Tal — als Berg gezählt gewänne
  sie jede Kältefrage, ohne dass man es sähe. Der Filter steht im
  ANTWORTTEXT („… in Österreich, ohne Bergstationen"): „112 Tage in
  Österreich" allein wäre schlicht falsch.
  **„Berg" IST EIN STATIONSNAME, und daran ging der Filter kaputt**
  (`terrainPhrase`, seit 2026-09-30): Österreich hat eine Station **„Bergau"**
  und eine **„Leiser Berge"** — „meiste eistage ohne berge" traf deshalb
  Leiser Berge, „ohne berg" Bergau. Der Filter selbst stand richtig auf „low",
  galt aber einer EINZELNEN Station, wo er gar keine Bedeutung hat; beantwortet
  wurde also eine ganz andere Frage. Die Gegenrichtung gab es ebenso: „höchste
  Temperatur in Leiser Berge" schaltete still auf „nur Bergstationen".
  Die Wörter zerfallen deshalb in zwei Klassen — EINDEUTIGE
  (`bergstation…`, `hochgebirge`, `flachland`, `tieflage…`) gelten für sich,
  MEHRDEUTIGE (`berg`, `berge`, `bergen`, `gipfel`, `tal`) nur mit einem
  Qualifizierer davor („ohne …", „nur …"). Ist eine Phrase erkannt, sucht
  `parseQuestion` die Station in der Frage OHNE deren Wörter — die
  Reihenfolge ist die eigentliche Behebung. **Findet die verkürzte Frage die
  Station TROTZDEM, war sie gemeint**: „in leiser berge" trifft ohne „berge"
  weiter Leiser Berge (Score 0,89), „in den bergen" ohne „bergen" gar nichts
  — daran unterscheiden sich die beiden Fälle, ohne eine zweite Namensliste.
  Bei ausdrücklichem „ohne"/„nur" gilt der Filter immer. Mitgegangen: „hoher"
  ist als Bergwort raus — ein Allerweltsadjektiv, das als Marker nichts taugt.
  **Das ist kein Einzelfall dieser Wortart**: dieselbe Kollision hat
  „höchste temperatur in Puchberg am SCHNEEBERG" — die Kompositum-Regel liest
  darin `schnee` und antwortet mit der Schneehöhe. Dort ist sie nicht
  behoben (ein Parameterwort steckt in einem Stationsnamen, eine andere
  Mechanik als der Höhenfilter); wer sie angeht, braucht die Positionen des
  Stationstreffers, die `matchStations` heute nicht zurückgibt.
  **Der gefilterte LANDESrekord geht weder über `_national.json` noch über
  die Stationsdateien** — die eine Datei ist über alle Stationen
  vorgerechnet und nicht nachträglich filterbar, die andere wären bei „ohne
  Bergstationen" rund 470 Abrufe. Genommen wird der KARTEN-INDEX
  (`_map-<code>.json`): daraus den Gewinner unter den erlaubten Stationen
  bestimmen und NUR DESSEN Stationsdatei nachladen — zwei Abrufe, und die
  Antwort bekommt Datum und alle Ebenen wie sonst.
  **Der Index führt seit 2026-09-30 auch den TAGESblock** — vorher nicht,
  und das war ein Fehler mit genau der Wirkung, die der Filter verhindern
  soll: „kältester Tag in Österreich ohne Bergstationen" antwortete mit
  −33,2 °C vom Sonnblick, also der UNGEFILTERTEN Zahl (richtig sind
  −26,0 °C, Lunz 612 m, 30.12.1939). Dieselbe Klasse traf jede Frage aus dem
  Tagesblock: Gegenrichtung einer Extremgröße („wärmste Nacht"),
  ausdrückliche Tagesfrage („höchster Tagesniederschlag" — ohne
  Bergstationen 233,2 mm, Loibl Tunnel). Die Werte lagen die ganze Zeit in
  den Stationsdateien, sie waren nur nie in die Karten-Sicht übernommen.
  **Zwei Lehren stehen darin.** Erstens: der Index ist eine ABGELEITETE
  Sicht auf die Stationsdateien und lässt sich jederzeit daraus neu bauen —
  `scripts/at-build-record-index.mjs` (npm `ingest:at:recidx`) tut das **ohne
  einen einzigen API-Abruf**, während der volle Rekord-Ingest 20 Minuten,
  290 MB und 22 % des Stundenbudgets kostet. Der Ingest ruft seither
  dieselbe Funktion, statt eine zweite Fassung der Umformung zu pflegen; die
  eingebaute Fassung war es, die den Tagesblock nicht kannte. Zweitens:
  **wenn der Filter nicht zu rechnen ist, gibt es KEINE Zahl.** Der Rückfall
  auf die ungefilterte Antwort war der eigentliche Schaden — sie sieht
  richtig aus und ist genau das, was ausgeschlossen werden sollte.
  **Rangliste** (`AtRankList` + Rechenkern `atRank.ts`) reiht die
  geladenen Kartenwerte (auch Anomalien) — rein clientseitig, kein zusätzlicher
  Request; Hover markiert die Station in der Karte (`highlightIdx`), Klick
  öffnet ihr Detail. Der Einstieg ist ein Knopf **links oben IN der
  Karte** (`.atmap-toolbtn`) — genau dort, wo die Liste danach aufgeht; er
  verschwindet, solange sie offen ist (sie belegt denselben Platz und schließt
  über ihr eigenes ✕). Er steht bewusst UNTER dem Suchfeld des Klimaarchivs und
  ist kleiner — Begründung dort. Das Suchfeld der Liste bekommt beim Öffnen den
  Fokus.
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
  Detail alle Rekordebenen als Tabelle mit Datum.
  **Die hervorgehobene Rekordebene folgt dem ZEITBEZUG** (`levelFor` in
  `AtStationDetail`) — und tat es nicht: dort stand immer `abs`, der beste
  EINZELMONAT der Reihe. Bei „Niederschlag Summe, Jahr" zeigte das Fenster
  für Hohenau „Höchstwert 212 mm, September 2024", während die Frage nach
  dem höchsten JAHRESniederschlag lautet — 734 mm aus dem Jahr 1959. Beide
  Ebenen liegen in den Assets (`abs` und `ann`), gelesen wurde die falsche;
  bei Summen liegen sie um ein Vielfaches auseinander, bei Maximum- und
  Minimum-Größen fallen sie zusammen. Jetzt wählt der Zeitbezug die Ebene
  (Jahr → `ann`, Saison → `sea`, Monat → `mon`, Tagesansicht → `abs`), die
  Zeile NENNT sie („Höchstwert Jahr"), und die AT-Zeile darunter zeigt
  dieselbe Ebene — vorher standen dort zwei verschiedene Fragen
  untereinander (1.441 mm Dezember am Sonnblick neben einem Jahreswert;
  richtig sind 4.167 mm, Feuerkogel 1944).
  **Rekordtage** (`api/
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
  **Das Detailfenster sagt FETT und ZUERST, was es zeigt**
  (`.atdetail-what`: Größe + Zeitbezug, im Abweichungsmodus mit „·
  Abweichung"). Vorher stand das dreimal klein und grau verstreut —
  „Niederschlag Summe — Reihe der Perioden" oben, „Jahr 2011–2025 ·
  Niederschlag Summe · mm" unter dem Diagramm —, und der ZEITBEZUG fehlte in
  der obersten Zeile ganz. Bei einer Summe ist das der Unterschied zwischen
  813 mm im Monat und 2.211 mm im Jahr: die Zahl allein sagt nicht, welche
  Frage sie beantwortet. Die Bildunterschrift trägt seither nur noch, was
  NUR sie weiß (Jahre, Bezugsperiode, Einheit); die Größe steht einmal.
  `scopeLabel` ist dafür aus der Komponente in den Kern `atHistory.ts`
  gewandert — zwei Stellen brauchen ihn jetzt, und die Überschrift ist die
  letzte, bei der man eine abweichende Fassung bemerken würde.
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
  **Die Farbe der REKORDPFEILE hängt an der GRÖSSE, nicht an hoch/tief**
  (`recordToneColors` in `config/atParameters.ts`, `tone()` im
  Stationsdetail). Sie muss sich lesen wie die Balken der Perioden-Historie,
  die im SELBEN Fenster direkt darüber stehen — und tat es beim Niederschlag
  nicht: dort stand ein roter ▲ auf der nassesten Jahreszeit, während das
  Balkendiagramm zwei Zentimeter höher Nässe türkis zeichnete. Jetzt gilt
  warm/kalt für die Temperatur, **nass/trocken für den Niederschlag**
  (türkis nach oben, ocker nach unten) und weiter umgedreht für die
  Kälte-Kenntage (`highIsCold`). Die Sonnenscheindauer braucht keinen
  eigenen Eintrag: viel Sonne = warmes Orange ist schon die richtige Lesart.
  **Mitgenommen: die NIEDERSCHLAGSTAGE.** Sie stehen in der Registry unter
  „Kenntage" und fielen deshalb sowohl bei den Pfeilen als auch bei
  `anomalyBarColors` in den Rot/Blau-Zweig — mehr Regentage sind aber nasser,
  nicht wärmer. Beides entscheidet jetzt dieselbe Hilfsfunktion.
  **Die Balkenfarben lassen sich dafür NICHT einfach übernehmen** — als TEXT
  sind sie zu dunkel. Gemessen auf dem Zellenhintergrund (#232428): BrBG-
  Türkis #35978f 4,4:1, BrBG-Braun #bf812d 4,7:1, das Trüb-Blau der
  Sonnenrampe #4d6183 sogar nur 2,5:1, während die vorhandenen Pfeilfarben
  bei 6,2:1 liegen. Die Pfeile benutzen deshalb aufgehellte Fassungen
  derselben Töne (#49bdb0 / #d69a3f, 6,8 und 6,3:1); ein Test hält alle
  Kontraste über 4,5:1 UND hält fest, dass die rohen Balkenfarben darunter
  liegen — damit niemand die zwei Sätze zu einem zusammenzieht. Die Farben
  stehen seither in der Registry und nicht mehr als CSS-Klassen: welche
  Farbe gilt, kann CSS nicht entscheiden.
  **Bei Frost- und Eistagen ist das OBERE Ende der Größe das KALTE, und die
  Farbpolarität dreht deshalb mit** (`AtParameterSpec.highIsCold`, gesetzt auf
  `tage_frost`/`tage_eis`): der Winter mit den MEISTEN Frosttagen ist der
  kälteste. Die Karte machte das über `COLD_RAMP` schon richtig (86 Frosttage =
  hellblau), drei andere Stellen nicht — im Stationsdetail stand ein ROTER ▲ auf
  „86 Frosttage, Winter 1963", die Balken der Perioden-Historie zeigten „mehr
  Frost" rot, und die Anomalieskala der Karte ebenso. Alle drei hängen jetzt an
  dem einen Feld: `tone()` in `AtStationDetail` (Klassen heißen seither
  `atdetail-recwarm`/`-reccold`, nach der BEDEUTUNG statt nach der Richtung —
  der PFEIL bleibt an hoch/tief gebunden), `anomalyBarColors` und
  `anomalyScale`/`climateAnomalyScale` über `reverseColors()`, das die Skala
  SPIEGELT statt eine zweite Farbtabelle zu pflegen (zwei Listen, die
  spiegelbildlich gleich bleiben müssen, laufen auseinander; ein Test hält
  fest, dass nur die Farben tauschen und die Schwellen stehen bleiben). Balken
  und Karte MÜSSEN zusammen kippen — dieselbe Lesart in beiden ist eine
  gesetzte Regel (`anomalyBarColors`). NICHT gedreht sind Niederschlag, Sonne
  und Niederschlagstage: die sagen nass/trocken bzw. trüb/sonnig, nicht
  warm/kalt, und haben ihre eigenen Rampen.
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
  **JETZT-WERTE DER TAWES-STATIONEN** (`derived: 'current'`, `fetchLiveCurrentValues`, Kern
  `currentStationValue`, nur am laufenden Tag aus `klima-v2-10min`): Temperatur (`tl`), Wind (`ff`),
  Böen der letzten Stunde bzw. 24 h (`ffx`, `liveWindowH`) und Windfiedern (`barbs`, Richtung `dd`,
  `drawStationBarbs`, ausgedünnt am Kartenraster). Liegt eine Station über eine Stunde hinter dem
  Netz, bleibt sie leer (ein stehengebliebener Fühler sähe sonst aktuell aus). Stationen melden
  einzelne Termine oft verspätet: über eine Stunde darf die Hälfte der Werte fehlen, über 24 h ein
  Viertel. Die Uhrzeit steht groß in der Überschrift der Karte.
  **ZEITSCHIEBER ÜBER 3 TAGE** (seit 2026-11-09, auf Wunsch; älter ist Sache des Klimaarchivs): der
  Worker führt ALLE 23 Größen der 10-Minuten-Werte über 120 h in R2, seit 2026-11-12 EINE DATEI JE
  GRÖSSE (`tawes/10min/<code>.bin`, Kern `config/tawesStore.ts`, `worker/tawes.ts`, eigener Cron alle
  10 min, ~3.300 Schreibvorgänge am Tag, zusammen ~2,2 MB, je Datei 2–240 KB). Die Klimakarte lädt
  davon nur `tl, rf, ff, ffx, dd` (`loadTawesStore`), der Bereich TAWES (s. u.) die gewählte Größe.
  120 h, weil die 48-h-Niederschlagssumme des Bereichs TAWES am ältesten Termin ihr Fenster braucht.
  Die alte Sammeldatei `tawes/recent.bin` wird nicht mehr geschrieben und kann aus R2 weg.
  Jeder Lauf holt die letzten 6 h neu, verspätet gemeldete Termine füllen sich so nach.
  Direkt bei GeoSphere dauern 3 Tage aller Stationen 6 bis 8 s je Größe (gemessen 2026-11-09), das
  taugt für keinen Schieber. Fehlt die Datei oder ist sie über 2 h alt, gibt es keinen Schieber und
  die Werte kommen wie bisher direkt von GeoSphere. Lokal: `npm run ingest:tawes`, dann Dev-Server neu.
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
