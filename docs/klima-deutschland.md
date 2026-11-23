# Klimamonitor Deutschland

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Klimamonitor DEUTSCHLAND** (seit 2026-10-08, Phase 1) — derselbe Bereich
  wie die Österreich-Klimakarte, Umschalter **Österreich | Deutschland** vorn
  in der Leiste (`country` in `AtClimatePanel`). **Der DWD hat KEIN CORS**
  (gemessen am Climate Data Center wie am Radar) → anders als bei GeoSphere
  fragt der Browser nicht beim Anbieter, sondern liest im Deploy erzeugte
  Dateien unter `public/de/` (`scripts/de-ingest-climate.mjs`, npm
  `ingest:de:climate`, gitignored). Folge: der Stand ist so alt wie der
  letzte Deploy, und Tageskarten gibt es nur im „recent"-Fenster des DWD
  (~anderthalb Jahre, bis gestern). **HEUTE kommt aus den 10-Minuten-Werten**
  (`10_minutes/*/now`, ~2,4 MB, 5 s für ~460 Stationen, beim DWD ~30 min
  Verzug) → `today.json`, als `source: 'live'` mit Messzeitpunkt wie der
  Live-Tag Österreichs; Tagesgrenze 00 UTC, Max/Min aus den 10-Minuten-
  EXTREMEN (TX_10/TN_10), nicht aus den Terminwerten. Er ist die Vorgabe
  beim Umschalten. `--today-only` erneuert nur diesen Teil — gedacht für
  einen häufigeren Lauf; im Deploy ist er so alt wie der letzte Lauf — der
  Cron läuft deshalb seit 2026-10-09 STÜNDLICH (vorher alle 3 h).
  **Nach einem lokalen Ingest den Dev-Server neu starten** (siehe
  Modellkarten: neue Dateien in `public/` kennt Vite sonst nicht und liefert
  die Startseite — hier war `today.json` deshalb zuerst „leer").
  **Die Größen tragen die CODES der Österreich-Registry** (`tl_mittel`,
  `tlmax`, `rr`, `tage_frost` …; Zuordnung DWD-Spalte → Code in
  `MONTHLY_MAP`/`DAILY_MAP` des Ingests), und `fetchDePeriodValues`
  (`api/deClimate.ts`) liefert dieselbe `PeriodValues`-Form samt
  `PeriodCoverage` — Karte, Farbskalen, Abweichung, Rangliste und die
  Teilzeitraum-Logik („läuft noch — bisher …") laufen dadurch ohne Sonderweg.
  `deParamAvailable` ergänzt `isParamAvailable` um das, was der DWD führt.
  Was es in Phase 1 NICHT gibt: Allzeit-Rekorde, Klimaarchiv-Fragen,
  HISTALP, Perioden-Historie und Tagesreihe im Stationsdetail
  (`DeStationDetail` zeigt Wert, Normal, Abweichung und Stammdaten).
  **Gemessen (2026-10-08)**: 573 aktive Stationen mit Tageswerten, 1.241 mit
  irgendeiner Reihe; Monatskarten ab 1881 (125 Stationen damals); Assets
  50 MB. Historische Archive ~400 MB (Monat 35 MB, Tag 360 MB) liegen in
  `.cache/de-climate/` bzw. im Actions-Cache (Schlüssel je Monat) und werden
  nur ersetzt, wenn der DWD sie neu schreibt (Reihenende im Dateinamen); je
  Deploy neu geholt wird nur das recent-Fenster (~25 MB, rund 1 min).
  **KENNTAGE zählt der Ingest selbst** — der DWD-Monatsdatensatz führt sie
  nicht —, und zwar nur aus VOLLSTÄNDIGEN Monaten der Quellgröße: ein Monat
  mit Lücken ergäbe zu wenige Frosttage und sähe aus wie ein milder Winter.
  Ein gerade abgeschlossener Monat, den `monthly/kl` noch nicht führt, wird
  ebenso aus vollständigen Tageswerten gebildet; der laufende Monat steht als
  Teilwert in `running.json`.
  **Saison und Jahr nur aus ALLEN Monaten der Station** (`fetchDePeriodValues`):
  gemessen hatten 2025 43 Stationen Lücken — Reit im Winkl nur Jänner bis
  März, „Jahresmittel" 1,0 °C, 6,4 K unter dem Normal. **Seit 2026-10-08 gilt
  dieselbe Regel für Österreich** (`fetchPeriodValues`): gemessen hatten 2024
  dort 7 Stationen beim Temperaturmittel und 9 beim Niederschlag nur
  Teiljahre (Waizenkirchen 5, Jenbach 8 Monate) und standen bis dahin mit
  verzerrten Jahreswerten in der Karte.
  **Normale rechnet der DWD selbst** (`multi_annual/mean_91-20`, `mean_61-90`):
  Temperaturmittel, Niederschlag, Sonne und vier Kenntage; für Max/Min und
  Niederschlagstage gibt es KEINE, dort bleibt die Abweichung leer.
  Stationsliste: SIEHT aus wie Festbreiten-Text, ist es aber nicht (die
  Strichzeile ist breiter als die Werte) — geparst über ein Muster, das
  Bundesland über die feste Liste der 16 Länder. **Beim Umschalten ist die
  Stationsliste an ihr Land gebunden** (`stationsOf`): die Effekte liefen
  sonst eine Runde mit der alten Liste, und Österreich fragte GeoSphere mit
  DWD-Kennungen (HTTP 403). Karte `DE_VIEW` auf dem Europa-Bündel,
  Beschriftung ausgedünnt (38 px).
  **REKORDE UND KLIMAARCHIV (Phase 3)** — der Ingest schreibt
  `public/de/records/` in DERSELBEN Form wie `public/at/records/`
  (Stationsdateien, `_national.json`, Karten-Index über die gemeinsame
  `buildRecordIndexes` aus `scripts/at-build-record-index.mjs`). Die Lader
  `loadStationRecords`/`loadRecordIndex`/`loadNationalRecords` nehmen dafür
  ein Land (`RecordCountry`, Vorgabe `at`); Allzeit-Karte, Rekordtabelle im
  `DeStationDetail` und Klimaarchiv lesen beide Länder über denselben Weg.
  Monatsebenen aus den Monatswerten ab 1881, der TAGESblock (wärmste Nacht,
  kältester Tag, nassester Tag, exaktes Datum) aus den historischen + recent
  Tagesreihen, mit derselben Plausibilitätsregel wie Österreich (Minimum über
  Maximum → verworfen; gemessen 3 Tage). Gegengeprüft: Deutschland-
  Jahresrekord 41,2 °C Tönisvorst 2019, nassester Tag 312 mm Zinnwald-
  Georgenfeld 12.08.2002 — beides die amtlichen Werte.
  **Das Klimaarchiv ist länderfähig über `AskCountry`** (`ASK_AT`/`ASK_DE` in
  `climateAsk.ts`): Landeswörter, Bundesländer samt exakten Kürzeln (`nrw`)
  und der Name im Antworttext — alles andere ist dieselbe Sprache. Der
  Gebietsschlüssel heißt seither `'country'` statt `'austria'`.
  `matchState` prüft ZUSAMMENGEZOGENE Nachbartokens jetzt ZUERST:
  „Sachsen-Anhalt" sind die Tokens „sachsen anhalt", und einzeln geprüft
  gewann „Sachsen" — ein anderes Land (für Österreich ändert das nichts, alle
  Tests liefen unverändert). `resolvePlace` trennt den Ortsnamen an
  denselben Grenzen wie `normalize` (Bindestrich, Schrägstrich, Klammer),
  sonst hieß der Ort „Berlin-Dahlem" statt „Berlin". Die Monatsnamen der
  Antworttexte sind österreichisch; `AtAskBox` wechselt für Deutschland beim
  ANZEIGEN „Jänner" → „Januar" (`L`), weil die Datumsformate kein Land
  kennen. `nightNote` nennt für Deutschland die DWD-Tagesgrenze (seit 2001
  00–24 UTC, davor 21:30–21:30 MEZ, aus den Parameter-Metadaten) — die
  Nacht vor dem Tag liegt in beiden Konventionen im Fenster. Den exakten
  Rekordtag (`resolveExtremeDay`) gibt es für Deutschland nicht: er holt die
  Tagesreihe bei GeoSphere. Bekannte Grenze: „Frankfurt" fasst Frankfurt/Main
  und Frankfurt/Oder zu EINEM Ort zusammen (gleicher Namensanfang) — die
  Antwort sagt „in Frankfurt" und nennt beide in der Spanne.
  **EXAKTER REKORDTAG beim Bauen statt zur Laufzeit**: der Ingest merkt sich
  je Station und Monat den Tag des höchsten Maximums und tiefsten Minimums
  (`monthExt`) und hängt ihn an die Rekorde von `tlmax`/`tlmin` — nur wenn der
  Tageswert den Rekord GENAU trifft (±0,05), sonst bleibt es beim Monat.
  Gemessen 41.024 von 41.025 aufgelöst. Österreich holt denselben Tag erst
  beim Fragen bei GeoSphere (`resolveExtremeDay`); für den DWD gibt es
  dorthin keinen Abruf. Gegenprobe: 41,2 °C Tönisvorst am 25.07.2019.
  **PERIODEN-HISTORIE im Stationsdetail** wie bei Österreich: der Ingest
  schreibt je Station die ganze Monatsreihe (`de/series/<id>.json`, ab dem
  ersten Jahr, je Größe ein flaches Array, 1.184 Dateien, 36 MB),
  `loadDeSeries` gibt sie in der Form von `fetchStationSeries` zurück, und
  `AtPeriodHistory` nimmt ein Land (`country`) — dieselbe Zeichnung für beide.
  **GEBIETSMITTEL (Phase 2)** — zweiter Umschalter **Stationen | Gebietsmittel**
  (`api/deRegional.ts`, `DeRegionDetail`): die amtlichen FLÄCHENmittel des DWD
  je Bundesland und für Deutschland (`regional_averages_DE`, aus dem
  1-km-Raster), also genau die Zahl, die es für Österreich bewusst NICHT gibt.
  Temperatur und Niederschlag ab 1881, Sonne ab 1951, je Monat/Jahreszeit/
  Jahr; Frost-, Eis-, Sommer- und Hitzetage nur JÄHRLICH ab 1951 (so führt
  sie der DWD — `deRegionalAvailable`). Gegengeprüft: Deutschland 2024
  10,89 °C (amtlich 10,9), Sommer 2003 19,67 °C. Berlin, Hamburg und Bremen
  gibt es nur mit dem Umland — genommen werden genau diese Kombinationen,
  damit die Fläche lückenlos aufgeteilt ist (13 Regionen). In der Karte steht
  jedes Land als PSEUDO-STATION (fester Beschriftungspunkt, große Schrift
  `labelPx`), Deutschland selbst in der Überschrift (anklickbar,
  `byStation[DE_ID]`). Das NORMAL kommt aus derselben Reihe (≥ 24 der 30
  Jahre) und hat die Form von `NormalsMap` — die Abweichungslogik läuft
  unverändert. Das Detail zeigt die ganze Reihe mit dem gewählten Jahr
  gelb markiert und seinen RANG („Platz 8 der wärmsten · 146 Jahre seit
  1881"; Superlativ im Genitiv PLURAL, weil Monatsnamen und Jahr verschiedene
  Genera haben). Kein Tag, kein Teilzeitraum: der DWD veröffentlicht nur
  abgeschlossene Monate.
