# Oberfläche und Navigation

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **„Punktprognosen" ist in der veröffentlichten Version AUSGEBLENDET**
  (`POINT_FORECASTS_ENABLED` in `config/features.ts`, gesetzt über
  `VITE_ENABLE_POINT_FORECASTS=false` in `npm run build:web`): der Bereich hat
  sich neben klassischem Meteogramm, Ensemble, Vertikalprofil und Verifikation
  nicht als eigener Nutzen gezeigt — dieselben Punktabfragen, nur mit mehr
  Bedienung davor. **NICHT gelöscht, sondern abgeschaltet**, und das ist
  wichtig: Ensemble und Vertikalprofil teilen sich seine sechs
  `PanelConfig`s, die gespeicherten Presets und das Layout je Bereich hängen
  daran, und die KARTE ist nur von hier aus erreichbar. Ein Entfernen hätte
  all das mitgerissen. Anders als bei der Karte (`MAP_ENABLED`, dort ein
  ausgegrauter Eintrag mit Hinweis) fällt er VOLLSTÄNDIG aus der Navigation —
  ein deaktivierter Menüpunkt wirft die Frage auf, was da fehlt. Im Web-Build
  ist die Bedingung wegoptimiert, dort steht unbedingt
  `TABS.filter((t) => t.id !== 'workbench')` (im Bundle verifiziert); der
  volle Build behält den Eintrag. Dazu zwei Folgeänderungen: der
  **Startbereich ist jetzt `classic`** statt `workbench` — sonst startete die
  Seite in einem Bereich, den ihre Navigation nicht zeigt —, und `App.tsx`
  hat einen Rückfall, falls `workbench` trotzdem im Zustand steht.
  Wiedereinschalten ist das Entfernen einer Umgebungsvariable aus
  `build:web`.
- **STARTSEITE UND MENÜ NACH DER FRAGE** (seit 2026-11-02, auf Wunsch;
  `LandingPage.tsx`, Animation `render/heroWind.ts` mit Tests, Registry
  `config/navigation.ts` — EINE Liste für Navigation UND Kacheln). Start ist
  die Startseite (`AppView 'home'`), das Logo „meteojunkie" links in der
  Leiste führt dorthin. Gruppen: **Vorhersage** (Meteogramm, Modellkarten,
  Ensemble, Soundings, Föhn, MOS) · **Beobachtung** (Radar, Satellit,
  Klima, Luftqualität) · **Auswertung** (Verifikation). Dafür sind **Klima
  und MOS zwei Bereiche** (`at-klima`, `mos`, gemeinsames Gerüst
  `AtSection mode=…`) statt eines mit Umschalter. Oben auf der Startseite
  der 10-m-Wind des AKTUELLEN IFS-Laufs als Partikel über Europa — eigenes
  Canvas ohne MapLibre (die Seite soll sofort stehen), Mercator füllend,
  Bewegung über die Zeit, eingefärbt nach Tempo; ein Windfeld (~0,3 MB) über
  denselben Lader wie die Modellkarten. Ohne Lauf ein Ersatzfeld OHNE
  Laufangabe (es ist keine Vorhersage) — NUR beim Ladefehler, bis zum
  Laden stehen nur Küsten und Grenzen da, die Partikel blenden danach ein
  (als Platzhalter zeigte die Liveseite erst ein Sturmtief, das dann in die
  echte Lage umsprang), bei `prefers-reduced-motion` ruhende
  Stromlinien.
  **UNTERGRUND: DAS AKTUELLE GEOCOLOUR-BILD** (seit 2026-11-02, auf
  Wunsch; `render/heroBase.ts` mit Tests): unter der Strömung das neueste
  MTG-Geocolour aus dem R2-Vorrat, alle 10 min neu. **Der Termin kommt aus
  `sat/geocolour/latest.json`**, das der Satelliten-Cron schreibt (neuester
  Termin mit BEIDEN Stufen im Vorrat), erst die Vorschau, dann das scharfe
  Bild — gemessen ~0,5 s bei leerem Cache, drei Abrufe same-origin. Vorher
  kam der Termin aus dem Capabilities von EUMETView: das nannte oft einen
  Termin, den der Vorrat noch nicht hatte, und EUMETView renderte das
  scharfe Bild dann auf Anfrage (1 bis über 10 s, „lädt manchmal sehr
  langsam"). Nur ohne `latest.json` noch der alte Weg (`loadSatelliteImage`,
  jüngster Termin, sonst bis zu zwei ältere). Geocolour bringt Tag UND Nacht selbst mit — tags
  Echtfarben samt Schnee, wo es wolkenfrei ist, nachts Infrarotwolken über
  den Stadtlichtern — und liegt auf genau dieser Fläche (`SATELLITE_AREA` =
  `GROUND_BOUNDS`). Abgedunkelt um 0,4, sonst stehen die weißen Partikel auf
  weißen Wolken. Quellenzeile nennt EUMETSAT samt Termin.
  **RÜCKFALL nach 6 s ohne Satellitenbild**: Blue Marble (Tag) und Black
  Marble 2016 (Nacht, `src/mapdata/europe-night.jpg`, 449 KB,
  `build:ground`, deckungsgleich) mit der Dämmerungslinie je Bildpunkt nach
  dem Sonnenstand (−6° … +4°); Bilder nur, wenn die Ansicht sie braucht.
  Die Wartezeit, damit er beim normalen Laden nicht kurz aufblitzt.
  **Eine Vorstufe (verworfen) legte auf Blue Marble den aktuellen Schnee**:
  Blue Marble gibt es in GIBS nur in EINER Fassung (Jänner/Juli/November
  byte-gleich, Sommerstand), und MODIS-NDSI allein taugt nicht — Wolken sind
  dort durchsichtig, über sechs Tage Terra + Aqua stand Anfang November ganz
  Süd-Schweden weiß, wo IFS und ICON-EU 0 cm führten. Mit ICON-EU als Maske
  ging es (IFS 0,25° nicht: Alpen 2,4 % gegen 26,7 % Schnee), mit Geocolour
  vorn war es überflüssig. Im Dev-Build: `?base=fallback`, `?t=…`.
  **Auf der Startseite KEINE Navigationsleiste** (auf Wunsch):
  darunter stehen DREI SÄULEN (Vorhersage · Beobachtung · Auswertung), deren
  Bereiche beim Überfahren/Antippen NACH OBEN über das Windbild aufpoppen
  (halbtransparent, zweispaltig) — eine erste Fassung klappte nach unten auf
  und schob die Hälfte unter den Fensterrand; auf dem Handy (Säulen
  untereinander) klappen sie im Fluss nach unten. **Das Impressum steht dort
  unten als Link** (§ 18 MStV: aus jeder Seite erreichbar). Der Eintrag
  „Modellkarten" nennt die aktuellen Läufe von IFS, ICON-D2 und Varda.
