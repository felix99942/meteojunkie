# Föhn

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

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
  **QUERSCHNITT** (seit 2026-11-09, Umschalter „Querschnitt" im Bereich;
  `scripts/icon-section-ingest.py`, npm `ingest:icon-d2-section`, Kern
  `config/foehnSection.ts` mit Tests, Zeichnung `components/FoehnSection.tsx`):
  ICON-D2 entlang der Föhnachsen, Farbe = Vertikalwind oder Wind längs der Achse,
  Linien = potentielle Temperatur, Pfeile = Strömung in der Schnittebene.
  **Aus den MODELLFLÄCHEN, nicht aus Druckflächen**: nur die folgen dem Gelände und
  zeigen den Föhnstrom in den Tälern, `w` ist dort echte Modellgröße (Varda führt
  keine Vertikalbewegung). Beim DWD je Größe × Fläche × Schritt eine Datei (~1 MB):
  t, u, v, p auf 1–65, w und hhl auf 1–66, von oben gezählt, hhl unter
  `hhl/…time-invariant…` (live 2026-11-09). Bis 9 km, ab 3 km jede zweite
  Fläche: 37 Flächen, unten ~25 m Abstand,
  unterste Fläche 10 m über Grund. Stündlich bis +24 h, danach 3-stündlich, weil
  sonst die Abrufe doppelt so viele wären. Gemessen lokal 14 min je Lauf (~6 GB
  Download, nicht gespeichert), Ergebnis 1,5 MB JSON je Achse (0,4 MB gzip).
  Eigenes Verzeichnis `nwp/icon-d2-section`, eigener Actions-Cache je Lauf.
  **Der Längswind ist auf EINE Richtung je Achse projiziert** (Anfang → Ende): dem
  Linienverlauf folgend sprang er an jedem Knick senkrecht durch die ganze Säule.
  Die Achsen stehen im Ingest (Wegpunkte) und reichen über die Föhnpunkte hinaus.
  **Dazu eine FREI ZIEHBARE Nord-Süd-Linie** (45,0–48,6° N, 6,0–16,5° O, Eintrag
  in der Auswahl „Achse", Vorgabe bleibt Bozen–Innsbruck; aufklappbare Karte `SectionLocator`, oben rechts im
  Diagramm die Mini-Karte des DACH-Raums mit roter Linie): alle 0,1° eine eigene
  Datei (`lon-114.json`, 106 Stück). Die Felder sind ohnehin geholt, jede Linie
  kostet nur Rechnen: gemessen 290 MB je Lauf, je Linie 2,7 MB bzw. 0,7 MB gzip;
  geladen wird erst, wenn die Linie 140 ms steht, dazu die zwei Nachbarn. Im Browser
  bleiben nur die letzten zehn Schnitte (`SECTION_LRU`). Während des Ladens bleibt
  der vorige Schnitt stehen, Beschriftung und Mini-Karte nennen deshalb den
  GELADENEN Schnitt, nicht die Position der Linie. Längswind positiv nach Norden.
  **Live geprüft (2026-09-14, alle sieben Achsenpunkte)**: ICON-CH1 (1 km,
  33 h), AROME France (1,5 km, 51 h), ICON-CH2 (2,1 km, 120 h), ICON-D2 (2,2 km,
  48 h), AROME Austria (2,5 km, 60 h) liefern `pressure_msl`/`surface_pressure`/
  Bodengrößen; **700 hPa nur ICON-D2 und AROME France** (`FOEHN_UPPER_AIR_
  MODELS`, die übrigen durchgehend null) — deshalb ICON-D2 als Detailmodell.
  `meteofrance_arome_france_hd` liefert KEIN `pressure_msl` und fehlt deshalb.
  Lokal-Ensembles: ICON-CH2-EPS (21 Member, +120 h, Voreinstellung),
  ICON-D2-EPS (20), ICON-CH1-EPS (11) — über `useEnsembleSeriesFor` mit
  expliziter Tages-/Memberzahl, weil `getEnsembleModel` unbekannte IDs still
  auf IFS abbildet (15 Tage, 51 Member). **ICON-CH1/CH2 sind inzwischen FREIGESCHALTET**
  (waren `selectable: false`, solange nur die Föhn-Größen geprüft waren): live
  verifiziert (2026-09-16, Innsbruck) liefern BEIDE alle 19 Größen des
  klassischen Meteogramms vollständig — `weather_code`, `is_day`, die vier
  Bewölkungsschichten, `precipitation_probability`, `cape` und
  `shortwave_radiation` inklusive, kein leeres Feld. Auch die Registry-Werte
  bestätigten sich beim Nachmessen: CH1 endet bei +43 h ab Rasterbeginn, vom
  geschätzten 09-UTC-Lauf also genau die eingetragenen 33 h; CH2 bei +127 h,
  vom 06-UTC-Lauf 120 h (eine schöne Gegenprobe für `modelHorizonEnd`, das ab
  Init rechnet). Die Abdeckung hält ebenfalls — Werte in Innsbruck, Salzburg,
  WIEN und Lugano, Fehler in Berlin (jenseits 50,5° N). In der Auswahl stehen
  sie an der Spitze der Lokalmodelle; CH1 mit 1 km ist das feinste Modell der
  Registry. **Drucklevel haben sie weiter NICHT** — das gatet
  `PRESSURE_LEVEL_MODELS` in `config/levels.ts` unabhängig von `selectable`,
  sonst zeigte das Vertikalprofil leere Diagramme. Vier Tests halten
  Freischaltung, Größenliste, Einordnung und die fehlende
  Drucklevel-Fähigkeit fest.
  `config/levels.ts` ist deswegen inzwischen KOMPLETT NACHGEMESSEN (s. u.) —
  ICON-D2 ist dort jetzt drucklevelfähig geführt.
  `usePointSeries` holt Serien OHNE Registry-Gate (Drucklevel,
  `surface_pressure` stehen nicht in `availableVariables`), mit demselben
  Query-Key und Batcher wie `useMeteogramSeries`. Kosten je Achse: ein
  Request je Punkt (Tirol 3 — Lee fällt mit Nord zusammen, Schweiz 4) plus
  zwei Ensemble-Abrufe. Dafür neu in `ChartStack`/`chartDef`: `flagRows`
  (Kriterien-Streifen), `Curve.quiet` (Member ohne Werteanzeige/Legende),
  `symmetricMin` (Achse symmetrisch um 0) und `yInclude` (Bezugswerte, die
  die Achse immer enthält). Die Stundenbeschriftung kommt aus
  `getUTCHours`: de-DE formatiert eine reine Stunde als „06 Uhr".
