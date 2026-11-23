# Varda (KI, 1 km)

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

  **VARDA (KI, 1 km) ist seit 2026-11-02 das fünfte Modell — und das einzige,
  das hier GERECHNET statt geholt wird** (`scripts/varda-ingest.py`, npm
  `ingest:varda`, Modell `varda`): MeteoSwiss' Varda-single-1.0 (Anemoi,
  Graph Transformer auf Stretched Grid, global 31 km, 1 km über dem
  ICON-CH1/KENDA-Gebiet 42,0–50,5° N / 0,8° W–17,7° O — ganz Österreich, Wien
  ~1° vor dem Ostrand; Gewichte CC BY 4.0 auf Hugging Face). Startwerte
  MeteoSwiss KENDA-CH1 (STAC data.geo.admin.ch, erscheint 2–2¾ h nach dem
  Termin) plus ECMWF Open Data. **Gerechnet auf der Laptop-GPU per
  systemd-Benutzertimer** (`scripts/systemd/varda-ingest.*`, eingerichtet
  über `install-varda.sh`, Linger an, Läufe 00/06/12/18 UTC um
  02:50/08:50/14:50/20:50 UTC — die 6-h-Analysen erscheinen sehr regelmäßig
  2:43–2:45 h nach dem Termin (gemessen 2026-11-09 an den STAC-Zeitstempeln),
  kommt eine später, wartet `varda-cron.sh` bis zu 45 min auf sie, sonst fiele
  der Termin aus —, `Persistent` holt nach; seit 2026-11-03 WECKT ein System-Timer den Laptop
  aus der Bereitschaft (`varda-wake.*`, `sudo scripts/systemd/
  install-varda-wake.sh` — ein Benutzer-Timer darf mit `WakeSystem` nicht
  wecken): 2 min vorher geweckt, bis 10 min aufs WLAN gewartet (ohne Netz
  kein Lauf), gerechnet unter einer Sperre gegen Bereitschaft und
  Deckelschalter (geweckt mit geschlossenem Deckel legt logind ihn sonst nach
  ~30 s wieder schlafen), danach zurück in die Bereitschaft — nur wenn der
  Timer geweckt hat und die Sitzung gesperrt ist (`LockedHint`)) und von dort SELBST nach R2 geladen
  (`scripts/varda-cron.sh` → `upload-data.sh nwp/varda`, Zugangsdaten in
  `~/.config/meteojunkie/varda.env`) — GitHub Actions hat keine GPU, und der
  Deploy fasst `nwp/varda` nicht an (seine Liste nennt die Modelle einzeln).
  Modell-Repository samt zwei uv-Umgebungen liegt in `~/varda-test`
  (`VARDA_HOME`), Zwischendateien in `/var/tmp/varda-run` auf `/`.
  **Drei Abweichungen von den Vorgaben des Modell-Repositorys, alle gemessen
  nötig**: PyTorch cu128 statt cu124 (RTX 5090 = sm_120), Ein-GPU-Runner statt
  `runner.parallel` (sonst „Default process group has not been initialized"),
  `libgfortran5` für ECMWFs MIR. Gemessen (RTX 5090 Laptop 24 GB): Vorhersager
  +120 h 3,6 min (davon ~1 min GPU, 3 s je 6-h-Schritt, Spitze 18,5 GB),
  Downscaler stündlich, KENDA-Download bei leerem Cache ~2,5 GB.
  **Das 1-km-Gitter ist unstrukturiert (ICON), die Koordinaten stehen NICHT im
  GRIB**, sondern im Checkpoint (`load_metadata(…, supporting_arrays=True)`,
  `source0/latitudes` unter `lam_0/cutout_mask`). Umgerechnet wird linear über
  eine Delaunay-Triangulierung auf 0,01° (1851×844, Gewichte einmal gerechnet
  und in `VARDA_HOME` gecacht), > 1,5 km vom nächsten Modellpunkt = außerhalb.
  **Der Downscaler schreibt nur die Kartenfelder** (`variables` in der
  erzeugten `downscaler.yaml`): ungefiltert sind es 67 Felder, ~160 MB GRIB je
  Stunde, ~20 GB über 120 h; jede Datei wird nach dem Lesen gelöscht. Bei +0
  fehlt die Niederschlagssumme in der Ausgabe und wird als 0 gesetzt.
  Größen: T2m, T850, T700, Bodendruck, Niederschlag (Rate/Summe), Wind 10 m,
  850, 700 und 300 hPa (+Partikel), 500/300 hPa, Relative Topografie, Taupunkt,
  rF 700 hPa (aus q und T gerechnet), Nullgradgrenze (`zero_level`: aus T und
  Höhe auf 1000/925/850/700/500 hPa, linear in der Höhe, oberster Durchgang wie
  HZEROCL). **KEINE VERTIKALBEWEGUNG UND KEIN 600 hPa**, gemessen an der Ausgabe
  (2026-11-09): 12 Flächen 50–1000 hPa mit FI, QV, T, U, V. Die Metadaten des
  Checkpoints nennen `w_*` und 600 hPa, das sind die Trainingsdaten — nicht daraus
  ableiten. **KEINE Bewölkung, Böen, CAPE, Schnee** — die
  Auswahl sperrt sie über meta.json. ~3,9 MB Bilder je Stunde, ~470 MB je
  Lauf. `nwp_common.ingest` kennt dafür `only`/`optional` (ein Modell mit nur
  einem Teil der Größen). Quellenzeile sagt „gerechnet auf eigener Hardware —
  keine offizielle MeteoSwiss-Vorhersage". Laufalter-Warnung ab 18 h.
