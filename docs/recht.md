# Impressum, Datenschutz, Login

> Ausgelagert aus `CLAUDE.md` (dort steht, was bereichsübergreifend gilt).

- **Impressum ist Pflicht, nicht Beiwerk** (`Impressum.tsx`, AppView
  `impressum`, `.legal*` in `index.css`): Rechtsrahmen ist DEUTSCHLAND, private
  nicht kommerzielle Seite. **Welche Norm gilt, entscheidet den Umfang, und der
  naheliegende Schluss ist falsch**: § 5 DDG (seit Mai 2024 an der Stelle des
  früheren § 5 TMG) gilt nur für GESCHÄFTSMÄSSIGE, gegen Entgelt angebotene
  Dienste — greift hier nicht. Pflicht ist trotzdem **§ 18 Abs 1 MStV**: Name
  und Anschrift für alle Telemedien, die „nicht ausschließlich persönlichen oder
  familiären Zwecken" dienen, und eine öffentlich erreichbare Wetterseite tut
  das nicht. Nicht kommerziell heißt also NICHT impressumsfrei. § 18 Abs 2 MStV
  (inhaltlich Verantwortlicher) entfällt — kein journalistisch-redaktionelles
  Angebot —, steht aber ausdrücklich im Text, weil es sonst die Rückfrage ist.
  **KEINE Postadresse des Anbieters steht im Quellcode** — und das gilt auch
  für die einer IMPRESSUMSVERTRETUNG, nicht nur für eine Wohnadresse: das
  Repository ist öffentlich, die Pflichtangabe gehört auf die ausgelieferte
  Seite, aber nicht in einen öffentlichen Git-Verlauf, aus dem man sie nur mit
  einem History-Rewrite wieder herausbekommt (und bis dahin kann geforkt oder
  gespiegelt sein). Name, Zustellzusatz, Straße, Ort und E-Mail kommen erst
  beim BAUEN herein (`VITE_IMPRESSUM_NAME`/`_CAREOF`/`_STREET`/`_CITY`/
  `_EMAIL`, typisiert in `src/env.d.ts`): lokal aus `.env.local` (gitignored
  über `*.local`, Vorlage `.env.example`), im Deploy aus der
  REPOSITORY-Konfiguration (`IMPRESSUM_*`, eingesetzt in `deploy.yml`).
  **Dort werden `vars` UND `secrets` gelesen** (`${{ vars.X || secrets.X }}`),
  mit Vorrang für `vars` — absichtlich beides: sachlich richtig sind
  VARIABLES, weil die Adresse ohnehin veröffentlicht wird und Variables sich
  im UI ANSEHEN lassen; Secrets sind schreib-nur, man sieht nicht, ob und was
  gesetzt ist, und genau daran war nicht zu erkennen, warum das Feld leer
  blieb. Der Fallback bleibt, weil die beiden Reiter im UI nebeneinander
  liegen. **Wichtig: REPOSITORY-Ebene, nicht Environment** — der Build-Job hat
  keine Environment-Bindung (nur der Deploy-Job hat eine), unter
  Settings → Environments → github-pages eingetragene Werte sieht er NICHT.
  Das ist die naheliegende Verwechslung, „this environment has no variables"
  ist genau dieser Irrweg. Im fertigen
  Bundle stehen sie im Klartext — richtig so, eine Pflichtangabe muss lesbar
  sein; verborgen werden sie nur vor dem Repository. **Ein LEERER Wert zählt als FEHLEND, nicht als
  Angabe** (`given()` in `config/impressum.ts`, mit Tests) — der Unterschied zu
  `??` hat live geschadet: ein NICHT GESETZTES GitHub-Secret kommt als LEERER
  STRING an (`${{ secrets.FOO }}` expandiert zu `''`), nicht als `undefined`.
  Mit `??` rendert das Impressum dann ein leeres Adressfeld UND unterdrückt die
  Warnung, weil `''.includes('⟨')` falsch ist; die Selbstdiagnose war damit
  blind für genau ihren Anwendungsfall, und so ging sie am 2026-09-16 auf
  meteojunkie.com live. Die Angaben liegen deshalb in `config/impressum.ts`
  statt in der Komponente: `Impressum.tsx` darf für React Fast Refresh nur
  Komponenten exportieren, und geprüft werden kann die Regel nur als reine
  Funktion. Fehlt eine Angabe, baut
  die Seite trotzdem und zeigt SELBST eine Warnung (`DETAILS_MISSING`), aber
  **NUR im Dev-Build** (`import.meta.env.DEV`): auf der ausgelieferten Seite
  hat der Hinweis nichts zu suchen, er nennt interne Variablennamen und
  richtet sich an den Entwickler, nicht an den Leser eines Impressums. Im
  Produktions-Bundle entfernt Vite ihn als toten Code (geprüft: 0 Vorkommen).
  Die PLATZHALTER (`⟨Name⟩` …) bleiben in BEIDEN Builds — sie sind das
  eigentliche Signal und brauchen keine Erklärung. —
  dieselbe Regel wie beim Preset-Laden: Fehlendes wird nie still übergangen.
  `_CAREOF` ist optional und löst keine Warnung aus (nicht jeder Anbieter hat
  eine Vertretung); eine Kundennummer darin gehört ZUR Adresse, ohne sie kommt
  dort keine Post an. **Und genau daran ist sie verschwunden**: in einer
  `.env`-Datei beginnt ein ungeschütztes `#` einen KOMMENTAR, aus
  `VITE_IMPRESSUM_CAREOF=c/o Autorenglück #91443` wurde still
  „c/o Autorenglück". Werte mit `#` gehören dort in Anführungszeichen — in
  GitHub Variables/Secrets gilt die Kommentarregel NICHT, dort wird das Feld
  genommen, wie es dasteht (ohne Quotes). Steht in `.env.example`. Geprüft: ohne Secrets kommt die Anschrift im Bundle
  nicht vor (nur der Warntext), mit Secrets schon. **Der Preis der Trennung**:
  was die Seite als Anschrift zeigt, steht nicht mehr im Code, sondern in der
  Deploy-Konfiguration — ein falsch GESETZTES Secret ersetzt sie still, ohne
  dass ein Diff es zeigt; dagegen hilft nur ein Blick auf die ausgelieferte
  Seite nach dem Deploy.
  **Bewusst KEINE einzelne Landes-Aufsichtsbehörde genannt**: Art. 77 DSGVO
  eröffnet die Beschwerde bei der Behörde des Aufenthalts, des Arbeitsplatzes
  ODER des Orts des Verstoßes, eine bestimmte zu benennen ist Praxis, aber
  nicht vorgeschrieben. Die Zuständigkeit folgt der tatsächlichen
  Niederlassung, NICHT der Zustelladresse — eine nach der Zustelladresse
  gewählte Behörde wäre die falsche, und die richtige hätte das Bundesland
  verraten, das die Vertretung gerade verdeckt. Verlinkt ist die Liste des
  BfDI. **Kein Werkzeug-Tab**, sondern ein
  stiller Link, seit 2026-11-02 FEST UNTEN RECHTS in jedem Bereich
  (`LegalCorner` in `AppNav.tsx`, `.legal-corner`, auf Wunsch — vorher am
  rechten Rand der Navigationsleiste; die Startseite hat ihn in der
  Fußzeile): gleichrangig neben Meteogramm und Klimakarte wäre
  falsch, schwer erreichbar wäre rechtswidrig („leicht erkennbar, unmittelbar
  erreichbar und ständig verfügbar").
  Inhaltlich ist der PFLICHTBLOCK der uninteressante Teil — der wichtige ist
  der **Haftungshinweis**: die Seite zeigt rohe Modellausgaben und ist kein
  Warndienst, für sicherheitsrelevante Entscheidungen gelten die amtlichen
  Warnungen (verlinkt: DWD, GeoSphere, MeteoSchweiz, lawinen.report). Deshalb
  hebt `.legal-emph` ihn hervor statt ihn ins Kleingedruckte zu setzen; dazu
  die Linkhaftung nach §§ 7–10 DDG.
  Die **Datenschutzerklärung ist AUS DEM CODE abgeleitet**, nicht aus einem
  Generator: keine Cookies/Tracker/Fremdfonts (geprüft), Hosting GitHub Pages
  (USA-Übermittlung, Art. 6 Abs 1 lit. f), der Browser kontaktiert
  `open-meteo.com` und `hub.geosphere.at` DIREKT — IP, Koordinaten und
  Suchbegriffe gehen dorthin, der Preis dafür, dass es keinen eigenen
  Zwischenserver gibt. MOSMIX dagegen nicht (Ingest im Build). **IndexedDB und
  localStorage brauchen eine Begründung, kein Banner**: sie fallen unter
  § 25 Abs 2 Nr. 2 TDDDG (unbedingt erforderlich) — ohne die Caches belastete
  jeder Handgriff die Kontingente der Datenanbieter erneut; das ist genau das
  Argument und steht so im Text. Aufsichtsbehörde folgt dem Sitz des
  Verantwortlichen (Konstante `DPA`).
  Der einzige Bereich mit FLIESSTEXT: `.legal-body` setzt die Grundschrift von
  12 auf 14 px hoch und deckelt die Satzbreite auf 78ch — die Dichte der
  Workbench ist für Prosa falsch. Ein Scroll-Container, wie in der Verifikation.
- **Die Seite steht hinter einem gemeinsamen LOGIN** (seit 2026-11-05, auf Wunsch,
  Freundeskreis; `worker/auth.ts` mit Tests): ein Benutzername, ein Passwort, signierter
  Cookie für 30 Tage ohne Serverzustand. Worker-Secrets `SITE_USER`, `SITE_PASSWORD`,
  `SESSION_SECRET`, gesetzt mit `wrangler secret put`, nicht im Repo; **fehlt eines, bleibt
  die Seite zu (503)**. Ein neues Passwort meldet alle ab. Im Worker statt in der App,
  sonst wären die Daten in R2 direkt abrufbar; das deckt auch die workers.dev-Adresse ab.
  `assets.run_worker_first` ist dafür Pflicht. **Der Check steht VOR jedem Cache-Zugriff**.
  **Ohne Login bleiben `/impressum` und `/assets/`**: ein Freundeskreis ist nicht
  „ausschließlich persönlich oder familiär" (§ 18 MStV), und die Seite braucht dafür ihre
  Programmdateien; die enthalten keine Daten (CARTO-Key ausgenommen), und der Quellcode
  ist ohnehin öffentlich. `impressum.html` ist eine zweite Vite-Seite mit derselben
  Komponente. `npm run dev` hat keinen Login, das läuft nur im Worker. Bewusst nicht
  Cloudflare Access: das meldet je E-Mail-Adresse an, gewünscht war ein Sammellogin.
  GitHub Actions und die GPU laden direkt nach R2, der Cron läuft im Worker; beides geht
  nicht über den Login. **Kein Besucherzähler mehr**, GoatCounter ist seit demselben Tag
  raus (auf Wunsch).
