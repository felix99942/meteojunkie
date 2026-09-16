// Impressum / Anbieterkennzeichnung — eigener Bereich, erreichbar über den
// kleinen Link am rechten Ende der Bereichs-Navigation (KEIN Werkzeug-Tab: das
// Impressum beantwortet keine Wetterfrage und gehört nicht in die Reihe mit
// Meteogramm und Klimakarte, muss aber „leicht erkennbar, unmittelbar
// erreichbar und ständig verfügbar" sein — also aus jedem Bereich ein Klick).
//
// Rechtsrahmen: DEUTSCHLAND, private nicht kommerzielle Website.
//
// Welche Norm gilt, ist hier nicht Formalie, sondern entscheidet den Umfang:
//
//   § 5 DDG (Digitale-Dienste-Gesetz, seit 14.05.2024 an der Stelle des
//     früheren § 5 TMG) gilt nur für GESCHÄFTSMÄSSIGE, in der Regel gegen
//     Entgelt angebotene digitale Dienste → greift hier NICHT (kein Entgelt,
//     keine Werbung, keine Einnahmen).
//
//   § 18 Abs 1 MStV (Medienstaatsvertrag) gilt dagegen SCHON: er verlangt Name
//     und Anschrift von jedem Anbieter von Telemedien, die „nicht
//     ausschließlich persönlichen oder familiären Zwecken" dienen. Eine
//     öffentlich erreichbare Wetterseite dient das nicht — die Angabe ist also
//     Pflicht, nicht Kulanz. Das ist der häufige Irrtum bei privaten Seiten:
//     nicht kommerziell heißt nicht impressumsfrei.
//
//   § 18 Abs 2 MStV (zusätzlich ein inhaltlich Verantwortlicher) betrifft
//     journalistisch-redaktionelle Angebote. Diese Seite stellt Modelldaten
//     dar und verbreitet keine redaktionellen Beiträge → entfällt, steht aber
//     ausdrücklich dabei, weil es sonst die naheliegende Rückfrage ist.
//
// Der substantielle Teil dieser Seite ist NICHT der Pflichtblock, sondern der
// HAFTUNGSHINWEIS zu den Wetterdaten: die Seite stellt rohe Modellausgaben
// nebeneinander (genau das ist ihr Zweck) und ist ausdrücklich kein Warndienst.
// Wer Modelle vergleicht, sieht, wie weit sie auseinanderliegen — das ist der
// ehrlichste mögliche Unsicherheitshinweis, ersetzt aber keine amtliche
// Warnung.
//
// Der Datenschutzteil ist AUS DEM CODE abgeleitet, nicht aus einem Generator:
// keine Cookies und keine Tracker (nachgeprüft), aber der Browser kontaktiert
// die Datenanbieter DIREKT — das ist eine Übermittlung und gehört genannt.

import { buildLabel, buildTitle } from '../config/build'
import { DETAILS_MISSING, OWNER } from '../config/impressum'
import { MODELS } from '../config/models'

/** Wetterdienste hinter den Modellen — aus der Registry, nicht gepflegt. */
const PROVIDERS = [...new Set(Object.values(MODELS).map((m) => m.provider))]
  .filter((p) => p !== 'Open-Meteo')
  .sort()

/** Externe Dienste, die der BROWSER direkt kontaktiert (siehe Datenschutz). */
const THIRD_PARTY_HOSTS = [
  {
    host: 'open-meteo.com',
    what: 'Vorhersagen, Ensembles, vergangene Läufe und die Ortssuche',
    href: 'https://open-meteo.com/en/terms',
    hrefLabel: 'Nutzungsbedingungen und Datenschutz',
  },
  {
    host: 'hub.geosphere.at',
    what: 'gemessene Stationswerte der österreichischen Klimastationen',
    href: 'https://data.hub.geosphere.at/',
    hrefLabel: 'Data Hub',
  },
  {
    host: 'maps.dwd.de',
    what: 'Radarbilder des Niederschlagsradars (nur im Bereich „Radar")',
    href: 'https://www.dwd.de/DE/service/datenschutz/datenschutz_node.html',
    hrefLabel: 'Datenschutzerklärung des DWD',
  },
]

