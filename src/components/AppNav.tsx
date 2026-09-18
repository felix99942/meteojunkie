// Oberste Bereichs-Navigation (siehe state/appView.ts). Ensemble und
// Soundings sind eigene Bereiche statt Panel-Modi — sie beantworten andere
// Fragen als der Modellvergleich und waren im Modus-Dropdown zu gut versteckt.
// Alle drei Panel-Bereiche teilen sich dieselben sechs Panel-Configs, es geht
// beim Wechseln also nichts verloren.
//
// DIE REIHE IST GRUPPIERT, und die Farbe trägt die Gruppe — bei acht Bereichen
// ist eine gleichförmige Knopfreihe eine Liste, die man jedes Mal neu liest:
//
//   mint   VORHERSAGE und Klima am Punkt bzw. an der Station — Meteogramm,
//          Klima + MOS, Ensemble, Soundings, Föhn. Alles Zahlenwerke aus
//          Modell- oder Messreihen.
//   ocker  BILDKARTEN — Radar und Satellit. Andere Herkunft (fertige Karten
//          fremder Dienste), andere Bedienung (Zeitschleife statt Zeitraster),
//          kein Open-Meteo-Budget.
//   rot    VERIFIKATION — der einzige Bereich, der ZURÜCKschaut und die
//          übrigen bewertet. Rot, weil er die unbequeme Frage stellt.
//
// Die Farbe ist NICHT der einzige Unterschied (der aktive Tab trägt zusätzlich
// Hintergrund und Unterkante), damit die Reihe auch ohne Farbunterscheidung
// benutzbar bleibt.

import { buildLabel, buildTitle } from '../config/build'
import { POINT_FORECASTS_ENABLED } from '../config/features'
import { useAppView, type AppView } from '../state/appView'

/** Farbgruppe der Reihe — siehe Kopfkommentar. */
type NavGroup = 'forecast' | 'imagery' | 'verify'

const TABS: { id: AppView; label: string; title: string; group: NavGroup }[] = [
  {
    id: 'classic',
    label: 'Meteogramm',
    title: 'Klassisches Meteogramm — Temperatur, Niederschlag, Wolken, Wind auf einen Blick',
    group: 'forecast',
  },
  {
    id: 'at-klima',
    label: 'Klima + MOS',
    title: 'Österreichische Klimakarte (GeoSphere-Stationsdaten) und MOS-Punktvorhersage (DWD MOSMIX)',
    group: 'forecast',
  },
  {
    id: 'ensemble',
    label: 'Ensemble',
    title: 'Plume-Diagramme am Punkt — Streuung der Mitglieder',
    group: 'forecast',
  },
  {
    id: 'profile',
    label: 'Soundings',
    title: 'Skew-T am Punkt — Schichtung der Atmosphäre',
    group: 'forecast',
  },
  {
    id: 'foehn',
    label: 'Föhn',
    title: 'Föhn-Diagnose: Druckdifferenz über die Alpen, Kammwind und Lee-Station — Modelle und Ensemble',
    group: 'forecast',
  },
  {
    id: 'radar',
    label: 'Radar',
    title:
      'Niederschlagsradar: DWD-Komposit im 5-Minuten-Takt — Deutschland, Schweiz und Westösterreich',
    group: 'imagery',
  },
  {
    id: 'satellite',
    label: 'Satellit',
    title:
      'Satellitenbilder von EUMETSAT: Meteosat Third Generation alle 10 Minuten (Geocolour, sichtbar hochaufgelöst, Infrarot), MSG alle 15 (Luftmassen, Konvektion)',
    group: 'imagery',
  },
  {
    id: 'verify',
    label: 'Verifikation',
    title:
      'Wie gut war die Vorhersage? Vergangene Modellläufe gegen die gemessenen Stationswerte',
    group: 'verify',
  },
  // Steht in der veröffentlichten Version nicht in der Reihe
  // (`POINT_FORECASTS_ENABLED`) und deshalb am Ende: im vollen Build ist es
  // der Werkzeugkasten hinter den fertigen Bereichen, nicht der Einstieg.
  {
    id: 'workbench',
    label: 'Punktprognosen',
    title: 'Modellvergleich als Zeitreihe und Karte, frei wählbare Variablen',
    group: 'forecast',
  },
]

export function AppNav() {
  const view = useAppView((s) => s.view)
  const setView = useAppView((s) => s.setView)
  /**
   * „Punktprognosen" fällt in der veröffentlichten Version VOLLSTÄNDIG weg,
   * nicht bloß ausgegraut: ein deaktivierter Menüpunkt wirft die Frage auf,
   * was da fehlt. Der Bereich selbst bleibt im Code und im Zustand — Ensemble
   * und Vertikalprofil teilen seine Panel-Configs (siehe `config/features.ts`).
   */
  const tabs = POINT_FORECASTS_ENABLED ? TABS : TABS.filter((t) => t.id !== 'workbench')
  return (
    <nav className="appnav">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`appnav-tab is-${t.group}${view === t.id ? ' is-active' : ''}`}
          title={t.title}
          aria-pressed={view === t.id}
          onClick={() => setView(t.id)}
        >
          {t.label}
        </button>
      ))}
      {/* Impressum gehört NICHT in die Tab-Reihe: es beantwortet keine
          Wetterfrage und stünde gleichrangig neben Werkzeugen, die man
          täglich benutzt. Es muss aber aus jedem Bereich mit einem Klick
          erreichbar sein (§ 18 MStV: „leicht erkennbar, unmittelbar
          erreichbar und ständig verfügbar") —
          deshalb abgesetzt am rechten Rand, unauffällig, aber immer da. */}
      {/* BUILD-KENNUNG neben dem Impressum. Beantwortet „ist das schon der
          neue Stand?" — an diesem Projekt war das mehrfach nicht zu sagen,
          ohne das ausgelieferte Bundle zu durchsuchen (Re-Run eines alten
          Laufs, gecachte index.html). Kommt aus GIT, ist also keine
          gepflegte Nummer, die driften kann. */}
      <span className="appnav-build label-muted" title={buildTitle()}>
        {buildLabel()}
      </span>
      <button
        type="button"
        className={`appnav-legal${view === 'impressum' ? ' is-active' : ''}`}
        title="Impressum, Offenlegung, Datenquellen und Datenschutz"
        aria-pressed={view === 'impressum'}
        onClick={() => setView('impressum')}
      >
        Impressum
      </button>
    </nav>
  )
}
