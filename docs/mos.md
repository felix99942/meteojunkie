# MOS-Vorhersage

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **MOS-Vorhersage** (DACH) — zweiter Modus des Österreich-Bereichs (`AtSection`
  schaltet Klima↔Vorhersage). Quelle: **DWD MOSMIX** (echtes MOS), 3060 Stationen
  im DACH-Raum (`public/mos/stations.json`, aus dem DWD-Katalog; Koordinaten sind
  Grad+Dezimalminuten → umgerechnet). DWD hat **kein CORS** → die Daten werden
  NICHT im Browser geholt, sondern per **Ingest im Deploy-Workflow** (`scripts/
  mos-ingest-forecast.mjs`, KMZ→KML-Parser `scripts/lib/mosmix.mjs`, kein externes
  Paket) zu kompakten Pro-Parameter-JSONs (`public/mos/forecast/*.json`, **gitignored**,
  im Build erzeugt) verarbeitet; der Browser lädt sie same-origin (`api/mosApi.ts`).
  `deploy.yml` läuft dafür zusätzlich per Cron (seit 2026-10-09 stündlich). **Seit 2026-11-02 JE LAUF im
  Actions-Cache** (`mos-forecast-v1-<lauf>`): MOSMIX_L erscheint nur
  viermal am Tag (03/09/15/21 UTC), der Ingest holt aber 3.060
  Einzeldateien und brauchte ~16 der ~22 Minuten eines stündlichen Laufs —
  20 von 24 Läufen holten denselben Stand erneut (der größte Posten der
  Actions-Minuten, wichtig für ein privates Repo). Der Lauf kommt aus der
  Sammelliste `MOSMIX_L/all_stations/kml/` (~1 KB; die Dateien erscheinen
  dort und bei den Einzelstationen in derselben Minute, gemessen). In den
  Cache nur, wenn der erste Termin = Lauf + 1 h ist (sonst war es ein
  halber Wechsel, und der nächste Lauf holt neu); bei einem Treffer wird
  trotzdem nach R2 synchronisiert, `--checksum` schreibt dann nichts, holt
  aber einen gescheiterten Upload nach. Ist die Liste nicht erreichbar,
  läuft der Ingest wie früher. T2m/Niederschlag/Sonne/
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
  **AUSGEDÜNNT NACH ZOOM — NUR IN DEUTSCHLAND** (seit 2026-11-02, auf
  Wunsch; `mosStationTier`/`MOS_TIER_ZOOM` in `config/atForecast.ts` mit
  Tests, `AtClimateMap.minZoom`): 2.614 der 3.060 Punkte liegen in
  Deutschland, dort steht in der Ausgangsansicht nur das STATIONSNETZ
  (WMO-Synopstationen, fünfstellige Kennung), ab 3-fachem Zoom kommen die
  MOSMIX-Zusatzpunkte dazu. Österreich, die Schweiz und alle übrigen Länder
  zeigen IMMER alle Stationen. Das LAND steht seither im Katalog
  (`country`, ISO alpha-3, `mos-ingest-stations.mjs` per Punkt-in-Polygon
  gegen Natural Earth 1:50m) — an der Kennung ist es nicht abzulesen (die
  P-Punkte reichen von Norditalien bis an die Ostsee, die Z-Punkte liegen in
  Tirol); 29 Seepunkte ohne Land zählen zu Deutschland. Eine erste Fassung
  zeigte in der Übersicht nur Flughäfen und Bergstationen (195) — „komische
  Vorauswahl", Würzburg fehlte. Bei der Label-Ausdünnung gewinnt je Zelle
  die Netzstation (`drawStationLabels(…, { order })`), ausgeblendete sind
  auch für Hover und Klick nicht da; hervorgehobene und markierte zeigt die
  Karte immer.
  **LOKAL IST DIE VORHERSAGE SO ALT WIE DER LETZTE EIGENE INGEST** — die
  JSONs sind gitignored und entstehen beim Bauen: auf der Seite alle 3 h per
  Cron, im Arbeitsbaum nur durch `npm run ingest:mos:forecast`. Am
  2026-09-30 stand hier deshalb ein Lauf vom 18.08. im Bild (Tmax 18.8.–
  28.8.), und **man sah es nicht**: die Laufangabe war auf die reine Uhrzeit
  formatiert, ein sechs Wochen alter Lauf sah aus wie der von heute.
  Aufgefallen ist es nur, weil Tmin/Tmax Datumsangaben tragen — bei den
  stündlichen Größen steht dort Wochentag und Uhrzeit, und ein „Di., 18:00"
  aus dem August liest sich wie heute. Seither steht der Lauf mit
  TAGESBEZUG da (`formatRunLong` wie in den übrigen Bereichen; anders als
  dort ist er hier GEMELDET und nicht geschätzt, also ohne `RUN_TITLE`),
  und `forecastFreshness` setzt einen sichtbaren Hinweis: „⚠ alter Lauf"
  ab `STALE_RUN_HOURS` = 12 h (bei ~4 Läufen/Tag zwei verpasste Zyklen),
  „⚠ Stand verbraucht", sobald der letzte Termin in der VERGANGENHEIT liegt
  — Letzteres schlägt Ersteres, denn dann ist es keine Vorhersage mehr.
  Fehlen die Zeiten (kaputte Meta), wird NICHT gewarnt: ein Fehlalarm bei
  jedem Ladefehler entwertet den Hinweis. Der Fall kann auch auf der Seite
  auftreten — `deploy.yml` lässt den Ingest mit `continue-on-error` laufen,
  ein DWD-Ausfall darf das Deployment nicht blockieren.
