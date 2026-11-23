# Ensemble

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Ensemble-Modus** (`EnsemblePanel`, `config/ensemble.ts`, Kern `render/plume.ts`,
  Parsing `api/ensembleParse.ts`) — vierter Panel-Modus, **punktbasiert**.
  **Startparameter ist `temperature_850hPa`, nicht T2m** (`DEFAULT_ENSEMBLE_
  VARIABLE`): die Plume ist ein synoptisches Werkzeug, auf 850 hPa liegt das
  Signal des Luftmassenwechsels — T2m wird von der bodennahen Grenzschicht
  (Inversion, Schneedecke, Modellorografie) überlagert, die Streuung zeigt dort
  eher Modellrauschen als Wetterlage.
  Eigener Endpunkt (`ensemble-api.open-meteo.com`), aber derselbe `apiGet`-Pfad
  (mock-fähig, im Verbrauchszähler sichtbar). Modelle: `ecmwf_ifs025` und
  `ecmwf_aifs025` (je 51 Member, 15 Tage), `gfs_seamless` (NOAA GEFS,
  31 Member, ~34 Tage — der einzige Weg über 15 Tage hinaus; bis +240 h 0,25°,
  danach 0,5°, deshalb genau EIN GEFS-Eintrag statt gfs025/gfs05 daneben) und
  seit 2026-09-16 **`icon_d2_eps`** (20 Member, 2,2 km, ~48 h) — das erste
  LOKALensemble hier, Streuung auf der Skala, die Täler auflöst. Es steht ANS
  ENDE der Liste, weil `DEFAULT_ENSEMBLE_MODEL` = `ENSEMBLE_MODELS[0]` ist:
  als Voreinstellung wäre ein 48-h-Ensemble falsch, eine Plume lebt von der
  Auffächerung über Tage (ein Test hält Voreinstellung und Mindesthorizont des
  ersten Eintrags fest). **ICON-CH1-EPS und ICON-CH2-EPS stehen bewusst NICHT
  hier**, obwohl der Föhn-Bereich sie benutzt: live geprüft (2026-09-16)
  liefern beide `temperature_850hPa` und `geopotential_height_500hPa`
  durchgehend `null` (HTTP 200, die Falle aus SPEC §6) — und 850 hPa ist der
  STARTparameter dieses Bereichs, die Plume öffnete sich also leer. Deshalb hat
  `EnsembleModelInfo` jetzt **`availableVariables`** — je Modell die Größen, die
  es WIRKLICH liefert, alle live gemessen (2026-09-16, Innsbruck). Damit stehen
  auch die ICON-Ensembles ohne Drucklevel in der Liste:
  **`icon_eu`** (ICON-EU-EPS, 40 Member, 7 km, ~120 h — das
  mitgliederstärkste nach den ECMWF-Läufen und das einzige regionale),
  **`icon_seamless`** (40 Member, ~192 h, Blend aus EU und Global),
  **`meteoswiss_icon_ch2_ensemble`** (21, 2,1 km) und
  **`meteoswiss_icon_ch1_ensemble`** (11, 1 km).
  **Zwei ID-Fallen dabei, beide gemessen**: auf dem Ensemble-Endpunkt heißt
  ICON-EU-EPS `icon_eu`, also wie das deterministische Modell, und
  `icon_eu_eps` ist ein ALIAS darauf (Wert für Wert identisch) — die
  Umkehrung der AIFS-Falle, wo zwei IDs NICHT austauschbar sind. `icon_global`
  bleibt bewusst draußen: gleicher Horizont wie Seamless, aber weder Böen noch
  Drucklevel.
  **Von allen DWD-Ensembles hat nur ICON-D2 Drucklevel** — deshalb war es das
  einzige, das ohne die Beschränkung passte.
  **Die Beschränkung deckt einen ALTEN Fehler mit auf**: AIFS liefert im
  Ensemble weder Böen noch CAPE (dasselbe wie sein deterministischer Lauf),
  beides stand aber im Dropdown und ergab eine leere Plume.
  Dazu zwei Absicherungen, damit nie eine leere Plume erscheint:
  `ensembleVariableOptions(modelId)` filtert das Dropdown, und
  `ensembleVariableFor()` stellt die Größe beim Modellwechsel mit um
  (Startparameter ist 850 hPa — genau den haben die ICON-Ensembles nicht). Ein
  Korrektur-Effekt in `PanelHeader` fängt zusätzlich, was aus gespeicherten
  Presets in den Zustand kommt, dasselbe Muster wie die Schwellen-Korrektur in
  `VerifyPanel`. Sechs Tests halten die Messwerte fest.
  **Eine KI-Version des GFS gibt es nicht** — `gfs_graphcast025` liefert auf
  beiden APIs durchgehend null, die übrigen Namen sind ungültige IDs; nicht
  erneut aus der Doku übernehmen. **`deterministicDays` ist getrennt von
  `forecastDays`**: die Forecast-API deckelt bei 16 Tagen, mit dem
  Ensemble-Horizont (GEFS 35) scheitert der Hauptlauf-Abruf komplett.
  **BEIM NIEDERSCHLAG SIND ES QUANTIL-SÄULEN, KEINE PLUME**
  (`render/quantileBars.ts` mit Tests, Umschalter „Quantil-Säulen" in der
  Leiste, Vorgabe AN bei `kind: 'accum'` — gilt für BEIDE Ansichten, Summe
  wie 6-h-Menge). Eine Plume lebt davon, dass die Member PARALLEL laufen und
  sich auffächern; beim Niederschlag springen sie stattdessen — Member 7 hat
  den Schauer um 14 Uhr, Member 12 um 20 Uhr, zwanzig andere gar nicht. Als
  Linienbündel ist das ein Knäuel, und das P10–P90-Band dazwischen zeichnet
  einen Verlauf, den KEIN EINZIGER Member hat. Gefragt ist an einem
  Niederschlagstermin ohnehin nicht „wie läuft es", sondern „wie viel und wie
  sicher" — also die Verteilung an diesem einen Termin.
  **Die beiden ANSICHTSSCHALTER stehen im PANELKOPF neben SYNC**
  (`BALKEN`/`MEMBER` in `PanelHeader`, `.panel-viewtoggles`; Zustand
  `ensembleBars`/`ensembleMembers` in der `PanelConfig`). Vorher waren es
  zwei Häkchen in der Werkzeugleiste des Panelinhalts, rechts oben — dort
  sucht man sie nicht: was ein Panel ZEIGT, stellt man im Kopf ein, wie
  Modell und Parameter daneben. Sie sehen aus wie SYNC, weil sie so bedient
  werden; aktiv aber in der Schriftfarbe statt im Akzentblau, denn der
  Akzent gehört der KOPPLUNG zwischen Panels, hier geht es nur um dieses
  eine Panel. `BALKEN` erscheint nur bei Summengrößen (bei Temperatur ist
  die Plume richtig), `MEMBER` nur dort, wo es Spaghetti zu zeigen gibt — in
  der Balkenansicht stehen die Einzelläufe gar nicht im Bild. Die Gruppe hat
  einen eigenen Container statt eines `:first-of-type`-Kniffs: welcher Knopf
  der erste ist, hängt daran, welche gerade sichtbar sind. Panel-lokal wie
  `ensembleAccumView` — zwei Panels nebeneinander, eines mit Balken, eines
  mit Spaghetti, ist ein sinnvoller Vergleich; ältere Presets ohne die
  Felder laden mit beiden an (nur ein ausdrückliches `false` schaltet ab).
  Gezeichnet wird die am Markt übliche **QUANTIL-BALKEN**-Form
  (ECMWF-/Wetterzentrale-Manier): Hauptbalken **P10–P90** mit **Median und
  MITTEL** als Marken darin, darauf schmalere und blassere Aufsätze bis
  **P5 und P95**, darüber die **Striche an Minimum und Maximum** mit dünner
  Verbindung. Dazu Hauptlauf und Kontrolllauf als Marken in ihren Farben.
  **Die Einzelläufe stehen NICHT im Balken** — wer sie sehen will, schaltet
  die Balken ab und bekommt die Spaghetti; der „Member"-Haken verschwindet
  deshalb in dieser Ansicht, statt als wirkungsloses Bedienelement stehen zu
  bleiben.
  **Median UND Mittel, weil sie beim Niederschlag weit auseinanderliegen**:
  dreißig trockene Member und fünf nasse ergeben Median 0 und Mittel 2 mm.
  Beide Zahlen stimmen und beantworten verschiedene Fragen („der typische
  Lauf" gegen „die erwartete Menge"); sie stehen auch in der Ablesezeile.
  `PlumeStats` führt dafür jetzt `p5`, `p95` und `mean`.
  **ZWEI VORSTUFEN SIND GESCHEITERT und stehen hier, damit niemand
  zurückrudert.** Die erste zeichnete drei gefüllte Quantilstufen bis zum
  MAXIMUM: ein einzelner nasser Ausreißer zog den Balken auf das Dreifache,
  und die 80 %, um die es geht, quetschten sich unten in ein paar Pixel. Die
  zweite ersetzte die Fläche durch eine GEIGENFORM (Breite = Memberzahl je
  Höhenabschnitt, Wurzelskalierung, ein Strich je Member) — rechnerisch
  ehrlich und gegen den falschen Eindruck wirksam, in der Praxis aber unruhig
  und ohne Mehrwert gegenüber den Quantilen, die man ohnehin abliest. Die
  Lehre aus beiden steckt in der jetzigen Form: **Fläche ist
  Aufmerksamkeit**, deshalb nach außen hin schmaler UND blasser (Hauptbalken
  → Aufsatz → Strich), statt überall gleich viel Farbe zu setzen.
  **Der Abstand wird bei jedem Zeichnen neu gerastert** (`barStepHours`, nur
  runde Stundenvielfache 1/2/3/6/12/24/48, `barIndices` hängt sie an die
  UTC-Zeit statt an den Datenbeginn — sonst stünden zwei Panels versetzt).
  Zwei Zahlen dahinter, beide gemessen: mit 7 px Mindestabstand stand die
  SUMMENansicht (361 Stundenwerte über 15 Tage) als geschlossener Block da,
  mit **14 px** bleibt über den vollen Horizont der 6-Stunden-Schritt, und
  beim Hineinzoomen rücken die Balken von selbst auf 3 h und 1 h nach. Der
  Mindestabstand ist eine Sache der ANZEIGE: `valToPos(…, true)` rechnet in
  GERÄTEpixeln, ohne die Division durch `devicePixelRatio` stünden die
  Balken auf einem HiDPI-Schirm doppelt so dicht (genau so war es zuerst).
  Gezeichnet wird im `draw`-Hook, also ÜBER den Kurven — darunter
  verschluckte sie die Bandfüllung.
  **In der Balkenansicht entfallen die LINIEN von Hauptlauf und
  Kontrolllauf**: beide stehen als Marke IN jedem Balken, die Verbindung
  dazwischen ist nicht nur überflüssig, sie behauptet auch einen Verlauf —
  bei 6-h-Mengen gibt es zwischen zwei Terminen keinen Zwischenwert, und die
  zwei kräftigen Zickzacklinien waren das Auffälligste im Bild. Die
  Medianlinie bleibt dünn stehen: sie ist die eine Spur, an der man die
  Abfolge der Termine entlanglesen kann.
  **Die y-Achse muss die Extreme der Balken MITNEHMEN** (`barHi` in den
  `scales`): uPlot skaliert nach den SERIEN, Minimum und Maximum liegen aber
  in keiner — sie werden aus `stats` im `draw`-Hook gezeichnet. Ohne das
  reichte die Achse nur bis P90 und schnitt die Extremstriche ab, und zwar
  unauffällig: ein abgeschnittener Balken sieht wie ein hoher Balken aus.
  Solange die Linien von Hauptlauf und Kontrolllauf noch mitliefen, fing
  einer von beiden den Höchstwert oft zufällig ein — mit ihrem Wegfall kam
  der Fehler sofort zum Vorschein (6-h-Ansicht: Achse bis 10,5 bei einem
  Maximum von 19,2).
  Bei Temperatur, Druck und Wind bleibt es bei der Plume; dort ist sie
  richtig, und der Umschalter erscheint gar nicht.
  **DIE PLUME BEGINNT AM JÜNGSTEN LAUFSTART, nicht um 00 UTC** (seit
  2026-11-10, gemeldet als „ab einem Datum kreuzen sich die Member"; Kern
  `config/ensembleRun.ts` mit Tests, Hook `useEnsembleRunMeta`): Open-Meteo
  füllt die Stunden davor mit älteren Läufen, und „Member 7" ist in jedem Lauf
  eine andere Bahn. An der Naht schnürte sich das Bündel zusammen (der neue
  Lauf startet mit kleiner Streuung) und die Linien kreuzten quer — gemessen
  ICON-EU-EPS Innsbruck T2m: Streuung 0,85 → 0,47 K um 12 UTC, Rangkorrelation
  der Member 0,57 statt ~0,9. Laufstart aus `meta.json` des Datensatzes, wenn
  frisch (≤ 48 h); die DWD-Datensätze standen dort am 10.11. noch auf dem 06.10.,
  dann Schätzung aus Rhythmus und Bereitstellungszeit (bewusst etwas zu kurz:
  zu früh geschätzt bliebe der Knoten). Aus den Daten selbst ist die Naht NICHT
  zu finden — bei Wind, Niederschlag und den Konvektions-EPS springt die
  Reihenfolge auch mitten im Lauf. Summen beginnen damit am Laufstart. Gilt
  ebenso für ΔP je Member im Föhn-Bereich.
  **WAHRSCHEINLICHKEITSLEISTE unter der Plume** (`exceedance` in
  `render/plume.ts` mit Tests, Schwellen `ENSEMBLE_THRESHOLDS` in
  `config/ensemble.ts`): Anteil der Member, die eine Schwelle erfüllen, über
  die Zeit — „wie wahrscheinlich ist T850 < 0 °C", „Böen ≥ 89 km/h". Die
  Schwelle steht zusätzlich als gestrichelte Linie IN der Plume, in derselben
  Farbe (Türkis — Gelb gehört dem Zeit-Cursor), damit Linie und Leiste als
  eine Aussage lesbar sind. **Ein eigenes uPlot, keine zweite y-Achse**: 0–100 %
  neben °C im selben Feld liest man gegen die falsche Achse. Zeitachse,
  Ausschnitt (setScale-Hook der Plume) und Cursor (`uPlot.sync`) sind geteilt,
  die linke Achse gleich breit — die Termine stehen senkrecht übereinander.
  **Vorgabe ist AUS** — die Leiste erscheint erst, wenn man eine Schwelle
  wählt. **Voreinstellungen an etablierten Grenzen**, nicht geraten: Kenntage
  bei T2m, Beaufort bei den Böen (8 = 62, 10 = 89, 12 = 118 km/h), gängige
  CAPE-Stufen; dazu eine eigene Schwelle. **Beschriftet wird nur, was eine
  DEFINITION ist** (Frost, Sommertag, Bft, Achtel) — keine Wetterdeutung: die
  erste Fassung schrieb zu „T850 < 0 °C" „Schnee bis in tiefe Lagen möglich",
  und das stimmt ohne Niederschlag schlicht nicht; ebenso ist CAPE ohne
  Auslösung kein Gewitter. Die Schwelle beschreibt die Größe, nicht das Wetter. `>=` schliesst den Grenzwert ein, `<` aus — 0 °C
  fällt eindeutig auf eine Seite. Bei Summengrößen gilt der Wert für die
  gewählte ANSICHT (Summe bzw. 6-h-Menge), die Beschriftung sagt es mit der
  Einheit dazu. Die Schwelle ist LOKAL im Panel und geht beim Größenwechsel
  wieder aus (0 °C bei 850 hPa ist etwas anderes als bei Böen); sie steht
  deshalb nicht in Presets.
  **Gezählt wird nur über Member mit Wert, und unter der halben Memberzahl gibt
  es KEINE Zahl** — dieselbe Regel wie bei der Föhn-Wahrscheinlichkeit. Der
  Kontrolllauf zählt mit (er IST ein Member), der Hauptlauf nicht. Die Leiste
  sagt ausdrücklich „roh (nicht kalibriert)": Ensembles sind am Boden meist zu
  eng gestreut, 0 % und 100 % sind damit selbstsicherer als die Wirklichkeit,
  und die Auflösung ist 1/Memberzahl (bei ICON-D2-EPS 5 %).
  **Die Ablesezeile unter dem Diagramm ist das ERGEBNIS des Bereichs** und
  seit 2026-09-30 entsprechend gesetzt: die Zahlen groß (19 px) und in der
  Farbe ihrer Kurve, die Bezeichner klein daneben, der einordnende Nachsatz
  (P10–P90, Spanne, Streuung) klein. Vorher stand alles in der Größe der
  Bedienleiste darüber und ging unter.
  Die suffixlose Reihe der Antwort
  ist der **Kontrolllauf**, NICHT der Hauptlauf — der kommt als eigener
  deterministischer Abruf dazu (1 Call). Eigene Modell- UND Variablenregistry
  (u.a. 850 hPa / 500 hPa), eigene Zeitachse über den vollen Horizont, Zoom per
  Mausrad. **Keine Kartenvariante**: ein Punkt kostet ~5 gewichtete Locations,
  ein AT-Gitter käme auf ~7.200 Calls pro Feld (Rechnung in `config/ensemble.ts`).