- **Eigene Bereiche statt Panel-Modi** (`state/appView.ts`, `AppNav`).
  **Die Reihe ist GRUPPIERT, und die Farbe trägt die Gruppe** — bei acht
  Bereichen ist eine gleichförmige Knopfreihe eine Liste, die man jedes Mal neu
  liest:
  **mint** Meteogramm (`classic`) · Modellkarten (`globe`) · Klima + MOS
  (`at-klima`) · Ensemble · Soundings (`profile`) · Föhn — Zahlenwerke aus
  Modell- und Messreihen;
  **ocker** Radar · Satellit — fertige Karten fremder Dienste, Zeitschleife
  statt Zeitraster, kein Open-Meteo-Budget;
  **rot** Verifikation — der einzige Bereich, der ZURÜCKschaut und die übrigen
  bewertet;
  **lila** Luftqualität (`air`) — ein anderes Thema (Schadstoffe statt
  Wettergrößen), mit Modell UND Messung, deshalb abgesetzt rechts neben der
  Verifikation (auf Wunsch; #b48cf0, Kontrast nachgerechnet 4,9/5,4/5,1:1).
  **Die Gruppen sind AUFKLAPPBAR** (seit 2026-10-19, auf Wunsch): je Gruppe
  ein Kategorieknopf — „Vorhersage + Klima" (Meteogramm, Modellkarten,
  Klima + MOS, Ensemble, Soundings, Föhn) und „Analyse" (Radar, Satellit);
  Verifikation und Luftqualität stehen EINZELN (eine Gruppe mit nur einem
  Bereich ist einfach ihr Knopf). Die Bereiche klappen in DERSELBEN Zeile
  auf, der Rest rutscht nach rechts — ANIMIERT über ein Gitter mit einer
  Spalte 0fr ↔ 1fr (`.appnav-items`; animiert auf die echte Inhaltsbreite,
  ohne zu messen; zugeklappt `inert`, damit Tab die unsichtbaren Knöpfe nicht
  erreicht; `prefers-reduced-motion` schaltet ab). **Aufgeklappt wird beim
  Überfahren UND per Klick/Tipp, ZUGEKLAPPT NUR per Klick auf den
  Kategorieknopf** (auf Wunsch — zwei Vorstufen klappten beim Verlassen zu:
  fuhr man Richtung „Analyse", fiel „Vorhersage + Klima" hinter einem
  zusammen und alles rutschte). Mehrere Gruppen dürfen gleichzeitig offen
  sein. Touch löst vor dem Klick ein `mouseenter` aus — ein Klick binnen
  `HOVER_CLICK_GRACE_MS` nach dem Öffnen zählt deshalb nicht als Zuklappen,
  geprüft IM State-Updater (im gerenderten Stand ist das Öffnen beim Tipp noch
  nicht angekommen; so war es zuerst falsch). Zugeklappt nennt der
  Kategorieknopf den offenen Bereich („Vorhersage + Klima | Meteogramm").
  14 px Abstand (`.appnav-group.is-group-start`). Sind beide Gruppen offen,
  bricht die Reihe auf schmalen Fenstern um.
  `NavGroup` setzt nur `--nav`, alles Weitere leitet sich daraus ab.
  **Die Farbe liegt auf JEDEM Tab, nicht nur auf dem aktiven** — sie ordnet die
  Reihe in Blöcke, und das tut sie nur, wenn man sie durchgehend sieht. Die
  Zustände unterscheiden sich deshalb über die INTENSITÄT: ruhig gefärbt →
  beim Überfahren deutlich kräftiger (Text ins Helle, volle Unterkante) →
  aktiv am kräftigsten plus Schein nach innen. Der aktive Tab trägt DREI
  Merkmale (Farbe, getönte Fläche, Unterkante), damit die Reihe auch ohne
  Farbunterscheidung benutzbar bleibt; die transparente Unterkante der übrigen
  hält die Reihe beim Wechseln ruhig. **Die Mischungen sind nachgerechnet,
  nicht geschätzt**: der Textkontrast liegt bei 4,6–5,5:1 (Ruhe) und
  5,0–5,4:1 (hover/aktiv). Zwei Werte fielen durch und wurden korrigiert — das
  Rot der Fehlermeldungen (#e0645a) kam ruhend nur auf 4,0:1 und ist hier
  deshalb heller (#e8776c), und der aktive Text musste weiter ins Weiß, weil
  die kräftigere Fläche ihn sonst auf 3,7:1 drückte. `color-mix` trägt überall
  einen Rückfall auf die volle Gruppenfarbe: fällt es aus, ist die Farbe
  lieber zu kräftig als weg.
  Punktprognosen (`workbench` — der frühere „Meteogramm"-Bereich, nur
  umbenannt) steht am ENDE der Registry: in der veröffentlichten Version fällt
  es ohnehin heraus (`POINT_FORECASTS_ENABLED`), im vollen Build ist es der
  Werkzeugkasten hinter den fertigen Bereichen. Die Tabs sind bewusst GRÖSSER
  als der Rest der Leiste (7/16 px, 14 px fett) — sie sind das meistbenutzte
  Bedienelement der Seite und waren kleiner als jeder Dropdown daneben; die
  Leiste darf dafür umbrechen. Ensemble und Profil waren früher Panel-MODI und sind jetzt
  eigene Bereiche — `PanelMode` kennt nur noch `'meteogram' | 'map'` (Panel
  zeigt Linienchart vs. Feld-Karte — ACHTUNG, andere Bedeutung als die
  AppView-Id `classic`; deshalb bewusst NICHT `'meteogram'` als AppView-Id
  benutzt, das wäre mit `PanelMode` verwechselbar gewesen). Die drei
  Panel-Bereiche teilen sich DIESELBEN sechs
  `PanelConfig`s: die Felder für Meteogramm (`models`/`variable`), Ensemble
  (`ensembleModel`/`ensembleVariable`) und Profil (`models`) sind ohnehin
  getrennt, ein Bereichswechsel verliert also nichts. Was gezeichnet wird,
  entscheidet `Panel.tsx` am Bereich, nicht mehr am Modus. Ältere Presets mit
  `mode: 'ensemble'|'profile'` werden NICHT verworfen: `restorePanel` lädt sie
  als Meteogramm und sagt es im `presetWarning`.
