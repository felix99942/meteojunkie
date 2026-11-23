# Soundings / Skew-T

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Ortswahl auf der Karte** (`LocationMap.tsx` + `ProfileMapPane.tsx`, Asset
  `scripts/build-relief.mjs` → `src/mapdata/europe-relief.png`, Konstanten in
  `config/relief.ts` mit Tests) — der Soundings-Bereich wählt den Punkt auf
  einer zoombaren Europakarte statt über Ortsname oder Schnellwahl. Grund: ein
  Vertikalprofil wählt man GEOGRAFISCH — Luv oder Lee, vor oder hinter der
  Front, Alpennord- gegen Südseite; man weiss, WO man hinsehen will, aber nicht,
  wie der Ort dort heisst. Karte LINKS neben dem Diagramm (`ProfileSplit.tsx`),
  nicht darüber: übereinander nähme sie die Höhe weg, die das Skew-T braucht.
  Der Ort ist globaler Zustand, die Komponente ist deshalb allgemein gehalten
  (nimmt eine Modell-Liste und eine Breite, sonst nichts) und liesse sich ohne
  Umbau auch neben Meteogramm oder Ensemble stellen.
  **Der Soundings-Bereich hat GENAU EIN Panel, und das ist keine Voreinstellung**
  (`FIXED_PANEL_COUNT`/`hasLayoutChoice` in `state/workbench.ts`): der
  MODELLVERGLEICH FINDET IM PANEL STATT — mehrere Modelle liegen als Kurven im
  selben Skew-T —, und der Ort ist globaler Zustand. Ein zweites Panel zeigte
  also denselben Punkt zur selben Zeit und unterschiede sich nur in der
  Modellauswahl, also in genau dem, wofür das eine Diagramm schon da ist; dazu
  kostete es Budget (~100 Level-Variablen) und nähme der Karte die Breite.
  Der LayoutPicker wird dort deshalb GAR NICHT gezeigt (eine Auswahl ohne
  Wirkung ist schlimmer als keine), `setLayout` ist für solche Bereiche ein
  No-op, und `presetLayouts` zieht ein älteres Preset mit zwei Profil-Panels
  auf den festen Wert. Die sechs Panel-Configs bleiben unangetastet — Layout
  ist nach wie vor nur eine Anzeigefrage.
  **Die Grenze zwischen Karte und Diagramm ist ZIEHBAR** (`.split-handle`,
  Rechenkern `lib/splitWidth.ts` mit Tests, Breite im Store als
  `profileMapWidth`): was man gerade braucht, wechselt mit der Frage — wer den
  Punkt sucht, will die Karte gross, wer das Profil liest, das Diagramm. Das
  ist ein Handgriff mitten in der Arbeit und gehört deshalb an die Grenzlinie,
  nicht in ein Menü. Die Breite liegt im STORE und nicht in der Komponente,
  damit sie einen Bereichswechsel überlebt. Greiffläche 10 px (3 px trifft man
  nicht), Doppelklick und Pos1 setzen zurück, Pfeiltasten verschieben.
  **Im Engpass gewinnt das DIAGRAMM** (`clampMapWidth`): reicht der Platz für
  beide Mindestbreiten nicht, schrumpft die Karte unter ihr Minimum — sie ist
  das Werkzeug zur Auswahl, das Profil der Inhalt. Unter 900 px wird ohnehin
  gestapelt, und dort muss die vom Trenner gesetzte Inline-Breite per
  `!important` überschrieben werden.
  **Die Orografie ist QUALITATIV, Atlas-Manier** — abgestufte Höhenschichten
  (0–200 … > 3000 m, dunkelgrün → braun → hell), aus denen man die Landschaft
  erkennt, aber KEINE Werte abliest. Gedämpft fürs dunkle Theme, und das ist
  Bedingung: darüber liegen Grenzlinien (#b4b9c2) und Stadtlabels, ein Test
  hält die oberste Stufe unter deren Helligkeit und die Stufen monoton
  aufsteigend. Meer bekommt fast die Hintergrundfarbe — es trägt keine
  Information, Bathymetrie lenkt nur ab.
  **Was Meer ist, entscheidet NICHT die Höhe allein, sondern eine LANDMASKE**
  (`rasterizeLand` im Ingest, Natural Earth 1:50m — dieselbe Stufe wie die
  Küstenlinie der Basemap, damit die Maskenkante exakt darunter liegt). Ohne
  sie standen die Niederlande und die deutsche Marschküste als Wasser da: sie
  liegen grossflächig unter null, und die Karte sah aus, als wäre das halbe
  Land abgesoffen. Eine tiefere Höhenschwelle behebt das NICHT, sie verschiebt
  es nur — Wattenmeer und Bodden liegen ebenfalls knapp unter null und wären
  dann Land. Die Maske hebt deshalb nur AN und löscht nie: Land unter dem
  Meeresspiegel wird zur untersten Landstufe (gemessen 0,52 % der Fläche =
  44.969 px), ein Punkt ausserhalb der Polygone bleibt aber nach seiner HÖHE
  eingestuft — sonst verlöre man kleine Inseln, die in 1:50m fehlen.
  **Was das Profil wirklich bestimmt, ist die MODELLtopografie** — deshalb
  steht am gewählten Punkt die Modellhöhe (`Profile.elevation`, neu
  durchgereicht, im Skew-T als `.skewt-elev` neben der Zeit; als SPANNE, wenn
  die Modelle sich uneinig sind). Am Sonnblick rechnet Open-Meteo mit 2962
  statt 3109 m — das Relief ordnet ein, es beweist nichts.
  **Bild statt Tile-Dienst**, dieselbe Entscheidung wie überall
  (`render/basemap.ts`): kein Key, kein fremdes Rate-Limit, und MapLibres
  `load`-Event hängt nicht an fremden Requests. Quelle sind die offenen
  Terrain-Kacheln von AWS Open Data (Tilezen „terrarium",
  h = R·256 + G + B/256 − 32768), einmalig geholt und eingefärbt; Attribution
  ist Lizenzbedingung und steht im Bereich (`ReliefAttribution`). Die Kacheln
  liegen in WEB-MERCATOR und MapLibres image-source spannt linear im
  Mercator-Raum auf — das Kachelfeld IST also das Zielraster, es braucht keine
  Vorverzerrung wie `render/fieldImage.ts` für lat/lon-Gitter (gleiche Lage wie
  beim Radarbild in EPSG:3857). PNG lesen und schreiben macht
  `scripts/lib/png.mjs` mit Bordmitteln (zlib), bewusst ohne Fremdpaket wie der
  KMZ-Parser des MOSMIX-Ingests; es liest NUR 8-Bit-RGB ohne Interlacing und
  schreibt NUR indiziert — alles andere wirft, statt still falsch zu lesen.
  **Zoomstufe 6 = 1,53 km/px, 321 KB. Gemessen (2026-09-20) kostet Stufe 7 mit
  0,75 km/px das 3,4-Fache (1128 KB)** — für ein Relief ohne ablesbare Werte
  ist das der Preis nicht wert, und beim Hineinzoomen weich zu werden ist hier
  sogar richtig: die Modelle lösen 7–25 km auf.
  **Ausserhalb der Modellabdeckung wird ABGEBLENDET und der Klick abgelehnt**
  (`coverageIntersection`/`isEmptyCoverage` in `config/models.ts`, mit Tests;
  Maske = Polygon mit Loch). Der SCHNITT ist die richtige Rechnung, nicht die
  Vereinigung: die Panels legen die Profile übereinander, an einem Punkt, den
  nur eines abdeckt, stünde eine Kurve allein da. Abgeblendet wird halb-
  durchlässig — man muss noch erkennen, WO die Abdeckung endet. Gemessen: die
  acht Regionalmodelle der Registry überlappen PAARWEISE alle, ein leerer
  Schnitt ist heute unerreichbar (ein Test hält das fest, damit ein Modell
  ausserhalb Europas auffällt).
- **Drucklevel-Verfügbarkeit ist GEMESSEN, nicht aus der Doku**
  (`config/levels.ts`, live 2026-09-20 in Innsbruck, je Modell alle 19 Level
  abgefragt und die nicht-leeren gezählt; Tests in `levels.test.ts`). Der
  vorherige Stand war ein Doku-Arbeitsstand und in BEIDE Richtungen falsch.
  **Fünf Modelle mit Druckleveln fehlten**: `icon_d2` (14 Level), `meteofrance_
  arome_france` (15), `meteofrance_arpege_europe` (15), `ecmwf_aifs025_single`
  (13) und `ukmo_global_deterministic_10km` (19). Damit stehen erstmals
  LOKALmodelle im Skew-T — AROME France mit 1,5 km und ICON-D2 mit 2,2 km
  gegen einen 25-km-Global ist genau der Vergleich, um den es dieser Workbench
  geht. **Und KEIN Modell liefert alle 19 Level**: ECMWF IFS/AIFS nur 13 — es
  fehlen 975, 950, 900, 800, 70 und 30 hPa, also gerade die untere
  Feinstruktur, auf die es bei einer Inversion ankommt; ICON-D2 endet bei
  200 hPa (Konvektionsmodell), hat dafür unten alle Level. `PressureLevelSupport`
  führt deshalb `levels` und `topHpa`: ein Profil, das bei 200 hPa aufhört, ist
  richtig und kein Datenfehler. **Bestätigt OHNE Drucklevel** (alle 19 durchgehend
  null bei HTTP 200 — die Falle aus SPEC §6): `geosphere_arome_austria`,
  `meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`; bei den ICON-CH deckt sich das
  mit dem Ensemble-Befund. Nicht erneut aus der Doku ergänzen.
- **Das Profil beginnt am BODEN, nicht bei 1000 hPa** (`SurfacePoint` +
  `columnFromProfile` in `lib/sounding.ts`, Tests in `sounding.test.ts`):
  Open-Meteo besetzt die Drucklevel AUCH unterhalb der Modelloberfläche — dort
  extrapoliert. **Gemessen (2026-09-20, ECMWF IFS)**: am Sonnblick
  (Modellhöhe 3057 m, Bodendruck 717 hPa) liefert 1000 hPa **25,5 °C auf
  217 m**, also 2840 m TIEF IM BERG, und 850 hPa 16,7 °C auf 1594 m; am
  Grossglockner liegt selbst 700 hPa noch darunter. **Auch das Flachland ist
  betroffen** — Salzburg (442 m): 1000 hPa auf 209 m. Es gibt also keinen
  Punkt, an dem das ungefiltert richtig war.
  Ungefiltert begann jedes Skew-T bei 1000 hPa, und das SB-Paket („surface
  based") stieg von einem Niveau auf, das es nicht gibt: **Sonnblick vorher
  SB-CAPE 57 / LCL 856 hPa** (1,5 km unter dem Gipfel), nachher 0 / 616 hPa;
  **Salzburg vorher 4, nachher 95** — der Fehler ging in BEIDE Richtungen.
  Abgeschnitten wird am BODENDRUCK, nicht an der Höhe: die Skew-T-Achse ist
  eine Druckachse, und `surface_pressure` lässt sich direkt gegen ein
  Drucklevel halten, ohne den Umweg über die selbst extrapolierte
  Geopotentialhöhe. Der vollständige Bodenpunkt wird als unterstes Niveau
  EINGEFÜGT (aus `temperature_2m`/`relative_humidity_2m`/`wind_*_10m`, fünf
  Variablen mehr im selben Request — das Gewicht bleibt bei 10 gewichteten
  Calls, der Bodenpunkt kostet also nichts). Diagramm, Windfiedern, Hodograf
  UND Kennzahlen lesen seither dieselbe `SoundingColumn`; vorher zeichnete das
  Panel aus den Rohleveln, während die Tabelle schon gerechnet hatte.
  **Zwei Folgefehler kamen dabei ans Licht, beide vorher durch den erfundenen
  warmen Start verdeckt:**
  **(1) CIN ohne LFC war eine Riesenzahl.** Ohne Niveau des freien Auftriebs
  summierte die Schleife die negative Auftriebsfläche bis zur Gitterspitze —
  am Sonnblick standen **−21.668 J/kg** in der Tabelle (real sind −10 bis
  −300). CIN ist dort gegenstandslos: gibt es kein LFC, ist nichts zu
  überwinden. `ParcelResult.cin` ist deshalb `number | null`, die Tabelle
  zeigt „–".
  **(2) Freie Konvektion wurde als CAPE = 0 ausgewiesen.** Die LFC-Suche
  verlangte einen Vorzeichenwechsel des Auftriebs. Ist das Paket ab dem LCL
  SOFORT wärmer als die Umgebung (heisser Nachmittag, genau die Gewitterlage),
  gibt es keinen — das LFC liegt dann AUF dem LCL und CIN ist 0.
  **(3) Die NULLGRADGRENZE steht in METERN, nicht in hPa** — so liest man sie
  (Schneefall- und Vereisungsgrenze); der Druck bleibt nur als Rückfall, falls
  ein Modell keine Geopotentialhöhen liefert („–" wäre dort unzutreffend, der
  Wert ist bekannt, nur nicht in der gewünschten Einheit). Interpoliert wird
  über die Level MIT gültiger Höhe statt über alle: vorher verlangte die
  Rechnung, dass JEDER Eintrag eine Höhe trägt, und ein einziger fehlender
  Wert unterdrückte die Angabe still — seit der Bodenpunkt vorangestellt wird,
  genügte dafür ein fehlendes `elevation`. Gerundet auf 10 m, nicht auf 100:
  die Tabelle dient dem MODELLvergleich, und zwei Modelle mit 3440 und 3460 m
  sollen unterscheidbar bleiben.
- **Bezugspaket des Skew-T ist ML, nicht SB** — durchgehend: der gezeichnete
  Parzellenweg mit CAPE/CIN war es schon, der **LIFTED INDEX kam aber aus dem
  SB-Paket**, die Tabelle wies also zwei Grössen aus, die von verschiedenen
  Startniveaus stammten. Grund für ML: das SB-Paket hängt an genau EINEM
  Wertepaar (`temperature_2m`/`relative_humidity_2m`) und wird von der
  bodennahen Schicht dominiert — bei nächtlicher Inversion meldet es eine
  Stabilität, die nur die untersten Meter betrifft. Das ML-Paket mittelt die
  untersten 100 hPa. Seit das Profil am Boden abgeschnitten wird (s. o.) wiegt
  das schwerer, weil der SB-Start jetzt wirklich der Modellbodenwert ist und
  nicht mehr ein extrapoliertes 1000-hPa-Niveau. In der Tabelle steht ML-CAPE
  deshalb ZUERST, die Zeile heisst „LI (ML)", und SB/MU stehen zum Vergleich
  daneben.
- **θe-SPALTE neben dem Skew-T** (`thetaE` in `lib/thermo.ts`,
  `thetaEProfile` in `lib/sounding.ts`, `drawThetaEColumn` in
  `render/skewt.ts`; Umschalter „θe", Vorgabe AN): die
  äquivalentpotentielle Temperatur über die Höhe, hinterlegt mit der
  Schichtung — **rot = potentiell instabil, grau = neutral, blau = stabil**.
  θe bleibt bei trockener WIE feuchter Hebung erhalten; hebt man eine ganze
  Schicht, bleibt ihr θe-Profil also stehen. **Nimmt θe nach oben ab,
  labilisiert sich die Schicht beim Heben von selbst** (der feuchte Fuß
  sättigt zuerst und kühlt danach feuchtadiabatisch langsamer ab als die
  trockene Oberseite) — die klassische Gewitterlage vor einer Hebung, und im
  T/Td-Paar sieht man sie nur, wenn man beide zusammen liest.
  **Eine eigene Spalte, keine zweite Kurve im Diagramm**: 320–350 K sind
  47–77 °C, liegen also weit außerhalb der Temperaturachse (die bei 45 °C
  endet), und die Scherung schöbe sie noch weiter hinaus. Eine zweite,
  versteckte x-Skala im selben Feld wäre schlechter als eine getrennte —
  man läse die Kurve unweigerlich gegen das Isothermengitter, das für sie
  nicht gilt. Die Spalte teilt sich die DRUCKachse, liegt also mit dem
  Diagramm auf einer Höhe.
  **Die Skala nimmt nur die Troposphäre** (bis `THETAE_SCALE_TOP_HPA` =
  300 hPa): θe wächst nach oben unaufhaltsam — über der Tropopause ist es
  praktisch θ, bei 100 hPa über 500 K. Auto-skaliert über die ganze Säule lag
  der Bereich, in dem die Schichtung entschieden wird (300–340 K), in den
  linken 15 % der Spalte, plattgedrückt von der Stratosphäre; darüber läuft
  die Kurve jetzt aus dem Rahmen.
  Klassifiziert wird auf den NATIVEN Leveln (nicht auf dem feinen 5-hPa-Gitter
  — die Bänder sollen zeigen, was das Modell liefert) über dθe/dz mit einer
  Totzone von ±`NEUTRAL_K_PER_KM` = 0,5 K/km; in der freien Troposphäre
  nimmt θe normal um 2–4 K/km ZU, „stabil" ist also der Normalfall und die
  roten Schichten sind die Ausnahme, auf die es ankommt. Fehlen
  Geopotentialhöhen, springt die hypsometrische Näherung ein (sonst fiele die
  ganze Schicht aus, obwohl θe an beiden Enden bekannt ist).
  Kurven für ALLE gewählten Modelle in ihren Farben, Bänder nur vom ersten —
  übereinandergelegte Bänder ergäben eine Farbe, die keiner Schicht mehr
  entspricht. Die Kurve wird dunkel unterlegt gezeichnet, sonst verschwindet
  eine blaue Modellfarbe auf dem blauen „stabil"-Band.
  **θe ist gegen IDENTITÄTEN geprüft, nicht gegen eigene Ausgaben**
  (`thermo.test.ts`): bei trockener Luft geht es in θ über, und entlang einer
  Feuchtadiabate bleibt es erhalten — Letzteres misst die Formel (Bolton
  1980, Gl. 43) gegen den unabhängig implementierten RK4-Feuchtadiabaten
  (gemessen 331,85 → 332,14 K von 900 auf 500 hPa).
  Kennzahlentabelle und Umschalter weichen der Spalte aus
  (`.skewt.has-thetae`, `right: 120px` = THETAE_W + Fiedernrand) — sonst läge
  die Tabelle darauf und die Spalte wäre nur bei geschlossener Tabelle zu
  sehen.
- **FEUCHTKUGELKURVE UND DCAPE** (`wetBulb` in `lib/thermo.ts`,
  `wetBulbColumn`/`downdraftCape` in `lib/sounding.ts`; Umschalter „Tw",
  Vorgabe AUS, ebenso der Abwindweg — auf Wunsch, beide schaltet man in
  der Legende dazu). Die Feuchtkugeltemperatur ist die Temperatur, auf die
  Verdunstung die Luft abkühlen KANN; sie liegt immer zwischen Taupunkt und
  Temperatur und fällt bei Sättigung mit beiden zusammen. Gerechnet nach
  NORMAND — trockenadiabatisch zum LCL, von dort feuchtadiabatisch zurück auf
  den Ausgangsdruck —, also aus den beiden schon vorhandenen, geprüften
  Bausteinen; gegen die Psychrometertafel: 20 °C bei 10 °C Taupunkt und
  1000 hPa ergeben 13,98 °C.
  Gezeichnet gepunktet und in EIGENEM LILA (`WETBULB_LINE`) statt in der
  Modellfarbe: als dritte Kurve desselben Modells in dessen Farbe ging sie
  zwischen T und Td unter — man fand sie nur, wenn man wusste, wo sie liegt.
  Die Zuordnung bleibt trotzdem lesbar, weil Tw immer ZWISCHEN T und Td
  desselben Modells verläuft; der Preis ist, dass bei mehreren Modellen die
  Tw-Kurven nicht mehr nach Modell zu unterscheiden sind. Der Abwindweg ist
  daraufhin ins BLAUVIOLETTE gerückt: er startet GENAU auf der Tw-Kurve, die
  beiden laufen also unweigerlich nebeneinander, und zwei gleich warme
  Violetts wären dort nicht zu trennen.
  **Zwei Zahlen hängen daran, beide in der Kennzahlentabelle.**
  **„0 °C feucht"** ist die Feuchtkugel-Nullgradgrenze und die für den
  Niederschlagstyp entscheidende der beiden: Schnee, der in ungesättigte Luft
  fällt, kühlt sie durch Schmelzen und Verdunsten auf Tw ab und überlebt
  deshalb bis etwa dorthin. Gemessen an zwei Profilen, die sich NUR in der
  Feuchte der Mittelschicht unterscheiden: 1230 m unter der trockenen
  Nullgradgrenze bei trockener Mitte, keine 90 m bei feuchter.
  **DCAPE** ist das Gegenstück zu CAPE — die Energie des ABWINDS. Startniveau
  ist das θe-Minimum in den untersten 400 hPa (SPC-Konvention), das Paket
  startet GESÄTTIGT bei der Feuchtkugeltemperatur dieses Niveaus (mehr kann
  Verdunstung nicht kühlen) und sinkt feuchtadiabatisch zum Boden; integriert
  wird nur die Fläche, auf der es KÄLTER ist als die Umgebung — ein wärmerer
  Abschnitt bremste den Abwind, ihn gutzuschreiben machte die Zahl größer und
  die Aussage falscher. Hohe Werte bei trockener Mitte sind das Kennzeichen
  für FALLBÖEN, also Sturm am Boden ohne viel Regen; derselbe Kontrast
  gemessen: **1004 gegen 544 J/kg bei identischem Temperaturprofil**.
  Beide Größen sind gegen diesen Kontrast getestet, nicht gegen feste Zahlen:
  was zählt, ist dass die Feuchte der Mittelschicht sie in die richtige
  Richtung bewegt.
  **Der ABWINDWEG steht im Diagramm** (`drawDowndraft`, Umschalter „DCAPE"):
  gestrichelte Absinkkurve vom Startniveau zum Boden, darunter die
  DCAPE-Fläche — sie IST die Zahl aus der Tabelle, so wie die rote Fläche das
  CAPE ist. **Violett**, weil Rot und Blau hier CAPE und CIN gehören und die
  DCAPE-Fläche regelmäßig GENAU ÜBER dem CIN-Bereich liegt; in derselben
  Farbfamilie wären die beiden nicht auseinanderzuhalten. Gestrichelt statt
  gepunktet, damit der Absinkweg nicht mit dem Aufstiegsweg des ML-Pakets
  verwechselt wird. Gefüllt wird abschnittsweise nur dort, wo das Paket
  KÄLTER ist als die Umgebung — dieselbe Einschränkung wie in der Rechnung.
  Nur für das Bezugsmodell, wie der Parzellenweg.
- **DIE FLÄCHEN WERDEN ABSCHNITTSWEISE GEFÜLLT, nicht über den ganzen
  Bereich** (`fillRuns` in `render/skewt.ts`) — sonst malen sie auf der
  falschen Seite. Gerechnet wird der Auftrieb über die VIRTUALtemperatur (so
  gehört es sich: feuchte Luft ist bei gleicher Temperatur leichter),
  gezeichnet werden die ECHTEN Temperaturen, weil das die Kurven sind, die
  man im Skew-T abliest. Beide Kriterien kippen an leicht verschiedenen
  Stellen: gemessen (Montpellier, 30.09.2026 15 UTC, ECMWF IFS) liegt das
  **LFC aus der Virtualtemperatur bei 803 hPa, die Kurven kreuzen sich erst
  bei 763 hPa**. Ungeprüft färbte der Füller den Streifen dazwischen ROT,
  obwohl das Paket dort sichtbar auf der kalten Seite liegt — als
  Falschaussage gemeldet („LFC und CAPE-Fläche passen nicht zusammen").
  Dasselbe am Boden: **das ML-Paket startet wärmer als die
  Bodentemperatur** (gemessen 22,03 gegen 20,80 °C — die mittlere θ der
  untersten 100 hPa ist in einer stabilen Grundschicht höher als die des
  Bodens, das ist richtig so), und die blaue CIN-Fläche lief über diesen
  Bereich hinweg. Beide Flächen prüfen jetzt je Abschnitt das Vorzeichen der
  GEZEICHNETEN Differenz; die ZAHLEN bleiben unangetastet bei der
  Virtualtemperatur. Der Rest-Versatz zwischen LFC-Marke und Flächenbeginn
  ist die Virtualtemperatur selbst und steht im Tooltip der CAPE-Zeile — jede
  Sondierungssoftware hat ihn.
- **DIE BILDLEGENDE IST DAS SCHALTBRETT** (`.skewt-legend`, links oben unter
  der Zeitangabe): sie sagt, was welche Farbe bedeutet — und schaltet
  dieselbe Schicht gleich ein und aus (Tw, ML-Paket, CAPE, CIN, DCAPE).
  Wer eine Fläche loswerden will, sucht sie dort, wo ihre Farbe erklärt ist,
  nicht in einer Knopfreihe am anderen Ende des Panels; die Umschalter „Tw"
  und „DCAPE" oben sind dafür entfallen. Oben bleiben nur die, die das
  LAYOUT ändern (θe-Spalte, Hodograf, Kennzahlen).
  **Bewusst AUSSERHALB der Kennzahlentabelle**: die kann man zuklappen, die
  Legende muss stehen bleiben. T und Td haben kein Häkchen — ohne sie gäbe es
  kein Diagramm. Ein abgeschalteter Eintrag bleibt lesbar, tritt aber zurück
  (`:has(input:not(:checked))`), damit man sieht, was gerade NICHT im Bild
  ist. Schriftgröße 12 px wie die Bedienleisten der übrigen Bereiche: als
  10-px-Zeile im Kennzahlenkasten war die Legende eine Fußnote.
- **„ⓘ Info" im Skew-T dokumentiert die RECHNUNG** (`SoundingInfo.tsx`,
  Knopf `.skewt-info-btn` gross und in Akzentfarbe vor den Layout-Schaltern):
  ML-CAPE, CIN, DCAPE und Feuchtkugeltemperatur, jeweils mit den Formeln,
  die in `lib/sounding.ts`/`lib/thermo.ts` WIRKLICH stehen — nicht die
  Lehrbuchdefinition. Genau das braucht, wer die Zahlen gegen ein anderes
  Programm hält: CAPE/CIN/DCAPE gibt es in mehreren Konventionen, und
  abweichende Werte heissen meist schlicht abweichende Rechnung. **Ändert
  sich dort ein Verfahren, muss der Text mit** — er ist Handarbeit, kein
  Generat. Formelsatz mit **KaTeX** (einzige Abhängigkeit dafür), per
  `React.lazy` erst beim ersten Klick geladen: 82 KB gzip samt Schriften
  kosten den Bereich sonst bei jedem Aufruf. Inhaltsverzeichnis als KNÖPFE
  mit `scrollIntoView`, nicht als `#`-Links — die änderten die Adresse.
- **Die Kennzahlen stehen dauerhaft im Diagramm, oben rechts**
  (`.skewt-params`): sie sind der Grund, warum man ein Sounding aufschlägt —
  hinter einem Knopf kostete jeder Blick einen Klick. Möglich wurde es durch
  den ziehbaren Trenner: das Diagramm hat jetzt Platz, den es als halbes
  Panel nicht hatte. Ausblenden geht weiter über „Kennzahlen ✕".
  **Die Ecke ist gewählt, nicht bloss frei**: rechts oben heisst im Skew-T
  „sehr warm in grosser Höhe" — dort verläuft keine reale Sondierung, die
  Fläche ist praktisch immer leer. Links unten sässe der Kasten mitten in der
  Bodenschicht. Er ist deshalb auch nur so hoch wie nötig (kein `bottom: 0`
  mehr): über die volle Höhe verdeckte er die untere rechte Ecke, wo bei
  warmen Profilen die Kurven liegen. Gemessen 7 % der Panelfläche bei einem
  Modell.
  **Modellnamen dürfen UMBRECHEN**, dieselbe Regel wie im
  Verifikations-Panel: ungebrochen ist „ECMWF IFS 0.25° 12 UTC" allein 145 px
  breit, ab drei Modellen lief der Kasten über seine Höchstbreite und die
  letzte Spalte stand abgeschnitten da (gemessen 460 px gebraucht bei 418 px
  Platz). Mit Umbruch kostet jede Modellspalte 88 px, vier Modelle passen.
- **GEMESSENE AUFSTIEGE im Skew-T** (`scripts/sonde-ingest.py` → `public/
  sondes/`, Kern `api/sondes.ts` mit Tests, npm `ingest:sondes`): weisse
  Kurve über den Modellen, eigene Spalte in der Kennzahlentabelle, **rote
  Punkte** auf der Ortswahl-Karte (Klick setzt den Punkt EXAKT auf den
  Startplatz; vorher weisse Dreiecke, die über dem hellen Alpenrelief
  untergingen). **Quelle ist seit 2026-10-09 der DWD**
  (`opendata.dwd.de/weather/weather_reports/radiosonde/bufr/`): sein
  GTS-Eingang als BUFR, also die Meldungen ALLER Wetterdienste, ~2 Tage
  vorgehalten (~425 Dateien, ~240 MB), überwiegend hochaufgelöst (bis ~7.000
  Punkte). **Vorher University of Wyoming — und das ist der Grund für den
  Wechsel**: vom GitHub-Runner aus lieferte UWyo stundenweise NICHTS (drei
  Läufe hintereinander null Aufstiege, der Schritt meldete trotzdem
  „success"), während derselbe Abruf lokal 21/21 Stationen brachte; ein
  leerer Lauf ersetzte den letzten guten Stand, die Seite sagte „keine
  Daten". Der DWD ist vom Runner aus verlässlich (MOSMIX, ICON) und
  VOLLSTÄNDIGER: **Graz, Linz, Ljubljana, Rivolto (Udine), Novara, Altenstadt,
  De Bilt** fehlten bei UWyo und sind jetzt dabei — 31 Stationen, Liste
  gemessen. Nicht im Strom: Udine 16044, Mailand 16080, Uccle, Nancy, Lyon.
  **Innsbruck und Graz steigen nur EINMAL täglich auf (≈ 02:15 UTC)** — das
  ist der Startplan, keine Lücke der Quelle; im GTS steht nichts weiter. Wien
  zweimal, Lindenberg/Idar-Oberstein alle 6 h.
  **Drei Fallen beim Dekodieren, alle gemessen**: (1) ABSTIEGE — nach dem
  Platzen misst die Sonde weiter und wird als eigene Meldung verteilt
  (Vorlage 309056, Druck steigend); genommen werden nur 309052/309057 mit
  fallendem Druck. (2) TEILMELDUNGEN — ein Aufstieg kommt erst bis 100 hPa,
  später vollständig; je Station und Termin gilt die mit den meisten Punkten.
  (3) In der DWD-Vorlage 309057 ist `pressure` um EINEN Wert länger als die
  übrigen Reihen (hinten angehängter Tropopausen-/Maximalwind-Druck) — mit
  dem Druck als Länge lief der Index über und acht deutsche Stationen fielen
  still heraus; die Länge kommt deshalb aus der Temperatur.
  **Termin ≠ Startzeit, und der Termin steht NICHT in der Meldung**:
  `term_of` = letzter 3-h-Termin bis 1¾ h nach dem Start (DWD 10:45 → 12,
  Cuneo 22:15 → 00, Innsbruck 02:15 → **03 UTC** — bei UWyo stand derselbe
  Start unter 00 UTC). Termine sind also nicht nur 00/12. Ein früh
  abgerissener Aufstieg wird mit „endet bei … hPa" markiert.
  **Dekodieren kostet**, weil jede Meldung weltweit ausgepackt werden muss:
  je BUFR-Datei liegt das Ergebnis in `.cache/sondes/` (für ALLE
  europäischen Stationen, damit eine Änderung der Liste den Cache nicht
  entwertet), im Deploy über den Actions-Cache mit einem Schlüssel je
  6-Stunden-Block (je Lauf wären ~8 MB stündlich, 1,3 GB über die
  Aufbewahrungszeit, und verdrängten die ECMWF-Läufe). Gemessen lokal: kalt
  1½ min samt Download, warm 0,4 s. Bei null Stationen scheitert der Schritt
  sichtbar (`continue-on-error`), und das Panel unterscheidet „Abruf brachte
  nichts" von „Ingest fehlt". LOKAL braucht der Ingest `eccodes`
  (`pip install -r scripts/requirements-nwp.txt`).
  Ausgedünnt wird auf ECHTE Messpunkte (alle 2 hPa, über 300 hPa alle 1 hPa,
  Druck streng fallend), nicht auf ein Gitter interpoliert. Gerechnet wird
  über `sondeColumn` → dieselbe `computeSounding` wie bei den Modellen.
  **Td der Messung ist DURCHGEZOGEN**: an scharfen Trockenschichten springt
  er echt um 15 K in 2 hPa, die Strichelung zerhackte das zu Rauschen.
  **Drei Ansichten, nicht eine Zusatzkurve** (`soundingSource` im Store,
  Segmentschalter `.skewt-source`): Vorhersage · Messung · Vergleich. Ein
  Skew-T liest man über die Flächen, und die gehören immer zu GENAU EINEM
  Profil — in der Messansicht gehören Paket, CAPE/CIN, DCAPE, Tw, Windfiedern
  und Hodograf dem Aufstieg, im Vergleich bleiben sie beim ersten Modell. Die
  Messansicht holt KEINE Modelle (Budget) und die Karte prüft dort keine
  Modellabdeckung (`LocationMap gated={false}`). Farbcode durchgehend:
  Vorhersage = Akzentblau, Messung = Weiss der Messkurve (Umschalter,
  Kennzeilen `.skewt-time-model/-obs`, Tabellenspalte). Leere Ansichten
  melden sich IM Panel (`blocker`) statt per frühem `return` — sonst
  verschwände der Umschalter, und man käme nicht mehr heraus. Windfiedern und
  θe-Spalte der Messung laufen über `thinColumn` (25 hPa): auf 2-hPa-Punkten
  wären die Fiedern ein Klumpen und die θe-Schichtung Messrauschen.
  Automatisch dazugenommen wird die nächste Station nur bis
  `SONDE_AUTO_KM` = 60 km — Salzburg gegen München wäre ein anderer Ort, kein
  Modellfehler. Weicht die Modellzeit vom Termin ab, sagt das Panel es und
  bietet „auf Termin setzen" (nur innerhalb des Zeitrasters, ältere Termine
  sind reine Messung).
- **Windfahnen im Skew-T sind von der API begrenzt, nicht vom Code**
  (`BARB_MIN_GAP`/`BARB_LEN` in `SkewTPanel.tsx`): Open-Meteo liefert genau die
  19 Drucklevel aus `PRESSURE_LEVELS`, davon 16 im Achsenbereich (1050–100 hPa).
  **Die Zwischenlevel 750/650/550/450/350 hPa gibt es NICHT** — live geprüft
  (2026-09-16): HTTP 200 mit lauter `null`, während 700 und 600 im SELBEN
  Request Werte liefern. Das ist die Falle aus SPEC §6; nicht erneut aus der
  Doku ergänzen. Gerechnet für eine 420-px-Achse zeichnet der adaptive Abstand
  bei 13 px 12 Fahnen, bei 8 px 14 — und tiefer bringt NICHTS mehr, weil
  1000/975/950/925 auf der logarithmischen Druckachse nur 4,5–4,9 px
  auseinanderliegen. Steht er auf 8, ist praktisch jedes verfügbare Level
  gezeichnet. Die Schaftlänge muss mitskalieren (`drawWindBarb(..., len)`),
  sonst greifen die Fiedern der Nachbarn ineinander. Wer WIRKLICH mehr Fahnen
  will, müsste sie zwischen den Leveln INTERPOLIEREN — das sähe wie ein
  echtes Radiosondenprofil aus, wäre aber erfunden; bewusst nicht gemacht.
