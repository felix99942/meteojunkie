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
//          Modellkarten, Klima + MOS, Ensemble, Soundings, Föhn.
//          Alles Zahlenwerke aus Modell- oder Messreihen (die Modellkarten
//          zeigen zwar Karten, aber MODELLausgabe mit ablesbaren Werten, keine
//          fertigen Karten eines fremden Dienstes).
//   ocker  BILDKARTEN — Radar und Satellit. Andere Herkunft (fertige Karten
//          fremder Dienste), andere Bedienung (Zeitschleife statt Zeitraster),
//          kein Open-Meteo-Budget.
//   rot    VERIFIKATION — der einzige Bereich, der ZURÜCKschaut und die
//          übrigen bewertet. Rot, weil er die unbequeme Frage stellt.
//   lila   LUFTQUALITÄT — ein anderes Thema als das Wetter (Schadstoffe statt
//          Wettergrößen), mit Modell UND Messung; steht deshalb abgesetzt am
//          Ende der Reihe (auf Wunsch).
//
// Die Farbe ist NICHT der einzige Unterschied (der aktive Tab trägt zusätzlich
// Hintergrund und Unterkante), damit die Reihe auch ohne Farbunterscheidung
// benutzbar bleibt.

import { useRef, useState } from 'react'
import { buildLabel, buildTitle } from '../config/build'
import { POINT_FORECASTS_ENABLED } from '../config/features'
import { useAppView, type AppView } from '../state/appView'

/** Farbgruppe der Reihe — siehe Kopfkommentar. */
type NavGroup = 'forecast' | 'imagery' | 'verify' | 'air'

/** Beschriftung der aufklappbaren Gruppenknöpfe (Gruppen mit mehr als einem Bereich). */
const GROUP_LABELS: Record<NavGroup, string> = {
  forecast: 'Vorhersage + Klima',
  imagery: 'Analyse',
  verify: 'Verifikation',
  air: 'Luftqualität',
}

/** Ein Klick so kurz nach dem Öffnen per Überfahren klappt nicht gleich wieder zu (Touch). */
const HOVER_CLICK_GRACE_MS = 600

const TABS: { id: AppView; label: string; title: string; group: NavGroup }[] = [
  {
    id: 'classic',
    label: 'Meteogramm',
    title: 'Klassisches Meteogramm — Temperatur, Niederschlag, Wolken, Wind auf einen Blick',
    group: 'forecast',
  },
  {
    id: 'globe',
    label: 'Modellkarten',
    title:
      'ECMWF IFS, ICON-EU und ICON-D2 als Globus oder Karte (Europa, Alpen) — Temperatur, Druck, Niederschlag, Wind, Bewölkung, 500 hPa',
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
  {
    id: 'air',
    label: 'Luftqualität',
    title: 'Luftqualität am Punkt — Europäischer Luftqualitätsindex, Feinstaub, Stickstoffdioxid, Ozon, Saharastaub (CAMS)',
    group: 'air',
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

  /**
   * AUFKLAPPEN beim Überfahren UND per Klick/Tipp, ZUKLAPPEN NUR per Klick auf
   * den Kategorieknopf (auf Wunsch): ein Zuklappen beim Verlassen störte —
   * fuhr man in der Leiste Richtung „Analyse", klappte „Vorhersage + Klima"
   * hinter einem zusammen, und alles rutschte. Mehrere Gruppen dürfen
   * gleichzeitig offen sein.
   *
   * Touch kennt kein Überfahren, löst aber vor dem Klick ein `mouseenter` aus
   * — der Tipp öffnete die Gruppe also und schlösse sie im selben Zug. Ein
   * Klick kurz nach dem Öffnen per Überfahren (`HOVER_CLICK_GRACE_MS`) zählt
   * deshalb nicht als Zuklappen.
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<NavGroup>>(new Set())
  const openedAt = useRef<Partial<Record<NavGroup, number>>>({})
  const openHover = (g: NavGroup) => {
    if (openGroups.has(g)) return
    openedAt.current[g] = Date.now()
    setOpenGroups((prev) => new Set(prev).add(g))
  }
  const toggleGroup = (g: NavGroup) => {
    // Im Updater prüfen, nicht am gerenderten Stand: beim Tipp kommen
    // mouseenter und click im selben Zug, der Stand im Render kennt das
    // Öffnen dann noch nicht
    setOpenGroups((prev) => {
      if (prev.has(g) && Date.now() - (openedAt.current[g] ?? 0) < HOVER_CLICK_GRACE_MS) return prev
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else {
        next.add(g)
        openedAt.current[g] = Date.now()
      }
      return next
    })
  }
  // Gruppen in der Reihenfolge ihres ersten Auftretens
  const groups: { key: NavGroup; tabs: typeof tabs }[] = []
  for (const t of tabs) {
    const g = groups.find((x) => x.key === t.group)
    if (g) g.tabs.push(t)
    else groups.push({ key: t.group, tabs: [t] })
  }
  const activeGroup = tabs.find((t) => t.id === view)?.group
  // Offen beim Überfahren oder nach Klick — auch die Gruppe des aktiven
  // Bereichs klappt wieder ein (auf Wunsch); welcher Bereich offen ist, sagt
  // dann der Kategorieknopf selbst
  const isOpen = (g: NavGroup) => openGroups.has(g)
  const activeTab = tabs.find((t) => t.id === view)
  const tabButton = (t: (typeof tabs)[number]) => (
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
  )
  return (
    <nav className="appnav">
      {groups.map((g, gi) =>
        // Eine Gruppe mit nur EINEM Bereich (Verifikation, Luftqualität) ist
        // einfach ihr Knopf — ein Aufklappen um einen einzigen Eintrag wäre
        // ein Klick zu viel
        g.tabs.length === 1 ? (
          <span key={g.key} className={`appnav-group${gi > 0 ? ' is-group-start' : ''}`}>
            {tabButton(g.tabs[0])}
          </span>
        ) : (
          <span
            key={g.key}
            className={`appnav-group${gi > 0 ? ' is-group-start' : ''}${isOpen(g.key) ? ' is-open' : ''}`}
            onMouseEnter={() => openHover(g.key)}
          >
            <button
              type="button"
              className={`appnav-cat is-${g.key}${g.key === activeGroup ? ' has-active' : ''}`}
              aria-expanded={isOpen(g.key)}
              title={g.tabs.map((t) => t.label).join(' · ')}
              onClick={() => toggleGroup(g.key)}
            >
              {GROUP_LABELS[g.key]}
              {g.key === activeGroup && activeTab && !isOpen(g.key) && (
                <span className="appnav-cat-current">{activeTab.label}</span>
              )}
              <span className="appnav-cat-chev" aria-hidden="true">
                ›
              </span>
            </button>
            {/* Immer gerendert, damit das Ein- und Ausfahren animiert werden
                kann (CSS-Gitter 0fr ↔ 1fr); zugeklappt `inert`, sonst ließen
                sich die unsichtbaren Knöpfe mit Tab ansteuern */}
            <span className="appnav-items" inert={!isOpen(g.key)}>
              <span className="appnav-items-inner">{g.tabs.map(tabButton)}</span>
            </span>
          </span>
        ),
      )}
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
