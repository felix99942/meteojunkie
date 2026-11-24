# TAWES

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **TAWES** (seit 2026-11-12, auf Wunsch; AppView `tawes`, Gruppe Beobachtung; `TawesPanel.tsx`,
  `TawesStationDetail.tsx`, Registry `config/tawesParameters.ts`, Kern `config/tawesValues.ts` mit
  Tests) — alle Messgrößen der österreichischen Wetterstationen im 10-Minuten-Takt über die letzten
  72 h, als EIGENER Bereich neben der Klimakarte: die fragt „wie war der Zeitraum gegen das Normal",
  dieser „was misst das Netz jetzt". Die Jetzt-Werte der Klimakarte bleiben dort (tagesaktuelle
  Statistik). Eigene Registry statt `atParameters.ts`, weil Normal, Abweichung und Monatsaggregat
  hier keinen Sinn haben und Druck, Boden, Strahlung dort keinen Gegenpart. Daten aus denselben
  R2-Dateien wie die Klimakarte, je Größe erst beim Auswählen geladen, alle 5 min erneuert.
  **Zeitfenster wählbar NUR beim Niederschlag** (auf Wunsch): 10 min · 1 h · 3 h · 6 h · 12 h ·
  24 h · 48 h · 72 h · 96 h (6/72/96 h seit 2026-11-24), Summe und Regendauer. Je Fenster eigene
  Farbstufen (`precipScale` in `colorscales.ts`): Rot auf DWD „markant", Lila auf „Unwetter" des
  Zeitraums (1 h 15/25, 6 h 20/35, 12 h 25/40, 24 h 30/50, 48 h 40/60, 72 h 60/90 mm; 96 h hat
  kein DWD-Kriterium, 70/100 sind fortgeschrieben). Der Speicher trägt 120 h, die Zeitleiste
  72 h: eine Summe gibt es nur, wenn ihr GANZES Fenster im Speicher liegt (`stationValue`,
  `from < 0` → kein Wert, keine zu trockene Teilsumme) — 96 h also nur für die letzten 24 h der
  Zeitleiste, 72 h für die letzten 48 h. Davor sagt die Kopfzeile „96 h-Summe erst ab …". **Die Fenster stehen als eigene Einträge in der Größen-Liste** („Niederschlag 3 h" … „96 h", Wert
  `key:steps`), nicht mehr in einem zweiten Feld „Summe über": das erschien erst nach der Wahl von
  „Niederschlag" und wurde übersehen (gemeldet 2026-11-24). Alle übrigen Größen haben ihr festes Fenster im Namen („Spitzenböe 24 h").
  **Höchst- und Tiefstwerte gelten für den SYNOPTISCHEN Zeitraum** (auf Wunsch,
  `synopticWindow`/`synopticPeriods`): Maximum 06–18 UTC, Minimum 18–06 UTC (2 m und 5 cm).
  Liegt der Termin im Zeitraum, ist es der Wert bisher („● läuft noch"), sonst der zuletzt
  abgeschlossene. Der Wert mit Zeitstempel 06:00 gilt für 05:50–06:00 und gehört zur Nacht. Für
  diese Größen springt die Zeitleiste in den TAGESMODUS: ein Knopf je Tag bzw. Nacht, so viele
  der Speicher trägt (5), ←/→ wechselt den Zeitraum.
  **Lückenregel** (`minPresent`): eine Summe braucht drei Viertel der Termine, auch über eine
  Stunde — mit Lücke sähe sie trockener aus. Maxima über ≤ 1 h die Hälfte.
  **`pred` IST NICHT ÜBERALL MEERESNIVEAU** (gemessen 2026-11-12): GeoSphere reduziert nur die
  ~170 tieferen Stationen auf Meereshöhe, die Bergstationen liegen unter demselben Namen bei ~830
  bzw. ~787 hPa (Bezugshöhe). Die Karte nimmt deshalb nur 900–1080 hPa; Drucktendenz und
  24-h-Änderung kommen aus dem Stationsdruck `p`, der überall gilt. Weitere Funde: `sh` meldet
  vereinzelt negative Werte (verworfen), `chim` messen nur vier Stationen, `tb50` an Station 39
  steht fest auf 27,8 °C (nicht gefiltert — keine allgemeine Regel dafür).
  Nicht übernommen: `zeitx` (Uhrzeit der Spitzenböe, als Karte ohne Aussage). Taupunkt und
  gefühlte Temperatur werden aus `tl`/`rf`/`ff` gerechnet. Klick auf eine Station: alle Größen
  der Station über 72 h als Diagrammstapel, Termin der Karte als Linie.
