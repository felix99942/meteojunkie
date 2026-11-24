# Niederschlagsradar

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Niederschlagsradar** (`RadarPanel.tsx`, Registry/Kern `config/radar.ts` und
  `api/dwdRadar.ts` mit Tests, AppView `radar`) — der erste Bereich, der
  überhaupt keine Zahlen holt, sondern FERTIGE KARTEN: der **WMS des DWD**
  (`maps.dwd.de/geoserver/dwd/wms`) liefert das deutsche Radarkomposit
  (1 km, alle 5 Minuten, Analyse ~4 Tage rückwärts PLUS 2 h Verlagerung) als
  eingefärbtes, transparentes PNG, schickt `Access-Control-Allow-Origin: *` und
  braucht keinen Key.
  **Gezeigt wird die REFLEKTIVITÄT in dBZ** (Produkt **WN**,
  `Radar_wn-product_1x1km_ger`), nicht die Niederschlagsrate: dBZ ist die
  Messgröße des Radars, mm/h erst das Ergebnis einer Z-R-Beziehung, die über
  Tropfengrößenverteilung, Hagel und Schmelzschicht annimmt, was sie nicht
  messen kann. Das mm/h-Produkt **RV** bleibt als zweiter Eintrag der Registry
  wählbar — dasselbe Feld, nur durch diese Annahme gedreht. Beide führen
  Analyse UND Verlagerung, beide dieselbe Zeitmechanik; unterschiedlich sind
  Farbskala (17 bzw. 15 Stufen) und die Deckkraft der „Keine Daten"-Maske
  (WN 0,5 · RV 0,3, deshalb `RadarProduct.maskOpacity` — die Nachbearbeitung
  färbt darauf um und darf sie nicht raten). Deshalb: direkt aus dem Browser, **kein Proxy, kein
  eigenes Rendering, kein Open-Meteo-Budget** (läuft über plain `fetch`, nicht
  über `apiGet` — dieselbe Trennung wie die Ortssuche). Nutzung nach GeoNutzV,
  Quellenzeile im Bereich; `maps.dwd.de` steht als einziger DWD-Host jetzt auch
  im Impressum bei den Drittanbietern — die MOSMIX-Daten kommen weiter aus dem
  Ingest, das Radar NICHT.
  **Die ABDECKUNG ist die wichtigste Eigenschaft dieses Bereichs, und sie ist
  gemessen**: das Gitter reicht von 45,7–56,2 °N und 1,5–18,7 °O, die
  Radardaten aber nicht. Das Produkt malt „keine Daten" (Rasterwert **−999**,
  über GetFeatureInfo geprüft) als halbtransparentes Grau, und diese Maske
  beginnt je Breite zwischen **13,2 °O (47 °N) und 14,4 °O (49 °N)**.
  Deutschland, die Schweiz, Vorarlberg, Tirol und das Land Salzburg sind drin —
  **Linz, Wien, Graz, Klagenfurt, St. Pölten, Eisenstadt und Villach nicht.**
  Die Maske wird deshalb NICHT ausgeblendet, sondern in der Legende benannt:
  ein grauer Fleck liest sich sonst als „kein Regen", und das ist die falsche
  Aussage. Für den fehlenden Osten Österreichs gibt es aus der GeoSphere-API
  **keinen gangbaren Ersatz** — das Nowcast-Gitter
  (`grid/forecast/nowcast-v1-15min-1km`, `rr`, 1 km/15 min) ist inhaltlich
  genau richtig, aber nur als GeoJSON oder NetCDF-4 abrufbar: EIN Zeitschritt
  über ganz Österreich sind 188.574 Punkte = **36 MB in 115 Sekunden**
  (gemessen 2026-09-16), und NetCDF-4 ist HDF5, bräuchte also zusätzlich einen
  Binärparser. Nicht erneut als „vielleicht doch"-Weg prüfen. Eine echte
  Vollabdeckung Österreichs bräuchte eine andere Quelle — **die gibt es seit
  2026-11-24: das OPERA-Komposit** (Produkt `opera`, Abschnitt unten).
  **Ein Bild je Zeitschritt über die GANZE Produktfläche, in EPSG:3857** — und
  beides mit Grund. Mercator, weil MapLibre eine image-Source LINEAR im
  Mercator-Raum aufspannt: so stimmt die Zuordnung exakt, ohne die
  Vorverzerrung, die `render/fieldImage.ts` für lat/lon-Gitter braucht. Ein
  Vollflächenbild statt Kacheln, weil ein Zeitschritt dann EINEN Abruf kostet
  statt eines Dutzends, die Folge sich vorladen lässt (Schleife läuft danach
  ruckfrei) und ein Verschieben der Karte KEINEN neuen Abruf auslöst. Preis ist
  die feste Auflösung: `RADAR_IMAGE_WIDTH` = 1200 px sind bei 48 °N rund 1,1 km
  je Pixel, also etwa die Produktauflösung (gemessen 1000 px → 63 KB, 1400 px →
  111 KB, 1800 px → 166 KB je Bild) — weiter hineinzoomen darf man, es wird nur
  weich (`maxZoom: 11`).
  **GEZEIGT WIRD NUR GEMESSENES — die Vorhersage ist auf Wunsch DRAUSSEN.**
  Der Dienst liefert sie mit: am Ende der Zeitdimension von WN und RV stehen
  2 Stunden Verlagerungsrechnung (DWD **RADVOR**: ähnliche Strukturen zweier
  Komposite wiedererkennen, ein flächendeckendes Verlagerungsvektorfeld
  bestimmen, das Echofeld in 5-Minuten-Schritten fortschreiben — keine
  Entstehung, kein Zerfall, keine NWV-Physik; gemessen bestätigt: alle
  Vorhersageschritte tragen dieselbe `REFERENCE_TIME` wie die Analyse).
  `forecastMs` sagt, wie viel davon am Ende steht, `analysisTime()` schneidet
  es ab, `radarTimes()` endet am letzten Analysebild.
  **Wer sie je zurückholt, braucht wieder das Festhalten der Abdeckung**:
  verschoben wird das GANZE Feld, einschliesslich der „keine Daten"-Kennung —
  die Radarkreise der Abdeckungsgrenze wandern mit dem Wind mit. Gemessen
  (2026-09-16, 1200-px-Bild, +120 min): 50.342 Pixel, die in der Analyse
  maskiert sind, zeigen im Vorhersagebild Inhalt, der aus dem Inneren über
  unbeobachtetes Gebiet geschoben wurde; der Maskenschwerpunkt verschiebt sich
  um 60 px nach Westen. Der Code dafür (`coverageStencil`) ist mit der
  Vorhersage entfallen, die Messung steht hier.
  **AKTUALITÄT: 5-Minuten-Takt, rund 3 Minuten Verzug** — gemessen
  (2026-09-16, Minutenproben): das Bild für 22:30 UTC stand zwischen 22:32:26
  und 22:33:07 bereit, das Blitzprodukt hängt einen Schritt weiter zurück.
  Näher an „jetzt" und feiner als 5 Minuten gibt es diese Quelle nicht. Was
  fehlte, war das **automatische Nachrücken im Browser**: die Seite blieb auf
  dem Stand des Seitenaufrufs stehen und sah dadurch alt aus, obwohl die Quelle
  längst weiter war. Deshalb fragt `RadarPanel` jede Minute die Zeitdimension
  nach und holt beim neuen Stand GENAU DAS EINE fehlende Bild — und deshalb
  liegen die Bilder in einer Map über den **ZEITSTEMPEL** statt in einem Array
  über den Index: beim Nachrücken verschieben sich alle Indizes, die Zeiten
  nicht, alles Geladene bleibt gültig. Nachgerückt wird nur, wenn der Zeiger
  auf dem neuesten Bild steht oder die Schleife läuft (`atLiveEdge`) — wer ein
  älteres Bild ansieht, wird nicht weggerissen und bekommt den Knopf
  „● neuer Stand".
  **OVERLAYS, fast alle vom selben Dienst** (`RADAR_OVERLAYS`, Häkchen in der
  Leiste):
  **Blitze** (`Blitzdichte`) sind voreingestellt an, **MTG-Blitze** (s. u.,
  der einzige Nicht-DWD-Layer) auf Wunsch. **Cluster** (`Gewittercluster`)
  und **KONRAD** (`K3D_EVAL_current_cells` + `K3D_EVAL_cur_track_lines`)
  sind seit 2026-11-02 RAUS (auf Wunsch, „eher nutzlos für die Seite"; wie
  man sie zurückholt, steht in `config/radar.ts` über `RADAR_OVERLAYS`) —
  die Beschreibung unten gilt für den früheren Stand. Alles 5-Minuten-Takt, CORS offen,
  die DWD-Layer nach GeoNutzV — und alles NUR Gegenwart: die `fcst_*`-Layer des
  KONRAD-Verfahrens (Prognosekegel, Vorhersagespuren) bleiben draußen wie die
  Radarvorhersage auch. **`Gewitterzellen` war dabei und ist auf Wunsch wieder
  raus**: dieselben Punktsymbole in derselben Skala wie die Cluster, nur je
  Einzelzelle — neben Echo, Blitzkreuzen und KONRAD-Umrissen trug der Layer
  nichts bei, was nicht schon dastand. Nur die Blitze sind vorbelegt, weil
  sie das Echo um etwas ergänzen, was es nicht zeigt.
  **Jedes Overlay hat seine EIGENE Fläche und eigene Zeitschritte**, deshalb je
  Overlay eine eigene `RadarMeta`, eigene Bildecken und eigene Bild-Map
  (gemessen 2026-09-16: Blitze lon 1,7–18,5/lat 46,95–54,91 — ganz Österreich
  in der Länge, im Süden fehlt Kärnten; Cluster lon 5–16/lat 47–55,3, Wien
  liegt knapp draußen; KONRAD lon 4,03–16,21/lat 46,36–55,45, also am
  weitesten nach Süden und Osten). Angefragt werden nur
  Zeiten, die in der jeweiligen Dimension stehen, und **gescheiterte Zeiten
  werden gemerkt** (`failedRef`): die Symbol-Layer haben DISKRETE Zeitpunkte —
  wo nichts erkannt wurde, fehlt der Zeitstempel und der Dienst antwortet mit
  `InvalidDimensionValue` (live gesehen für 15:00 UTC, während die Cluster
  dieselbe Minute hatten). Ohne das Merken liefe der Nachlade-Effekt endlos auf
  dieselbe Zeit. Die Legendenzeile sagt dann „nichts gemeldet", nicht „Fehler".
  **POLARITÄT UND STROMSTÄRKE GIBT ES NICHT — nachgemessen, nicht erneut
  suchen** (2026-09-29). `GetFeatureInfo` auf `Blitzdichte` liefert GENAU zwei
  Felder, `GRAY_INDEX` (den Dichtewert) und `TIME`; `opendata.dwd.de` hat gar
  kein `lightning`-Verzeichnis; der GeoSphere Data Hub führt unter 67
  Datensätzen keinen einzigen zu Blitz/Gewitter/ALDIS; und
  `data.blitzortung.org/Data/Protected/Strikes/` antwortet mit **HTTP 401**
  bei **null Access-Control-Headern** — doppelt zu, und Zugangsdaten im
  Frontend wären ohnehin öffentlich (dieselbe Regel wie beim API-Key).
  Vorzeichen und Scheitelstrom misst nur ein bodengebundenes VLF/LF-Netz mit
  kalibrierter Amplitude (ALDIS/EUCLID, Vaisala, nowcast/LINET) — lizenzpflichtig,
  als Live-Stream mit Schlüssel, also mit einem deployten Backend. Das hat diese
  Seite nicht (`server/` ist Vite-Dev-Middleware, ausgeliefert wird GitHub Pages),
  und der Deploy-Cron alle 3 h trägt keinen Blitzmonitor. Eine OPTISCHE Messung
  aus dem All kann beides prinzipiell nicht liefern und unterscheidet auch
  Wolken- nicht von Erdblitzen.
  **Deshalb der MTG Lightning Imager als ZWEITE Blitzquelle** — und er ist
  wegen der ABDECKUNG da, nicht wegen der Auflösung: die DWD-Blitzdichte endet
  im Süden bei 46,95 °N (Kärnten fehlt), das Radarecho im Osten bei
  13,2–14,4 °O (Linz, Wien, Graz, Klagenfurt fehlen) — MTG sieht von 0° aus
  die ganze Scheibe, also genau diese Ecken. Layer `mtg_fd:li_afa`
  (Accumulated Flash Area, L2) auf demselben EUMETView-WMS wie der
  Satellitenbereich; live geprüft 2026-09-29: CORS `*`, keyless, PNG8
  transparent ~5 KB über diese Fläche, 5-Minuten-Takt (`PT5M`), Archiv ab
  30.05.2025.
  **Dafür kann `WmsImageSource` jetzt eine FREMDE Quelle sein**: `wmsBase`,
  `capsBase` und `area` (Vorgaben sind der DWD-Workspace). `area` ist keine
  Bequemlichkeit — das MTG-Capabilities meldet die ganze sichtbare Halbkugel
  (±70°) und führt **gar keine EPSG:3857-BoundingBox** (nur CRS:84 und
  EPSG:4326, gemessen), `parseRadarCapabilities` fiele dort also auf `null`
  zurück, obwohl die Zeiten da sind. Angefordert wird deshalb über die
  Registry-Fläche — dieselbe Box wie das DWD-Radargitter, damit beide Overlays
  denselben Boden abdecken.
  **Gezeichnet werden RINGE, kein Bild** (`RadarOverlay.cells`, `CellSymbols`,
  `drawFlashRings`): ein rohes AFA-Bild wäre derselbe Fehler, der bei der
  DWD-Dichte schon verworfen wurde — die Rampe ist YlOrRd (`#FFF2AE → #8B0026`,
  am Legendenbild abgetastet) und liest sich über dem Echo wie ein zweites
  Echo. **Eine maschinenlesbare Klassenliste gibt es nicht**: der SLD des
  Layers trägt nur einen nackten `RasterSymbolizer` ohne ColorMap (über
  `request=GetStyles` nachgeladen), die Farben stecken in der Farbtabelle des
  Rasters — die Stufe ist deshalb eine relative Intensität und wird auch nur so
  benannt. **Ring statt Kreuz, weil sich die Quellen ÜBERLAPPEN**: über
  Deutschland liegt der Ring um das DWD-Kreuz (zwei Quellen, die sich einig
  sind), östlich und südlich davon steht er allein — mit zweimal Kreuzen sähe
  die Überlappung nach doppelt gezeichneten Blitzen aus. Die Altersfarben sind
  dieselben (`LIGHTNING_AGES`): die Zeitlesart darf nicht je Quelle eine
  andere sein. Welche Overlays selbst zeichnen, entscheidet das Feld `cells`
  und nicht mehr eine fest verdrahtete Id — mit `id === 'blitze'` wäre der
  zweite Layer still als rohes Bild auf der Karte gelandet.
  **Die MTG-Zeitdimension hinkt dem Radarstand ein bis zwei Schritte
  hinterher** (live gesehen: Radar 19:05, MTG 19:00 — die sichere Richtung,
  siehe die `nearestValue`-Falle im Satellitenabschnitt). Die Beschriftung
  eines Zellen-Overlays nennt deshalb den jüngsten Zeitschritt IM
  Altersfenster, der Zellen hat, nicht `current`: sonst stand „keine Blitze"
  unter einer Karte voller Ringe. Das BILD greift weiter nie zurück — dort
  trägt die Farbe das Alter, ein Rückgriff wäre eine falsche Aussage.
  **MTG-EINZELBLITZE** (seit 2026-11-10, Overlay `mtgflash`, Vorgabe aus;
  `worker/flashes.ts`, Format `FlashBucket` in `config/radar.ts`, Tests
  `worker/flashes.test.ts`): dieselbe Quelle wie `mtgli`, aber die EINZELNEN
  Blitze aus dem Data Store („LI Lightning Flashes", `EO:EUM:DAT:0691`) statt
  der aufsummierten Fläche — eigene Zeit je Blitz, gezeichnet als PUNKT
  (`drawFlashDots`, Farbe = Alter in 5-Minuten-Stufen, Größe = Leuchtstärke
  `flashLevel`). Holt der WORKER im 5-Minuten-Cron, nicht der Laptop: die
  Datei ist ~790 KB NetCDF4 UNKOMPRIMIERT (anders als FCI, siehe MTG HD),
  jsfive liest sie in ~15 ms. Gemessen 2026-11-10: ein Paket je 10 Minuten,
  ~2¾ min nach Fensterende im Data Store; SUCHE ohne Token, ABRUF nur mit
  (sonst 404) — Secrets `EUMETSAT_KEY`/`EUMETSAT_SECRET` (`wrangler secret
  put`). Geholt wird direkt der NetCDF-Teil (`sip-entries`, „CHK-BODY"), nicht
  die ZIP. Je Paket zwei Fenster `radar/mtgflash/<Ende>.json` (Ende :x5/:x0,
  5 s Versatz zum Paket bewusst geschluckt, damit jedes Fenster zu genau EINER
  Datei gehört), Index wie die eigenen Radarbilder (6 h), ~2 Dateien + Index
  je Lauf. Abgelegt wird die Blitzfläche ±1°. `flash_filter_confidence` ≥ 0,5
  fliegt raus (drei Werte in der Datei: 0 = 81 % kräftige Blitze, 0,052, 1 =
  8 % schwache) — die Lesart „Sicherheit für Fehlalarm" ist ABGELEITET, nicht
  dokumentiert. Ein abgebrochener Abruf (kam lokal vor: der Server schließt
  die Verbindung) kostet nur diese Datei, drei Versuche, der Index wird
  trotzdem geschrieben. Gegen netCDF4 geprüft: Zahl, Lage, Zeit, Strahldichte
  gleich. Lokal: `npm run ingest:flashes` (Zugang aus
  `~/.config/meteojunkie/eumetsat.env`, Ablage `public/radar/mtgflash`).
  **Die Quellenzeile trennt die Lizenzen** (`RadarOverlay.credit`): „Nutzung
  nach GeoNutzV" gilt für den DWD, nicht für EUMETSAT — ein pauschaler Satz
  über beiden wäre die falsche Angabe, und Attribution ist Lizenzbedingung.
  `view.eumetsat.int` steht im Impressum jetzt auch für diesen Bereich.
  **`format=image/png8` für ALLES**, gemessen: gleiche Farbanzahl (der Stil hat
  unter 256 Farben), aber halbe Größe — Radar 44 statt 93 KB, ein LEERES
  Symbol-Overlay **1,1 statt 37,7 KB**. Bei 13 Bildern je Schleife und bis zu
  vier Quellen ist das der Unterschied zwischen 0,6 und 2,5 MB.
  Die **Symbol-Overlays werden GRÖSSER angefordert** (1600 px statt 1200): ihre
  Kreise und Pfeile werden in Pixeln des Bildes gezeichnet und stehen sonst
  hochskaliert und unscharf auf der Karte. Der Vorgabestil der KONRAD-Zellen
  ist bewusst NICHT genommen — er füllt sie deckend und verdeckt genau das
  Radarecho; stattdessen `..._unfilled_polygons_colored_border`, und die
  Zugspuren kommen als ZWEITER Layer im selben Bild (kommagetrennt, mit
  passender Stilliste) statt als zweiter Abruf.
  **BLITZE SIND KREUZE, keine Dichtefläche** (`render/lightning.ts`, mit
  Tests) — auf Wunsch, und der Wunsch hat recht: die Dichteskala läuft über
  Gelb, Grün und Türkis, sieht also aus wie ein zweites Radarecho und legt sich
  als Schleier über das, was man lesen will (im Vergleich nachgestellt).
  **Der DWD gibt keine Einzelblitze heraus** — was es gibt, ist die
  NowCastMIX-Dichte, und deren Kornung ist gemessen **10 km × 10 km** (bei
  50 m/px überzoomt hält eine Farbfläche über 10,4 km; passt zur Einheit
  „Blitze/min je 100 km²"). Ein Kreuz steht deshalb für EINE ZELLE mit Blitzen,
  nicht für einen Einschlag; die Legende sagt das. **Farbe = Alter**
  (`LIGHTNING_AGES`, vier Stufen à 5 min, gelb → orange → rot → violett,
  gezeichnet von ALT nach NEU, damit das jüngste oben liegt), **Größe =
  Blitzrate** (Stufe aus der PIXELFARBE zurückgelesen, `LIGHTNING_DENSITY_
  COLORS`). Beides ist nötig: ohne die Größenstaffelung stand über einer
  Böenlinie ein gleichförmiges Kreuzgitter, in dem die aktiven Kerne
  verschwanden. Die Maße (`LIGHTNING_ARM` 1,6 + 0,35 je Stufe) sind an der Lage
  vom 16.09.2026, 15 UTC nachgestellt: die 10-km-Zellen liegen bei 1.200 px
  Bildbreite ~9,6 px auseinander, ein Kreuz darf also höchstens ~6 px breit
  werden, sonst schließt sich das Gitter. **Die Altersstufe ist
  produktbedingt auf 15 Minuten gerundet** (jedes Bild fasst die Blitze der
  letzten 15 Minuten zusammen) — steht so im Tooltip, feiner gibt es die Quelle
  nicht. Das Blitzbild wird deshalb GROB geholt (400 px, ~4,7 km/px) und die
  Zellen daraus einmal beim Laden extrahiert (`loadLightningCells` speichert
  Positionen, kein PNG); gezeichnet wird ein eigenes Canvas über vier
  Altersstufen, das als image-Source auf die Karte geht.
  **Interpolation: KEINE — der Dienst rastert nearest neighbour**, und das ist
  gemessen, nicht angenommen: 90-fach überzoomt (~11 m/px) stehen entlang einer
  Zeile durch ein Echo Blöcke von 101–102 Pixeln in EINER Klassenfarbe mit
  harten Kanten (also genau eine 1-km-Zelle je Block), ohne einen einzigen
  Zwischenton, und benachbarte Blöcke springen über Klassen hinweg (7–9,5 dBZ
  direkt auf 14,5–19 dBZ). Der GeoServer-Vendorparameter
  `interpolations=nearest neighbor` änderte entsprechend nichts — Byte für Byte
  dieselbe Antwort. Selbst interpoliert wird auch nicht: das Bild kommt in
  Web-Mercator, also im Zielraster. Die einzige Weichzeichnung ist die ~1 px
  Kantenglättung des Renderers.
  **Die Zeitschritte werden GEHOLT, nicht gerechnet**: eine Zeit abseits des
  5-Minuten-Rasters beantwortet der Dienst mit einer ServiceException statt mit
  einem Bild. Sie stehen in der Zeitdimension des GetCapabilities — und zwar
  des **layer-eigenen virtuellen WMS** (`/geoserver/dwd/<Layer>/wms`, 18 KB)
  statt des Workspace-Capabilities (862 KB), was den Minutentakt erst
  vertretbar macht. Das Ende der Dimension ist NICHT der letzte
  Analysezeitpunkt, sondern das Ende des Nowcasts; `analysisTime()` zieht
  `forecastMs` (2 h) ab. Zweimal gegengeprüft: die Dimension des reinen
  Analyse-Layers (`Radar_wn-analysis_1x1km_ger`) endete exakt 120 min früher.
  Ein neuer Stand wird **angezeigt, aber nicht automatisch geladen** (ein Satz
  Bilder sind ~40 Abrufe bei einem fremden, kostenlosen Dienst) — Knopf
  „● neuer Stand". Ladereihenfolge ist `frameLoadOrder`: erst das ANGEZEIGTE
  Bild, dann vorwärts, dann die älteren rückwärts; vier gleichzeitig.
  **Die magentafarbene Randlinie des Produkts wird weggerechnet**
  (`render/radarImage.ts`, mit Tests): der Dienst zeichnet entlang der
  Außengrenze des Radargebiets eine 1 px breite Linie in **#FB00FF** — eine
  Farbe, die in seiner eigenen Legende nicht vorkommt (Werte außerhalb der
  Farbtabelle; die Linie steht bei 110 m/px genauso da wie bei 1,1 km/px, ist
  also im Produkt und kein Artefakt der Anfrage). Sie liest sich GENAU FALSCH:
  Magenta sitzt in jeder Niederschlagsskala am oberen Ende, hier markiert es
  den Rand des unbekannten Gebiets. **Geprüft wird die MISCHLINIE zwischen
  Maskengrau und #FB00FF, nicht „irgendwie magenta"** — und daran hängt mehr,
  als es aussieht: die dBZ-Skala führt **#FF33FF für 75–85 dBZ**, eine echte
  Klassenfarbe, die jeder „rot hoch, grün niedrig, blau hoch"-Regel zum Opfer
  fällt (die erste Fassung hätte sie stillschweigend gelöscht). Auf der
  Mischlinie liegt sie nicht — bei ihrem Grünwert wären rund 200 statt 255 im
  Rotkanal zu erwarten. Ein Test fährt alle Farben BEIDER Skalen dagegen. Jedes Bild läuft deshalb einmal über ein
  Canvas und wird als Data-URL weitergegeben (`toDataURL()` ist synchron —
  bei vier parallel ladenden Bildern kann so kein zweites dazwischen auf
  dieselbe Leinwand malen). Die Farbskala selbst ist NICHT erfunden, sondern
  1:1 aus `GetLegendGraphic&format=application/json` desselben Layers.
  Kartenhintergrund kommt aus `render/basemap.ts` — dafür aus `MapPanel.tsx`
  herausgezogen, damit Radar und Feld-Karte nicht zwei Fassungen derselben
  Linienfarben pflegen. Städte kommen aus `config/cities.ts` über die
  **Pseudo-Domain `'imagery'`** (hieß bis 2026-09-19 `'radar'`, trägt seit dem
  Satellitenbereich ZWEI Karten; beide haben keine `DomainPreset`, ihre Fläche
  gibt der Dienst bzw. der Ausschnitt vor — ein zweites Städteverzeichnis wäre
  schlechter); ausgedünnt wird hier nach ZOOM, nicht nach Panelbreite.
  **In den Bildkarten verschwindet der GANZE Marker, nicht nur das Label**
  (`.city-hidden` statt `.city-label-hidden`): über einem Radarecho oder einem
  Satellitenbild ist ein Punkt ohne Namen kein Hinweis, sondern ein Fleck mehr,
  den man für Bildinhalt hält. In den PANEL-Karten bleibt es beim alten
  Verhalten (Punkt bleibt, Label fällt) — dort ist die Fläche winzig und die
  Lage der Nachbarpunkte trägt noch. **Die Zoomleiter reicht bis Priorität 5**
  (z < 4,8 → 1 · < 6 → 2 · < 7 → 3 · < 8 → 4 · sonst 5): beim Hineinzoomen
  sollen MEHR Orte kommen, nicht immer dieselben vierzig. Dafür führt die
  Registry rund 95 Einträge für `'imagery'` — Stufe 4 sind Regionalzentren,
  Stufe 5 Alpenorte und Grenzstädte (bei Föhn- und Staulagen genau die, an
  denen man sich orientiert). **Die Koordinaten der Nachträge sind geokodiert,
  nicht aus dem Kopf**: die erste Abfrage lieferte für „Milano" und „Venezia"
  gleichnamige Kleinorte in Mittelitalien, 300 km daneben — in der Karte sähe
  das wie ein Projektionsversatz aus. `cities.test.ts` prüft deshalb die LAGE
  (alle im Ausschnitt, im Länderumriss, keine doppelten Punkte, jede
  Zoomstufe besetzt). **Punkte und Labels
  sind hier GRÖSSER als in den Panel-Karten** (8 statt 5 px, 13 statt 10 px,
  fetter, kräftigerer Halo — `.radar-container .city-*` in `index.css`): dort
  teilen sich bis zu sechs Karten den Bildschirm, hier hat eine Karte die
  ganze Fläche, und über einem roten Echo verschwand die kleine Schrift. Der
  Marker-Offset ist der halbe Punktdurchmesser (−4 px), sonst säße der größere
  Punkt sichtbar neben seiner Koordinate.
  **BUNDESLANDGRENZEN aus einem EIGENEN Bündel** (`dach.basemap.json`, nur
  admin1, Bundesländer und Kantone von D, A und CH): die Radarkarte lädt
  seither ZWEI Bündel — Küsten und Staatsgrenzen weiter aus `europe` (die
  Produktfläche reicht bis an die Nordsee), admin1 aus `dach`. Das
  Europa-Bündel führt bewusst KEIN admin1, über ganz Europa wäre das Rauschen;
  über der Radarfläche sind die Landesgrenzen dagegen die Orientierung, an der
  man eine Zugbahn festmacht. Gefiltert wird über `ADM0_A3` — ungefiltert
  kämen die Regionen Frankreichs, Italiens, Tschechiens und Polens mit
  (`ADMIN1_COUNTRIES` in `scripts/build-basemap.mjs`, 224 KB, AT 132 / DE 773 /
  CH 334 Liniensegmente).
  **DOPPLERWIND UND EINZELNE ELEVATIONEN GIBT ES NICHT — nachgemessen
  (2026-09-29), nicht erneut suchen.** Der vollständige Radar-Katalog des WMS
  sind AUSSCHLIESSLICH Komposite: WN (dBZ), RV (mm/h), RADOLAN-RW/RY/SY/W4 und
  die „No Data No Echo"-Maske. Keine Radialgeschwindigkeit, keine Elevation,
  kein Dual-Pol. Die ROHdaten liegen dagegen offen auf
  `opendata.dwd.de/weather/radar/sites/` — `sweep_vol_v` (Doppler-
  Radialgeschwindigkeit), `sweep_vol_z` (Reflektivität je Elevation),
  `sweep_vol_zdr`/`rhohv`/`phidp` (Dual-Pol), 17 Standorte × 10 Elevationen
  (`vradh_00`…`09`), 5-Minuten-Volumenscan, ODIM-HDF5, 46 KB je Elevation und
  Standort; dazu `mesocyclones/` als XML. **Erreichbar sind sie trotzdem
  nicht**: `opendata.dwd.de` sendet KEINE `Access-Control-*`-Header (gemessen
  bei HEAD und GET auf eine echte Datei) — der Browser kommt gar nicht heran.
  Dazu zwei weitere Wände, jede für sich genügend: HDF5 bräuchte einen
  Binärparser im Frontend (dieselbe Entscheidung wie beim GeoSphere-Nowcast),
  und die Daten stehen in POLARkoordinaten je Standort, müssten also selbst
  komposit-iert, ENTFALTET (Velocity-Aliasing — der eigentliche Aufwand) und
  projiziert werden; dieser Bereich ist bewusst als „fertige Karten fremder
  Dienste" gebaut, genau um kein eigenes Radar-Rendering zu haben. Menge
  obendrein: eine Elevation über Deutschland = 17 Dateien ≈ 780 KB je
  Zeitschritt, ein volles Volumen 170 Dateien ≈ 7,8 MB alle 5 Minuten. Wer es
  will, braucht einen Server, der holt, entfaltet, komposit-iert und Kacheln
  ausliefert — dieselbe Wand wie bei der Blitzpolarität, keine neue.
  **RADOLAN ist die zweite Hälfte der Produktliste, und es ist eine andere ART
  Zahl** (`rw`/`ry`/`w4`/`sy`, alle Werte live gemessen 2026-09-29): RADOLAN
  eicht das Radar an den Niederschlagsmessern der Bodenstationen. Damit fällt
  der größte Fehler der reinen Radarmessung weg — die Z-R-Beziehung nimmt eine
  Tropfengrößenverteilung an, die sie nicht messen kann (dieselbe Begründung,
  aus der dieser Bereich dBZ statt mm/h als Vorgabe zeigt). Der Preis ist
  Zeit: **RW** (Stundensumme, angeeicht, `PT10M`) erscheint rund eine halbe
  Stunde nach dem Termin, ein Nowcast ist das nicht. **RY** (`PT5M`) ist
  qualitätsgeprüft und abschattungskorrigiert, aber NICHT geeicht — die Stufe
  dazwischen. **W4** (4-Wochen-Summe) und **SY** (Summe des laufenden
  hydrologischen Jahres, seit 1. November — die übliche Bilanzperiode, weil
  sie den Winterniederschlag samt Schneeschmelze in EIN Jahr legt) laufen im
  TAGEStakt und sind klimatologische Bilder, keine Wetterbilder.
  **Die Abdeckung ist eine ANDERE als bei WN/RV**: lon 2,07–15,72 · lat
  47,14–55,09, und der DWD sagt dazu ausdrücklich „Daten nur innerhalb
  Deutschlands" — im Bild sichtbar als scharfe Kante an der Staatsgrenze. Von
  Österreich liegt nichts Brauchbares drin; die Legendenzeile sagt das auch so.
  **`maskOpacity` und die Randlinien-Regel sind deswegen GETRENNT**
  (`WmsImageSource.edgeLine`) — das ist die wichtigste Änderung an der
  Mechanik. Bisher war `maskOpacity` beides: Beschreibung der Maske UND
  Schalter für die Nachbearbeitung. Mit RADOLAN geht das auseinander:
  RW und RY HABEN die graue Maske (gemessen Alphawert 77 = 0,3), dürfen die
  Regel aber auf keinen Fall durchlaufen — ihre Rampe führt **`#DA28C6` als
  echte Klassenfarbe** (40–60 mm/h), und genau diese Farbe kommt der
  Mischlinie der Regel bis auf drei Einheiten nahe (die Warnung stand schon
  für die Blitzdichte da, die dieselbe 13-Farben-Rampe benutzt). Umgekehrt
  tragen W4 und SY **gar keine Maske** (kein einziges Maskenpixel im Bild) und
  SY mit `#E720CE` eine weitere magentanahe Klassenfarbe. Gemessen ist
  ausserdem, dass die Randlinie in KEINEM RADOLAN-Bild vorkommt — sie ist eine
  Eigenheit von WN/RV. Wer ein Produkt ergänzt, setzt `edgeLine` nur, wenn er
  die Linie im Bild wirklich gesehen hat; ein Test hält die Zuordnung fest.
  **Tagesprodukte brauchen Tagesfenster** (`RadarProduct.historyOptions`,
  7/14/30 Tage statt 30 min–3 h): mit „1 h" bestünde die Schleife aus einem
  einzigen Bild. Die Vorgabe ist bewusst die kürzeste — ein W4-Bild wiegt
  gemessen 311 KB bei 1.200 px, 30 Tage wären über 9 MB bei einem fremden,
  kostenlosen Dienst. Beim Produktwechsel korrigiert ein Effekt einen
  Fensterwert, den die neue Auswahl nicht kennt (dasselbe Muster wie die
  Schwellen-Korrektur in `VerifyPanel`).
  **Die OVERLAYS gibt es nur zu den Nowcast-Kompositen** (`supportsOverlays`,
  entschieden am TAKT und nicht an einer Id-Liste): über einer 4-Wochen-Summe
  ist „Blitze der letzten 5 Minuten" keine Ergänzung, sondern ein Widerspruch
  — und technisch fällt es sofort auf die Nase, weil die Tages-Zeitstempel
  nicht in der 5-Minuten-Dimension der Overlays stehen (live gesehen: 30
  vergebliche Abrufe je Umschaltung, alle mit ServiceException). Die Häkchen
  bleiben sichtbar, aber gesperrt samt Begründung im Tooltip.
  **Ein Produktwechsel verwirft jetzt auch die META**, nicht nur die Bilder:
  sonst rechnet `times` einen Augenblick lang mit der Zeitdimension des ALTEN
  Produkts und dem neuen Layer. Solange alles im 5-Minuten-Takt lief, fiel das
  nicht auf; zwischen 5 Minuten und einem Tag liegen Faktoren, und jede
  solche Zeit beantwortet der Dienst mit einer ServiceException.
  **SÄULENMAXIMUM (DMax) UND VIL SIND SEIT 2026-10-28 DA — als EIGENE
  Bilder** (`own: true` in `RADAR_PRODUCTS`, `OWN_RADAR`, Rechenkern
  `worker/radar.ts`): der Worker holt alle 5 Minuten
  `composite/dmax` und `composite/vii` von opendata.dwd.de (kein CORS — der
  Browser käme nicht heran), rechnet sie auf ein Mercator-PNG in der
  Produktskala und legt Bild + `radar/<id>/index.json` in R2; das Panel liest
  den Index statt eines GetCapabilities (`fetchRadarMeta`), sonst läuft alles
  wie bei den WMS-Produkten (Overlays, Schleife, Nachrücken). **HX ist
  bewusst NICHT dabei**: laut Metadaten aus einem ~30-s-Teilscan, was es
  genau ist, sagen sie nicht — DMax ist eindeutig das Maximum über das ganze
  Volumen (Scan 4 min). **Gemessen**: DMax 4800×4400 uint16 (250 m), ein
  einziger deflate-Block; **jsfive liefert die Werte als JS-Array (167 MB
  Heap) und sprengt damit das 128-MB-Limit eines Workers** — jsfive (0.4.0,
  fest gepinnt, privates `_dataobjects`) gibt deshalb nur Metadaten und die
  Blockadresse, entpackt wird als Strom (`DecompressionStream`), behalten
  nur jeder 4. Punkt (1 km = Bildauflösung): 0,1 s, 8 MB Heap, 0
  Abweichungen gegen jsfive komplett. **h5wasm geht im Worker nicht** (übersetzt
  WebAssembly zur Laufzeit aus Bytes, das erlaubt Cloudflare nicht). Lage
  gegen das WN-Bild desselben Termins geprüft: beste Deckung bei 1 px
  Versatz (~1 km). Die Ecken (`UL_lon` …) sind die AUSSENKANTEN des Gitters,
  UL liegt auf (0, 0). VIL-Skala ist eine ANZEIGESKALA (`VIL_LEGEND`), der
  DWD führt keine Klassen. Kosten je Lauf ~0,5 s CPU, ~6 R2-Schreibvorgänge.
  Bei einem Produktwechsel rechnete das Panel eine Runde mit der ALTEN
  Zeitdimension (fünf 404 je Umschaltung) — `metaOwnerRef` hält das ab.
  **WIE ANDERE AN DIE ELEVATIONEN KOMMEN — nachgemessen 2026-10-08**: über
  einen eigenen SERVER, nicht im Browser. Kachelmannwetter („3D-Radar-
  Analyse") rechnet nach eigener Angabe alle 5 Minuten die Volumendaten
  aller Standorte auf ein 3D-Gitter und leitet daraus Echotops, VIL und
  Mesozyklonen ab — genau die Pipeline aus `sweep_vol_z` oben. Gemessen am
  Standort Isen: 10 Elevationen (0,5/1,5/2,5/3,5/4,5/5,5° bis 180 km,
  8° bis 124 km, 12/17/25° bis 60 km), 360 Strahlen × 250 m, ein Volumen
  ~0,9 MB, alle Deutschland ~15 MB je 5 Minuten. Fertige 3D-ABLEITUNGEN
  liegen ebenfalls offen, alle ODIM-HDF5 und alle OHNE CORS:
  `composite/hx` und `composite/dmax` (Säulenmaximum dBZ, 250 m, 4400×4800,
  ~1,2 bzw. 2 MB), `composite/vii` (VIL, 1 km, 45 KB), `sites/pe`
  (Echotops je Standort, 1 km) und `konrad3d/` (Zellen als XML). Werkzeuge:
  wradlib/xradar (lesen ODIM-Volumen direkt), wetterdienst (Abruf).
  Gangbar wurde das erst mit dem Worker-Cron (s. u., 3D-Radar).
  **3D-RADAR STUFE 1 seit 2026-11-02: HÖHENSCHICHTEN UND QUERSCHNITT**
  (auf Wunsch; Produkt `cappi` „Höhenschicht 3D (dBZ)", Rechenkern
  `worker/radar3d.ts`, Browser `config/radar3d.ts` mit Tests +
  `api/radar3d.ts` + `components/RadarSection.tsx`). Der Worker holt alle
  5 Minuten die Volumenscans ALLER 17 Radare (`sweep_vol_z/<st>/hdf5/
  filter_polarimetric`, 10 Elevationen 0,5–25°, 360 Strahlen × 250 m, 170
  Dateien ~12 MB) und rechnet einen Stapel aus 23 Höhen über NN (1–12 km in
  500 m) auf ~0,9 km (Mercator 1000×1178 über lon 3,4–17,2 / lat
  45,8–56,0). Strahlausbreitung mit 4/3-Erdradius, LINEAR in der Höhe
  zwischen den Elevationen darüber und darunter (in dBZ), ausserhalb der
  gescannten Hülle nur innerhalb der halben Strahlbreite — sonst KEIN Wert;
  mehrere Radare: das Maximum. Kodierung 1 Byte (0 = kein Echo, 1…254 =
  (dBZ + 32) · 2, 255 = nicht abgedeckt), gzip, `radar/r3d/<termin>.bin`
  + `index.json` (3 h).
  **CPU gemessen, und das war die offene Frage**: ein Termin 2,3 s lokal
  (Dekodieren 1,4 s mit jsfive, Einrechnen 0,65 s, gzip 0,2 s), Heap
  höchstens 58 MB, Datei 0,46 MB bei ruhiger Lage. Die Grenze im
  5-Minuten-Cron ist 30 s CPU (Paid-Plan, Cron < 1 h), 128 MB Speicher,
  15 min Laufzeit. Der 3D-Lauf hat deshalb einen EIGENEN Cron
  (`2-59/5 * * * *`, `R3D_CRON` in `worker/index.ts`): eigenes CPU-Budget,
  ein Fehler reisst Radar und Satellit nicht mit, und das Volumen ist dann
  vollständig (die letzte Elevation beginnt ~4 min nach dem Termin, rund
  30 s später liegt sie beim DWD). Höchstens 2 Termine je Lauf. In
  `wrangler dev --test-scheduled` mit echten Abrufen: 2 Termine in 7,2 s.
  **Dateinamen werden GEBILDET, nicht aus der Liste gelesen**: jede
  Verzeichnisliste ist ~1 MB und kommt ungzipped; die Scanzeiten liegen
  aber je Standort und Elevation auf ±1 s fest (über zwei Tage gemessen),
  zwei Scanpläne (`OFFSETS_A`/`OFFSETS_B`, Memmingen, Rostock, Ummendorf
  takten die oberen Elevationen anders), probiert wird ±2 s. Ein Standort
  mit weniger als 6 Elevationen fällt für den Termin weg (seine Fläche zeigt
  dann „keine Daten").
  Im Browser bleiben die Dateien KOMPRIMIERT im Speicher, entpackt (27 MB)
  nur die letzten drei; eine Höhe wird je Termin als Bild gemalt
  (`r3dLevelImage`, dieselbe WN-Skala und Maske wie die Reflektivität,
  Wert am Zeiger über dieselbe Legende). Höhenwechsel leert die Bilder im
  HANDLER samt Ref, nicht über einen Effekt (sonst hielte der Ladeeffekt
  derselben Runde nichts für fehlend) — gemessen 12 Bilder in ~1 s.
  **Querschnitt**: Knopf, dann zwei Klicks in die Karte (A, B als
  DOM-Marker, keine Glyphenquelle); unter der Karte der Schnitt für den
  GEZEIGTEN Termin (läuft beim Abspielen mit), alle 1 km eine Spalte,
  Kennzeile mit Höchstwert, Echotop (18 dBZ) und Radarzahl, Wert am Zeiger.
  Grenzen, sichtbar gelassen statt aufgefüllt: über jedem Radar fehlt ein
  Kegel, in der Ferne die untersten Kilometer (1 km über NN deckt nur die
  Umgebung der tief gelegenen Radare ab, 39 % der Fläche; ab 3 km 66 %),
  Österreich nur im Westen. Offen (Stufe 2): echte 3D-Ansicht (WebGL2-
  Volumen) aus demselben Stapel.
  **WERT AM ZEIGER seit 2026-11-02 — als KLASSE aus dem Bild**
  (`radarPixelAt`/`classifyRadarPixel` in `config/radar.ts`, Anzeige oben
  mittig): die Farbe des schon geladenen Bilds zurück auf die Legende,
  „19–23,5 dBZ", Maskengrau = „keine Radardaten", Mischfarbe an einer Kante
  = keine geratene Klasse, kein Abruf beim DWD. Dekodiert wird abhängig
  davon, OB der Zeiger auf der Karte ist — mit der Position als Abhängigkeit
  brach jede Mausbewegung das Dekodieren ab (so war es zuerst). Den EXAKTEN
  Wert gäbe nur GetFeatureInfo:
  Früher offen und bewusst nicht gebaut: der Wert am Zeiger (`GetFeatureInfo` liefert
  `WN_ANALYSIS` in dBZ bzw. `RV_ANALYSIS` in mm/h plus `REFERENCE_TIME` —
  kostet aber einen Abruf je Abfrage; **−999 = keine Daten, −64 dBZ = kein
  Echo**, gemessen).
- **OPERA — GANZ ÖSTERREICH** (seit 2026-11-24, auf Wunsch; Produkt `opera`
  „Europa-Komposit OPERA (dBZ) — ganz Österreich", Worker `worker/opera.ts`
  mit Tests, Registry `OPERA_*` in `config/radar.ts`, lokal
  `npm run ingest:opera` → `public/radar/opera`). Das europäische
  Radarkomposit von EUMETNET, offen über MeteoGate (RODEO), **CC BY 4.0** —
  die Quellenzeile nennt EUMETNET/MeteoGate/Lizenz statt DWD/GeoNutzV.
  Läuft im 5-Minuten-Cron neben DMax/VIL, Bild + Index wie dort
  (`radar/opera/`), Ausschnitt `OPERA_AREA` lon 8,4–18,4 / lat 45,3–50,3
  (Bild 1200 px), beim Wählen springt die Karte dorthin. Alles gemessen
  2026-11-24:
  **Österreichische Radare sind NICHT dabei** — in keinem der drei Komposite
  (DBZH, RATE, ACRR) ein `at*`-Knoten, im Speicher kein `AT/`-Ordner mit
  Einzelstandorten (Länder: BE CH CZ DE DK EE ES FI HR HU IE IS LT MT NL NO
  PL RO SE SK). Die Fläche über Österreich ist trotzdem LÜCKENLOS (im
  Ausschnitt 0 Punkte „keine Daten") — von den Nachbarn: Isen, Memmingen,
  Türkheim, Eisberg, Skalky, Brdy, Javorník, Kubická hora, Pogányvár,
  Szentes, Lisca, Weissfluhgipfel, Albis (`OPERA_AT_RADARS`). Über dem
  Alpenhauptkamm schauen sie aus großer Entfernung hinein; schwacher Regen
  in tiefen Tälern kann fehlen. Das ist vermutlich auch die Quelle von
  Seiten wie tauernwetter.at (vom Nutzer genannt, dort nicht nachgeprüft).
  **Dateien**: Name BILDBAR, der Katalog (EDR `locations/0-20010-0-OPERA?
  parameter-name=DBZH:comp&datetime=…`, Limit 200/h ohne Schlüssel) wird
  nicht gefragt — `object-store.os-api.cci1.ecmwf.int/openradar-24h-backup/
  YYYY/MM/DD/OPERA/COMP/OPERA@YYYYMMDDTHHMM@0@DBZH.h5` (daneben `.tiff` als
  COG, RATE, ACRR). Der in der MeteoGate-Messung vom 18.10. notierte Host
  `s3.waw3-1.cloudferro.com/openradar-24h` antwortet inzwischen mit 404.
  ODIM-HDF5, CIRRUS-`MAX`-Komposit (Météo-France), 3800×4400 à 1 km, LAEA
  lat_0 55 / lon_0 10 / x_0 1950000 / y_0 −2100000, **float64 in dBZ**,
  nodata −9999000, undetect −8888000, deflate in Blöcken 760×880, ~2,6 MB.
  Name = ENDE eines 10-Minuten-Fensters (`starttime` 12:35:01 für 12:45),
  Takt 5 min, Datei ~4 min nach dem Termin. Das RATE-/ACRR-Komposit
  (NIMBUS) erzeugt übrigens GeoSphere Austria — auch dort ohne at-Radare.
  **Entpackt wird NUR der Ausschnitt** (6 von 30 Blöcken, Zeilen davor ohne
  Dekodieren übersprungen): roh wären es 134 MB, mehr als ein Worker darf;
  gemessen 30–40 ms Dekodieren + ~30 ms Bild/PNG, Heap ~30 MB, Bild ~8 KB.
  Gegen die volle jsfive-Dekodierung: 0 Abweichungen. LAEA ellipsoidisch
  (Snyder), trifft die Ecken UL/LR auf Bruchteile eines Millimeters. LAGE
  gegen das DWD-WN desselben Termins über Deutschland geprüft: bester
  Versatz (1, 1) px bei 1000 px über 10° = unter einem Gitterpunkt, wie bei
  DMax. OPERA zeigt dabei MEHR Echofläche als WN (Maximum über alle Radare
  und das 10-Minuten-Fenster) und einzelne Störstreifen/Speckle (v. a.
  SK/HU) — Eigenschaft der Daten, nicht gefiltert.
  **UNVOLLSTÄNDIGE TERMINE werden ausgelassen, und das ist der wichtige
  Teil**: einzelne Dateien kommen mit nur einem Teil der Radare an (12:50
  UTC 102, 12:55 UTC nur die 23 französischen, sonst 160–165) und werden
  NICHT nachgeliefert (um 13:16 UTC noch unverändert, `last-modified` 12:53 bzw. 12:57). Über
  Österreich sähe so ein Termin wie „kein Regen" aus. Regel: fehlen mehr
  als drei der 13 `OPERA_AT_RADARS` (`how/nodes`), wird der Termin nicht
  gezeigt; nach 20 min (`RETRY_MS`) gilt er als aufgegeben und steht unter
  `incomplete` im Index, damit nicht jeder Lauf ihn erneut holt. Lücken in
  der Schleife zeigt der Zeitschieber wie bei den anderen eigenen Produkten.
  Höchstens 4 neue Termine je Lauf (nach einem Ausfall füllt sich die
  Schleife über mehrere Läufe).
  **VORGABE DES BEREICHS ist seit 2026-11-24 OPERA** (auf Wunsch,
  `DEFAULT_RADAR_PRODUCT`), die Karte startet auf dem Ausschnitt; dazu der
  Ansichtsknopf „Österreich". Die DWD-Produkte bleiben wählbar.
  **STÖRECHOFILTER** (seit 2026-11-24, auf Wunsch; `filterEchoes`,
  `updatePersistence` in `worker/opera.ts`, Tests in `opera.test.ts`).
  Gemessen über 35 Termine (10:00–12:45 UTC) im Ausschnitt, drei Sorten:
  (1) flüchtige SPRENKEL aus wenigen Punkten, vor allem über SK/HU, jeder
  Termin anders; (2) ORTSFESTE kleine Flecken/Striche — östlich von Wien in
  > 80 % der Termine am selben Ort, teils 37–46 dBZ (Windparks,
  Bodenechos); (3) ein großer ortsfester Störkeil (Funk/RLAN) über Franken.
  **Der Qualitätsindex der Datei taugt NICHT** (`quality1`, qi_total: auch
  bei echtem Niederschlag meist 0). **Ein reiner Ortsfestigkeitsfilter
  auch nicht**: echter, stundenlang stehender Niederschlag (Adria,
  Nordost-Slowakei in dieser Messung — in Österreich jede Staulage) ist
  genauso ortsfest. Deshalb je zusammenhängendem Fleck (8er-Nachbarschaft):
  weg, wenn < 16 km² und kein Punkt ≥ 37 dBZ (Sprenkel; ein kleiner
  kräftiger Kern ist eher eine junge Zelle), ODER wenn ≤ 60 km² und seine
  Punkte im gleitenden Mittel ≥ 50 % Echo hatten (ortsfest UND klein).
  Gleitender Mittelwert je Punkt mit Gewicht 1/12 (~1 h Gedächtnis), aus
  dem ROHEN Termin vor dem Filtern, als `radar/opera/persistence.bin`
  (Bytes je Gitterpunkt des Ausschnitts, 470 KB, 1 Schreibvorgang je
  Lauf); nach einem Neustart greift der Ortsfest-Teil erst nach ~40 min.
  Ergebnis: ~1.500–2.000 von 7.000–12.000 Echopunkten je Termin entfernt,
  ~1 ms; Sprenkel und der Strich bei Wien weg, Niederschlagsgebiete
  unverändert. Der Störkeil (3) bleibt — kein Filter hier unterscheidet ihn
  von einem stehenden Regenband.
  **MTG-BLITZE sind seit 2026-11-24 voreingestellt AN** (auf Wunsch, mit
  OPERA als Vorgabe): die DWD-Blitzdichte endet im Süden bei 46,95 °N,
  Kärnten fehlt. Die DWD-Kreuze bleiben ebenfalls an (Ring um Kreuz = beide
  Quellen einig, siehe oben).

