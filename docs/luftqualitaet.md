# Luftqualität

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Luftqualität** (`AirQualityPanel.tsx`, Registry/Kerne `config/airQuality.ts`
  mit Tests, Abruf `fetchAirQuality` in `api/openmeteo.ts`, AppView `air`,
  seit 2026-10-18) — CAMS-Vorhersage über die Air-Quality-API von Open-Meteo
  am globalen `lockedLocation`: Europäischer Luftqualitätsindex (EAQI) mit den
  Stufengrenzen als Linien, Feinstaub PM2,5/PM10, NO₂, Ozon, Wüstenstaub. In
  der Leiste der Index der laufenden Stunde samt Stufe und dem MASSGEBLICHEN
  Schadstoff (höchster Teilindex — „mäßig wegen Ozon" ist eine andere Lage als
  „mäßig wegen Feinstaub"). **Punkt statt Karte, das ist Budget**: EIN Abruf je
  Ort für alle 11 Größen (≈ 1 Call), `staleTime` 1 h (CAMS rechnet einen Lauf
  am Tag); über `apiGet`, also mock-fähig und im Zähler. Live geprüft
  (2026-10-18): CORS `*`, kein Key. **NUR `cams_europe`** (0,1°, bis ~+4 Tage):
  die Vorgabe `auto` hängt danach CAMS global (0,4°) an, mit einem Sprung an
  der Naht (Ozon nachts 41 gegen 5 µg/m³) — der sähe wie ein Wetterwechsel
  aus. Außerhalb Europas antwortet `cams_europe` mit HTTP 400 „No data is
  available for this location", NUR dann wird auf `cams_global` gewechselt und
  ein Hinweis gezeigt. Über den Horizont hinaus kommen nulls (SPEC §6) — die
  Achse endet am letzten Wert (`dataEnd`). `uv_index` gibt es nur global und
  fehlt deshalb. Pollen bewusst noch nicht (Saison vorbei). Quellenzeile nennt
  CAMS (Copernicus-Bedingung) und Open-Meteo.
  **Die Achsen folgen den DATEN, nicht festen Grenzen** (auf Wunsch): der
  Index endet auf der nächsten Stufengrenze über dem Höchstwert
  (`eaqiAxisTop` — unter 40 bis 40, reißt ein Wert die 60, bis 80), die
  Konzentrationen am Datenmaximum mit nur kleinen Böden (5–10 µg/m³) gegen
  das Aufblasen von Hauchwerten. Die Stufen stehen als FLÄCHEN in ihrer
  EEA-Farbe hinter der Kurve, groß beschriftet („ausreichend", „mäßig" …;
  `ChartDef.yZones`, gezeichnet im `drawClear`-Hook unter Gitter und Kurve,
  Beschriftung nur wo der Streifen hoch genug ist).
  **WHO-Richtwerte 2021, BEWUSST NUR WHO** (auf Wunsch, keine EU-Grenzwerte;
  `WHO_GUIDELINES`): PM2,5 15 und PM10 45 µg/m³ im 24-h-Mittel, NO₂ 25 im
  24-h-Mittel (dazu 200 als Stundenwert, aus den Leitlinien 2005), Ozon 100 im
  8-h-Mittel. **Sie stehen NICHT als Linien im Diagramm**, sondern als
  Erläuterung hinter einem ⓘ je Größe — auf Wunsch auf ein Minimum gekürzt:
  Richtwert, Mittelungszeitraum und dass ein einzelner Stundenwert ihn nicht
  reißt, ein Satz je Größe. Das ⓘ ist ein eigenes `InfoPop` statt `<details>`:
  schließt beim Klick daneben, mit Escape und nach 10 s von selbst.
  **ALLES IST MODELL, AUCH „JETZT" UND DIE MITTEL** — CAMS-Vorhersage, die
  vergangenen Stunden aus `past_days` ebenso; keine Messung. Steht als
  „Modellwerte (CAMS) · keine Messung" am Ende der Kastenreihe, ohne das
  läse sich „Jetzt 42" wie ein Messwert.
  **GEMESSENE WERTE (nur Österreich) als WEISSE Kurven** (seit 2026-10-18,
  `config/airMeasured.ts` mit Tests, Abruf `api/airMeasured.ts`, Messstellen
  `public/air/at-stations.json` aus `scripts/air-ingest-stations.mjs`, npm
  `ingest:air:stations`): Download-Dienst der EEA, „Up To Date" (E2a) —
  aktuelle, UNGEPRÜFTE Stundenmittel, ~2–3 h Verzug. **CORS `*` samt
  Preflight**, `POST /ParquetFile` schneidet den Zeitraum serverseitig zu: ganz
  Österreich, vier Stoffe, ein Tag ≈ 140 KB in ~3 s, EIN Abruf, der Ort wird
  erst danach gewählt (Ortswechsel kostet nichts). Abgerufen nur, wenn eine
  Messstelle ≤ 15 km vom Ort liegt. ZIP/Parquet lesen `fflate`/`hyparquet`
  (Versionen bewusst älter gepinnt), dynamisch geladen — eigene Pakete von
  ~30 und ~60 KB. **Die Zeitstempel sind Wiener ORTSZEIT MIT SOMMERZEIT**,
  obwohl die Metadaten „UTC+01" sagen — gemessen gegen die Halbstundenwerte
  des Landes OÖ mit ausdrücklichem Offset (Linz Stadtpark: UTC+2 exakt,
  UTC+1 2,4 µg/m³ daneben); umgerechnet über Europe/Vienna
  (`viennaWallToUtc`). Nach der Winterzeit-Umstellung (25.10.2026) noch
  einmal gegenprüfen. Gezeichnet am ENDE der Messstunde. **Stationswahl**:
  nächste HINTERGRUNDstation ≤ 15 km, sonst die nächste beliebige — das Modell
  rechnet Hintergrundbelastung, eine Straßenstation misst NO₂ systematisch
  höher; Station, Abstand und Typ stehen in der Kopfzeile. Bei zwei Geräten
  am selben Ort gewinnt das mit mehr Werten. Andere Quellen geprüft und
  verworfen: UBA Deutschland ohne CORS, Österreich ohne bundesweite API
  (nur einzelne Länder), OpenAQ nur mit Key; die EEA-JAHRESdateien
  (`/ParquetFile/urls`) liegen ohne CORS. Erste Befunde: Salzburg NO₂ abends
  gemessen ~29 gegen 8 µg/m³ im Modell, Sonnblick Ozon ~90 gegen 65.
  **Gemessene 8-/24-h-Mittel ERSETZEN die Modellmittel** (auf Wunsch, je
  Zeitraum: gibt es das gemessene Mittel, steht nur dieses da, sonst das
  Modell; Kopfzeile weiß, „bis HH:MM UTC"; der gemessene 24-h-Kasten führt
  zusätzlich PM10 und PM2,5 — deren WHO-Richtwert gilt fürs 24-h-Mittel, und
  der Jetzt-Index ist ein Modellwert, gemessener Feinstaub stünde oben sonst
  nirgends; Feinstaubgrenzen `CONC_BANDS` 5/15/50 bzw. 15/45/120): sie enden an der JÜNGSTEN gemessenen
  Stunde, nicht an „jetzt" — die Messung hinkt 2–3 h hinterher
  (`measuredMean`, ≥ 3/4 der Stunden belegt). Dafür wird ab GESTERN
  abgerufen (~280 statt ~140 KB). Der Jetzt-Kasten ist zweizeilig und die
  Kopfzeilen tragen „Modell"/„gemessen", damit alle fünf Kästen in eine Reihe
  passen — umgebrochen kosteten sie den Diagrammen eine ganze Zeile.
  **Der aktuelle Zeitpunkt ist eine ROTE, 3 px breite Linie mit „aktuell"
  LÄNGS der Linie** (`MarkStyle` in `chartDef.ts`, `markPlugin` in
  `ChartStack`; ohne Stil bleibt es die dünne gestrichelte Markerlinie der
  MOS-Vorhersage). Die Schrift schrumpft mit der Zeilenhöhe und entfällt
  unter 8 px, statt in die Achse zu ragen. Eine Fassung, die die Achse erst
  3 h vor der jüngsten Messung beginnen ließ, war auf Wunsch wieder draußen —
  man sah zu wenig von der Messung.
  **AMPEL rechts neben den Kästen** (`ampelDecision`/`ampelOf` in
  `config/airQuality.ts` mit Tests): grün bis „ausreichend", gelb „mäßig",
  rot ab „schlecht". Grundlage sind die Modell-Teilindizes der laufenden
  Stunde; fällt das jüngste GEMESSENE PM2,5 (höchstens 6 h alt,
  `AMPEL_MAX_AGE_H`) in eine ANDERE Stufe als das Modell-PM2,5, ersetzt es
  dessen Teilindex (auf Wunsch) — die Ampel folgt dann dem höchsten aus
  gemessenem Feinstaub und den übrigen Modell-Teilindizes. Darunter steht,
  ob sie „nach Modell" oder „nach Messung PM2,5 … µg/m³ (HH:MM UTC)" steht. Eine Fassung mit Richtwertlinien plus gleitenden Mittelkurven war
  auf Wunsch wieder draußen: zu unübersichtlich — ebenso danach je Zeile
  zuschaltbare Mittelkurven und AMPELFARBEN der Kurven nach Grenzwerten (beides
  gebaut und wieder entfernt). Die Diagramme zeigen nur die Stundenwerte.
  **Die Mittel stehen stattdessen als ZAHLEN neben dem Jetzt-Kasten**: je ein
  Kasten 8-h- und 24-h-Mittel mit NO₂ und Ozon (nachlaufend bis zur laufenden
  Stunde, `rollingMean`, Wert nur bei ≥ 3/4 belegtem Fenster), Zahl und Stufe
  in der EAQI-Farbe, Rand in der schlechteren. Feinstaub fehlt dort bewusst —
  er bestimmt meist schon den Index. Eingeordnet über `concBand`/`CONC_BANDS`:
  **die Indexgrenzen sind GEMESSEN** (2026-10-18, Wien, 96 h) — Open-Meteo
  rechnet die Teilindizes nach der NEUEN EEA-Einteilung (NO₂ 10/25/60/100/150,
  O₃ 60/100/120/160/180, PM2,5 5/15/50, PM10 15/45/120) auf den STUNDENwert,
  höchstens 0,5 Punkte Abweichung, mit der älteren Tabelle (NO₂ 40/90/120)
  bis 32. Die Grenze zu „mäßig" ist dort der WHO-Richtwert. Dafür holt der
  Abruf einen Tag Vorlauf (`past_days=1`), die Diagramme beginnen trotzdem
  heute 00 UTC.
  Der Index der laufenden Stunde steht GROSS links oben über dem
  ersten Diagramm (`.air-now`), nicht in der Leiste. Ein Hinweis „farbig:
  Modell / weiß: Messung" neben den Kästen ist auf Wunsch wieder raus — er
  verwirrte bei den Kästen, und die Diagramme sagen es selbst. Überschriften 16 px,
  der Ort steht groß im Jetzt-Kasten, die Uhrzeit des Zeigers als Kästchen
  NUR in der Indexzeile (in den flachen Zeilen überdeckte sie die Werte),
  Werteanzeige am Zeiger 16 px und MIT Kurvennamen (`ChartDef.readoutPx`/`readoutLabels`, gilt nur
  dort, wo gesetzt) — PM2,5 und PM10 teilen sich Einheit und Zeile.
