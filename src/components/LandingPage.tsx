// Startseite (seit 2026-11-02, auf Wunsch): oben die Windströmung des
// aktuellen IFS-Laufs über Europa als Animation (`render/heroWind.ts`),
// darunter je Bereich eine Kachel — gegliedert wie die Navigation
// (`config/navigation.ts`). Kein eigener Datenpfad: das Windfeld kommt über
// denselben Lader wie die Modellkarten (`api/globeData.ts`, ~0,3 MB), die
// Laufzeiten aus deren meta.json.

import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { loadGlobeField, loadGlobeMeta, setGlobeMeta } from '../api/globeData'
import { loadBasemap } from '../render/basemap'
import { HeroWind } from '../render/heroWind'
import { nearestStepIndex, runMs, sampleWind, validMs, type GlobeMeta, type GlobeModelId } from '../config/globe'
import { runLabel, validLabel } from '../config/globeFormat'
import { POINT_FORECASTS_ENABLED } from '../config/features'
import { buildLabel, buildTitle } from '../config/build'
import { NAV_GROUPS, NAV_TABS, type NavGroup } from '../config/navigation'
import { useAppView } from '../state/appView'

/** Läufe, die auf der Modellkarten-Kachel stehen */
const RUN_MODELS: { id: GlobeModelId; label: string }[] = [
  { id: 'ecmwf-ifs', label: 'IFS' },
  { id: 'icon-d2', label: 'ICON-D2' },
  { id: 'varda', label: 'Varda' },
]

/** GeoJSON-Linien (LineString/MultiLineString) → Linienzüge [[lon, lat], …] */
function lineStrings(fc: FeatureCollection | undefined): number[][][] {
  const out: number[][][] = []
  for (const f of fc?.features ?? []) {
    const g = f.geometry
    if (g.type === 'LineString') out.push(g.coordinates)
    else if (g.type === 'MultiLineString') out.push(...g.coordinates)
  }
  return out
}

export function LandingPage() {
  const setView = useAppView((s) => s.setView)
  const linesRef = useRef<HTMLCanvasElement>(null)
  const windRef = useRef<HTMLCanvasElement>(null)
  const heroRef = useRef<HeroWind | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [runs, setRuns] = useState<Partial<Record<GlobeModelId, GlobeMeta>>>({})
  /**
   * Aufgeklappte Säule: beim Überfahren, per Klick/Tipp umschaltbar. Touch
   * löst vor dem Klick ein `mouseenter` aus — ein Klick kurz danach klappt
   * deshalb nicht gleich wieder zu (dieselbe Regel wie in der Navigation).
   */
  const [open, setOpen] = useState<NavGroup | null>(null)
  const openedAt = useRef(0)
  const hoverOpen = (g: NavGroup) => {
    if (open === g) return
    openedAt.current = Date.now()
    setOpen(g)
  }
  const clickColumn = (g: NavGroup) => {
    if (open === g && Date.now() - openedAt.current < 600) return
    setOpen((cur) => (cur === g ? null : g))
  }

  useEffect(() => {
    const lines = linesRef.current
    const wind = windRef.current
    if (!lines || !wind) return
    const hero = new HeroWind(lines, wind)
    heroRef.current = hero
    let cancelled = false
    loadBasemap('europe')
      .then((bm) => !cancelled && hero.setGeo([...lineStrings(bm.coast), ...lineStrings(bm.borders)]))
      .catch(() => {})
    // Wind 10 m des aktuellen IFS-Laufs zum Termin, der jetzt am nächsten liegt
    loadGlobeMeta('ecmwf-ifs')
      .then((meta) => {
        if (cancelled) return
        setGlobeMeta(meta)
        const steps = meta.variables.uv10?.steps ?? []
        if (!steps.length) return
        const step = steps[nearestStepIndex(steps, runMs(meta), Date.now())]
        return loadGlobeField('ecmwf-ifs', meta.runId, 'uv10', step).then((f) => {
          if (cancelled) return
          hero.setSampler((lat, lon) => sampleWind(f, lat, lon))
          setCaption(`Wind 10 m · ECMWF IFS · Lauf ${runLabel(runMs(meta))} · gültig ${validLabel(validMs(meta, step))}`)
        })
      })
      // Ohne Lauf bleibt das Ersatzfeld stehen — und die Bildunterschrift leer,
      // denn es ist KEINE Vorhersage
      .catch(() => {})
    for (const m of RUN_MODELS) {
      loadGlobeMeta(m.id)
        .then((meta) => !cancelled && setRuns((r) => ({ ...r, [m.id]: meta })))
        .catch(() => {})
    }
    return () => {
      cancelled = true
      hero.destroy()
      heroRef.current = null
    }
  }, [])

  const tabs = POINT_FORECASTS_ENABLED ? NAV_TABS : NAV_TABS.filter((t) => t.id !== 'workbench')

  return (
    <div className="landing">
      <section className="landing-hero">
        <canvas ref={linesRef} className="landing-canvas" aria-hidden="true" />
        <canvas ref={windRef} className="landing-canvas" aria-hidden="true" />
        <div className="landing-hero-text">
          <h1>meteojunkie</h1>
          <p>Wettermodelle, Radar, Satellit &amp; mehr</p>
          {caption && <span className="landing-caption">{caption}</span>}
        </div>
      </section>
      {/* Drei Säulen statt einer Kachelwand (auf Wunsch): die Frage zuerst,
          die Bereiche klappen darunter auf */}
      <div className="landing-columns" onMouseLeave={() => setOpen(null)}>
        {NAV_GROUPS.map((g) => {
          const items = tabs.filter((t) => t.group === g.key)
          const isOpen = open === g.key
          return (
            <section
              key={g.key}
              className={`landing-column is-${g.key}${isOpen ? ' is-open' : ''}`}
              onMouseEnter={() => hoverOpen(g.key)}
            >
              <button type="button" className="landing-column-head" aria-expanded={isOpen} onClick={() => clickColumn(g.key)}>
                <strong>{g.label}</strong>
                <span>{g.blurb}</span>
                <em>{items.map((t) => t.label).join(' · ')}</em>
              </button>
              {/* immer gerendert, damit das Aufklappen animiert werden kann
                  (Gitter 0fr ↔ 1fr); zugeklappt `inert` */}
              <div className="landing-column-items" inert={!isOpen}>
                <div className="landing-column-inner">
                  {items.map((t) => (
                    <button key={t.id} type="button" className="landing-item" title={t.title} onClick={() => setView(t.id)}>
                      <strong>{t.label}</strong>
                      <span>{t.blurb}</span>
                      {t.id === 'globe' && (
                        <em>
                          {RUN_MODELS.filter((m) => runs[m.id])
                            .map((m) => `${m.label} ${runLabel(runMs(runs[m.id]!))}`)
                            .join(' · ') || ' '}
                        </em>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )
        })}
      </div>
      {/* Impressum MUSS von jeder Seite aus erreichbar sein (§ 18 MStV) —
          ohne Leiste steht es hier */}
      <footer className="landing-foot">
        <span className="label-muted" title={buildTitle()}>
          {buildLabel()}
        </span>
        <button type="button" className="appnav-legal" onClick={() => setView('impressum')}>
          Impressum
        </button>
      </footer>
    </div>
  )
}
