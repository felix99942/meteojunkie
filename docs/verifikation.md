# Verifikation

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

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
  eine Fußzeile. Zeiträume 5 (Voreinstellung) / 10 / 20 / 60 / 90 / 180 Tage;
  die Legende stuft ab (unter `ROUGH_DAYS` „kein Modellvergleich", darüber
  „grobe Reihung"). **Die langen Zeiträume sind die Voraussetzung dafür, dass
  die Rangliste Modelle überhaupt TRENNEN kann** — bei 20 Tagen liegt der
  gepaarte Unterschied zweier Globalmodelle regelmäßig innerhalb der
  Unsicherheit. Kosten: ein Request je Modell für ALLE Vorlaufzeiten, danach
  für immer im IDB-Cache; ein einmal geholter größerer Zeitraum wird beim
  Zurückschalten zugeschnitten (`sliceRuns`) und kostet nichts mehr. Bei 20 Zeilen klebt der Tabellenkopf mit (Modellnamen
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
  **ÜBER der Tabelle steht eine RANGLISTE über den ganzen Zeitraum**
  (`RankingBlock`) — der „auf einen Blick"-Teil. Bewusst keine Reihung nach MAE
  allein: die Spalten beantworten drei verschiedene Fragen. MAE/Bias = wie groß
  und systematisch-oder-streuend; **σf/σo und r = WORAN es liegt**; Skill gegen
  Persistenz/Klimatologie = war die Aufgabe leicht oder schwer; **Δ zum Besten
  = ist die Reihenfolge überhaupt belastbar**. Die letzte Spalte ist der Grund
  für den Block: über 14 Tage SANK der IFS-Fehler mit längerem Vorlauf
  (gemessen, reines Rauschen) — eine Reihung ohne Unsicherheit hätte das als
  Befund ausgewiesen. Die Kopfzeile sagt deshalb ausdrücklich, ob die Spitze
  belastbar führt oder ob die Reihenfolge oben Zufall ist.
  **Der Vergleich ist GEPAART** (`pairedMae`): alle Modelle werden an DENSELBEN
  Tagen verifiziert, die richtige Größe ist deshalb die Differenz der
  Tagesfehler und deren Streuung, NICHT der Vergleich zweier unabhängig
  gemittelter MAE — was allen gemeinsam schwerfiel (ein Frontdurchgang) kürzt
  sich heraus, und genau das macht den Vergleich trennscharf. **Autokorrelation
  ist dabei der Fallstrick**: Wetter hält an, aufeinander folgende Tagesfehler
  sind nicht unabhängig, `sd/√n` wäre zu optimistisch und wiese Unterschiede
  als gesichert aus, die es nicht sind. Korrigiert über die Autokorrelation
  erster Ordnung (`nEff = n(1−ρ)/(1+ρ)`, AR(1)-Näherung; bei ρ = 0,5 bleibt von
  60 Tagen ein effektives Drittel). Schwelle `PAIRED_Z` = 2 — die Markierung
  heißt deshalb „unterscheidbar", nicht „signifikant": bei einem halben Dutzend
  Modellen im Vergleich ist die Konvention ohnehin optimistisch
  (Mehrfachvergleiche).
  **`Scores` trägt eine DIAGNOSE, nicht nur Fehlerbeträge**: `sdRatio` =
  σ(Vorhersage)/σ(Messung) macht den AIFS-Befund (Tagesgang auf zwei Drittel
  gestaucht), der hier von Hand herausgerechnet wurde, für JEDES Modell und
  jede Station automatisch sichtbar; `corr` trennt „richtiger Verlauf, falsches
  Niveau" (korrigierbar) von „falscher Verlauf". Dazu die **Murphy-Zerlegung**
  `MSE = Bias² + (σf−σo)² + 2σfσo(1−r)` (`decomp`) — eine exakte Identität, die
  aus einer Rangliste eine Diagnose macht: systematischer Versatz ↔ falsche
  Amplitude ↔ Timing/Verlauf. Zwei Modelle mit demselben MSE sehen hier völlig
  verschieden aus. Streuungen als POPULATIONsgrößen (durch n), sonst gilt die
  Identität nicht exakt; `phase` wird als REST gerechnet, damit die Summe
  numerisch immer stimmt, auch wenn r undefiniert ist (konstante Messreihe).
  Ein Test prüft genau diese Summe — das ist der einzige, der hier etwas
  beweist.
  **Der bloße Fehlerbetrag beantwortet die Frage nicht, die man hat** — deshalb
  drei Referenzen (`verify.ts`, mit Vitest getestet). **Skill gegen die
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
  **Skill gegen KLIMATOLOGIE als zweite Referenz** (`climatologyForecast`),
  weil Persistenz nur bei KURZEM Vorlauf ein ernsthafter Gegner ist: bei +5 bis
  +7 Tagen schlägt sie jedes Modell mühelos, der Score sättigt gegen 1 und
  trennt die Modelle nicht mehr — genau dort, wo der Vergleich am
  interessantesten wäre. Es ist eine STICHPROBEN-Klimatologie (Mittelwert des
  ausgewerteten Zeitraums), **nicht** das 30-jährige Normal: die vorhandenen
  Normal-Assets führen bei `tlmax` das MONATSMAXIMUM und nicht das Mittel der
  Tagesmaxima (siehe `atParameters.ts`) — als Tagesklimatologie wären sie grob
  zu hoch und damit schlechter als keine; außerdem gäbe es sie nur für ~207
  Stationen, die Stichprobenversion ist überall definiert und kostet keinen
  Request. Gerechnet LEAVE-ONE-OUT (je Tag das Mittel aller ANDEREN Tage),
  sonst kennte die Referenz den Tag, den sie vorhersagen soll.
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
  grober Fehlgriff, 2,6 mm Tagesniederschlag sind Alltag. **Seit 2026-11-02
  färbt sie nach RICHTUNG** (`errTone` in `verify.ts`, auf Wunsch; vorher
  nur nach Betrag grün → rot): unter der feinsten Stufe TREFFER (weiß mit
  goldenem Rand, beim Niederschlag auch „trocken angesagt, trocken
  geblieben"), darüber Temperatur zu warm ROT / zu kalt BLAU, Niederschlag
  zu nass GRÜN → BLAU / zu trocken BRAUN, STUFENLOS mit dem Fehler (die
  `errSteps` sind Stützpunkte des Verlaufs, `rampAt`, und am unteren Ende
  DICHT: Temperatur 0,5 · 0,8 · 1,1 · 1,5 · 2 · 2,6 · 3,6 · 5 K, Treffer unter
  0,5 K; Niederschlag 0,3 · 0,6 · 1 · 1,5 · 2,5 · 4 · 7 · 12 mm — mit
  0,7/1,2/1,8 … lagen die kleinen Abweichungen in zwei blassen Tönen), jedes Ende wird mit
  dem Fehler DUNKLER (dunkelblau = große Abweichung, auf Wunsch). Die FARBEN
  sind die des GeoSphere-Klimamonitors (`colorRamp` aus
  `api.zamg.ac.at/climon/v1/data/spartacus/raster`, `TMa…_IMG` = RdBu,
  `RRa…_IMG`), die KLASSENGRENZEN nicht — die gelten dort für Monate. Auf
  den hellen Anfängen schaltet die Schrift auf dunkel (`inkOn`);
  eine Farberklärung steht über der Tabelle.
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
  Globalmodelle · Mischungen. Interessant ist der Vergleich
  1–2,5-km-Lokalmodell gegen 25-km-Global. **INNERHALB einer Gruppe ordnet die
  MODELLFAMILIE, dann die Auflösung** (`modelFamily` = Etikett bis zum ersten
  Leerzeichen/Bindestrich): ICON-CH1/CH2/D2 stehen als Block, AROME France und
  Austria als Block. Der Preis ist, dass eine Gruppe nicht mehr durchgehend
  fein → grob läuft (ARPEGE 11 km steht vor ICON-EU 7 km) — dafür steht die
  Auflösung an jedem Eintrag, die Information geht also nicht verloren. Das
  Etikett als letzter Stichentscheid sorgt dafür, dass `ecmwf_ifs025` und
  `ecmwf_aifs025_single` NEBENEINANDER stehen und GFS mit denselben 25 km
  nicht dazwischenrutscht (ein Test hält das fest, ein zweiter, dass jede
  Familie nur EINEN zusammenhängenden Block bildet). Die **Auflösung steht
  sichtbar an JEDEM Eintrag JEDER Auswahl** — klassisches Meteogramm,
  Karten-Dropdown, Modell-Picker, Föhn und Verifikation, überall über
  `resolutionLabel` (`resolutionKm = 0` → „variabel"), deshalb trägt auch kein
  Etikett mehr seine Gitterweite im Namen. Ohne die Angabe ist nicht zu sehen,
  warum ein Globalmodell im Alpental danebenliegt — siehe der AIFS-Befund
  oben.
  Der **Bias** steht klein unter jedem Wert: derselbe Fehlerbetrag bedeutet bei
  +2 K Schieflage etwas anderes (systematisch, korrigierbar) als bei 0 K (streut
  nur). Darin steckt auch der Unterschied zwischen Modellgitterzelle und
  Messplatz — genau deshalb ist er stationsweise interessant. Ein Request je
  Modell (alle Vorlaufzeiten in einem), Messung ein GeoSphere-Bulk-Request, für
  immer gecacht.
  **DIAGRAMME UNTER DER RANGLISTE** (seit 2026-11-24, auf Wunsch „intuitiver";
  `VerifyCharts.tsx`, CSS `.verify-charts`/`.vchart-*`) — dieselben Zahlen als
  drei Bilder, ausgewählt vom Nutzer aus vier Vorschlägen (Streudiagramm
  Vorhersage/Messung wurde NICHT genommen): **Skill-Balken** „wie viel besser
  als nichts tun" (Skill gegen „wie gestern" und gegen „das Mittel" als
  Prozent, gemeinsame Achse, unter −100 % gekappt); **Fehler nach Vorlauf**
  (MAE je Modell über +1 … +7 d, eingestellter Vorlauf gestrichelt, unter 30
  Tagen sagt die Unterzeile „weitgehend Zufall" — siehe den 14-Tage-Befund
  oben); **Fehlerursachen** (Murphy-Zerlegung gestapelt, Balkenlänge = ganzer
  quadratischer Fehler, am Ende der RMSE in der Einheit, Anteile im Tooltip;
  drei Graustufen statt Serienfarben, die tragen hier das Modell). Kein
  zusätzliches API-Budget: eine Abfrage je Modell trägt alle Vorlaufzeiten.
  Schlichtes SVG statt uPlot (keine Zeitachse, sieben Stützpunkte), Werte am
  Zeiger über `<title>` mit Zeilenstreifen als Ziel. **Farbe je Modell über
  einen festen Slot** (kleinster freier beim Hinzufügen, `slotsRef`) wie in
  den Meteogrammen — mit dem Index in der Auswahlliste wechselten die Farben
  beim Abwählen. Deshalb sind höchstens 8 Modelle wählbar
  (`MAX_MODELS_PER_PANEL`, so viele geprüfte Serienfarben gibt es). Das
  frühere Abweichungsdiagramm bleibt draußen — die Tagesverläufe stehen
  weiter nur in der Tabelle.
  **Überschriften nennen die KENNZAHL, nicht eine Frage** (auf Wunsch,
  zuerst stand „Wie viel besser als nichts tun?" usw.): „Skill Score (SS = 1 −
  MSE Modell / MSE Referenz)", „Mittlerer absoluter Fehler (MAE) nach
  Vorlauf", „Zerlegung des MSE nach Murphy (1988)" samt Formel; die Legende der
  Zerlegung führt Term UND Lesart („Bias² (Versatz)").
  **RANGLISTEN-TABELLE ENTFERNT, DIAGRAMME GRÖSSER** (2026-11-24, auf Wunsch:
  „die Tabelle mit dem SS etc. kann man sich sparen"). `RankingBlock` ist nur
  noch die Kopfzeile „Bestes Modell bei … : X" samt der Aussage, die in keinem
  Diagramm steht — ob die Führung belastbar ist (gepaarter Vergleich, Tooltip),
  mit den Modellen, von denen das beste nicht unterscheidbar ist. σf/σo und r
  stecken in der Murphy-Zerlegung, Skill in den Balken, MAE im Vorlaufdiagramm.
  **VARDA UND C-LAEF IN DER VERIFIKATION** (seit 2026-11-24, auf Wunsch;
  `config/ownVerify.ts` mit Tests, `api/ownRuns.ts`, `worker/verifyArchive.ts`,
  `nwp_common.ingest(points=True)`). Beide stehen NICHT bei Open-Meteo, also
  kein `previous_dayN`; GeoSphere hält von C-LAEF nur die letzten SECHS Läufe
  (gemessen: `available_forecast_reftimes` der Metadaten, 15 h), Varda rechnen
  wir selbst. Deshalb ein EIGENES ARCHIV, das ab dem ersten Lauf wächst — es
  gibt KEINE Vergangenheit, Ergebnisse erst, wenn die vorhergesagten Tage
  gemessen sind, belastbar nach Wochen. Datenfluss: der Ingest schreibt je
  Lauf T2m und Niederschlagssumme an den 290 aktiven Klimastationen (bilinear,
  0,1 °C/0,1 mm) nach `verify/points/<modell>/<lauf>.json`; hochgeladen mit
  `upload-data.sh --copy` (NICHT synchronisieren — in R2 sammeln sich die
  Läufe; Varda löscht die lokalen Dateien nach dem Upload, sonst lüde jeder
  Lauf alle früheren wieder hoch). Der Worker übernimmt sie stündlich (erster
  TAWES-Lauf der Stunde) in `verify/<modell>/<station>.json` und löscht sie:
  je Vorlauf n stündlich der Wert des JÜNGSTEN Laufs mit Init ≤ t − n·24 h —
  dieselbe Regel wie `previous_dayN`. Ein zu spät gekommener ÄLTERER Lauf wird
  verworfen (er überschriebe einen jüngeren). Stundenniederschlag aus der
  Summe, Lücken gleichmäßig verteilt. 185 Tage, Station für Station verarbeitet
  (alle Archive im Speicher wären ~80 MB). Vorlaufzeiten: C-LAEF +1/+2 (60 h,
  alle 3 h), Varda +1…+4 (120 h, alle 6 h). Gemessen lokal: 290 Stationen
  im Gitter, Übernahme 54 ms; Lauf 09 UTC +6 h an der Hohen Warte 2,4 °C,
  gemessen 2,5 °C. **HÖHENUMRECHNUNG mit GENÄHERTER Modellhöhe**
  (`heightCorrection`, `ownVerifyHeights.json` aus
  `scripts/build-verify-heights.py`): Open-Meteo rechnet die Vergleichsmodelle
  auf die Stationshöhe um, der Data Hub liefert für C-LAEF aber KEINE
  Orografie (16 Größen, kein z/hsurf; die Punkt-API nennt nur die Koordinaten
  des Gitterpunkts). Genähert als ~30-m-Geländemodell (AWS Terrain Tiles,
  z12) über die 1-km-Zellen der vier umliegenden Gitterpunkte, bilinear
  gewichtet. Gemessen an den 290 Stationen: |Station − Zelle| im Median 19 m
  (~0,1 K, egal), aber 41 Stationen über 100 m, 8 über 200 m — Valluga +359,
  Sonnblick +351, Patscherkofel +322 m über der Zelle (~2 K zu warm), St.
  Leonhard im Pitztal −234 m darunter. Umgerechnet mit 0,65 K/100 m wie bei
  Open-Meteo, NUR die Temperatur, erst im Browser (das Archiv bleibt roh). Die
  echte Modellorografie ist eher glatter — an Gipfeln ist die Korrektur eher zu
  klein. Die Stationsliste ändert sich selten; bei neuen Stationen das Skript
  neu laufen lassen (ohne Eintrag: keine Umrechnung).
  C-LAEF kommt nur mit dem Deploy (~alle 3 h, nicht jeder Lauf), Varda nur,
  wenn der Laptop rechnet. Fehlt ein Archiv, bleibt die Spalte „—" (der
  Vite-Dev-Server antwortet dann mit HTML statt 404 — der Lader prüft den
  Inhaltstyp). Lokal: Ingest laufen lassen, dann `npm run ingest:verify-archive`.

