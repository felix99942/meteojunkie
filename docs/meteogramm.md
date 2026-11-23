# Klassisches Meteogramm

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Klassisches Meteogramm** (`ClassicMeteogram.tsx`, AppView `classic`) — der
  „Meteogramm, wie man's kennt"-Bereich: EIN Ort — GROSS und mittig als Überschrift über dem Stapel
  (`.meteo-place`, auf Wunsch) — (teilt sich `lockedLocation`
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
  **Der ResizeObserver jeder Zeile ist GEBREMST, und das ist kein
  Feinschliff**: Größenmeldungen gehen nur weiter, wenn sich die GERUNDETE
  Größe geändert hat, und gebündelt im nächsten Frame
  (`requestAnimationFrame`). Ohne die Bremse flimmert der Stapel sichtbar: die
  Zeilen sind `flex: 1 1 0`, ihre Höhen also gebrochen (110,4 px),
  `clientHeight` rundet, uPlots `setSize` schreibt die gerundete Höhe zurück,
  das Layout rundet erneut — und bei sechs Zeilen mit gemeinsamem Cursor
  entsteht daraus ein Dauerlauf. Chromium meldet Sub-Pixel-Änderungen, Edge
  und Chrome sind gleich betroffen.
  **Zweite Flimmerquelle ist der SCROLLBALKEN**, und die fängt der
  Größenvergleich NICHT ab: liegt die Gesamthöhe genau an der Kante,
  erscheint der Balken → Breite schrumpft → Diagramme werden neu vermessen →
  Höhe ändert sich → Balken verschwindet. Die Breite wechselt dabei zwischen
  zwei GÜLTIGEN Werten, der Vergleich mit der letzten Größe greift also nicht.
  Dagegen `scrollbar-gutter: stable` auf `.meteo-stack` — der Platz ist immer
  reserviert. Wer einen weiteren Diagrammstapel in einen scrollbaren
  Container setzt, braucht dasselbe.
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
  Höhe (`DAY_STRIP_H`). **Weil das Plugin außerhalb der Achsenlogik zeichnet,
  muss es den VERSATZ selbst kennen**: unter der Zeichenfläche liegen ZWEI
  Achsen (Stunden, darunter der Datumsstreifen), `u.bbox` kennt aber nur die
  Fläche. Ohne die übergebene Stundenachsenhöhe (`axisH`) landete das Datum im
  Band der UHRZEITEN und lag bei 00 UTC genau auf der „00", während der eigens
  reservierte Streifen darunter leer blieb. `axisH` ist 0, wenn die
  Stundenachse ausgeblendet ist (Symbolzeile) — eine versteckte Achse
  reserviert bei uPlot keine Höhe. Die Tagesgrenzen werden EINMAL beim Plot-Aufbau aus
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
- **SCHNEEVORHERSAGE** (seit 2026-11-10, auf Wunsch; Unterpunkt des Meteogramms,
  Umschalter „Meteogramm | Schneevorhersage" in dessen Leiste; `SnowForecast.tsx`,
  Kern `config/snowForecast.ts` mit Tests): Neuschnee-SUMME ab der laufenden Stunde
  über 7 Tage am gewählten Ort. Oben ALLE Ensembles in EINER Verteilung, jedes
  Ensemble mit GLEICHEM Gewicht (`pooledStats`, gewichtetes Quantil) — je Member
  gezählt bestimmte IFS-ENS mit 51 Membern das Band fast allein. Darüber die vier
  Hauptläufe AROME 1 km, ICON-D2, ICON-EU, IFS 9 km (`ecmwf_ifs`). Darunter je
  Ensemble eine Kachel mit eigenem Band, Median und zugehörigem Hauptlauf
  (ICON-D2-EPS 20 Member +48 h, ICON-EU-EPS 40 +120 h, IFS-ENS 51, 0,25°). Anordnung (auf
  Wunsch): ICON-D2 und ICON-EU NEBENEINANDER mit eigener, bis zu ihrem letzten Wert
  GEKÜRZTER Zeitachse (`Tile.n`), IFS-ENS darunter über die volle Breite — auf der
  7-Tage-Achse in halber Breite wäre ICON-D2 ein schmaler Streifen links gewesen.
  Der Zeiger-Sync läuft je Achsenlänge (`snow-<n>`), die Zeitleiste über `readoutTime`. Bänder
  rosa (10–90 %) und lila (25–75 %), Median dunkelviolett. Endet ein Ensemble,
  springt das kombinierte Band; die Kopfzeile nennt die Stelle (`groupChanges`).
  **AROME kommt DIREKT vom GeoSphere Data Hub** (Punktabfrage `timeseries/forecast/
  nwp-v2-1h-1km`, CORS offen, kein Schlüssel): Open-Meteo liefert
  `geosphere_arome_austria` seit dem Ende des 2,5-km-Datensatzes (04.11.2026) nur
  noch null (gemessen 2026-11-10). Außerhalb des Gebiets antwortet der Hub HTTP 400
  → leere Reihe. AROME hat hier kein Ensemble mit Membern: am Hub gibt es das C-LAEF-Ensemble (`ensemble-v2-1h-1km`, 1 km, Läufe alle 3 h, +60 h) NUR als Perzentile P10/P50/P90 je Stunde (gemessen 2026-11-23, CORS offen) — für eine Neuschnee-SUMME taugt das nicht, Perzentile von Stundenwerten lassen sich nicht aufsummieren. **Schnee in cm wie Open-Meteo**
  (1 mm Wasserwert = 0,7 cm); AROME `sf` (kg/m²) wird ebenso umgerechnet — die
  Modellkarten rechnen beim Neuschnee 10:1, die Zahlen dort liegen also höher.
  Die Werte gelten für die MODELLhöhe des Gitterpunkts, nicht für die Höhe des
  Orts (Hinweis im Tooltip). Kosten: 3 Ensemble- und 3 Hauptlauf-Abrufe bei
  Open-Meteo je Ort, dazu einer bei GeoSphere.
