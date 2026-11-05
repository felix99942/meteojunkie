// Oberste Bereichs-Navigation (siehe state/appView.ts). Ensemble und
// Soundings sind eigene Bereiche statt Panel-Modi — sie beantworten andere
// Fragen als der Modellvergleich und waren im Modus-Dropdown zu gut versteckt.
// Alle drei Panel-Bereiche teilen sich dieselben sechs Panel-Configs, es geht
// beim Wechseln also nichts verloren.
//
// DIE REIHE IST NACH DER FRAGE GRUPPIERT (seit 2026-11-02) — Vorhersage ·
// Beobachtung · Auswertung, Liste und Begründung in `config/navigation.ts`.
// Die Farbe trägt die Gruppe (mint · ocker · rot), ist aber NICHT der einzige
// Unterschied: der aktive Tab trägt zusätzlich Hintergrund und Unterkante,
// damit die Reihe auch ohne Farbunterscheidung benutzbar bleibt. Links das
// Logo, es führt zur Startseite.

import { useRef, useState } from 'react'
import { buildLabel, buildTitle } from '../config/build'
import { POINT_FORECASTS_ENABLED } from '../config/features'
import { NAV_GROUPS, NAV_TABS, type NavGroup } from '../config/navigation'
import { useAppView } from '../state/appView'

/** Beschriftung der aufklappbaren Gruppenknöpfe (Gruppen mit mehr als einem Bereich). */
const GROUP_LABELS = Object.fromEntries(NAV_GROUPS.map((g) => [g.key, g.label])) as Record<NavGroup, string>

/** Ein Klick so kurz nach dem Öffnen per Überfahren klappt nicht gleich wieder zu (Touch). */
const HOVER_CLICK_GRACE_MS = 600

const TABS = NAV_TABS

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
      <button
        type="button"
        className={`appnav-brand${view === 'home' ? ' is-active' : ''}`}
        title="Startseite"
        aria-pressed={view === 'home'}
        onClick={() => setView('home')}
      >
        meteojunkie
      </button>
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
    </nav>
  )
}

/**
 * Impressum und Build-Kennung, FEST in der Ecke unten rechts jedes Bereichs
 * (auf Wunsch, 2026-11-02 — vorher rechts in der Navigationsleiste; die
 * gehört jetzt nur der Navigation). Das Impressum gehört nicht in die
 * Tab-Reihe, es beantwortet keine Wetterfrage, muss aber aus jedem Bereich
 * mit einem Klick erreichbar sein (§ 18 MStV: „leicht erkennbar, unmittelbar
 * erreichbar und ständig verfügbar"). Die Startseite hat es in ihrer Fußzeile.
 *
 * Die BUILD-KENNUNG beantwortet „ist das schon der neue Stand?" — an diesem
 * Projekt war das mehrfach nicht zu sagen, ohne das ausgelieferte Bundle zu
 * durchsuchen. Kommt aus GIT, ist also keine gepflegte Nummer, die driften
 * kann; das Datum steht im Tooltip.
 */
export function LegalCorner() {
  const view = useAppView((s) => s.view)
  const setView = useAppView((s) => s.setView)
  return (
    <div className="legal-corner">
      <span className="label-muted legal-copy">© 2026 meteojunkie</span>
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
    </div>
  )
}