export function Impressum() {
  return (
    <div className="legal">
      <div className="legal-body">
        <h1>Impressum</h1>

        {/* --- Pflichtangabe § 18 Abs 1 MStV ---------------------------- */}
        <section>
          <h2>Anbieter</h2>
          <address className="legal-address">
            {OWNER.name}
            <br />
            {OWNER.careOf && (
              <>
                {OWNER.careOf}
                <br />
              </>
            )}
            {OWNER.street}
            <br />
            {OWNER.city}
            <br />
            {OWNER.country}
            <br />
            <a href={`mailto:${OWNER.email}`}>{OWNER.email}</a>
          </address>
          {/* NUR im Dev-Build. Auf der ausgelieferten Seite hat dieser Hinweis
              nichts zu suchen: er nennt interne Variablennamen und richtet
              sich an den Entwickler, nicht an den Leser eines Impressums. Als
              Selbstdiagnose bleibt er trotzdem wertvoll — er hat das Fehlen
              der Angaben am 2026-09-16 überhaupt erst sichtbar gemacht.
              Die PLATZHALTER (⟨Name⟩ …) stehen weiter in beiden Builds: sie
              sind das eigentliche Signal und brauchen keine Erklärung. */}
          {DETAILS_MISSING && import.meta.env.DEV && (
            <p className="legal-warn">
              ⚠ <strong>Nur im Dev-Build sichtbar.</strong> Die Angaben des Anbieters
              fehlen: § 18 Abs 1 MStV verlangt Name <em>und</em> Anschrift. Sie stehen
              absichtlich nicht im Quellcode (das Repository ist öffentlich), sondern
              kommen aus <code>VITE_IMPRESSUM_NAME</code>,{' '}
              <code>VITE_IMPRESSUM_STREET</code>, <code>VITE_IMPRESSUM_CITY</code>,{' '}
              <code>VITE_IMPRESSUM_EMAIL</code> und optional{' '}
              <code>VITE_IMPRESSUM_CAREOF</code> — lokal aus <code>.env.local</code>, im
              Deploy aus Repository-Variables bzw. -Secrets.
            </p>
          )}
          <p className="legal-note">
            Angabe nach § 18 Abs 1 Medienstaatsvertrag (MStV).{' '}
            {OWNER.careOf &&
              'Die angegebene Anschrift ist eine Zustelladresse (Impressumsvertretung); Post erreicht den Anbieter nur unter Angabe des oben genannten Zustellzusatzes. '}
            Die Informationspflichten des
            § 5 Digitale-Dienste-Gesetz (DDG, seit Mai 2024 an der Stelle des früheren
            § 5 TMG) bestehen nicht, weil dieses Angebot nicht geschäftsmäßig und nicht
            gegen Entgelt bereitgestellt wird. Ein zusätzlicher
            inhaltlich Verantwortlicher nach § 18 Abs 2 MStV ist nicht zu benennen: die Seite
            stellt automatisiert bezogene Mess- und Modelldaten dar und verbreitet keine
            journalistisch-redaktionellen Beiträge. Eine Umsatzsteuer-Identifikationsnummer
            und eine Registereintragung bestehen nicht.
          </p>
        </section>

        {/* --- Zweck ---------------------------------------------------- */}
        <section>
          <h2>Zweck der Website</h2>
          <p>
            Privates, nicht kommerzielles Projekt: eine Wetter-Workbench, die die frei
            verfügbaren Ausgaben mehrerer numerischer Wettermodelle nebeneinanderstellt, dazu
            Ensembles, Vertikalprofile, eine Föhndiagnose, das österreichische Klimaarchiv und
            eine Verifikation vergangener Vorhersagen gegen gemessene Stationswerte.
          </p>
          <p>
            Keine Werbung, keine Tracker, keine Registrierung, keine Nutzerkonten, keine
            Einnahmen. Es werden keine Inhalte Dritter veröffentlicht und keine Kommentare
            entgegengenommen.
          </p>
        </section>

        {/* --- Der eigentlich wichtige Teil ----------------------------- */}
        <section>
          <h2>Haftungsausschluss — kein Warndienst</h2>
          <p className="legal-emph">
            Diese Seite zeigt <strong>rohe Modellausgaben</strong>, nicht geprüfte
            Wettervorhersagen. Sie ist <strong>kein amtlicher Wetterdienst</strong> und
            ersetzt <strong>keine Unwetterwarnung</strong>.
          </p>
          <p>
            Für sicherheitsrelevante Entscheidungen — Bergtouren, Luft- und Wassersport,
            Bauarbeiten, Veranstaltungen, Einsatzplanung — sind ausschließlich die amtlichen
            Warnungen und Prognosen der nationalen Wetterdienste maßgeblich:{' '}
            <a href="https://www.dwd.de/warnungen" target="_blank" rel="noreferrer">
              Deutscher Wetterdienst
            </a>
            ,{' '}
            <a href="https://warnungen.zamg.at/" target="_blank" rel="noreferrer">
              GeoSphere Austria
            </a>
            ,{' '}
            <a href="https://www.meteoschweiz.admin.ch/" target="_blank" rel="noreferrer">
              MeteoSchweiz
            </a>
            . Für die Alpen zusätzlich die{' '}
            <a href="https://lawinen.report/" target="_blank" rel="noreferrer">
              Lawinenvorhersage
            </a>
            .
          </p>
          <h3>Inhalt dieses Angebots</h3>
          <p>
            Die dargestellten Werte werden automatisiert von fremden Schnittstellen bezogen und
            ohne inhaltliche Prüfung wiedergegeben. Modellausgaben sind punktweise
            interpolierte Gitterwerte: in komplexem Gelände weichen sie systematisch von der
            tatsächlichen Messung ab (die Bereiche „Verifikation“ und „Punktprognosen“ zeigen
            das Ausmaß, und sie machen keinen Hehl daraus). Für Richtigkeit, Vollständigkeit,
            Aktualität und Verfügbarkeit wird keine Gewähr übernommen; eine Haftung für
            Schäden aus der Nutzung dieser Darstellungen ist ausgeschlossen, soweit nicht
            Vorsatz oder grobe Fahrlässigkeit vorliegt oder gesetzlich zwingend gehaftet wird.
          </p>
          <p className="legal-note">
            Die Schwellenwerte der Föhndiagnose sind ausdrücklich Faustregeln und nicht gegen
            gemessene Föhnstunden kalibriert; die Kennzahlen der Verifikation beruhen auf
            kurzen Reihen und erlauben kein Ranking der Modelle. Beides steht auch an den
            betreffenden Stellen in der Oberfläche.
          </p>
          <h3>Externe Links</h3>
          <p>
            Für die Inhalte verlinkter fremder Seiten sind ausschließlich deren Anbieter
            verantwortlich. Zum Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar;
            eine dauerhafte inhaltliche Kontrolle ist ohne konkreten Anlass nicht zumutbar
            (§§ 7 bis 10 DDG). Bei Kenntnis von Rechtsverstößen werden die betreffenden Links
            entfernt.
          </p>
        </section>

        {/* --- Quellen: Lizenzbedingung, nicht Höflichkeit -------------- */}
        <section>
          <h2>Datenquellen und Lizenzen</h2>
          <p>
            Die Namensnennung ist Lizenzbedingung, nicht Höflichkeit. Jeder Bereich trägt
            zusätzlich seine eigene Quellenzeile.
          </p>
          <ul className="legal-list">
            <li>
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>{' '}
              — Vorhersagen, Ensembles, vergangene Läufe, Ortssuche. Lizenz{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.de"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
              . Die Modelldaten selbst stammen von {PROVIDERS.join(', ')}.
            </li>
            <li>
              <a href="https://data.hub.geosphere.at/" target="_blank" rel="noreferrer">
                GeoSphere Austria Data Hub
              </a>{' '}
              — „Stationsdaten-v2“, qualitätsgeprüfte Messwerte österreichischer
              Klimastationen (Tages-, Monats- und 10-Minuten-Werte), sowie{' '}
              <span title="HISTALP: homogenisierte, bruchbereinigte Langzeitreihen des Alpenraums. Wird auf dieser Seite ausschließlich für den Vergleich zweier Klimaperioden verwendet — Absolutwerte, Rekorde und alles Übrige laufen auf den nicht homogenisierten Stationsdaten.">
                HISTALP
              </span>{' '}
              für den Periodenvergleich. Lizenz{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.de"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
              .
            </li>
            <li>
              <a
                href="https://www.dwd.de/DE/leistungen/opendata/opendata.html"
                target="_blank"
                rel="noreferrer"
              >
                Deutscher Wetterdienst, Open Data
              </a>{' '}
              — MOSMIX-Punktvorhersagen, Stationskatalog und das Niederschlagsradar
              (Radarkomposit RV über <code>maps.dwd.de</code>). Nutzung nach{' '}
              <a
                href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html"
                target="_blank"
                rel="noreferrer"
              >
                GeoNutzV
              </a>
              .
            </li>
            <li>
              <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
                Natural Earth
              </a>{' '}
              — Küstenlinien, Staats- und Bundeslandgrenzen der Kartenhintergründe
              (gemeinfrei).
            </li>
          </ul>
          <p className="legal-note">
            Der Quellcode dieser Seite verwendet freie Bibliotheken, darunter{' '}
            <a href="https://maplibre.org/" target="_blank" rel="noreferrer">
              MapLibre GL
            </a>{' '}
            und{' '}
            <a href="https://github.com/leeoniya/uPlot" target="_blank" rel="noreferrer">
              uPlot
            </a>
            ; die jeweiligen Lizenzen liegen im Repository.
          </p>
        </section>

        {/* --- Datenschutz: aus dem Code abgeleitet, nicht behauptet ---- */}
        <section>
          <h2>Datenschutzerklärung</h2>
          <p>
            Die Seite ist eine statische Webanwendung ohne eigenen Anwendungsserver und ohne
            Datenbank. Sie setzt <strong>keine Cookies</strong>, verwendet{' '}
            <strong>keine Analyse-, Werbe- oder Tracking-Dienste</strong> und bindet keine
            externen Schriftarten oder Karten-Kachel-Dienste ein. Es werden keine
            Nutzerkonten geführt und keine Eingaben gespeichert.
          </p>

          <h3>Verantwortlicher</h3>
          <p>
            Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO ist der oben genannte Anbieter.
            Anfragen zum Datenschutz bitte an{' '}
            <a href={`mailto:${OWNER.email}`}>{OWNER.email}</a>.
          </p>

          <h3>Hosting und Zugriffsdaten</h3>
          <p>
            Ausgeliefert wird über{' '}
            <a
              href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Pages
            </a>{' '}
            (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA). Beim
            Abruf verarbeitet der Hoster technisch notwendige Zugriffsdaten einschließlich der
            IP-Adresse; Rechtsgrundlage ist Art. 6 Abs 1 lit. f DSGVO (berechtigtes Interesse
            an der sicheren und funktionsfähigen Bereitstellung). Auf diese Protokolldaten
            besteht kein Zugriff durch den Anbieter — es werden keine Server-Logfiles
            ausgewertet. Da der Dienst in den USA betrieben wird, kann eine Übermittlung in ein
            Drittland stattfinden; GitHub stützt sie nach eigener Angabe auf den
            Angemessenheitsbeschluss zum EU-U.S. Data Privacy Framework bzw. auf
            Standardvertragsklauseln (Einzelheiten in der verlinkten Datenschutzerklärung).
          </p>

          <h3>Abrufe bei Dritten</h3>
          <p>
            Die Wetter- und Klimadaten werden <strong>direkt vom Browser</strong> bei den
            Anbietern geholt — bewusst ohne Zwischenserver, damit keine Nutzungsdaten an
            zusätzlicher Stelle anfallen. Der Preis dafür ist, dass die Anbieter dabei
            zwangsläufig die IP-Adresse sowie die angefragten Koordinaten, Stationen und
            Suchbegriffe erfahren. Rechtsgrundlage ist Art. 6 Abs 1 lit. f DSGVO; ohne diese
            Abrufe kann die Seite ihre Funktion nicht erfüllen.
          </p>
          <ul className="legal-list">
            {THIRD_PARTY_HOSTS.map((h) => (
              <li key={h.host}>
                <code>{h.host}</code> — {h.what} (
                <a href={h.href} target="_blank" rel="noreferrer">
                  {h.hrefLabel}
                </a>
                )
              </li>
            ))}
          </ul>
          <p className="legal-note">
            Die MOSMIX-Punktvorhersagen des Deutschen Wetterdienstes werden nicht im Browser
            geholt, sondern beim Bauen der Seite vorverarbeitet und wie eine eigene Datei
            ausgeliefert. Die Radarbilder dagegen holt der Browser direkt bei{' '}
            <code>maps.dwd.de</code> — sie sind minutenaktuell und lassen sich nicht
            vorverarbeiten; Abrufe dorthin entstehen also nur, solange der Bereich „Radar"
            offen ist.
          </p>

          <h3>Speicherung auf dem Endgerät</h3>
          <p>
            Zur Schonung der fremden Schnittstellen legt die Anwendung abgerufene Daten lokal
            ab: bereits geholte Felder, Messreihen und vergangene Modellläufe in der{' '}
            <code>IndexedDB</code>, gespeicherte Panel-Vorlagen im <code>localStorage</code>.
            Diese Speicherung ist unbedingt erforderlich, um den ausdrücklich gewünschten
            Dienst bereitzustellen — ohne sie würde jeder Handgriff die Kontingente der
            Datenanbieter erneut belasten — und daher nach § 25 Abs 2 Nr. 2 TDDDG nicht
            einwilligungsbedürftig. Die Daten verbleiben auf dem Gerät, werden nicht übertragen
            und lassen sich jederzeit über die Browsereinstellungen („Websitedaten löschen“)
            entfernen.
          </p>

          <h3>Ihre Rechte</h3>
          <p>
            Betroffene Personen haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung
            (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
            Datenübertragbarkeit (Art. 20) sowie Widerspruch gegen eine Verarbeitung auf
            Grundlage berechtigter Interessen (Art. 21). Da hier keine personenbezogenen Daten
            gespeichert werden, kann sich ein Auskunftsersuchen praktisch nur auf die
            Protokolldaten des Hosters richten; Ansprechpartner ist dann GitHub.
          </p>
          {/* KEINE einzelne Landesbehörde genannt, und das ist überlegt: Art. 77
              DSGVO eröffnet die Beschwerde bei der Aufsichtsbehörde des
              gewöhnlichen Aufenthalts, des Arbeitsplatzes ODER des Ortes des
              mutmaßlichen Verstoßes — eine bestimmte zu benennen ist übliche
              Praxis, aber nicht vorgeschrieben. Die Zuständigkeit für den
              Anbieter folgt außerdem seiner tatsächlichen Niederlassung, nicht
              der Zustelladresse der Impressumsvertretung: eine nach der
              Zustelladresse gewählte Behörde wäre schlicht die falsche, und die
              nach der Niederlassung richtige hätte das Bundesland verraten,
              das die Vertretung gerade verdecken soll. Der Verweis auf die
              Liste aller Aufsichtsbehörden ist beides nicht. */}
          <p>
            Unabhängig davon besteht ein Beschwerderecht bei einer
            Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO) — wahlweise bei der Behörde des
            gewöhnlichen Aufenthaltsorts, des Arbeitsplatzes oder des Ortes des
            mutmaßlichen Verstoßes. Eine{' '}
            <a
              href="https://www.bfdi.bund.de/DE/Service/Anschriften/anschriften_table.html"
              target="_blank"
              rel="noreferrer"
            >
              Liste der zuständigen Aufsichtsbehörden
            </a>{' '}
            führt der Bundesbeauftragte für den Datenschutz und die Informationsfreiheit.
          </p>
        </section>

        {/* --- Stand dieser Seite -------------------------------------- */}
        <section>
          <h2>Stand dieser Seite</h2>
          <p>
            Diese Seite wird automatisch aus dem Quellcode gebaut. Ausgeliefert wird der
            Stand <strong title={buildTitle()}>{buildLabel()}</strong> (Commit-Kennung und
            Datum) — damit ist nachprüfbar, welche Fassung man gerade vor sich hat. Die
            Wetter- und Klimadaten darin sind dagegen tagesaktuell; ihr jeweiliger
            Modelllauf steht in den Vorhersagebereichen.
          </p>
        </section>

        {/* --- Urheberrecht -------------------------------------------- */}
        <section>
          <h2>Urheberrecht</h2>
          <p>
            Gestaltung, Darstellungen und Quellcode dieser Seite unterliegen dem deutschen
            Urheberrecht. Die zugrunde liegenden Wetter- und Klimadaten stehen unter den oben
            genannten Lizenzen der jeweiligen Anbieter und sind bei einer Weiterverwendung
            nach deren Bedingungen zu kennzeichnen.
          </p>
        </section>
      </div>
    </div>
  )
}
