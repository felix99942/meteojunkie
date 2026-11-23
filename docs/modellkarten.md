# Modellkarten

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Modellkarten** (Tab „Modellkarten", AppView-Id `globe` — dort hat der
  Bereich angefangen; `GlobePanel.tsx`, Registry/Kerne `config/globe.ts` mit
  Tests, Kacheln `render/globeTiles.ts` + `render/globeProtocol.ts`, Laden
  `api/globeData.ts`) — **ECMWF IFS 0,25°, DWD ICON-EU 7 km und ICON-D2
  2,2 km** als drehbarer Globus oder flache Karte (Ansichten Globus · Europa ·
  Alpen, MapLibre-Projektion je Ansicht): T2m, T850, 500 hPa, MSL,
  Niederschlag, Wind, Böen, Bewölkung (gesamt; bei ICON auch die Schichten),
  dazu Isolinien für Bodendruck und 500 hPa.
  **NICHT über Open-Meteo**, und das ist eine Rechnung, keine Vorliebe: ein
  Gitter kostet dort ~Punktzahl Calls — global 1° = 65.000, ICON-D2 nativ
  ~900.000 Punkte je Feld; das Tagesbudget sind 10.000 (Professional 5 Mio.
  im MONAT), und ein Browser-Cache hilft nicht, weil er je NUTZER gilt.
  Geholt wird einmal je Modelllauf im Deploy, direkt beim Anbieter — die
  Kosten hängen damit nicht an der Nutzerzahl. Punktdaten (Meteogramm,
  Ensemble, Soundings, Verifikation) bleiben bei Open-Meteo, dort sind sie
  billig.
  **Python statt Node**, als einzige Ingests: das GRIB2 ist CCSDS-komprimiert,
  `pip install eccodes` bringt die Bibliothek mit und dekodiert ein Feld in
  0,01 s. `scripts/nwp_common.py` ist der gemeinsame Kern (Abruf mit
  Gesamtfrist, `decode_grib`, Ableitung der Größen, Kodierung, atomare Ablage,
  Metadaten); `scripts/ecmwf-ingest.py` und `scripts/icon-ingest.py` liefern
  nur ihre Felder unter einheitlichen Namen. npm `ingest:ecmwf`,
  `ingest:icon-d2`, `ingest:icon-eu`; lokal vorher
  `python3 -m venv … && pip install -r scripts/requirements-nwp.txt`.
  Ablage `public/nwp/<modell>/` (gitignored): `meta.json` +
  `<lauf>/<größe>/<schritt>.webp`.
  **Gemessen (2026-10-05), ECMWF**: je Schritt eine GRIB-Datei (~146 MB) plus
  `.index` (JSON-Zeilen mit `_offset`/`_length`) — je Feld nur sein
  Byte-Bereich (0,5–0,9 MB). 00/12 UTC bis +360 h (3 h bis 144, dann 6 h),
  06/18 UTC nur +90 h und NICHT genommen. Verzug ~7,5 h. Raster 1440×721,
  Nord → Süd. **Die Bewölkung `tcc` kommt als ANTEIL 0–1, nicht in %** (gemessen
  2026-10-08, Mittel 0,66) — die 5-%-Kodierung rundete sie bis dahin überall
  auf 0, die IFS-Bewölkung zeigte die ganze Erde wolkenlos, ohne dass etwas
  fehlte; der Ingest-Bericht stand bei „0,0 MB" (ein konstantes Bild ist
  winzig). Jetzt ×100 in `ecmwf-ingest.py`. ICON liefert % und ist nicht
  betroffen. **Die Böe wechselt den Namen** (`10fg` bis +90 und ab +150,
  `10fg3` von +93 bis +144, `PARAM_ALIASES`). **Das Netz TRÖPFELT**: derselbe
  Byte-Bereich kam mit 7,8 MB/s und mit 90 KB/s; ein Socket-Timeout greift
  nicht, deshalb `DEADLINE_S` = 8 s Gesamtfrist mit Neuversuch (halbierte die
  Laufzeit, voller Lauf ~8 min). Der AWS-Spiegel antwortete durchgehend 503
  „SlowDown".
  **Gemessen (2026-10-05), DWD ICON** (opendata.dwd.de, KEIN CORS, eine
  bz2-GRIB-Datei je Größe × Schritt): ICON-D2 regelmäßig 0,02°, 1215×746,
  43,2–58,1° N / 3,9° W–20,3° O, alle 3 h, 0–48 h stündlich, komplett
  ~HH+1:20; ICON-EU 0,0625°, 1377×657, 29,5–70,5° N / 23,5° W–62,5° O,
  00/06/12/18 bis +120 h (stündlich bis 78, dann 3 h), komplett ~HH+3:40 —
  die Zwischenläufe (~30 h) werden NICHT genommen. **ICON tastet Süd → Nord**
  ab, ECMWF Nord → Süd — das Raster kommt deshalb aus der Nachricht
  (`decode_grib`), nie aus einer Annahme. Durchsatz 22–26 MB/s, 0 Fehler:
  D2 17 s / 54 MB, EU 38 s / 136 MB je Lauf. Vorhaltung beim DWD nur ~24 h.
  Das gültige D2-Gebiet ist KEIN Rechteck (ca. 150.000 Randpunkte fehlen, nach
  Süden schmaler) — die gezackte Kante in der Karte ist der Modellrand.
  **Der Niederschlag trägt sein Intervall im NAMEN** (seit 2026-11-03, auf
  Wunsch, `variableLabel`/`precipReadout` in `config/globe.ts`): Auswahl in
  Globusansicht und Panels „Niederschlag 3 h" bzw. „1 h" für den gezeigten
  Schritt, Panel-Legende „mm/3 h", Wert am Zeiger „2,4 mm in 3 h". MOS heißt schon
  „Niederschlag (1 h)", die Radarprodukte nennen ihren Zeitraum im Namen.
  **Gezeigt wird die MENGE je Intervall, nicht die Rate** (seit 2026-11-05, auf Wunsch):
  das ist die Lesart auf Modellkarten, und das 3-h-Mittel täuschte Dauerregen vor, wo
  ein Schauer fiel. **Gespeichert bleibt die Rate** (mm/h, `unit` in der Meta), umgerechnet
  wird beim Laden (`displayCodeStep`), Fläche, Zeiger und Zahlen sehen also dasselbe.
  **Die Farbstufen hängen am Intervall** (`displayScale`, `PRECIP_1H`/`PRECIP_6H`, seit
  2026-11-09, auf Wunsch; das Intervall kommt über `FieldSource.interval` in den Worker):
  gleiche Farben, aber 3 mm in einer Stunde sind stärkerer Regen als 3 mm in drei. NICHT
  proportional zur Dauer, sondern rund Faktor 1,5 je Stufe: die DWD-Warnschwellen liegen
  für 1 h bei 15/25/40 mm, für 6 h nur bei 20/35/60 mm. Rot beginnt bei 1 h auf 15 mm,
  Lila auf 25 mm; das untere Ende ist überall gleich. Die Legende folgt dem Intervall.
  **Böen- und Niederschlagsintervall stehen je Schritt in `meta.json`**
  (`intervals`, aus dem GRIB-`stepRange`) und in der Legende, weil sie
  WECHSELN: der Niederschlag gilt bis zum vorigen Schritt (1/3/6 h), die Böe
  bei ICON IMMER der letzten Stunde (auch EU nach +78 h, `80-81`), bei IFS bis
  +90 h der letzten Stunde (`2-3`), dann 3 bzw. 6 h. Die frühere Beschriftung
  „seit dem vorigen Zeitschritt" war für IFS bis +90 h falsch. Bei +0
  (stepRange „0") gibt es keine Böe, der Schritt fehlt.
  **Im Deploy**: ECMWF über den Actions-Cache JE LAUF (`--latest` liefert die
  Kennung, `cache/restore`, Ingest nur ohne Treffer mit `--run`, `cache/save`
  NUR bei Erfolg — der kombinierte Schritt speicherte auch halbfertige
  Stände). ICON seit dem STÜNDLICHEN Cron (2026-10-09) ebenfalls je Lauf im
  Cache: `--latest` → restore (mit `restore-keys` auf den vorigen Stand) →
  Ingest mit ausdrücklichem `--run` (sonst landete ein zwischendurch
  erschienener Lauf unter dem alten Schlüssel) → save nur bei Erfolg; ohne
  Cache holte jeder Lauf dieselben ~190 MB neu. Der Cron steht auf
  `30 * * * *`: die halbe Stunde, damit jeder D2-Lauf (fertig ~HH+1:20) zehn
  Minuten danach online ist. `continue-on-error` überall.
  **Wertebilder statt Farbbilder**: je Pixel ein 16-Bit-Code in R (hoch) und
  G (tief), `wert = lo + (code − 1) · step`, 0 = kein Wert; `lo`/`step` je
  Größe für ALLE Modelle gleich (`nwp_common.VARIABLES`), damit die
  Farbskalen modellunabhängig bleiben. Verlustfreies WebP, gemessen ~200–300 KB
  (T2m), 50–160 KB (MSL) je Schritt; zusammen ~380 MB für die drei neuesten
  Läufe — unter dem 1-GB-Limit von Pages. Der Lauf steht im PFAD, die Dateien
  sind unveränderlich; nur `meta.json` wird mit `no-cache` geholt. Im
  Speicher höchstens 24 dekodierte Felder.
  **KEINE Auflösungspyramide** — sie brächte nichts: das Gitter IST die
  Auflösung, beim Hineinzoomen gibt es nichts Feineres nachzuladen. Die
  Zoomgrenze, bis zu der neu abgetastet wird, hängt am Modell
  (`GlobeModel.maxzoom`: 6 / 7 / 8).
  **Kacheln, im Browser gerechnet, über ein eigenes Protokoll**
  (`globe://modell/lauf/größe/schritt/z/x/y`, `maplibregl.addProtocol`,
  Rückgabe ImageBitmap). (1) MapLibre zieht im Globus nur KACHELquellen bis an
  die Pole (`extendToNorthPole` in `create_tile_mesh`, in `draw_raster` für
  Bildquellen aus) — der Prototyp mit canvas-Source hatte schwarze Polkappen.
  (2) Je Zoomstufe neu abgetastet, also der WERT interpoliert, nicht die Farbe.
  (3) Regionale Gitter (`GlobeGrid.global = false`) enden an ihrem Rand:
  `gridX`/`gridY` liefern dort null, das Pixel bleibt durchsichtig und die
  Werteanzeige sagt „außerhalb ICON-D2" — gewickelt wird nur global.
  Eine Quelle je Modell (die Zoomgrenze lässt sich an einer bestehenden Quelle
  nicht ändern), ein Zeitschritt ist ein `setTiles`. Gewählt wird eine
  GÜLTIGKEITSZEIT, kein Index — beim Modellwechsel bleibt der Termin stehen;
  reicht das Modell nicht so weit, steht „⚠" an der Zeit. Das geladene Feld
  trägt seinen Schlüssel, sonst rechnete die Werteanzeige beim Wechsel kurz
  mit dem Feld des vorigen Modells. Die Werte am Zeiger sind gegen Python
  nachgerechnet, für ICON-D2 auch gegen die Original-GRIB-Punkte.
  **Temperaturskala −56 … 52 °C in 1-K-BÄNDERN, jedes zweite abgedunkelt**
  (seit 2026-10-28, `TEMP_FINE_ANCHORS`, `alternateShade`; gilt für T2m,
  T850 und — auf 2-gpdm-Bändern — die Relative Topografie): vorher 2-K-Bänder
  aus Ankern im 8-K-Abstand, und eine europäische 850-hPa-Lage (−8 … +15 °C)
  stand in EINEM Türkis-Grün (gemeldet). Jetzt Anker alle 4 K, 1-K-Bänder,
  und die abwechselnde Helligkeit macht jedes Grad als Stufe sichtbar, wie
  dünne Isothermen. Ein Test hält den Mindestabstand benachbarter Bänder
  über −20 … +30 °C fest. Legende über `legendMultiple` auf runden Werten.
  **Niederschlag (mm/h): zuerst ACHT Blautöne bis 2 mm/h**, erst darüber
  Grün → Gelb → Rot → Magenta (`PRECIP_COLORS` in `colorscales.ts`, von Hand
  gesetzt) — vorher stand alles unter 1 mm/h in fast einem Hellblau.
  **Kräftiger** (auf Wunsch): die Feldebene ist VOLL deckend (vorher 0,92 —
  die dunkle Grundkarte graute jede Farbe ab), die Temperaturrampe hat
  ×1,2 Sättigung (`saturate`, `TEMP_VIVID`). **Werteanzeige ganzzahlig**
  (`formatReadout`, `decimals: 0`), außer Niederschlag und Wellenhöhe;
  gerundet „−0" wird „0".
  **Bandgrenzen kantengeglättet** (auf Wunsch „das Pixelige weg, aber nicht
  überglätten", `colorizeTile`, `SUPERSAMPLE` = 2): je Pixel vier Teilpunkte
  aus dem Gitter interpoliert und eingefärbt, Farben VORMULTIPLIZIERT
  gemittelt — ein Box-Filter über genau ein Pixel; auch der Rand regionaler
  Gitter wird so weich. **Nicht über das Gefälle zu den Nachbarn schätzen**
  (die erste Fassung): das bilineare Feld knickt an jeder Gitterzelle, die
  Schätzung fiel dort zu groß aus, und knapp über 0,1 mm/h standen dunkle
  gerade Linien entlang der Zellgrenzen in Regenflächen. Kosten gemessen:
  3,7 statt 0,8 ms je 256er-Kachel (im Worker-Pool), bei Zoom 6 werden
  ~3 % der Pixel gemischt.
  **ISOLINIEN** (`render/globeContours.ts` mit Tests, Protokoll `globeiso://`,
  Schalter „Isobaren"/„500 hPa" in der Leiste, `CONTOURS` in `config/globe.ts`):
  Bodendruck alle 5 hPa, 500 hPa alle 4 gpdm, beschriftet, als EIGENE
  Rasterebenen über JEDER Größe — Bodendruck über Niederschlag, 500 hPa über
  T850 sind die klassischen Kombinationen. Wer MSL bzw. 500 hPa als Größe
  wählt, bekommt die Linie dazu eingeschaltet. **Raster statt Vektorlinien,
  wegen der Beschriftung**: ein Symbol-Layer bräuchte eine Glyphs-Quelle, die
  Basemap ist aber bewusst lokal; die Kachel zeichnet die Zahl selbst und
  spart die Linie darunter aus. Die Linie kommt aus dem ABSTAND zur Isolinie
  (`|v − L| / |∇v|`), daraus Kern und Halo — gleich breit und kantengeglättet,
  unabhängig vom Gefälle. Isobaren hell mit dunklem Halo, 500 hPa dunkel mit
  hellem, damit beide gleichzeitig unterscheidbar bleiben. Drei Befunde, alle
  im Browser gesehen und als Test festgehalten: (1) **Doppellinien und
  Treppenkästen**, wo gespeicherte Werte GENAU auf einem Linienwert lagen
  (1020,0 hPa ist ein häufiger Code) — eine Fläche ohne Gefälle, gezeichnet
  wurde ihr Umriss. Die Linienwerte liegen deshalb um eine halbe Speicherstufe
  versetzt. (2) **Geisterstriche**, wo das Feld nur an den Linienwert
  heranreicht: gezeichnet wird nur, wenn er innerhalb von 4 Pixeln wirklich
  durchschritten wird. (3) **Gebirgsrauschen** des reduzierten Bodendrucks:
  ICON-D2 zog Kringel um jedes Alpental; geglättet wird je Linienart und
  Modell (`ContourDef.smooth`, D2-Bodendruck ±12 Zellen ≈ 50 km), die
  Farbfläche bleibt ungeglättet. Auf der ganzen Kugel (z ≤ 2) doppelter
  Abstand; die Linien werden zwei Zoomstufen über der Feldgrenze noch neu
  gerechnet (gestreckte Linien werden breit, gestreckte Flächen fallen nicht auf).
  **RELATIVE TOPOGRAFIE 500/1000 hPa** (`reltop`, seit 2026-10-16, alle drei
  Modelle): Schichtdicke in gpdm = (Z500 − Z1000)/10, proportional zur
  Mitteltemperatur der Schicht (1 gpdm ≈ 0,5 K) — dafür holen die Ingests
  zusätzlich Geopotential auf 1000 hPa (`gh1000`, ECMWF `gh`/1000, DWD
  `fi`/1000, beide live im Verzeichnis geprüft). Skala 488–592 gpdm in
  4-gpdm-Bändern auf der Temperaturrampe; wer sie wählt, bekommt die
  500-hPa-Linien dazu (klassische Kombination). Sie ist die VORGABE beim
  Öffnen (`DEFAULT_GLOBE_VARIABLE`); fehlt sie in einem Lauf, fällt die
  Auswahl auf T2m zurück. Gemessen ICON-D2 16.10.,
  +12 h: 535–561 gpdm über Mitteleuropa. Keine Schneefallgrenze im Text
  (dieselbe Regel wie bei den Ensemble-Schwellen). Die Cache-Schlüssel im
  Deploy sind dafür gesprungen (ECMWF `v5`, ICON `v2`) — `already_done`
  hätte die alten Läufe sonst bei JEDEM Deploy neu geholt.
  **HÖHENWIND 300 hPa** (`wind300` + Partikelquelle `uv300`, seit
  2026-10-26, alle drei Modelle — u/v auf 300 hPa live in Index bzw.
  Verzeichnis geprüft, 250 hPa gäbe es ebenso): der Strahlstrom als Farbfeld
  in km/h, unter 70 km/h DURCHSICHTIG (in der Höhe ist das schwacher Wind,
  eine durchgefärbte Kugel verdeckte das Band) und auf einer eigenen kühlen
  Rampe, damit er nicht wie der 10-m-Wind aussieht. Wer ihn wählt, bekommt
  die Partikel dazu — und die laufen dann mit dem HÖHENwind
  (`particleSource`): **`uv300` hat 1 m/s je Stufe statt 0,5** (±127 m/s;
  mit der `uv10`-Kodierung klemmten die Kerne bei 63,5 m/s), die Stufe steht
  als `step` in der Meta und `sampleWind` rechnet damit; **Bezugstempo 40 statt
  10 m/s** (`setSampler(…, refSpeed)`, Tempostufen skalieren mit), sonst
  rasten die Partikel im Strahlstrom achtmal so schnell wie am Boden.
  Gemessen ICON-D2 26.10. 18 UTC, +12 h: Median 101, Maximum 266 km/h;
  Kosten je Schritt 122 KB (Betrag) + 98 KB (Komponenten). Cache-Schlüssel
  im Deploy dafür gesprungen (ECMWF `v6`, ICON `v3`).
  **Darüber das Geopotential DERSELBEN Fläche** (`gh300`, Größe heißt
  „Höhenwind + Geopotential 300 hPa"): über dem Höhenwind ersetzen die
  300-hPa-Linien die 500er (`contoursFor` — die Ebenenliste zeigt je Größe
  nur die passenden Linienarten), denn dort weht der Wind entlang der
  Linien. Abstand 8 gpdm statt 4: das 300-hPa-Feld ist steiler, mit 4 stünden
  die Linien im Jet zu dicht. ECMWF `gh`/300, DWD `fi`/300 (live geprüft),
  ~130–210 KB je Schritt. **Die Isobaren gehen beim Höhenwind AUS** (auf
  Wunsch — zwei Liniennetze übereinander) und kommen beim Verlassen der
  Größe zurück, aber nur, wenn sie dort automatisch abgeschaltet wurden.
  **SIEBEN FLÄCHENGRÖSSEN DAZU** (seit 2026-10-27, je Schritt live in Index
  bzw. Verzeichnis geprüft): Taupunkt 2 m, Nullgradgrenze (nur ICON —
  ECMWF Open Data führt sie nicht), Niederschlag Summe seit Laufbeginn (aus
  `tp`, kein Abruf), Schneehöhe (IFS aus `sd` · 1000 / `rsn`, ICON `h_snow`),
  relative Feuchte 700 hPa (erst ab 50 % eingefärbt), niederschlagbares
  Wasser, CAPE (IFS MU-CAPE, ICON ML-CAPE — IFS liegt deshalb höher). Die
  Auswahl ist seither in `GLOBE_GROUPS` gegliedert (`<optgroup>`).
  **Beim Wechsel auf Temperatur-, Niederschlags-/Feuchtegrößen und CAPE
  gehen Isobaren, 500 hPa und Partikel AUS** (`overlaysOffFor`, auf Wunsch;
  die Relative Topografie bleibt ausgenommen, sie liest man mit 500 hPa).
  **Kodierung bewusst GROB, und das ist Budget**: Pages erlaubt 1 GB, die
  Seite liegt damit bei ~973 MB (IFS 429, ICON-EU 301, ICON-D2 118, Rest
  ~125 MB). Summe 1 mm, CAPE 25 J/kg, Taupunkt 1 K; Werte, die die Skala
  ohnehin nicht einfärbt (Summe < 1 mm, CAPE < 50 J/kg), werden als 0
  gespeichert — das Rauschen darunter kostete ein Drittel der Bildgröße.
  Im Sommer wächst CAPE, im Winter die Schneehöhe: wer eine Größe ergänzt,
  muss erst Platz schaffen (IFS bis +10 Tage spart ~60 MB, oder die Daten
  auf einen Objektspeicher umziehen). Cache-Schlüssel ECMWF `v7`, ICON `v4`.
  **NEUSCHNEE** (`newsnow`, seit 2026-11-02, auf Wunsch): Summe seit
  Laufbeginn in cm aus dem SCHNEEFALL der Modelle als Wasserwert — ECMWF
  `sf` (m, im Index 0,25° und 0,1° geprüft), ICON `snow_gsp` + `snow_con`
  (kg/m², im Verzeichnis D2 und EU geprüft) — mit der Faustregel 1 mm
  Wasser ≈ 1 cm Schnee (10:1). Bei nassem Schnee liegt real weniger, bei
  Pulver mehr; Setzen und Schmelzen sind nicht abgezogen, die SCHNEEHÖHE
  ist die andere Größe. Varda führt ihn nicht. Unter 1 cm als 0 gespeichert,
  Höchstwerte als Zahlen wie bei der Regensumme. Cache-Schlüssel dafür
  gesprungen (ECMWF `v9`, IFS 9 km `v4`, ICON `v5`).
  **DRUCKFLÄCHEN UND θe 850 hPa** (seit 2026-11-15, auf Wunsch, alle Modelle;
  `PRESSURE_LEVELS`/`levelOf` in `config/globe.ts`, `LEVELS` in `nwp_common.py`):
  Temperatur und Wind auf den STANDARDflächen 1000/925/850/700/500/300/250/200 hPa,
  ICON-D2 950 statt 925 (es führt kein 925). Bewusst NICHT alle, die die Modelle haben
  — gemessen (2026-11-15) ECMWF 14 Flächen 1000–10 hPa, ICON-EU 20 (1000–50 samt
  950/900/875/825/800/775), ICON-D2 11 (1000–200), Varda 12 (1000–50 ohne 600); alle
  hätten grob +1,8 Mio. R2-Schreibvorgänge im Monat gekostet. Je Fläche drei Bilder
  (`t<p>`, `wind<p>`, `uv<p>` für Fiedern/Partikel), gemessen ~22 Bilder je Termin mehr,
  ECMWF 0,25° ~5,7 MB je Termin, ICON-D2 ~2,9 MB. θe 850 hPa (`thetae850`) aus T und rF
  derselben Fläche (Bolton, `theta_e` in `nwp_common.py`; Varda rF aus q). 300/250/200 hPa
  haben eine eigene Temperaturskala −84 … −20 °C (`UPPER_TEMP`), ab 500 hPa läuft der
  Wind auf der Strahlstromskala; über 250/200 hPa stehen die 300-hPa-Höhenlinien. Die
  Panel-Auswahl BLENDET aus, was das Modell nicht führt (sonst ein Dutzend gesperrte
  Einträge), die Globusansicht sperrt weiter nur. Cache-Schlüssel dafür gesprungen
  (ECMWF `v10`, IFS 9 km `v5`, ICON-D2 `v8`, ICON-EU `v6`).
  **WINDSKALA an festen Ankern** (`colorscales.ts`, gilt auch für MOS- und
  Feld-Karte): ab 100 km/h dunkelrot, ab 120 km/h lila (≈ Beaufort 12),
  Wind und Böe teilen die Anker.
  **Windstille behält das erste Grün** (`belowMin: 'clamp'`, auf Wunsch): die
  durchsichtigen Flecken unter 1 bzw. 2 km/h sahen wie Datenlücken aus. Der Höhenwind
  bleibt unter 50 km/h durchsichtig, dort hebt das den Strahlstrom hervor.
  **DIE BÖE IST BEI 3-h-SCHRITTEN NUR EINE STICHPROBE** (`sampledGapHours`,
  Hinweis in der Legende): IFS bis +90 h und ICON-EU ab +78 h liefern nur
  die Böe der LETZTEN STUNDE, zwei von drei Stunden fehlen. Nicht
  behebbar — Open Data hat keine Stundenschritte (+1/+2/+4 h → 404) und
  `10fg3` erst ab +93 h (geprüft 2026-10-27). Lückenlos: ICON-D2, ICON-EU
  bis +78, IFS ab +93. Die Böe ist die WMO-Spitzenböe (3-s-Mittel).
  **IFS 0,1° ist seit 2026-10-28 ein EIGENES Modell `ecmwf-hres`**
  („ECMWF IFS Europa · 9 km", `ecmwf-ingest.py --res 0p1`, npm
  `ingest:ecmwf-hres`): Boden/Druckflächen in getrennten Dateien, je Feld das
  GANZE globale Feld geholt (1,4 MB, GRIB lässt sich nicht räumlich
  zuschneiden) und auf die ICON-EU-Fläche zugeschnitten (`crop` in
  `nwp_common.py`, 861×411), nur bis +144 h. Gemessen: ~37 MB Abruf je
  Schritt, ~1,2 MB Bilder je Schritt, ~60 MB je Lauf, lokal 3 Schritte in
  13 s. Abrufe mit 25 s Frist statt 8 (größere Felder). IFS 0,25° bleibt
  global bis +360 h daneben.
  **HÖCHSTWERTE ALS ZAHLEN IM NIEDERSCHLAGSFELD** (seit 2026-11-02, auf
  Wunsch, alle Modelle; Kern `config/globeMaxima.ts` mit Tests, Ebene
  `render/fieldMaxima.ts`; seit 2026-11-03 IMMER an, ohne Häkchen — auf
  Wunsch; in der Legende beim Niederschlag kein „mm/h" mehr, die Einheit der
  Farbskala steht im Tooltip): grobe Mengen
  auf einen Blick, ohne die Farbe gegen die Legende zu halten. Der Ausschnitt
  wird in Blöcke von 55 px geteilt, je Block das Gittermaximum EXAKT über alle
  Zellen (Stichproben verlören 1-km-Kerne), dann nach Abstand ausgedünnt
  (40 px, der höhere Wert gewinnt). **Nicht zurück auf „nur über allen acht
  Nachbarn"**: die erste Fassung ließ je Region genau eine Zahl — gewünscht
  sind mehrere rund um die Kerne. Aus dem schon geladenen Feld, kein Abruf.
  `precip` zeigt die MENGE im Intervall („1,5" = 1,5 mm),
  `precipsum` ganze mm (so gespeichert). Zahlen erst ab 0,5 mm und NUR IN
  EINER FARBFLÄCHE (`inFilledArea`: die Zelle und ≥ 5 ihrer 8 Nachbarn
  eingefärbt) — gemeldet waren Zahlen bei geringen Mengen ohne sichtbare
  Fläche, ein einzelner nasser Gitterpunkt. Zahlen weichen Ortsnamen eine
  Zeile aus, unter Bedienelemente kommen sie nicht.
  **PANEL-ANSICHT: 4 oder 6 Karten nebeneinander** (seit 2026-11-02, auf
  Wunsch; Umschalter „Globusansicht · 4 Panels · 6 Panels" vorn in der Leiste,
  `ModelMapsSection.tsx` → `GlobeMultiPanel.tsx` + `GlobeMapPanel.tsx`, Kern
  `config/globePanels.ts` mit Tests). Flache Karten, Region **Europa** oder
  **Österreich**, bedient wie das Panel-Raster der Punktprognosen: je Panel
  Modell und Größe plus **ParSync** (diese Größe für alle → Modellvergleich,
  Vorgabe beim Öffnen mit Niederschlag — auf Wunsch über ÖSTERREICH mit IFS
  9 km · ICON-EU · ICON-D2 · Varda, auch ohne gespeichertes Preset;
  die VORGABE HÄNGT AN DER PANELZAHL, `defaultSetup`: im 6er EUROPA in IFS
  9 km per ModSync, oben T 850 · T 2 m · 500 hPa, unten Böen · Niederschlag
  · Neuschnee; beim Umschalten 4 ↔ 6 gilt die neue Vorgabe nur, solange man
  nichts selbst eingestellt hat), **ModSync** (dieses Modell für alle
  → Synoptik, je Panel eine Größe) und **SYNC** (gemeinsame Zeit UND
  gemeinsamer Ausschnitt; ohne SYNC eigene ‹ ›-Zeit im Kopf, Verschieben
  bleibt im Panel). ParSync/ModSync sind EIN Quellpanel (Radio), höchstens
  eine Kopplung. **Abschalten friert den gespiegelten Wert ein, ein WECHSEL
  der Kopplung nicht** — von ParSync auf ModSync stand sonst in allen Panels
  dieselbe Größe UND dasselbe Modell (so war es zuerst). **KEINE
  Isobaren/500-hPa-Linien in den Panels** (eine erste Fassung legte sie nach
  Konvention darüber, auf Wunsch wieder raus) und **kein Zahlenraster über
  Temperaturflächen** (die zweite Fassung — „schaut nicht gut aus").
  Stattdessen **KANTENLINIEN**, Schalter „Zahlen": ganz dünne, dezent graue
  Linien auf den Grenzen der Farbstufen, beschriftet mit ihrem Wert
  (`PANEL_BAND_LINES` in `config/globePanels.ts`, eigenes Protokoll
  `globeband://`, Stil `band` in `CONTOUR_STYLES` — dieselbe Isolinien-
  rechnung wie die Isobaren, Linie ~1 px ohne Halo, dunkle Schrift mit
  hellem Rand). Abstand je Größe auf Stufengrenzen (Temperatur 2 K bei
  1-K-Bändern), nur leicht geglättet, damit die Linie auf der KANTE der
  ungeglätteten Fläche liegt. Niederschlag behält die Höchstwerte, Größen
  ohne Kantenlinien fallen auf ein Werteraster zurück (`valueGrid`, an
  Gradvielfachen verankert). **Ein Panel zeigt den LETZTEN Termin BIS zur
  gewählten Zeit, nie einen späteren** (`frozenStepIndex`, auf Wunsch): ein
  3-h-Modell bleibt um 13 UTC bei 12 UTC STEHEN und wird ausgegraut („steht
  bei … · 3-h-Schritte"), Varda/ICON-D2 laufen stündlich weiter; mehr als
  6 h dahinter (`PANEL_FREEZE_MAX_MS`) heißt „reicht nur bis …". Die
  gemeinsame Zeitachse folgt dem GRÖBSTEN Takt der offenen SYNC-Panels
  (`coarsestTimes`: nur Zeiten, zu denen jedes Modell — soweit es reicht —
  einen eigenen Termin hat; vorher lief der Regler stündlich und IFS kam nur
  jeden dritten Schritt mit). **TAKTGEBER**: ein Klick (ohne Ziehen) in ein
  Panel mit FEINEREN Schritten (Varda, ICON-D2, ICON-EU bis +78 h) lässt den
  Regler in dessen Takt laufen. Gröbere Modelle sind nur ZWISCHEN ihren
  Terminen grau („steht bei …"), zu ihren eigenen Terminen erscheinen sie
  normal — eine erste Fassung graute sie im Taktgeber-Modus durchgehend aus,
  auch zu 18 UTC (auf Wunsch wieder raus). Beim Umschalten bleibt die gezeigte Zeit
  stehen — sonst rechnete der feinere Takt von der Uhrzeit aus neu und die
  Anzeige sprang zurück (so war es zuerst). Zweiter Klick oder Esc: zurück.
  **PRESETS** (auf Wunsch, bewusst simpel):
  Panels mit Modell/Größe/SYNC, Kopplung, Panelzahl und Region unter einem
  Namen im `localStorage` (`meteo-workbench:map-panel-presets`, getrennt von
  den Presets der Punktprognosen), ohne Zeit; beim Lesen fällt Unbekanntes
  auf die Vorgabe zurück (`parsePresets`). **Seit 2026-11-02 mit dem
  AUSSCHNITT je Panel** (Mittelpunkt + Zoom, `PanelView`; auf Wunsch —
  vorher fuhr jedes Panel beim Laden den Standardausschnitt der Region an).
  Er gilt auch für Panels, die erst durch den Wechsel auf 6 entstehen, und
  bis die Region von Hand gewechselt wird; ältere Presets ohne Ausschnitt
  fahren die Region an.
  **Der LAUF steht in JEDEM Panel fest links oben** (`.gmp-run`, seit
  2026-11-05, auf Wunsch: „Lauf heute 18 UTC · +6 h"): nebeneinander zeigen
  die Panels verschieden alte Läufe, im Tooltip des Modells sah man das nicht.
  Die Stunden gelten für den GEZEIGTEN Termin, auch wenn das Panel steht; bei
  altem oder verbrauchtem Lauf wird das Schild gelb (`globeFreshness`). Die
  Meta wird je Sitzung einmal geladen — ein lange offener Tab rückt also nicht
  von selbst auf einen neuen Lauf, das Schild zeigt dann den tatsächlich
  gezeigten.
  Den Wert am Zeiger
  zeigen ALLE Panels für denselben Ort. Gleiches Kachelprotokoll wie die
  Globusansicht (Kacheln aus dem gemeinsamen Speicher); das Vorrechnen
  sichtbarer Kacheln (`prefetchVisibleTiles`) bleibt der Globusansicht
  vorbehalten — es ist ein Singleton und bestellte sich zwischen sechs
  Karten gegenseitig ab, die Panels wärmen nur die Felder vor.
  **WINDFIEDERN bei Wind 10 m, Böen und Höhenwind** (`BARB_VARS`, auf
  Wunsch, Einzelkarte UND Panels). **In der Einzelkarte im WECHSEL mit den Partikeln**
  (2026-11-05, auf Wunsch: Haken des einen nimmt den anderen weg, beide aus geht):
  Vorgabe beim Wechsel auf die Größe sind Fiedern bei den Regionalmodellen, die
  Strömung beim globalen IFS. Bei den Böen zeigen sie den MITTLEREN 10-m-Wind
  (Böenkomponenten führt kein Modell). **Auch auf der Kugel** (`globeBarbGrid`,
  `screenBearing`): dort lief das Häkchen früher ins Leere. Die Richtung wird je Fieder
  auf die Bildschirmlage von Norden bezogen, das stimmt auch bei gedrehter flacher Karte;
  die Fahnen stehen überall nach Nordhalbkugel-Konvention, auch südlich des Äquators.
  **HÖHENWIND DER REGIONALMODELLE: Windfiedern und Isotachen** (seit
  2026-11-02, auf Wunsch; „regional" = `!meta.grid.global`, also IFS 9 km,
  ICON-EU, ICON-D2, Varda): beim Wechsel auf den Höhenwind Fiedern als Vorgabe
  (`render/windBarbs.ts`, Raster an Gradvielfachen, breiter
  dunkler Rand unter der hellen Fieder — sonst unsichtbar auf dem hellblauen
  Strahlstromrand) und ISOTACHEN statt 300-hPa-Höhenlinien (Linienart
  `wind300`, alle 20 km/h ab 60, `ContourDef.min`). IFS global bleibt bei
  Partikeln und Höhenlinien. Die Strahlstromskala färbt seit demselben Tag
  ab **50 statt 70 km/h**.
  **REGENSUMMEN-SKALA: die ersten 15 mm in sieben getrennten Stufen**
  (1/2/3/5/7/10/15, von Hand gesetzt, jede Stufe beschriftet) — vorher lagen
  1, 2 und 5 mm in drei kaum unterscheidbaren Blautönen.
  **LEGENDEN GRÖSSER in allen Karten** (Modellkarten, Panels, Radar,
  Satellit: Schrift 11,5–12,5 statt 9,5–10 px, Farbfelder 13 statt 9 px)
  und die **WERTEANZEIGE OBEN MITTIG** (`.globe-readout-top`, auch im
  Satellit, im Radar und je Panel) — links oben stehen die Ebenen.
  **EBENEN OBEN LINKS IN DER KARTE, nicht in der Kopfleiste**
  (`.globe-corner` → `.globe-layers`, darunter `.globe-readout`): Isobaren,
  500 hPa und Windpartikel/Wellenlauf als große Häkchen (15 px fett, 18-px-
  Kästchen) — klein zwischen den Auswahllisten wurden sie übersehen, obwohl
  man sie ständig umschaltet. Die Ecke zählt für die Beschriftung als belegt.
  **GESAMTBEWÖLKUNG IN GRAUSTUFEN, wolkenlos hell, bedeckt dunkel** — dieselbe
  Leserichtung wie im klassischen Meteogramm; das dunkle Ende bleibt über der
  Kartenfarbe, sonst wäre „bedeckt" nicht von „außerhalb des Modells" zu trennen.
  **WOLKENSCHICHTEN bei ICON UND seit 2026-11-02 bei ECMWF** (`clch`/`clcm`/
  `clcl`; ECMWF aus `hcc`/`mcc`/`lcc`, als Anteil 0–1 gemessen und ×100 —
  am 2026-10-05 führte Open Data nur `tcc`, im Index 2026-11-02 bei 0,25°
  UND 0,1° vorhanden; GeoSphere zeigt sie, weil sie IFS ohnehin voll
  bezieht): EIN Bild je Schritt mit drei Kanälen in %
  (`encoding: 'rgb3'`, R = mittel, G = hoch, B = tief, 255 = kein Wert),
  angezeigt als DREI HALBTRANSPARENTE FLÄCHEN, je Schicht EIN Farbton (hoch
  grün, mittel rot, tief blau), die STÄRKE in ACHTELN als Leiter von dunkel
  und blass (1/8) bis hell und kräftig (8/8) (`CLOUD_LAYER_RAMPS`,
  `CLOUD_OCTA_ALPHA` überproportional 0,12 … 0,92 — 1/8 12 %, 4/8 ~39 %,
  6/8 ~64 %: dünne Schichten bleiben durchscheinend, erst hohe Achtel decken
  (auf Wunsch; vorher linear 0,50 … 0,88), `toOcta` rundet wie die
  Synop-Meldung). Geglättet seit demselben Tag NUR NOCH ICON-D2 (±1 Zelle,
  `cloudSmoothRadius` ~2 km), alle gröberen Gitter gar nicht — die alte
  Untergrenze von einer Zelle hieß bei IFS 0,25° zwei Durchgänge à ±25 km,
  und wolkenfreie Täler/Becken in Österreich verschwanden (gemeldet;
  GeoSphere zeigt im selben IFS Hochnebel in Tälern).
  Übermalt wie von oben gesehen: tief unten, hoch oben. Zwei Vorstufen sind
  auf Rückmeldung verworfen: **additive Mischung** (hoch + mittel = gelb, alle
  drei = weiß — sieben Farben für drei Größen) und **eine Farbe mit
  gestaffelter Deckkraft** (auf der dunklen Karte sahen 3/8 und 6/8 gleich
  „rot" aus, die Stärke war nicht lesbar). Legende und Werteanzeige in Achteln.
  **Interpoliert, nicht gepixelt**: je Schicht vorher geglättet (`smoothRgb3`,
  zweimal Kastenfilter ±r = Dreiecksfilter; r aus der Gitterweite, D2 ±2,
  EU ±1 Zellen), dann bilinear, Farbe und Deckkraft STUFENLOS zwischen den
  Achtelstufen, unter 1/8 weich ausgeblendet. Der nächste Gitterpunkt war nur
  bei der additiven Fassung nötig (Zwischenfarben hätten wie eine weitere
  Schicht ausgesehen); mit ihm stand jede 2-km-Zelle als Klötzchen da, bilinear
  allein ließ Treppen stehen (ICON springt oft von 0 auf 100 %), ein einzelner
  Kastenfilter Kästchen — alles im Browser gesehen.
  Bewölkung in 5-%-Stufen gespeichert: in 1-%-Schritten verrauscht, die
  Schichten kosteten 639 KB je Bild (jetzt ~400–520 KB).
  **MEER: Wellenhöhe, Wellenperiode, Wassertemperatur — nur IFS**
  (`swh`/`pp1d`/`sst`, Skalen `WAVE_HEIGHT`/`WAVE_PERIOD`/`SEA_TEMP` in
  `config/globe.ts`). Quelle ist der Strom `wave` von ECMWF Open Data
  (Wellenmodell WAM, gleiches 0,25°-Gitter, gleiche Schritte +0 … +360 h,
  gemessen 2026-10-08); über Land kein Wert (36 % der Punkte), die Karte
  bleibt dort durchsichtig. **Kein Open-Meteo-Budget** — wie alle
  Modellkarten direkt beim Anbieter, im Deploy geholt. Die **Wassertemperatur
  ist die Hauttemperatur `skt`** aus dem `oper`-Strom, aber NUR wo das
  Wellenmodell Meer hat (es ist damit die Land-Meer-Maske, ohne eigenes
  Feld), und NICHT unter −2 °C: dort ist es Meereis, gemessen bis −32 °C
  Eisoberfläche in der Arktis. Gemeint ist die oberste Schicht, nicht die
  Badetiefe — steht im Tooltip. Plausibilität: Ionisches Meer 24,5 °C bei
  1,0 m Welle am 08.10. **Über den Wellengrößen zeigen die Partikel den WIND, keinen Wellenlauf**
  (seit 2026-10-18, auf Wunsch): eine Fassung ließ sie dort in
  Ausbreitungsrichtung (Gegenrichtung von `mwd`) mit der Gruppengeschwindigkeit
  c_g = g·T/(4π) laufen — bei mäßigem Seegang viel zu schnell und neben dem
  Farbfeld unverhältnismäßig. Die Wellenhöhe ist das Farbfeld, die Partikel
  bleiben der 10-m-Wind; `mwd` und das Feld `wavedir` sind aus dem Ingest
  entfernt. Kosten der Wellengrößen: ~2 MB Abruf je Schritt. ICON führt
  keine Wellen (DWD hat dafür ein eigenes Wellenmodell, EWAM/GWAM, nicht
  angebunden), die Auswahl ist dort gesperrt.
  **WINDPARTIKEL** (`render/windParticles.ts` mit Tests, Schalter
  „Windpartikel", eingeschaltet beim Wechsel auf Wind oder Böen): die Strömung
  des 10-m-Winds als bewegte Spuren über JEDER Größe, wie bei Windy. Daten
  sind das neue Feld **`uv10`** (`encoding: 'uv8'`, R = u, G = v, je
  (code − 128) · 0,5 m/s, 0 = kein Wert, ±63,5 m/s geklemmt; `sampleWind` in
  `config/globe.ts`) — vorher speicherten die Ingests nur den Betrag,
  Richtung gab es nicht. Gemessen ICON-D2 ~260 KB je Bild, 13 MB je Lauf.
  `already_done` im Ingest prüft seither auch, ob jede Pflichtgröße in der
  Meta steht, sonst würde ein schon abgelegter Lauf ohne `uv10` nie
  nachgeholt; der ECMWF-Cache-Schlüssel ist dafür auf `v3` gesprungen.
  **Verfahren im BILDSCHIRMRAUM (nullschool-Art), kein WebGL-Layer**: nach
  jeder Kamerabewegung einmal ein Geschwindigkeitsraster über die Sicht (je
  8 px: `unproject`, Wind, Projektionsableitung über zwei Nachbarpunkte →
  Pixel je Frame), danach laufen die Partikel nur noch im Bild. Damit ist die
  Projektion gleich — auf der Kugel krümmen sich die Bahnen richtig, ohne dass
  die Animation Globus und Mercator selbst können muss.
  **Die Ableitung wird ZENTRAL um denselben Punkt genommen** — vorher am
  auf 89° geklemmten Nachbarn, aber gegen die Lage des echten Punkts: nahe
  am Pol wurde die Lagedifferenz durch einen winzigen Längengrad geteilt,
  und Partikel schossen aus der Kugel. Jenseits 88° gibt es keine Partikel
  (u/v drehen sich dort auf kleinstem Raum), und mehr als 70 m/s in
  Bildschirmpixeln verwirft eine Zelle als Projektionsausreißer. Neben der Kugel
  erkennt man ungültige Punkte an der Rückprojektion. Gemessen (Headless,
  Software-Rendering): Raster 187×96 in 13–22 ms, Animation 61 fps. Während
  der Bewegung ruht sie (das Raster gilt für einen Kamerastand). **Das Tempo
  ist NICHT maßstäblich** (`pxPerSecondAt10`: 22 px/s bei 10 m/s auf der
  ganzen Kugel, linear bis 66 px/s ab Zoom 6 — nach Rückmeldung eingestellt:
  15/45 war „zu langsam", das Bildraten-abhängige Original viel zu schnell): maßstäblich stünden die
  Partikel auf dem Globus still und rasten über den Alpen. Maßstäblich sind
  Richtung und Verhältnis der Tempi, nicht die absolute Geschwindigkeit.
  **Gerechnet über die ZEIT, nicht je Bild** — die erste Fassung bewegte je
  `requestAnimationFrame`, und das läuft auf einem 120/144-Hz-Schirm doppelt
  so oft wie auf 60 Hz: im Test (60 Hz) ruhig, beim Nutzer „fetzte" es, und
  ein Halbieren je Bild half dort nicht. Bewegung, Lebensdauer und Verblassen
  (`FADE ** (dt·60)`) hängen an der vergangenen Zeit, ein Hänger wird auf
  50 ms gedeckelt. Den Betrag
  zeigt die Größe „Wind 10 m". Weiße Spuren, Deckkraft und Breite nach fünf
  Tempostufen; das Canvas liegt direkt über der Kartenzeichenfläche, unter
  Städten und Bedienelementen.
  **BESCHRIFTUNG UND LANDFLÄCHEN in ALLEN Ansichten, auch auf der Kugel**
  (`render/worldLabels.ts` mit Tests, Daten `src/mapdata/world.labels.json`
  aus `scripts/build-labels.mjs`, npm `build:labels`): ~6.900 Städte,
  242 Länder und 79 Meere aus Natural Earth, mit DEUTSCHEN Namen
  (`NAME_DE`), dazu die kuratierten Orte aus `config/cities.ts` (Alpenorte,
  Regionalzentren — gleicher Name < 30 km zählt einmal, mit dem früheren
  Zoom). **Länder- und Meeresnamen kommen SPÄTER als bei Natural Earth**
  (`displayMinZoom`: Länder +1,5 Stufen und nicht vor Zoom 3, Meere +1) und
  sind blass, Flächennamen halten zusätzlich Abstand vom Kugelrand
  (`FACING_MIN`) — auf Wunsch: mit Natural-Earth-Stufen war die ganze Kugel
  voller Ländernamen, die über den Rand ins All ragten. Auf der Kugel stehen
  jetzt Grenzen und große Städte, die Länder erst beim Hineinzoomen.
  Länder in gesperrten Versalien, Meere kursiv bläulich, Hauptstädte
  mit eckigem Punkt — Atlas-Konvention, damit Flächennamen nicht wie Orte
  aussehen. **Ausgedünnt nach PLATZ, nicht nur nach Zoom**: nach jeder
  Bewegung (`moveend`) wird neu entschieden — Rangfolge = ab welchem Zoom
  (Natural Earth `MIN_ZOOM`, eine Stufe abgezogen: NE rechnet in
  256-px-Kacheln, MapLibre in 512), bei Gleichstand Land vor Meer vor
  Hauptstadt vor Stadt; gesetzt wird nur, was ganz im Bild liegt, auf der
  zugewandten Kugelseite steht, auf dem Globus mit ALLEN VIER ECKEN auf der
  Kugel liegt (Rückprojektion, sonst ragten Namen ins All) und nichts schon
  Gesetztes überdeckt, höchstens
  220 Marker (MapLibre verschiebt jeden Marker bei jedem Frame). Bedienelemente
  über der Karte (Pfeile, Legende, Werteanzeige, Zoomknöpfe) zählen als
  belegt. Zwei Fallen, beide gesehen: die Bildkarten-Zoomleiter begann bei 0 —
  Köln (Priorität 1) stand auf dem Globus ab Zoom 0 und verdrängte
  „Deutschland" und Berlin, deshalb beginnt sie hier bei 4 (Test); und die
  Amundsen-Scott-Station (−90°) erschien in Mercator am OBEREN Bildrand,
  deshalb nur |Breite| ≤ 85°. **Landflächen** (Natural Earth 1:50m, im
  Welt-Bündel, Layer `land` in `BASE_STYLE`, für die übrigen Karten leer)
  liegen UNTER dem Feld und sind nur sichtbar, wo es durchsichtig ist (kein
  Niederschlag, klarer Himmel, außerhalb der Regionalmodelle) — dort war
  vorher Land nicht von Meer zu unterscheiden. Preis: das Welt-Bündel wächst
  von ~350 auf ~620 KB gzip, die Beschriftung kostet ~90 KB gzip; beides nur
  im Modellkarten-Bereich geladen. Bundesländer/Kantone weiter aus dem
  `dach`-Bündel, nur in den flachen Ansichten.
  **DURCHBLÄTTERN — gemessen, wohin die Zeit geht** (2026-10-05, Headless mit
  Software-Rendering, also eher zu langsam): je Zeitschritt beim IFS-Globus
  mit Isobaren ~690 ms für 17 Isolinien-Kacheln, ~315 ms für das Erzeugen der
  Bilder aus 17 Farbkacheln, nur ~38 ms für das Einfärben selbst, ~170 ms für
  zwei Felder (Laden + Dekodieren). Drei Hebel, ohne Server: (1) **Abbruch
  beachten** — das Protokoll rechnet eine Kachel nicht mehr, die MapLibre
  inzwischen abbestellt hat (`bail`, `AbortError`); vorher lief jeder
  übersprungene Schritt als Rückstau nach. (2) **Neuester Stand gewinnt** —
  solange die Kacheln eines Schritts laden, wird der nächste nur vorgemerkt
  und beim `idle` der Karte direkt auf den zuletzt gewählten gesprungen
  (`queueTiles`/`flushTiles`, Sicherheitsnetz 1,5 s); das Zeitlabel folgt
  sofort. (3) **Fertige Kacheln gemerkt** (256, LRU über die URL) — MapLibre
  leert seinen Speicher bei jedem `setTiles`, Zurückblättern rechnete alles
  neu; MapLibre schließt zurückgegebene Bilder nicht, die Wiederverwendung ist
  sicher. Zusammen halbierte das die Rechenarbeit beim Durchblättern (zehn
  Schritte im 150-ms-Takt: ~10 s → ~5 s). Vorgeladen werden zwei Schritte
  vorwärts, einer rückwärts, und die Felder der eingeschalteten Isolinien mit.
  **Seit 2026-10-08 rechnet ein WORKER-POOL** (`render/globePool.ts` +
  `render/globeWorker.ts`, 2–4 Worker): Dekodieren, Glätten, Einfärben und
  Isolinien laufen nicht mehr auf dem Hauptthread, das Protokoll reicht nur
  weiter und merkt sich fertige Kacheln; zurück kommt ein ImageBitmap als
  Transfer. Gemessen vorher: beim Durchblättern ~220 ms Dekodieren, ~100 ms
  Glätten, ~65 ms Kacheln auf dem Hauptthread — in diesen Blöcken stand die
  Kugel; danach ist davon nichts mehr übrig. **Zugeordnet wird nach FELD-URL,
  nicht reihum**: so wird jedes Feld genau einmal dekodiert und geglättet.
  Die Anfrage trägt URL (absolut — der Worker löst relativ gegen SEIN Skript
  auf), Raster und Kodierung selbst, der Worker kennt keine Meta. Der
  Hauptthread holt sich nur noch für Werteanzeige und Windpartikel eine KOPIE
  (`loadGlobeField`), Vorladen wärmt nur den Worker (`prefetchGlobeField`).
  Abbruch läuft über eine eigene Schlange im Worker (ein Auftrag je
  Makrotask), sonst käme das `cancel` erst nach allen schon eingetroffenen
  Kacheln an die Reihe.
  **Gesehene Schritte kommen aus dem Speicher** (`globeProtocol.ts`): der
  Kachelspeicher hat ein Budget nach `navigator.deviceMemory` (48 MB je GB,
  128–512 MB, ohne Angabe 256 MB) statt fester 256 Kacheln — ein Schritt auf
  der Kugel sind 68 Kacheln, vorher wurde schon der vierte Schritt zurück neu
  gerechnet (gemessen). **Dazu werden die SICHTBAREN Kacheln der Nachbar-
  schritte vorgerechnet** (`prefetchVisibleTiles`, +1/+2/−1, nach jedem
  Schritt und nach jedem `idle`): das Protokoll merkt sich je Ebene, welche
  Kacheln MapLibre zuletzt angefragt hat, und rechnet dieselben für die
  nächsten Schritte mit NIEDRIGER Priorität (der Worker zieht Sichtbares
  immer vor). Abbestellt wird nur, wenn sich die Schritte ändern — ein
  Stopp mitten im Vorladen mit identischer Kachel in beiden Runden darf sie
  nicht fallen lassen (`prefetching` hält das Signal, nicht nur die URL).
  Gemessen (Software-Rendering): vorwärts 2–3 s → 0,3–0,7 s je Schritt,
  zurück keine einzige Kachel mehr neu gerechnet.
  **DIE ISOLINIEN WAREN DER ENGPASS — gemessen 2026-11-02**, Sprung auf einen
  nicht vorgerechneten Schritt, Zeit bis zur letzten sichtbaren Kachel:
  IFS-Globus mit Isobaren 3,9 s (34 Farbkacheln 0,2 s, 34 Isobarenkacheln
  2,6 s), ohne Isobaren 0,5 s. Die Linien selbst kosten 3–7 ms je Kachel —
  die Zeit steckte im ZEICHNEN über ein OffscreenCanvas im Worker (~90–100 ms
  je Kachel, im ~100-ms-Takt: das beschleunigte Canvas wartet auf den
  GPU-Prozess; ein wiederverwendetes Canvas änderte nichts). Seither setzt der
  Worker die Zahlen selbst in die Pixel, aus EINMAL je Linienart gerasterten
  Ziffern (`glyphsFor`), und gibt die Kachel wie die Farbkacheln über
  `createImageBitmap(ImageData)` ab. **Kein OffscreenCanvas je Kachel mehr
  einführen.** Dazu das Glätten mit LAUFENDEN SUMMEN statt (2r+1)
  Additionen je Zelle (Varda r = 24: ~200 ms je Feld, lag direkt vor der
  ersten Isobarenkachel; ein Test hält es Zelle für Zelle gegen die direkte
  Rechnung). Danach: IFS-Globus 1,2–1,9 s (davon nur ~0,4 s Kachelrechnung —
  der Rest ist SwiftShader im Headless-Browser, der den Globus auf der CPU
  zeichnet und mit echter GPU entfällt), Varda Alpen 1,2 → 0,6 s. Gemessen
  mit Zeitstempeln im Worker; die `idle`-Zeit der Karte taugt headless NICHT
  als Maß, sie ist vom Software-Rendering dominiert.
  **Pixeldichte der Karte auf 1,5 gedeckelt** (`GLOBE_MAX_PIXEL_RATIO`,
  Windpartikel folgen `map.getPixelRatio()`): bei Pixeldichte 2 zeichnet die
  Grafikkarte je Frame viermal so viele Pixel. Die KACHELZAHL hängt NICHT
  daran (gemessen: 68 bei Pixeldichte 1 wie 2) — es geht nur um Füllarbeit.
  **KACHELSTUFE IM POLARBLICK** (`globeTileSize` in `render/globeTiles.ts`,
  seit 2026-11-05, gemeldet: „Isolinien extrem fett und unscharf"): MapLibre
  hält die Kugel beim Drehen gleich groß, indem es den Zoom um log2(1/cos(Breite))
  senkt, am Pol um rund 3,5 Stufen — und die Kachelstufe hängt an diesem Zoom.
  Von weitem auf den Pol lag so EINE Kachel der Stufe 0 über der ganzen Erde.
  Die Karte setzt deshalb bei jeder Bewegung `tileSize` von Feld- und
  Isolinien-Quelle kleiner (MapLibre liest den Wert je Aktualisierung neu, die
  Kacheln bleiben 256 px); `calculateTileZoom` geht nicht, unterhalb von Stufe 5
  ruft MapLibre es gar nicht auf. Abgestimmt auf ein Drittel des Wegs von der
  Mitte zum Bildrand, nicht südlich von 55°: auf den Äquator abgestimmt wurden
  Linien und Zahlen in hohen Breiten winzig. Gemessen von weitem am Pol Stufe 3
  mit 32 Kacheln, wie die Startansicht (Stufe 3, 34); bis 55° in der Mitte ändert
  sich nichts. Bei einem MapLibre-Update prüfen, ob der Zoomausgleich noch so
  arbeitet. **DIE POLKAPPE IST EINFARBIG UND OHNE LINIEN**
  (`poleSide`/`POLE_ROWS` in `config/globe.ts`, Wunsch nach Rückfrage): jenseits
  85,05° streckt MapLibre die Randzeile der Kachel bis an den Pol, jede Linie
  lief dort als Strahl zum Pol, die Fläche zeigte Fächer. Die obersten 16 Zeilen
  bleiben deshalb in den Isolinien-Kacheln leer und tragen in den Farbkacheln das
  Mittel des GANZEN Rings, nicht der Kachel (sonst stünden Sektoren da). 16 statt
  einer Zeile wegen der Mipmaps, die zum Pol hin über mehrere Zeilen mitteln.
  Preis: gut 550 km um den Pol keine Feldstruktur und am Ring ein sichtbarer
  Rand, die Werteanzeige liest dort weiter das echte Feld.
  **SEIT 2026-11-21 ÜBERDECKT EINE EIGENE WEBGL-EBENE DIE KAPPE** (`render/polarCap.ts`
  mit Tests, auf Wunsch): eine Scheibe ab 82° (südlich der
  gestreckten Zeilen auf jeder Stufe), auf die Kugel gelegt über MapLibres
  `interpolateProjection` mit der Kugelposition aus Länge/Breite statt aus Mercator, eingefärbt
  mit einer Textur in polarer Abbildung. Die CPU rechnet sie aus DEMSELBEN Feld mit derselben
  Farbtabelle und Isolinienregel wie die Kacheln, die Kante ist deshalb unsichtbar. Zwei
  Ebenen: Fläche direkt über dem Feld (das Feld wird beim Modellwechsel davor eingehängt),
  Linien über allem, aber nur nördlich der Zeile, ab der die Kacheln selbst keine mehr haben
  (`bandLat` der aktuellen Kachelstufe, je Bild nachgeführt) — keine Lücke, kein doppelter
  Strich. **Die Linien zeichnet der SHADER**, nicht die CPU: die Kappe bekommt die WERTE
  (R32F, 512², `capValueRaster`), die Linie entsteht je Bildschirmpixel aus Wert und Gefälle
  (dFdx/dFdy) mit derselben Breitenregel wie `contourTile`. Die erste Fassung schickte ein
  fertiges Linienbild, das beim Zoomen mitvergrößert wurde — die Linien wurden FETT (gemeldet).
  Die Fläche bleibt ein Bild, Größe nach dem Kappendurchmesser (128–1024, nach `moveend`). Nur
  auf der Kugel und nur für einfache Wertefelder: Wolkenschichten und Regen/Schnee behalten
  das Ringmittel. Die Ringmittel-Regel der Kacheln bleibt als Unterlage (Südpol, flache
  Karte, Übergang). Keine Beschriftung der Linien in der Kappe.
  Dabei behoben: Quellen wurden mit der Standard-Kachelgröße ANGELEGT (`currentTileSize`),
  am Pol eingeschaltete Linien standen bis zur nächsten Bewegung fett und unscharf da.
  **TOPOGRAFIE** (seit 2026-11-05, auf Wunsch; `render/globeTopo.ts` mit Tests,
  Protokoll `globedem://`): MapLibre-`hillshade` über dem Farbfeld, unter Gradnetz
  und Grenzen. In der Globusansicht von Anfang an AN, per Häkchen abschaltbar, in
  den Panels fester Bestandteil ohne Schalter. Flaches Land bleibt durchsichtig, die
  Farbe trägt weiter den Wert. Gezeigt wird das reale Relief, NICHT die
  Modelltopografie. Das Feld wird beim Modellwechsel neu angelegt und muss dabei
  UNTER dem Relief landen (`GLOBE_TOPO_LAYER` als `before`). **Die Terrain Tiles
  (AWS Open Data) liegen als Spiegel in R2 unter `topo/`** (`scripts/topo-mirror.mjs`,
  npm `ingest:topo`, einmalig von Hand, nicht im Deploy) — **in R2 liegen PNG, und der
  Browser fragt PNG ab.** Am 09.11. wurde der Abruf auf WebP umgestellt (`ingest:topo:pack`,
  Upload `scripts/topo-upload.sh`), ohne dass die WebP je hochgeladen waren: jede Kachel lief
  ins 404, das Relief war auf ALLEN Karten weg, und weil 404 dort der Normalfall (Meer) ist,
  fiel es keinem Test auf. Am 10.11. zurück auf PNG. Wer WebP will: erst packen und hochladen,
  mit `rclone lsf -R …/topo/ | grep -c webp` die 50.134 prüfen, DANN umstellen — die .webp-404
  stehen bis zu einer Woche im Edge-Cache (`TOPO_MISSING_CACHE`), vorher Cache leeren, damit AWS die Besucher nicht sieht; die Datenschutzerklärung nennt deshalb
  keinen weiteren Host. Weltweit Stufen 0–8, **feiner nur über DACH (bis 11) und den Alpen (bis 12, ~25 m je
  Pixel)**, festgelegt in `config/topoDetail.json`, die Skript und Browser beide lesen;
  die Karten zoomen dafür bis 12, Feld und Linien werden dort nur gestreckt. 50.134
  Kacheln, 4,3 GB, `immutable`. **Außerhalb dieser Gebiete rechnet der Browser aus dem
  nächsten Vorfahren hoch** (`topoTile`, `upsampleTopoTile`), sonst bräche das Relief
  beim Hineinzoomen weg. **Kubisch, nicht bilinear**: die Schummerung zeichnet die
  Steigung, und bilinear gab das bei 16-facher Vergrößerung ein Karomuster. **Reine Meereskacheln fehlen im Spiegel, ein 404 ist dort der
  Normalfall**, der Browser macht daraus eine flache Kachel, und der Worker cacht das 404,
  sonst kostete jede Meereskachel jedes Mal einen R2-Abruf. Auf ganze Meter gerundet und
  neu gepackt waren die Kacheln nicht kleiner. `npm run dev` holt direkt bei AWS, im
  Arbeitsbaum liegt kein Spiegel. Beim Öffnen der Kugel 34 Kacheln / 2,8 MB, Alpen
  58 / 4,7 MB. **Die Kacheln werden vor der Schummerung bereinigt,
  beides im Browser gesehen**: unter null wird null, sonst stehen Schelfkante und
  Mittelatlantischer Rücken wie Struktur im Wetterfeld da; und der Polrand
  (`POLE_ROWS`) wird flach, sonst zeigt die Schummerung am Pol denselben
  Strahlenfächer wie früher das Feld. **Kostet Daten, nicht Rechenzeit** (gemessen 2026-11-05: Worker warm
  71 ms, aus R2 122 ms, Hauptthread kaum belastet; je Zoomschritt ~28 Kacheln à 140 KB).
  WebP wäre 22 % kleiner (`topo-pack.py` vergleicht jede Kachel Pixel
  für Pixel, s. o. — noch nicht hochgeladen), und jede Kachel wartet vor dem Abruf 120 ms (`TOPO_FETCH_DELAY_MS`): beim
  Zoomen bestellte MapLibre 17–32 Kacheln je Schritt und gleich wieder ab. Mit
  mehreren Panels überträgt der Browser jede Kachel nur einmal (der HTTP-Cache hält
  parallele Abrufe an), dekodiert sie aber je Karte. **Schlägt ein Abruf fehl, wird er
  wiederholt (`retryTopo`, rund 16 s, solange steht die gröbere Stufe)**, erst danach
  wird die Kachel flach und bleibt es für die Sitzung, statt zum Fehler zu werden
  (dieselbe Regel wie bei den übrigen Protokollen). **Ein 404 ist im Browser nur 1 h
  gültig, an der Edge eine Woche** (`TOPO_MISSING_CACHE`): mit `immutable` hielte eine
  beim Upload fehlende Kachel ein Jahr lang.
  **ALPEN 3D** (eigene Ansicht `alps3d`, seit 2026-11-09, auf Wunsch; die anderen bleiben flach):
  die Karte liegt auf dem Gelände (`setTerrain`, 1,5-fach überhöht), Rechtsziehen kippt und
  dreht, Windrose rechts oben richtet nach Norden aus. Beim Öffnen werden die Reliefstufen
  bis z9 vorgeladen (`preloadRelief`, 391 Kacheln, Ladeanzeige), das Feinere kommt wie in 2D
  bis z12 beim Hineinzoomen nach. **Die Reliefstufe ist nicht der Engpass** (gemessen in
  Software-Grafik: z7, z8, z9 gleich schnell), teuer ist die Schummerung (6 gegen 9 Bilder/s),
  sie bleibt aber an, weil sie dem Gelände die Form gibt. Beschriftung auf 80 Marker (anfangs 40)
  und den Bereich begrenzt (sonst schweben Namen am Himmel), Pixeldichte 1, Isolinien aus.
  **Talorte nur in dieser Ansicht** (`config/alpsTowns.ts`, seit 2026-11-10, auf Wunsch:
  „sonst kennt man sich nicht so aus"): ~130 Orte von Bregenz bis Kranj in drei Zoomstufen
  (Talzentren ab 6,3, weitere ab 7,2, kleine ab 8,1), über `addWorldLabels(…, extra)` zu den
  übrigen genommen; Natural Earth kennt dort kaum etwas unter Bezirksgröße, Bludenz fehlte ganz.
  **GENAU EINE DARSTELLUNG, auf Wunsch**: nur ICON-D2 (`WIND3D_MODEL`), Farbfeld θe 2 m
  (seit 2026-11-10 dazu die Phasen-Summe, s. u.)
  (`THETAE_VARIABLE`, steht bewusst nicht in `GLOBE_VARIABLES`, sonst läge es in allen anderen
  Auswahllisten); beide Listen sind in der Ansicht gesperrt. θe rechnet der Ingest aus T2m, Td2m
  und Bodendruck `ps` (Bolton, wie `thetaE` in `lib/thermo.ts`), ~166 KB je Bild. Eine Fassung
  mit Varda (1 km, aber ohne Vertikalbewegung) war nur kurz drin.
  **ZWEITES FARBFELD: NIEDERSCHLAGSSUMME REGEN/SCHNEE** (`precipphase`, seit 2026-11-10, auf
  Wunsch; `PRECIPPHASE_VARIABLE`/`RELIEF_VARIABLES` in `config/globe.ts`, Ingest `phase_step` in
  `scripts/nwp_common.py`, Einfärbung `colorizePhaseTile`, Tests `render/globePhase.test.ts`): die
  Summe seit Laufbeginn, Regen grün → blau, Schnee hellrosa → dunkelviolett, dieselben Stufen.
  **Die Phase entscheidet JE PIXEL DAS ECHTE GELÄNDE**, nicht das Modell: der Rechen-Worker holt zu
  jeder Feldkachel die Reliefkachel (`topoHeights`, dieselbe Quelle wie das 3D-Gelände, also meist
  aus dem HTTP-Cache) und färbt violett, wo das Gelände über der Schnee-Höhe liegt. So läuft die
  Schneegrenze am Hang entlang, auch quer durch eine 2,2-km-Zelle. **Die Schnee-Höhe ist ein
  GEWICHTETER MEDIAN**: je Stunde zählt der Niederschlag dieser Stunde mit der Schneefallgrenze
  `snowlmt` (ICON-D2, m über NN, live geprüft 2026-11-10) zum Ende der Stunde; an einem Ort der Höhe
  z ist er Schnee, wenn z darüber liegt. Über die Stunden ist Schnee(z) die mit dem Niederschlag
  gewichtete Verteilungsfunktion der Grenzen — die Höhe, über der mehr als die Hälfte der Summe
  Schnee war, ist also deren gewichteter Median, und genau das braucht die Anzeige (überwiegende
  Phase). Die Grenze zum gezeigten Termin allein wäre falsch: sie bestimmte dann auch den
  Niederschlag der Stunden davor. **`snowlmt` fehlt in 19 % des Gitters** (gemessen, zu 88 % dort,
  wo auch die Nullgradgrenze fehlt) — in diesen Stunden entscheidet die Modellphase
  (`snow_gsp + snow_con` gegen `tot_prec`) für die ganze Zelle. Kodierung `encoding: 'phase'`: R+G
  die Summe als 16-Bit-Code (0,1 mm), B die Höhe in 20-m-Stufen ab −200 m (0 = Schnee überall,
  255 = Regen bis 4900 m). Gerechnet nur in `PHASE_BOX` (Alpen 3D mit Rand), außerhalb kein Wert
  — das ganze Gitter hielte 48 h × 2 Felder × 906.000 Punkte. Gemessen ~76 KB je Bild, die
  Rechenzeit fällt im Lauf nicht auf. **Gegenprobe gegen die Modellphase steht noch aus**: am
  10.11. schneite es im ganzen D2-Gebiet nirgends (alle Niederschlagszellen weit unter der
  Grenze); bei der ersten Schneelage prüfen, ob dort, wo das Modellgelände über der Grenze liegt,
  auch das Modell Schnee führt.
  **AROME 1 km ALS ZWEITES MODELL DAFÜR** (`arome-at`, seit 2026-11-10, `scripts/arome-ingest.py`,
  `RELIEF_MODELS`, `reliefOnly`): GeoSphere Data Hub `nwp-v2-1h-1km` (C-LAEF-AA, offen, CC BY 4.0;
  der 2,5-km-Vorgänger endet am 04.11.2026). Nur Niederschlag, Summe, Neuschnee und die
  Regen/Schnee-Summe, nur in „Alpen 3D" wählbar (verlässt man die Ansicht, springt das Modell auf
  ICON-D2 zurück); θe und Windpartikel bleiben ICON-D2. `tp`/`sf` gelten je STUNDE und werden
  aufsummiert, damit dieselbe Pipeline läuft. **`snowlmt` heißt dort „height above ground", ist
  aber über NN** — gegen ICON-D2 zur selben Zeit hängt die Differenz nicht von der Geländehöhe ab
  (Steigung −0,04, Median −50…+80 m); anders als bei ICON überall gesetzt. Je Abfrage höchstens
  10 Mio. Punkte → 5 Stunden × 3 Größen über 622 × 937, 13 Abfragen je Lauf, ~2 min, Phasenfeld
  ~17 MB je Lauf. Bereitstellung langsamer als ICON-D2 (um 16 UTC war 09 UTC der neueste Lauf).
  Deploy: eigener Schritt mit Cache je Lauf (`nwp-arome-at-v1-<lauf>`, seit 2026-11-23 `v2`), `netCDF4` in
  `requirements-nwp.txt`.
  **SEIT 2026-11-23 ALS „C-LAEF" IN ALLEN ANSICHTEN UND PANELS** (auf Wunsch: GeoSphere
  stellt von AROME Austria auf C-LAEF um, `nwp-v2-1h-1km` IST C-LAEF-AA). Kein
  `reliefOnly` mehr; die ID bleibt `arome-at` (Pfade in R2, Cache). Gemessen: 16
  Bodengrößen, KEINE Druckflächen, kein Taupunkt (aus `2r` gerechnet), Bewölkung nur
  gesamt, keine Schneehöhe, kein Bodendruck (deshalb kein θe 2 m). Geholt werden T2m,
  Taupunkt, MSL, Wind/Böen 10 m (+Partikel/Fiedern), Bewölkung, CAPE, Niederschlag,
  Summe, Neuschnee, Regen/Schnee-Summe über das GANZE Gebiet (945 × 1300, 43–51,5° N /
  5–22,6° O). Einheiten im NetCDF: `2t` °C (nicht K), `cape` m²/s², `tp`/`sf` je
  Stunde; bei +0 fehlen `tp`/`sf`/`10fg` überall (Summe dort 0, sonst wäre der
  Niederschlag bei +1 leer). Je Schritt zwei Abfragen (Grenze 10 Mio. Punkte), 122 je
  Lauf, lokal ~5 min, ~2 MB Bilder je Schritt, ~12 Bilder je Schritt in R2.
  **3D-WINDPARTIKEL AUS DEM WINDVOLUMEN VON ICON-D2** (`render/wind3dLayer.ts`, `config/wind3d.ts`,
  `api/wind3d.ts`; im Querschnitt-Ingest mit erzeugt, Flächen bis 1,5 km über Grund in 2,2 km,
  stündlich bis +24 h, danach 3-stündlich): u, v und das echte `w`. **Gerechnet in der HÖHE über
  NN, nicht entlang der Modellflächen** (`sampleWind3dAtHeight`): die Flächen folgen dem Gelände,
  ein Partikel würde am Berg doppelt gehoben. Unter der untersten Fläche gleitet es am Gelände
  entlang, über der obersten verschwindet es. Waagrecht und senkrecht dieselbe Raffung je
  Partikel, die Steigung ist also echt (plus Überhöhung); das Bezugstempo wächst mit der Höhe
  über Grund (6 m/s am Boden), damit Talwind ins Auge fällt. Gezeichnet wird bodennah über dem
  ECHTEN Relief, weil das Modellgelände geglättet ist, nach oben klingt das ab (`RELIEF_BLEND_M`).
  **Gezeigt wird nur der Wind bis 1 km über Grund** (`TOP_AGL_M`, auf Wunsch); wer darüber
  steigt, startet neu, die höheren Schichten liest man in 2D.
  Eigene WebGL-Ebene mit Instanzen (GL-Linien sind fest 1 Pixel, Matrix ist
  `defaultProjectionData.mainMatrix`, `modelViewProjectionMatrix` rechnet in Pixeln, dann bleibt
  das Bild leer). Tempo wie 2D (`pxPerSecondAt10`), Spuren dünn und zum Ende hin schmaler und
  blasser, die Deckkraft hängt am ALTER des Stützpunkts, nicht an seiner Nummer (eine erste,
  breite Fassung mit Stufen je Stützpunkt wirkte grob). Farbe nach Tempo, Legende in der Ecke.
  Neue Spuren entstehen gleichmäßig über den BILDSCHIRM (Raster aus `unproject`, nur nach einer
  Bewegung): `getBounds()` reicht bei gekippter Karte bis zum Horizont, hineingezoomt blieben im
  Tal sonst einzelne Striche.
  **`setTiles` NUR ÜBER `render/tileQueue.ts`** (Einzelkarte und Panels): MapLibre
  bricht laufende Kacheln nicht ab, und was zuletzt fertig wird, bleibt stehen, bis zum
  nächsten `setTiles`. Dazu übernimmt `setTiles` die Adresse verzögert (gemessen über
  200 ms); Kacheln, die in dieser Lücke entstehen, gingen an die ALTE Adresse. So stand
  beim Wechsel von 6 auf 4 Panels unter „Niederschlag" kachelweise Temperatur 850 hPa.
  Die Schlange wartet deshalb, bis die Quellen nichts mehr laden (jüngster Wunsch gilt,
  Fläche und Linien wechseln gemeinsam), und setzt `src.tiles` selbst vor `setTiles`.
  **H und T im Bodendruckfeld waren testweise drin und sind auf Wunsch wieder raus**
  (2026-11-05, „gefällt mir nicht").
  **PFEILTASTEN gehören der Zeit, von Anfang an**: MapLibre-Tastatur aus
  (`keyboard: false` — sie verschob die Karte und verbrauchte das Ereignis:
  nach einem Klick in die Karte schalteten zehn Tastendrücke keinen Schritt),
  die Auswahllisten geben nach der Wahl den Fokus ab (sonst blätterten die
  Pfeile in der Liste), und ein fokussiertes Häkchen sperrt die Tasten nicht
  mehr (`globalKeyAllowed`, gilt für alle Bereiche). Unten mittig zwei große
  Pfeile (`.globe-arrows`): anklickbar und Rückmeldung — sie leuchten beim
  Tastendruck kurz grün; auf dem Zeitschieber selbst bewegt der Browser nativ,
  dort nur die Rückmeldung.
  **STERNENHIMMEL hinter der Kugel** (`render/starfield.ts` mit Tests, nur in
  der Globus-Ansicht, `.globe-space`): MapLibre lässt die Fläche neben dem
  Globus durchsichtig, darunter liegt eine wiederholte Sternkachel als
  CSS-Hintergrund — kein WebGL, kostet beim Drehen nichts. Erzeugt statt
  geladen, mit festem Startwert (bei jedem Besuch derselbe Himmel), in der
  Auflösung des Schirms; Helligkeiten nach Potenzgesetz (viele schwache,
  wenige helle mit Schein), Farbtöne bläulich bis gelblich. Beim Drehen zieht
  der Himmel leicht mit (Parallaxe, direkt am Element gesetzt statt über
  React). **Als `transform` einer eigenen Ebene** (`.globe-stars`), nicht als
  `background-position`: die zwang je Frame zum Neumalen der ganzen Fläche
  samt Stilberechnung über alle Marker (gemessen beim Drehen, Pixeldichte 2:
  0,78 s → 0,02 s Stilberechnung). Dazu MapLibres Atmosphärenschein am Kugelrand
  (`sky['atmosphere-blend']`, beim Hineinzoomen ausgeblendet).
  **MAPLIBRE-FEHLER IN DER BILD-WARTESCHLANGE — die Thailand-Ansicht blieb
  dadurch LEER** (gesehen 2026-10-28, bei jedem Modell; Europa, Alpen und
  Globus nie): `RasterTileSource.loadTile` legt den AbortController der
  Kachel an und WARTET dann auf `transformRequest`; wird die Kachel in der
  Lücke abgebrochen, ist er gelöscht, und `ImageRequest.getImage` bekommt
  `undefined`. Wartet so ein Eintrag in der Warteschlange, wirft
  `processQueue` (`abortController.signal`) und arbeitet nie wieder etwas
  ab — es lädt KEINE Kachel mehr, während die Werteanzeige (Hauptthread)
  weiter richtige Zahlen zeigt. Gegenmittel in `registerGlobeProtocol`:
  `maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS(_PER_FRAME)` = 256, damit
  die Warteschlange gar nicht erst volläuft (unsere Kacheln rechnet der
  Worker-Pool, MapLibres Netz-Drosselung bringt hier nichts; die übrigen
  Karten der Seite geben MapLibre nur Data-/Blob-URLs), und das Protokoll
  beantwortet einen fehlenden Controller als Abbruch statt zu werfen.
  Danach 0 Fehler in allen vier Ansichten. Bei einem MapLibre-Update
  prüfen, ob `loadTile` das noch tut — dann lässt sich beides wieder streichen.
  **Vite-Dev-Server und neue Läufe**: Vite merkt sich beim Start, welche
  Dateien in `public/` liegen, und erfährt von Dateien in einem UMBENANNTEN
  Verzeichnis nichts — der Ingest legt jeden Lauf genau so ab. Nach einem
  neuen lokalen Ingest liefert der laufende Dev-Server für die neuen Bilder
  die Startseite aus (HTTP 200, text/html), MapLibre bekam dekodierfehlerhafte
  Kacheln. Abhilfe: Dev-Server nach dem Ingest neu starten. Auf Pages tritt das
  nicht auf. Die Kachelprotokolle liefern bei einem nicht ladbaren Feld
  seither eine LEERE Kachel statt einen Fehler — ein abgelehnter Aufruf ließ
  MapLibre 5 über eine Kachel ohne Textur stolpern („reading 'bind'").
  **Laufalter je Modell** (`GlobeModel.staleHours` = Takt + Bereitstellung +
  Cron-Abstand + Reserve: IFS 30 h, ICON-EU 15 h, ICON-D2 9 h); die Init-Zeit
  ist GEMELDET (steht im Dateinamen). Quellenzeile je Anbieter (ECMWF CC BY 4.0
  bzw. DWD GeoNutzV — beide kommerziell mit Namensnennung erlaubt).
  Basemap: Bündel `world.basemap.json` (Natural Earth 1:50m global, auf 0,01°
  gerundet, ~350 KB gzip, `build-basemap.mjs world`), in Europa/Alpen dazu die
  Bundesländer/Kantone aus `dach`.
