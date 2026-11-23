# Satellitenbilder

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Satellitenbilder** (`SatellitePanel.tsx`, Registry/Kern `config/satellite.ts`
  mit Tests, Abruf `api/eumetsat.ts`, AppView `satellite`) — zweiter Bereich,
  der fertige Karten holt statt Zahlen. Quelle ist **EUMETView**, der
  öffentliche WMS von EUMETSAT (`view.eumetsat.int/geoserver/wms`): CORS `*`,
  kein Key, `<Fees>none</Fees>`/`<AccessConstraints>none</AccessConstraints>` —
  also dieselbe Mechanik wie beim Radar, direkt aus dem Browser, ohne Proxy
  und ohne Open-Meteo-Budget (plain `fetch`, nicht `apiGet`).
  **FÜNFZEHN Produkte, nach Mission gruppiert** (`SATELLITE_GROUPS`,
  `<optgroup>` in der Auswahl — bei fünfzehn Einträgen ist eine flache Liste
  eine Liste, die man jedes Mal neu liest). **Jedes einzeln durchgemessen
  (2026-09-29)**: je ein Bild um 12 und um 20 UTC über die Standardfläche,
  daraus Größe, Deckungsgrad, mittlere Helligkeit und Farbzahl — so
  unterscheidet man „trägt nachts durch" von „liefert ein schwarzes Bild".
  Archiv: MTG ab 23.09.2024 (einzelne RGBs später), **MSG ab 01.09.2020**.
  MTG/FCI, 10 min: Geocolour (Voreinstellung) · **Sichtbar 0,6 µm
  hochaufgelöst** · Infrarot 10,5 µm · **Nebel/Tiefe Wolken** · **Staub** ·
  Wolkenphase · Wolkentyp · Schnee · Echtfarben.
  MSG/SEVIRI, 15 min: Luftmassen · Konvektion · **Wasserdampf 6,2 µm** ·
  Vulkanasche · Natural Colour verstärkt · **HRV-RGB geschärft**
  (s. u., das einzige Produkt aus zwei Layern und mit eigener Fläche).
  **Die drei wichtigsten Zugänge der Erweiterung**, weil sie Lücken schließen
  statt Varianten zu häufen: **Wasserdampf 6,2 µm** ist der klassische Kanal
  für die Höhenströmung (dunkle Streifen = trockene Absinkzonen, markieren
  Strahlstrom und Trogachsen, lange bevor am Boden etwas zu sehen ist) und
  fehlte ganz; **Nebel/Tiefe Wolken** behebt genau die dokumentierte Schwäche
  des Infrarots, dass WARME tiefe Wolken kaum heller sind als der Boden — im
  Winterhalbjahr das nützlichste Produkt der Liste; **Staub** zeigt
  Saharastaub über den Alpen und trägt als IR-Differenz Tag und Nacht.
  **Drei früher verworfene Produkte sind auf Wunsch wieder da**
  (`rgb_truecolour`, `rgb_snow`, `rgb_cloudtype`). Die alte Begründung —
  „zeigen tagsüber nichts, was Geocolour nicht auch zeigt" — hält für
  Echtfarben, aber NICHT für Schnee und Wolkentyp: auf einem
  True-Colour-artigen Bild sind Schneedecke und Wolke beide weiß, und genau
  das trennen diese RGBs. Die Auswahl folgt jetzt der Breite des Dienstes
  statt dem Minimum.
  **Bewusst DRAUSSEN, mit Grund**: die QUANTITATIVEN Produkte (`cth`
  Wolkenobergrenze, `clm` Wolkenmaske, `gii_kindex`/`gii_liftedindex`
  Instabilitätsindizes — alle live vorhanden und gefüllt) brauchen eine
  WERTElegende, und dieser Bereich hat bewusst keine: „ein Satellitenbild hat
  keine ablesbaren Klassen, dort steht die Erklärung des Produkts". Sie sind
  ein eigener Schritt, kein Registry-Eintrag. `rdt` (Rapidly Developing
  Thunderstorms) ist ein Polygon-OVERLAY und gehört neben KONRAD in den
  Radarbereich, nicht in eine Produktauswahl, die das Bild ersetzt — es deckt
  dafür ganz Österreich ab. `msg_rss` (Rapid Scan, 5 min) führt nur
  Tagesprodukte plus IR 3,9 µm bei 3 km; `msg_iodc` ist der Indische Ozean;
  `eps`/`copernicus` sind Polarumläufer mit Streifen statt Flächen und einem
  ganz anderen Zeitmodell. `frp` und `h40b` waren über Mitteleuropa leer bzw.
  bei 6 % Deckung.
  **EUMETView antwortet auf einzelne Zeitschritte sporadisch mit HTTP 502
  oder 500** — reproduziert (2026-09-29): `rgb_fog` um 12:00 UTC an zwei
  Tagen hintereinander, während 10:00, 14:00, 18:00 und 19:00 desselben Tages
  einwandfrei kamen. Gescheiterte Abrufe werden deshalb gemerkt (je Stufe
  und Zeit) und **nach 10 s und 60 s erneut versucht** (`retryAt`), danach
  bleibt die Lücke: ohne das Merken liefe eine Dauerschleife gegen einen
  fremden Dienst (das war ein echter Fehler), ohne die Wiederholung blieb
  jeder vereinzelte 500er für die ganze Sitzung ein Loch in der Leiste
  (auch das). Gemessen fängt die Wiederholung die meisten ab — von 12
  Fehlschlägen über einen Tagesaufbau blieb einer.
  Offen und nicht behoben: beim schnellen Durchschalten stehen
  `ERR_FILE_NOT_FOUND`/`AJAXError` auf blob-URLs in der Konsole. Gegengeprüft,
  dass das mit den ursprünglichen fünf Produkten genauso passiert — ein Rennen
  zwischen `updateImage` und der Verdrängung, die Anzeige bleibt richtig.
  **HOCHAUFGELÖST SICHTBAR IST `vis06_hrfi`** — MTG/FCI liefert VIS 0,6 µm als
  HRFI (High Resolution Fast Imagery), 500 m am Subsatellitenpunkt, über
  Mitteleuropa durch den schrägen Blick real ~1 km. Im direkten Vergleich mit
  Geocolour am selben Zeitpunkt sind Alpentäler, einzelne Cumuluszellen und
  Cirrenstreifen sichtbar schärfer. `dayOnly` steuert den
  Hinweis in der Legende — ein schwarzes Nachtbild sieht nach einem Fehler aus
  und ist keiner.
  **KORREKTUR: „MSGs HRV ist bei EUMETView nicht veröffentlicht" war FALSCH**
  (stand hier bis 2026-09-29). Es ist veröffentlicht, nur unter einem Namen,
  den man nicht danach absucht: `msg_fes:rgb_eview`, „European HRV RGB" — ein
  HRV-basiertes RGB mit Vegetationssignal, inzwischen als Produkt `hrv` in der
  Registry. Die SCHLUSSFOLGERUNG von damals stimmt trotzdem: nachgemessen
  (Autokorrelation des Spaltengradienten über den Alpen, Kontrollwerte
  779/1558/1169 m gegen die früher dokumentierten 788/1577/1113 — die Methode
  reproduziert sich) liegt `rgb_eview` bei **1.558 m** und damit gröber als
  `vis06_hrfi` mit 788 m, dazu nur alle 15 Minuten. Für „das schärfste Bild"
  bleibt der MTG-Kanal die Antwort. **Es ist aber das einzige MSG-Produkt mit
  eigener Anforderungsbreite** (1600 statt 1100 px): die übrigen sind
  3-km-Kanäle (~4.400 m), mit deren Vorgabe würde HRV gröber angefordert als
  geliefert. Genau das hat der Raster-Test gefunden.
  **DAS ANGEFORDERTE RASTER MUSS ZUM NATIVEN RASTER DES PRODUKTS PASSEN, und
  lange tat es das nicht** — gemeldet als „MTG ist bei mir unscharf, auf
  sat24.com gestochen scharf", und der Befund gab dem recht. GEMESSEN
  (2026-09-21, über den Alpen 90-fach überzoomt bei 126 m/px, Blockstruktur
  über die Autokorrelation des Spaltengradienten — dasselbe Verfahren wie der
  Nearest-Neighbour-Nachweis beim Radar), natives Abtastintervall in
  Mercator-Metern: `vis06_hrfi` **788 × 1178** (≈ 0,54 × 0,80 km am Boden),
  `ir105_hrfi` 1113 × 1670, `rgb_geocolour` 1577 × 2337, die MSG-RGBs ~3 km.
  EUMETView liefert HRFI also WIRKLICH mit 500 m. Der Abruf holte dagegen ALLE
  Produkte über die 22° breite Vollfläche mit 1600 bzw. 1100 px, also 1,3× bis
  2,0× gröber als die Quelle — und am gröbsten ausgerechnet dort, wo man das
  Produkt wegen seiner Schärfe nimmt. Gegenprobe über denselben Ausschnitt auf
  ein gemeinsames Zielraster gebracht (mittlerer Nachbarschaftsgradient als Maß
  für überlebende Struktur): nativ 1,163 · Detailfläche 2000 px 0,727 ·
  Vollfläche 3200 px 0,717 · Vollfläche 1600 px **0,523** (der alte Stand) ·
  Vollfläche 1100 px 0,415. **Die frühere Notiz „mehr bringt nichts und kostet
  nur" stützte sich auf die DATEIGRÖSSEN und ist damit widerlegt** — nicht
  erneut von der Byte-Kurve auf den Bildinhalt schließen.
  **SEIT 2026-09-30 GILT EINE FLÄCHE FÜR ALLES: GANZ EUROPA** (lon
  −28,125…45, lat 31,95…72,40 — das Kachelfenster der Zoomstufe 6, x 27…40 und
  y 13…26, in Mercator zufällig exakt QUADRATISCH mit 8.140 × 8.140 km).
  Island und das Nordkap liegen gerade noch innen, dazu Nordafrika, die Türkei
  und das europäische Russland. **Der Erdrand darf nicht hinein** — bei 60° O
  und 75° N steht er als schwarzer Keil im Bild (nachgemessen an einem Kasten
  −30…60 / 25…75); die Ecke (45° O, 72,4° N) liegt bei 77° Großkreisabstand
  vom Subsatellitenpunkt und damit innerhalb der Scheibe.
  **Der Preis ist das native Raster, und er ist unvermeidbar.** Angefordert
  wird mit 2000 px (MTG, 4.070 m/px, gemessen 439–463 KB) bzw. 1800 px (MSG,
  4.522 m/px, 136–353 KB). Für die MSG-Kanäle ist das praktisch genau nativ,
  für die FCI-RGBs Faktor 2,6 und für HRFI **Faktor 5** — beim Hineinzoomen
  auf die Alpen ist das Bild also weicher als mit der früheren Detailfläche.
  Mehr Bildinhalt gibt es mit EINEM Bild über EINE feste Fläche nicht: HRFI
  nativ über Europa wären ~8.000 px und mehrere MB je Zeitschritt, und Kacheln
  je Zoomstufe sind derselbe Handel, der beim Radar schon abgelehnt wurde.
  2432 px (3.347 m/px, 619 KB) wären das Raster des Untergrundbildes und die
  schönere Zahl — aber EUMETView beantwortet Anfragen dieser Größe spürbar
  unzuverlässiger (HTTP 500 und 504 bei der Messung, die bei 2000 px nicht
  auftraten), und bei zwölf vorgeladenen Bildern sind das 7,4 statt 5,6 MB.
  **Der Test hat sich damit UMGEDREHT**: „fordere jedes Produkt in seinem
  nativen Raster an" ist nicht mehr haltbar; geprüft wird jetzt die Hälfte,
  die weiter gilt und weiter Bytes spart — *niemals FEINER anfordern als die
  Quelle liefert* — plus die Vergröberung je Mission als Zahl, damit ein
  Eingriff auffällt.
  **WARUM EIN FARB-RGB NICHT SCHÄRFER ZU HABEN IST — und wie es trotzdem
  geht.** Natural Colour ist ein RGB aus drei SEVIRI-Kanälen (VIS0,8 · VIS0,6
  · NIR1,6), und alle drei haben 3 km; ein RGB kann nie feiner sein als sein
  gröbster Kanal. Im Bildvergleich über den Alpen (800 px auf 1,4° Länge,
  also 133 m/px angefordert) zerfällt `rgb_naturalenhncd` sichtbar in
  3-km-Klötze, während `vis06_hrfi` im selben Ausschnitt einzelne Grate und
  Täler auflöst. **Wetterseiten wie sat24 laden also kein schärferes Farbbild
  herunter — sie RECHNEN es**: Pan-Sharpening, Farbe aus dem groben RGB,
  Helligkeitsstruktur aus dem hochauflösenden Breitbandkanal.
  Das gibt es hier bei **`hrv`** (`render/panSharpen.ts`): Verhältnisverfahren
  `Ergebnis = Farbe × Pan / Tiefpass(Pan)`. Bewusst NICHT der Austausch der
  Intensität (IHS/Brovey in Reinform) — der verschiebt die Farben dort, wo
  Pan und Farbe radiometrisch auseinanderlaufen, und bei einem RGB gegen
  einen sichtbaren Pan-Kanal ist das die Regel. Der Tiefpass wird nicht
  geschätzt, sondern GERECHNET (Pan auf das native Raster der Farbe herunter
  und wieder hoch) — exakt, ohne Filterparameter und ohne `ctx.filter`, das
  Safari erst seit 17 kennt. Ein Dämpfungsfaktor von 0,85 hält das Korn des
  Pan-Kanals dort zurück, wo es keine Farbinformation gibt (über dunklem
  Wasser würde aus Rauschen sonst sichtbare Struktur).
  **GESCHÄRFT WIRD DAS HRV-RGB, NICHT NATURAL COLOUR** — auf Wunsch, nachdem
  beides gebaut und verglichen war. Natural Colour geschärft war ein eigener
  Eintrag und ist wieder draußen: das Verfahren funktionierte dort messbar
  (Faktor 5, Inntal und Adriaküste kamen heraus), aber ein ZWEITER
  Natural-Colour-Eintrag neben dem europaweiten war den Platz im Menü nicht
  wert. Beim HRV-RGB ist der Gewinn kleiner (Faktor 2: 1.558 → 779 m), sitzt
  dafür auf dem FEINSTEN Farb-Layer des Dienstes und damit auf einem Bild,
  das schon Struktur hat — gemessen und im Vergleich beider Fassungen
  bestätigt. Wer Natural Colour geschärft zurückwill, braucht einen
  Registry-Eintrag mit `sharpen` und `colourMercM: 4400`.
  **Der starke Gelbstich bleibt** — er gehört dem Produkt, nicht der
  Schärfung (die rohe Fassung hat ihn genauso). Wer die neutrale Optik in
  dieser Schärfe will, nimmt den Graustufenkanal `vis06`, der über die
  Detailfläche dasselbe Raster hätte.
  **Drei Preise, alle unvermeidbar.** (1) **Eigene, engere Fläche** — als
  einziges Produkt. Über ganz Europa wären dieselben 779 m/px rund 10.400 px
  und mehrere MB je Zeitschritt, und das Schärfen hätte dort ohnehin nichts
  zu tun, weil die Farbe bei 4.070 m/px schon gröber angefordert würde als
  sie ist. *Ganz Europa* und *höchstaufgelöst* gehen mit EINEM festen Bild
  nicht zusammen; sat24 löst das mit Kacheln je Zoomstufe — derselbe Handel,
  der hier zweimal abgelehnt wurde. (2) **Zwei Abrufe je Bild.** Die Farbe
  wird dabei bei IHREM nativen Raster geholt (1000 px = 1.558 m/px, gemessen
  120 KB) und beim Zusammensetzen hochgezogen; der Pan-Kanal kostet 332 KB.
  (3) **Zeitpaarung**: Farbe MSG alle 15 Minuten, Schärfe MTG alle 10. Die
  Zeitachse folgt der FARBE, zum Pan-Kanal wird der nächstgelegene Termin
  genommen — höchstens 5 Minuten Versatz, rund 3 km Wolkenzug. **Bei
  Gleichstand gewinnt der FRÜHERE Termin** (`sharpenPanTime`, eigener Test):
  `Math.round` rundet bei .5 nach oben und griffe am aktuellen Rand
  regelmäßig auf ein Bild, das es noch nicht gibt. Schlägt der Pan-Abruf
  fehl, bleibt es bei der groben Farbe — sie IST die Messung, nur unschärfer.
  **KEIN Untergrund mehr NEBEN dem Bild** (auf Wunsch): ausserhalb der
  Satellitenfläche steht nichts als Hintergrund, Gradnetz und Grenzlinien.
  Das Blue-Marble-Bild lag dort als Kartenhintergrund, weil das Bild damals
  nur Mitteleuropa abdeckte und in einer leeren Fläche zu schweben schien;
  über Europa ist der Rand schmal, und was ausserhalb liegt, ist schlicht
  nicht gemessen. **Es reicht seither auch EIN Bodenbild statt zwei**: das
  enge `dach-ground.jpg` (974 m/px) gab es nur, weil das Komposit über einem
  kleinen Ausschnitt lief und das Europa-Bild dort 4,3-fach hochskaliert
  matschig war — jetzt liegt das Komposit bei 4.070 m/px, und
  `europe-ground.jpg` mit 3.347 m/px ist eher zu fein. Es deckt exakt
  `SATELLITE_AREA` (Test), wiegt 538 KB, und im Bündel sind das 477 KB
  WENIGER als vorher. Die Nennung der NASA-Quelle steht nur noch bei den
  beiden Kanälen, die den Untergrund wirklich benutzen.
  **Damit ist auch die Kopplung Untergrund ↔ Höhenrelief aufgelöst.** Sie
  bestand, solange beide Kartenhintergründe waren und austauschbar sein
  sollten; der Untergrund ist jetzt eine Zutat des Komposits und folgt der
  Satellitenfläche, das Relief bleibt beim alten Fenster und gehört zur
  Ortswahl der Soundings. Ein Test hält fest, dass die beiden
  auseinanderlaufen — damit niemand die alte Gleichheit stillschweigend
  wiederherstellt.
  **Der Bezugspunkt für den Sonnenstand ist NICHT mehr die Flächenmitte**
  (`SATELLITE_CENTER`): die läge bei 8,4° O / 55° N in der Nordsee, und über
  73° Länge liegen zwischen Island und dem Kaspischen Meer fast fünf Stunden
  Sonnenstand. Gesetzt ist Mitteleuropa (48,5° N / 11° O) — der Hinweis „nur
  tagsüber" gilt für die Mitte, nicht für den Rand.
  **Historisch — ZWEI FLÄCHEN waren der Handel** (`SATELLITE_DETAIL_AREA`, lon 4–18 /
  lat 44–56 neben der Vollfläche): die Vollfläche nativ hieße 3200 px und
  990 KB je Bild, beim Öffnen also 12 MB für `PREFETCH_RECENT` = 12. Die beiden
  HRFI-Kanäle bekommen deshalb die engere Fläche, auf der sie mit weniger
  Pixeln nativ sind, alles Übrige bleibt auf der Vollfläche. Gemessene Kosten je
  Bild: vis06 Detailfläche 2000 px **546 KB** (779 m/px) · ir105 Detailfläche
  1400 px **188 KB** (1113 m/px — der Kanal ist gröber als der sichtbare, mehr
  Pixel wären nur teurer) · Geocolour Vollfläche 1600 px **302 KB** (1531 m/px)
  · MSG-RGBs Vollfläche 1100 px ~138 KB (2226 m/px, doppelt so fein wie ihre
  3-km-Quelle — DORT bringen mehr Pixel wirklich nichts). Breite und Fläche
  gehören zusammen und kommen deshalb nur gemeinsam aus `productImageSize()`:
  eine Breite mit der Höhe der anderen Fläche verzerrt das Bild, und der Dienst
  rendert das klaglos. Der Preis der engeren Fläche ist der Rand — Krakau,
  Ostrau und Lille fallen heraus (3 von 134 `imagery`-Einträgen), und
  „ganzer Ausschnitt" meint jetzt das BILD und wechselt mit dem Produkt; die
  festen Sprungziele D-A-CH und Alpen liegen in BEIDEN Flächen (Test).
  **MEHR ALS DAS GIBT DIESE QUELLE NICHT — und das ist gemessen, nicht
  angenommen**: dasselbe Fenster in DREI Dichten angefordert (779 · 389 ·
  195 m/px) zeigt die Blöcke immer bei derselben GRÖSSE am Boden — 788 m in x,
  1178 m in y. Der Dienst rastert nearest neighbour (wie der DWD beim Radar),
  eine feinere Anfrage liefert also dasselbe Feld in größeren Kästchen. Damit
  ist auch die naheliegende Idee erledigt, den Zoom aufzugeben und
  stattdessen zwei feste Stufen über Deutschland/Österreich neu anzufordern:
  sie brächte KEINEN Bildinhalt. Wir liegen mit 779 m/px in x auf dem nativen
  Raster und in y bereits 1,5× darunter.
  **Was bleibt, ist die DARSTELLUNG, und die ist der zweite Teil der
  Unschärfe**: ein festes Bild über eine feste Fläche wird von der Karte
  gestreckt, sobald der Kartenbereich in GERÄTEpixeln mehr Platz hat als das
  Bild Pixel — bei `devicePixelRatio` 2 schon in der Voreinstellung. Deshalb
  wird oberhalb von `resamplingSwitchZoom` **gestuft statt geglättet**
  (`raster-resampling: nearest` als Zoom-Stufenausdruck): bilinear mittelt
  jeden Ausgabepixel aus vier Quellpixeln und macht aus einzelnen
  Quellwolken eine Fläche — im Vergleich am selben Zeitpunkt (Alpen-Ansicht)
  deutlich sichtbar. Umgeschaltet wird eine ganze Zoomstufe VOR der
  1:1-Grenze (`magnificationZoom`, rechnet Bildbreite gegen Gradspanne und
  Gerätedichte): schon bei knapper Verkleinerung verwischt bilinear, Aliasing
  droht umgekehrt erst deutlich darunter — unterhalb bleibt es deshalb bei
  linear, sonst flimmert die Übersicht beim Verschieben. Anker: vis06 ist bei
  z ≈ 6,65 deckungsgleich, vor der Flächentrennung war es 5,68 (Tests halten
  Identität und Ankerwerte fest).
  Eine echte Verbesserung darüber hinaus hülfen nur KACHELN je Zoomstufe: ein
  Dutzend Abrufe je Zeitschritt statt einem, und jedes Verschieben der Karte
  löste neue aus — bewusst nicht gemacht, das ist derselbe Handel wie beim
  Radar.
  **WOLKEN LIEGEN ÜBER ECHTEM BODEN** (`render/cloudComposite.ts`,
  `cloudMask` in der Produkt-Registry) — der Anblick, den man von
  Wetterseiten kennt. Die beiden GRAUSTUFEN-Kanäle sind vom Dienst DECKENDE
  Bilder: wo keine Wolke ist, zeigen sie den Boden so, wie der Kanal ihn misst
  — sichtbar ein dunkles kontrastarmes Grau, Infrarot eine Temperaturfläche.
  Beim Laden wird deshalb EINMAL je Bild die HELLIGKEIT ZUR DECKKRAFT
  (Rampe zwischen `min` und `max`, keine harte Schwelle — sonst bekäme jede
  Wolkenkante eine Treppe und dünner Zirrus wäre ganz da oder ganz weg), und
  darunter liegt das scharfe Bodenbild. Heraus kommt wieder ein JPEG im
  Blob-URL (das Komposit ist deckend), der Anzeigepfad ist unverändert.
  Gemessen: 30–90 ms je IR-Bild (1400×2149) im Software-Renderer, also im
  Ladepfad neben dem Netz und nicht beim Abspielen.
  **DER SICHTBARE KANAL SKALIERT MIT DEM SONNENSTAND**, und das ist gemessen
  (2026-09-21, fünf Zeitpunkte): er misst reflektiertes Sonnenlicht, dieselbe
  Wolke ist mittags doppelt so hell wie zwei Stunden vor Sonnenuntergang — mit
  festen Schwellen löste sich die Bewölkung im Tagesverlauf langsam auf.
  Zwischen 21° und 40° Sonnenhöhe ist die Normierung mit dem Sinus fast exakt
  (Boden-Perzentil p20/sin bleibt bei 100–103). **Unter `MIN_SUN_DEG` = 10°
  wird NICHT zusammengesetzt**: dort bricht sie in BEIDE Richtungen — bei 7°
  lägen die Schwellen unter dem Boden und die ganze Fläche würde zur Wolke,
  bei 2,6° darüber und alles würde wolkenfrei; das rohe Bild ist bei diesem
  Sonnenstand (p98 = 27, fast schwarz) die ehrlichere Anzeige. Nachts erst
  recht — sonst stünde der blanke Untergrund da und sähe wolkenlos aus,
  obwohl nichts gemessen wurde.
  **Das Infrarot skaliert NICHT** (Wärmestrahlung, Tag und Nacht gleich), hat
  dafür eine bekannte Schwäche: WARME tiefe Wolken (Hochnebel, Stratus) sind
  kaum heller als der Boden und werden blass — wer sie sucht, nimmt den
  sichtbaren Kanal oder Geocolour; umgekehrt kann sehr kalter Winterboden wie
  Wolke aussehen. Dem Verfahren eigen, keine Fehlfunktion.
  **Geocolour und die MSG-RGBs bleiben unangetastet**: Geocolour bringt seinen
  Boden mit, und den Deutungs-RGBs die Deckkraft zu nehmen zerstörte ihre
  Aussage (jede Farbe bedeutet dort etwas).
  **Der Untergrund ist ein ECHTES Satellitenbild, nicht die graue Fläche und
  nicht das Höhenrelief** (`config/ground.ts` + `scripts/build-ground.mjs`,
  npm `build:ground`): **NASA Blue Marble: Next Generation** über GIBS — ein
  wolkenfreies MODIS-Monatskomposit, 500 m, nahtlos, CORS offen und ohne Key.
  Sichtbar ist er nur NEBEN dem Satellitenbild — das ist deckend —, und genau
  dort stand vorher nichts als Hintergrundfarbe mit ein paar Linien. Seit die
  HRFI-Kanäle ihre engere Fläche haben, ist dieser Rand breiter, und ein Bild,
  das in einer leeren Fläche schwebt, sieht nach einem Ladefehler aus statt
  nach einem Ausschnitt. **Warum hier ein Satellitenbild und nicht das
  Relief**: daneben liegt ein echtes Satellitenbild, und ein Farbschema aus
  Höhenstufen bricht diesen Eindruck — Wald, Ackerland, Küsten und die
  schneebedeckten Alpen setzen ihn fort. Das Relief bleibt, wo die OROGRAFIE
  die Frage ist (Soundings).
  **Das schärfere Landsat-Komposit ist bewusst DRAUSSEN**:
  `Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual` hat 30 m, zeigt
  über diesem Ausschnitt aber genau die Fehler solcher Jahreskomposite — live
  geprüft: ein schwarzes Loch plus Wolkenfeld über Nordsee und Dänemark,
  sichtbare Szenenkanten quer über Deutschland. Als Hintergrund ist nahtlos
  und weich mehr wert als scharf mit Löchern.
  **Ein Bild, kein Tile-Dienst**, dieselbe Entscheidung wie beim Relief und
  bei der Basemap; die WMS-Antwort geht UNVERÄNDERT auf die Platte (EPSG:3857
  ist schon das Zielraster, und JPEG schreiben könnte dieses Projekt ohne
  Fremdpaket gar nicht).
  **ZWEI Bodenbilder mit verschiedenen Aufgaben** (`build:ground` erzeugt
  beide): `europe-ground.jpg` NEBEN dem Satellitenbild als Kartenhintergrund —
  Ausschnitt exakt das Relief-Fenster, damit beide austauschbar sind (Test),
  2048 px = **485 KB** (2,1 km/px am Boden; 2560 wären 747 KB); und
  `dach-ground.jpg` UNTER den Wolken IM Bild, wo Schärfe zählt, weil der Boden
  neben gestochenen Wolkenkanten steht — Ausschnitt exakt
  `SATELLITE_DETAIL_AREA` (Test), 1600 px = **530 KB** (974 m/px). Am fertigen
  Komposit verglichen: mit dem Europa-Bild (4,3-fach hochskaliert)
  verschwimmen die Alpentäler zu einer Fläche, mit dem engen stehen Grate und
  Schneefelder unter den Wolken; 2000 px (803 KB) brachten nichts Sichtbares
  mehr. Ein Bild für beides gibt es deshalb nicht. Liegt
  über dem Hintergrund und unter allem anderen (das Satellitenbild wird später
  vor `OVERLAY_INSERT_BEFORE` eingehängt und damit darüber). Namensnennung
  (NASA) steht in der Quellenzeile.
  **DIE ZEITFALLE IST EINE ANDERE ALS BEIM DWD, und die gefährlichere**: die
  Zeitdimension trägt `nearestValue="1"` — ein Zeitpunkt auf dem Raster, den es
  noch nicht gibt, wird STILL durch das nächstgelegene Bild beantwortet
  (gemessen 2026-09-18: die Anfragen für 22:20 und 22:30 kamen byte-identisch
  zurück, gleiche MD5), erst eine Zeit NEBEN dem Raster (22:35) wirft eine
  ServiceException. Ein doppeltes Bild in der Schleife sieht aus wie Wetter,
  das steht. Deshalb kommen die Zeitschritte ausschließlich aus dem
  GetCapabilities des **layer-eigenen** WMS (`/geoserver/<ws>/<layer>/wms`,
  6,5 KB statt 282 KB) — dessen Ende hängt dem Verfügbaren eher hinterher
  (22:10 gemeldet, 22:30 schon abrufbar), was die sichere Richtung ist.
  Verzug insgesamt unter 10 Minuten.
  **Die FLÄCHE gibt die Seite vor, nicht der Dienst** (`SATELLITE_AREA`,
  lon 0–22 / lat 41–56; die HRFI-Kanäle die engere `SATELLITE_DETAIL_AREA`,
  s. o.): ein Satellitenlayer meldet im Capabilities die ganze
  sichtbare Halbkugel (gemessen lon ±81,3, lat ±77,4), ein Bild darüber wäre
  für Mitteleuropa nutzlos. Der Ausschnitt reicht bewusst von der Nordsee bis
  in die Po-Ebene und von der Rhône bis zur Weichsel, damit man Systeme
  HEREINZIEHEN sieht. Projiziert wird selbst (`toMercator`/`mercBox` in
  `config/wmsTime.ts`, Test gegen die Referenzwerte) — beim Radar kommt die
  EPSG:3857-Box dagegen aus dem Capabilities, das EUMETSAT-Capabilities führt
  gar keine.
  **JPEG, nicht PNG**: bei 1400 px war Geocolour als JPEG 266 KB und als PNG8
  1,18 MB — Faktor 4,4 bei einem Fotomotiv. `format_options=quality:70` ändert
  nichts (byte-identisch zu 85), nicht erneut versuchen. `SATELLITE_IMAGE_WIDTH`
  = 1100 ist seit der Flächentrennung nur noch die Vorgabe für die beiden
  MSG-RGBs (~138 KB je Bild); die MTG-Produkte bringen ihre Breite selbst mit
  (188–546 KB, Tabelle oben) — spürbar mehr als das Radar, deshalb die
  Nebenläufigkeit 3 statt 4.
  **NACHT IST KEIN FEHLER, sieht aber wie einer aus** (`lib/solar.ts`,
  `.satellite-night`): der hochaufgelöste sichtbare Kanal misst reflektiertes
  Sonnenlicht, sein Bild ist nachts vollständig schwarz — gemeldet wurde das
  als „plötzlich gar nichts mehr", und im Browser nachgestellt stimmte das
  Bild: nur noch Grenzlinien über Schwarz. Der Hinweis in der Legende reichte
  nicht, er steht klein unten links. Jetzt rechnet der Bereich den SONNENSTAND
  über der Mitte der Fläche (`SATELLITE_CENTER`) und sagt es mitten im Bild,
  mit der Zahl dazu („die Sonne steht 37° unter dem Horizont"), plus zwei
  Auswegen: Sprung zum letzten Tageslicht und Wechsel auf Geocolour. Die
  Nachtabschnitte sind zusätzlich in der Ziehleiste markiert, man sieht also,
  wo überhaupt Bilder zu erwarten sind.
  **Die Schwelle ist +5°, nicht der Horizont**, und das ist am Bild gemessen:
  mit „über dem Horizont" sprang der Bereich auf 17:20 UTC, wo die Sonne
  −0,4° bis +3° steht — das Bild dort ist praktisch schwarz und als Sprungziel
  wertlos. Mit 5° landet der Sprung bei 16:40 UTC, und da ist Struktur zu
  sehen. `solarElevationDeg` ist eine Näherung (Zehntelgrad) und gegen
  GEOMETRISCHE Identitäten getestet, nicht gegen die eigene Ausgabe:
  Mittagshöhe = 90° − Breite ± 23,44° zu den Sonnenwenden, Mitternachtssonne
  und Polarnacht auf Spitzbergen.
  **Die Ziehleiste umfasst IMMER 24 Stunden, ohne Auswahl davor** (auf
  Wunsch): eine Wetterlage liest man über einen Tag, und jede Auswahl davor
  ist ein Handgriff, bevor man etwas sieht.
  **Geladen wird in ZWEI STUFEN über eine WARTESCHLANGE** (`loadPlan`,
  `hiEvictions`, `retryAt` in `config/satellite.ts`, getestet; Schlange in
  `SatellitePanel`, Einzelabruf `loadSatelliteImage`). Der ganze Tag als
  VORSCHAU (`PREVIEW_WIDTH` = 1000 px, ~160 KB), SCHARF (~530 KB) nur das
  Bild unter dem Zeiger, seine Nachbarn und die Schleife — höchstens
  `HI_MAX` = 24 scharfe Bilder im Speicher, Vorschauen alle.
  **Anlass war ein gemessener Befund, keine Vermutung** (2026-09-30):
  EUMETView rendert jedes Bild auf Anfrage und braucht 1–3 s — bei 2000 px
  (530 KB) wie bei 1000 px (160 KB), die Zeit ist RECHENZEIT des Dienstes,
  nicht Leitung. Die frühere Politik (`wantedTimes`: jüngste 12 + Fenster um
  den Zeiger, 48 Bilder Obergrenze) bekam den Tag nie zusammen, und zwar aus
  einem Grund, der schwerer wog als die Fenstergrösse: der Ladeeffekt hing
  am Zeiger und rief beim Aufräumen `abort()` — **jedes Weiterziehen verwarf
  alle halbfertigen Bilder**, bei 1–3 s Renderzeit je Bild kam beim
  Durchziehen fast nichts an. Jetzt ORDNET eine Bewegung nur neu, was als
  Nächstes geholt wird; was läuft, läuft zu Ende. Abgebrochen wird allein
  beim Produktwechsel. Reihenfolge des Plans: scharf unter dem Zeiger (nicht
  beim Abspielen, dort wechselt das Bild alle 320 ms) → Vorschau um den
  Zeiger → Vorschau der Schleife → scharfe Nachbarn → Vorschau für den Rest
  des Tages vom Zeiger nach aussen → Schleife scharf. **Gemessen mit kaltem
  Cache**: 143 von 145 Vorschauen nach 90 s, die scharfe Schleife nach rund
  2 min; ~1 Bild/s bei `SAT_CONCURRENCY` = 3. Schneller geht es mit dieser
  Quelle nicht — bei 6 parallelen Abrufen kam schon einer mit HTTP 500 zurück,
  und auch mit 3 ist es jeder zehnte (daher die Wiederholung, s. o.).
  **SCHNELLER SCHARF (2026-10-08)** — gemessen lag die Wartezeit nicht am
  Dienst (EUMETView 0,5 s Vorschau, 0,8 s scharf; parallel 1/3/6 → 1,0/2,2/
  3,6 Bilder/s), sondern an der SCHLANGE: das scharfe Zeigerbild stand zwar
  vorn im Plan, wartete aber auf einen der drei Plätze, die in der ersten
  Minute Vorschauen holen; die scharfe Schleife kam erst nach ALLEN ~145
  Vorschauen des Tages. Jetzt: ein reservierter Platz für das scharfe
  Zeigerbild (`PRIORITY_LANE`/`slotLimit`), 4 statt 3 reguläre Plätze, die
  direkten Nachbarn ±1 scharf vor der Vorschau der Schleife, ±2 danach
  (`HI_NEIGHBOURS`, Pfeiltasten springen nie ins Unscharfe), die Schleife
  scharf VOR den Vorschauen des übrigen Tages, Ruhezeit am Zeiger 120 statt
  220 ms. Vergleich unter gleichen Bedingungen (kalter Cache, Geocolour):
  alt nach 40 s 2 scharfe Bilder, neu 20 (Schleife komplett nach 29 s, drei
  scharf nach 9,5 s). `HI_MAX` 24 → 28, weil Zeiger, vier Nachbarn und
  Schleife zusammen 24 sind.
  **CACHING — wo die Grenzen liegen, gemessen statt vermutet**: EUMETView
  schickt `max-age=604800`, der HTTP-Cache des Browsers liefert beim zweiten
  Besuch 18 von 20 scharfen Bildern und 85 von 119 Vorschauen von der Platte
  — eine eigene IndexedDB-Ablage brächte dort nichts. Was beim ERSTEN Besuch
  bremst, ist der Dienst: er rendert jedes Bild bei Anfrage und spricht nur
  HTTP/1.1 (höchstens 6 Verbindungen je Host im Browser, daher 4 + 1). Kein
  WebP (GeoServer antwortet mit XML). **NASA GIBS dagegen verbietet das
  Zwischenspeichern** (`Cache-Control: no-store`) — Himawari lud bei jedem
  Besuch alles neu. Deshalb eine eigene Ablage nur für GIBS
  (`api/imageStore.ts`, Cache Storage API, nur gültige, nicht leere Bilder,
  Aufräumen > 48 h einmal je Sitzung) und, weil GIBS HTTP/2 hinter einem CDN
  spricht und fast linear skaliert (1/4/8/12 parallel → 0,6/2,2/4,5/5,6
  Bilder/s), 8 Plätze statt 4 (`GIBS_CONCURRENCY`/`concurrencyFor`). Gemessen
  Himawari: 20 Vorschauen kalt 13,6 → 7,1 s, beim zweiten Besuch 1,3 s, der
  ganze Tag 1,6 s. **Schneller beim ersten Besuch von EUMETView geht es nur
  serverseitig** — ein Zwischenserver, der jeden neuen Termin einmal holt und
  für alle ausliefert (Cloudflare-Plan).
  **DETAILKACHELN seit 2026-10-28 — die Antwort auf „sat24 ist schärfer"**
  (`tileMaxZoom` in der Registry: Sichtbar und Infrarot bis z 7, Geocolour
  bis z 6; `worker/satTiles.ts`, `render/satTileProtocol.ts`): hält man an
  und zoomt ab Stufe 5 hinein, legt sich über das Europabild (~4 km je
  Pixel) eine Kachelebene im nativen Raster. Der Worker holt jede Kachel
  EINMAL bei EUMETView (512 px, gemessen 0,3–0,6 s, einmal 4,2 s, 12–22 KB)
  und legt sie in R2 (`sattile/…`), jeder weitere Abruf kommt von Cloudflare.
  **Nahtlos gemessen**: zwei einzeln geholte Nachbarkacheln sind Pixel für
  Pixel identisch mit derselben Fläche in einem Stück. `tileMerc` rechnet
  jede Kante aus IHREM Index (als „Anfang + Größe" wichen gemeinsame Kanten
  um eine Rundungsstelle ab — ein Test hält das fest). Der Worker nimmt NUR
  `parseSatelliteTilePath`-gültige Pfade (Produkt mit Kacheln, Zoombereich,
  Termin auf dem Raster, 12 min bis 26 h alt) — sonst wäre er ein offener
  Proxy, und ein zu junger Termin landete wegen `nearestValue` für immer
  unter der falschen Zeit. Das Wolkenkomposit läuft je Kachel
  (`compositeClouds(…, targetMerc)`, Sonnenstand des Produkts, damit die
  Kante nicht springt). Beim Abspielen keine Kacheln, und der Termin ist der
  gebremste (`settledIdx`). Je Termin eine neue Quelle statt `setTiles`,
  sonst stünden kurz Kacheln des vorigen Termins da. Aufräumen über eine
  Lifecycle-Regel `sattile/` im Bucket.
  **VORRAT IN R2 seit 2026-10-28** (`MIRRORED_SATELLITE_IDS` = Geocolour,
  Sichtbar HRFI, Infrarot, Wasserdampf; `worker/satellite.ts`): der Cron
  holt jedes neue Bild (Vorschau UND scharf) einmal bei EUMETView und legt es
  als `sat/<id>/<lo|hi>/<Termin>.jpg` ab; der Browser fragt dort zuerst
  (`fromMirror` in `api/eumetsat.ts`) und nur bei einer Lücke beim Dienst —
  der jüngste Termin kommt oft vor dem nächsten Cron-Lauf. URL und Schlüssel
  aus DENSELBEN Funktionen (`mirrorSourceUrl`), gemessen bytegleich. Je Lauf
  höchstens 80 Abrufe, 4 parallel (beim ersten Lauf fehlt ein ganzer Tag,
  ~1.150 Bilder — ~2 h zum Auffüllen; gemessen 79 in 94 s). Älter als 26 h
  löscht der Worker selbst. Geschärftes HRV und GIBS bleiben direkt.
  **Live gemessen (2026-10-28, gleiche 20 scharfe Geocolour-Bilder)**:
  direkt bei EUMETView 60 s (Median 11,6 s je Bild, an diesem Abend
  besonders langsam, eines gescheitert), aus dem Vorrat **0,8 s**. Deshalb
  laden die Vorrat-Produkte jetzt SCHARF ZUERST (`loadPlan(…, {sharpFirst})`,
  `sharpFirstPlan`): Zeiger, Nachbarn und Schleife ohne Vorschau davor, die
  Vorschau nur noch für den Rest des Tages (ein Tag scharf wären ~65 MB je
  Produkt, und `HI_MAX` deckelt den Speicher); 8 statt 4 parallel
  (`concurrencyFor`). Lokal gemessen: nach 3 s Schleife + Zeiger scharf (19)
  und 44 Vorschauen. Fehlt ein Termin noch im Vorrat, geht dieser eine
  Abruf weiter an EUMETView — beim Auffüllen nach einem Deploy sind das
  viele, danach nur der jüngste.
  **Die Verdrängung trifft nur SCHARFE Bilder und nie eines, das der Plan
  gerade will** — sonst Laden und Wegwerfen im Kreis; das war früher zweimal
  ein Fehler (Verdrängung im State-Updater, den React im Entwicklungsmodus
  doppelt aufruft; Abstand am GEBREMSTEN Zeiger gemessen, sodass die eben
  geladenen Bilder der neuen Stelle sofort wieder rausflogen). Ein
  freigegebenes scharfes Bild kommt beim nächsten Mal aus dem HTTP-Cache:
  EUMETView schickt `Cache-Control: max-age=604800` (7 Tage). Der Cache wird
  dadurch nicht „zugemüllt" — der Browser deckelt ihn selbst und verwirft das
  am längsten Ungenutzte; begrenzt werden muss der ARBEITSspeicher der Seite,
  und das tut `HI_MAX`. Vor dem ersten Zeigerstand (`idx < 0`) gilt der
  NEUESTE als Zeiger — ein Fenster um Index 0 wäre der Stand von vor 24
  Stunden (der Fehler der ersten Fassung, als Test festgehalten). Beim ZIEHEN
  ist der Plan weiter gebremst (`SETTLE_MS`, 220 ms), damit nicht jede
  Zwischenstellung ein scharfes Bild ganz nach vorn setzt.
  **Die SCHLEIFE kreist nur über die letzten 3 Stunden** (`LOOP_SPAN_MS`, in
  der Registry, weil der Plan sie kennt). Wer weiter zurück will, zieht
  dorthin; die Schleife spielt von dort vorwärts (auf den Vorschauen) und
  pendelt sich danach in den jüngsten Abschnitt ein. Die Statuszeile nennt
  beide Stufen getrennt („143 Übersicht · 20 scharf").
  **Die Leiste hat FESTE Breiten, und das ist eine Fehlerbehebung**: Schieber,
  Zeitangabe und Statuszeile liegen in EINER umbruchfähigen Flex-Zeile, und
  der Schieber ist das einzige flexible Element darin. Wechselte die
  Statuszeile beim Ziehen zwischen „lädt Bild …" und dem langen Text, änderte
  sich damit seine Breite — die Leiste zuckte, und bei knappem Platz sprangen
  die Angaben rechts in die nächste Zeile und schienen zu verschwinden. Jetzt
  steht immer derselbe Satz (`.radar-step`/`.radar-sub` mit `min-width` auf
  die längste Form, Ziffern tabellarisch), der Ladezustand ist ein Punkt in
  einem reservierten Platz (`.radar-load`, `visibility` statt `display`), und
  der Zähler sitzt in einem Feld fester Breite (`.radar-num`). Wer hier etwas
  ergänzt, das seine Länge ändert, bringt das Zucken zurück.
  **Kein Canvas** (anders als beim Radar): am Satellitenbild ist nichts zu
  korrigieren, die Bilder gehen als **Blob-URL** auf die Karte. Der Umweg über
  `canvas.toDataURL()` würde aus 160 KB JPEG mehrere MB PNG machen — dafür muss
  der Bereich die URLs selbst wieder freigeben (`urlsRef` + `dropImages`),
  sonst hält jeder Produktwechsel seine alte Schleife im Speicher.
  **Geteilt mit dem Radar ist `config/wmsTime.ts`** — Dimension parsen,
  Zeitraster bilden (`frameTimes`), `nearestFrame`, Mercator und Bildecken.
  Herausgezogen aus `config/radar.ts`, das die Namen weiter re-exportiert
  (seine öffentliche Form und seine Tests sind unverändert). Verschieden
  bleiben genau drei Dinge, jedes mit Grund: die Fläche (s. o.), das fehlende
  Canvas und der fehlende Vorhersageteil — EUMETView liefert nur Gemessenes,
  es gibt also kein `forecastMs` abzuschneiden.
  Karte, Zeitschieber, Schleife, „● neuer Stand" und das selbsttätige
  Nachrücken sind dieselbe Bedienung wie beim Radar (Bilder liegen über ihren
  ZEITSTEMPEL, nicht über den Index); CSS teilt sich die `.radar-*`-Klassen,
  nur die Legende ist eine andere (`.satellite-legend`): ein Satellitenbild hat
  keine ablesbaren Klassen, dort steht die Erklärung des PRODUKTS — bei einem
  RGB entscheidet die Kanalkombination, was Gelb oder Rot heißt, und das sieht
  man dem Bild nicht an.
  Die Bundesländergrenzen kommen aus demselben `dach`-Bündel wie beim Radar,
  die Städte über dieselbe Pseudo-Domain `'imagery'` in `config/cities.ts`
  (ein paar Einträge — Mailand, Venedig, Turin — liegen außerhalb der
  Radarfläche und tragen nur hier).
  **MTG HD — SELBST GERECHNET AUS DEN ROHDATEN** (seit 2026-11-10, auf Wunsch, als
  Antwort auf das „HD"-Bild von sat24; `scripts/mtg-hd-ingest.py`, `mtg-hd-cron.sh`,
  Timer `scripts/systemd/mtg-hd.*`, Produkt `mtghd` mit `source: 'own'`): tagsüber
  ECHTFARBEN (FCI hat den Grünkanal 0,51 µm, den SEVIRI nicht hatte) aus den 1-km-Kanälen,
  mit VIS 0,6 µm HRFI auf 500 m geschärft (Verhältnis 500 m / 1 km derselben Wellenlänge,
  0,85 gedämpft wie `panSharpen.ts`), nachts Infrarot 10,5 µm (290 → 205 K), je Pixel nach
  Sonnenzenit 72–84° überblendet — darüber machen Sonnenstands- und Rayleigh-Korrektur
  aus den Echtfarben ein weißes Band am Terminator. Läuft auf dem LAPTOP wie Varda; ist er
  aus, fehlen Termine, und die stehen als `missing` in `sat/mtghd/meta.json`.
  **Quelle**: EUMETSAT Data Store über `eumdac` (Konto mit Lizenz „Meteosat < 1 hr
  latency", Schlüssel in `~/.config/meteojunkie/eumetsat.env`), Sammlungen 0662 (FDHSI)
  und 0665 (HRFI). Ein Termin liegt ~3 min nach Scan-Ende vor. Je Termin 40 Streifen von
  Süd nach Nord, EINZELN ladbar (`product.open(entry=…)`); Europa = Streifen 32–40
  (Satpy zählt Zeilen von Süden, Streifen = Zeile // 278 + 1). Gemessen: 220 MB nachts bis
  ~350 MB tagsüber je Termin, 8 parallel in 25–30 s; die ganze Scheibe wären ~2 GB.
  **Ausgabe in DENSELBEN Pfaden wie der Vorrat**: Europabild `sat/mtghd/{hi,lo}/<Termin>.jpg`
  (2000/1000 px über `SATELLITE_AREA`), Detailkacheln `sattile/mtghd/<Termin>/z/x/y.jpg`
  z5–7 über dem z5-Block x 16–17 / y 10–11 (0–22,5° O, 41–55,8° N; `tileBounds`, Test hält
  ihn mit dem Skript gleich) — 86 Dateien je Termin, ~1,5 min. Gerechnet wird EINMAL in z7
  (4096² px), z6/z5 durch Verkleinern. Der Browser nimmt NUR den Vorrat (kein Ausweichen),
  der Worker gibt die Kacheln nur aus R2 und ohne die 12-min-Sperre (die gilt
  `nearestValue` bei EUMETView). Lokal liegt der Vorrat in `/var/tmp/mtg-hd/out` (/home ist
  knapp); `public/sat/mtghd` und `public/sat-tiles/mtghd` sind Verweise dorthin.
  **Vier Fallen, alle im Bild gesehen**: (1) FCI-Dateien sind mit FCIDECOMP gepackt →
  `hdf5plugin` + `HDF5_PLUGIN_PATH`. (2) netCDF ist nicht threadsicher — mit dem
  Thread-Scheduler von dask „NetCDF: HDF error" bzw. Speicherzugriffsfehler, daher
  synchron. (3) `true_color` GETRENNT mit `resolution=1000` laden. (4) Das Enhancement
  liefert über hellen Wolken Werte > 1 — vor `uint8` klemmen, sonst läuft der Kanal über
  und es entstehen blaue und rote Flecken (sah zuerst nach Rayleigh-Fehlern aus, war es
  nicht). Lage gegen die Natural-Earth-Küsten geprüft (Europabild und Kachelmosaik).
