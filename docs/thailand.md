# Thailand-Tropendienst

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Thailand-Tropendienst** (seit 2026-10-08, Quellen gemessen in den
  Projektnotizen): kein eigener Bereich, sondern Südostasien in DREI
  vorhandenen. **In der VERÖFFENTLICHTEN Version Satellit und Modellkarten**
  (`THAILAND_ENABLED` in `config/features.ts`, `VITE_ENABLE_THAILAND=false`
  in `build:web`, seit 2026-10-17 auf Wunsch): nur die Thailand-Region der
  Schnellwahl gibt es lokal; mit nur einer Region verschwindet die
  Regionsauswahl ganz. Die Modellkarten-Ansicht „Thailand" ist seit
  2026-10-28 wieder öffentlich — mit **IFS 0,1° Asien** (`ecmwf-hres-asia`,
  zweiter Ausschnitt desselben 0,1°-Abrufs, `crops` in `nwp_common.ingest`,
  411×331 über der Himawari-Fläche, ~34 MB je Lauf); die Ansicht wählt es
  von selbst, Europa/Alpen wechseln auf IFS Europa zurück. (1) **Satellit: Himawari-9 über NASA GIBS** (Gruppe
  „Himawari-9", `source: 'gibs'`, `HIMAWARI_AREA` 84–125° O / −5–28° N):
  Infrarot 10,4 µm, Sichtbar 0,64 µm (1 km, nur tagsüber) und Luftmassen-RGB.
  WMS wie EUMETView, CORS `*`, kein Key. **Die Zeitschritte kommen aus
  WMTS-„DescribeDomains"** (610 Bytes) — das WMS-Capabilities führt keine
  Zeitdimension, das WMTS-Capabilities wiegt 5,8 MB. Die Domäne meldet
  LÜCKEN (Himawari lässt 02:40 und 14:40 UTC aus); `parseTimeDomain` macht
  daraus ein Band mit `TimeExtent.missing`, und `frameTimes` lässt sie aus.
  **Zwei GIBS-Fallen, beide gemessen**: der jeweils neueste gemeldete Termin
  liefert rund eine halbe Stunde lang ein SCHWARZES JPEG mit HTTP 200
  (~17 KB statt ~320 KB) — die zwei jüngsten Termine werden deshalb gar nicht
  angeboten (`GIBS_TRIM_STEPS`), und was danach noch leer kommt, gilt über
  `SatelliteProduct.minBytes` als Fehler und läuft in die Wiederholung (nicht
  beim sichtbaren Kanal, der nachts zu Recht schwarz ist). Anforderungsbreite
  nach der WMTS-Kachelstufe des Layers (IR/Luftmassen Stufe 6 = 2.446 m/px →
  1860 px, sichtbar Stufe 7 = 1.223 m/px, mit 2660 px bewusst gröber), JPEG
  (PNG war 4× größer). Region wechselt mit dem Produkt (`isAsia`): Sprungziel
  „Thailand", Sonnenstand über Zentralthailand (`productCenter`), Welt-Bündel
  statt Europa-Bündel, Beschriftung über `addWorldLabels`, Quellenzeile
  JMA/NASA GIBS; `gibs.earthdata.nasa.gov` steht im Impressum.
  (2) **Modellkarten: Ansicht „Thailand"** — die IFS-Felder (0,25°, inkl.
  Wellen, Wassertemperatur, Partikel) sind ohnehin global; wer die Ansicht mit
  ICON wählt, wird auf IFS umgestellt (ICON ist europäisch). Die Urlaubsorte
  und Inseln, die Natural Earth nicht führt, kommen aus `config/thaiPlaces.ts`
  (geokodiert — „Khao Lak" und „Ko Tao" hatten gleichnamige Zweittreffer
  200 km daneben). (3) **Schnellwahl mit Regionen** (`QUICK_REGIONS`,
  Auswahl Österreich · Thailand vor den Knöpfen, `regionFor`): die Region
  folgt dem gewählten Ort; acht Thai-Orte an beiden Küsten plus Bangkok und
  Chiang Mai. Punktdaten laufen über Open-Meteo wie überall.
  **WOLKENOBERGRENZEN-TEMPERATUR AM ZEIGER** (Himawari-Infrarot,
  `SatelliteProduct.readout`, Kern `config/gibsReadout.ts` mit Tests, Laden
  `api/gibsReadout.ts`): GIBS liefert nur Farben, NASA veröffentlicht aber die
  Farbtabelle (`colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml`, 237
  Einträge −92 … +57 °C, CORS offen). Drei Fallen, alle gemessen: (1) **aus
  dem angezeigten JPEG geht es nicht** — an Gipfeln unter −30 °C p90-Fehler
  84 K; gelesen wird die verlustfreie WMTS-Kachel (Stufe 6, ~50 KB, je Termin
  und Kachel einmal, LRU 24). (2) **Auch die Kachel ist umgerechnet**: nur 49 %
  der farbigen Pixel treffen einen Eintrag exakt — projiziert wird deshalb auf
  den FARBVERLAUF (Strecken zwischen Nachbareinträgen), 89 % liegen innerhalb
  10 RGB-Einheiten; weiter weg (Mischung am Wolkenrand) gibt es KEINE Zahl.
  (3) **Grau bedeutet ZWEIMAL etwas**: warme Graurampe +13 … +57 °C UND ein
  kaltes Grauband −80 … −70 °C; die erste Fassung zeigte über dem
  wolkenfreien Golf von Bengalen −75 °C. Mehrdeutige Farben entscheiden die
  eindeutigen Nachbarn im Umkreis von 10 px (`valueAtPixel`), ohne solche
  gilt die warme Deutung. Über 0 °C sagt die Anzeige „Boden, Meer oder tiefe
  Wolke" — der Kanal sieht die oberste Fläche, nicht zwingend eine Wolke.
  **Pfeiltasten im Satellitenbereich** (←/→, Shift sechs Bilder), dieselbe
  Regel `globalKeyAllowed` wie überall; Lücken im Zeitraster werden dabei
  übersprungen. **Wassertemperatur-Skala ungleich gestuft** (`SEA_TEMP`):
  kalt 2 K, mittel 1 K, ab 26 °C 0,5 K — mit gleichmäßigen Bändern lagen die
  Tropen in zwei, drei Rottönen.
  **IFS mit 9 km — gemessen, noch NICHT gebaut**: gibt es NICHT bei ECMWF Open
  Data (nur `ifs/0p25`), nur im Open-Meteo-Bucket (`s3://openmeteo`,
  `data_run/ecmwf_ifs/<lauf>/<größe>.om`, ~580 MB je Größe und Lauf, Gitter
  O1280, Chunks (1, 7, 145)). **Ausschnitt lesen ist latenzgebunden, nicht
  datengebunden**: für 16 von 256 Zeilen des Thailand-Kastens flossen 795 KB
  in 131 s — die Bibliothek `omfiles` macht tausende kleine Abrufe
  nacheinander, auch asynchron mit 64 parallel blieb es bei 181 s je Größe.
  Am Stück lädt der Bucket von hier 6 MB/s (580 MB ≈ 95 s); gangbar ist also
  nur der GANZDATEI-Download im Deploy (Actions in den USA, nahe am Bucket),
  danach lokal ausschneiden und auf ein reguläres Gitter umrechnen.
