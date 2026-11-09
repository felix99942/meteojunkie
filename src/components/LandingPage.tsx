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
import { FALLBACK_WIND, HeroWind, heroProjection } from '../render/heroWind'
import { dayNightNeeds, drawDayNightBase, drawSatelliteBase } from '../render/heroBase'
import { fetchSatelliteExtent, loadSatelliteImage } from '../api/eumetsat'
import { SATELLITE_PRODUCTS, satelliteMirrorKey, satelliteTimes } from '../config/satellite'
import { GROUND_BOUNDS, GROUND_URL, NIGHT_URL } from '../config/ground'
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

/** So lange bleibt das Menü stehen, nachdem die Maus es verlassen hat (ms) */
const MENU_CLOSE_MS = 500
/** So lange muss die Maus auf der Nachbarsäule bleiben, bevor sie aufklappt (ms) */
const MENU_SWITCH_MS = 180

export function LandingPage() {
  const setView = useAppView((s) => s.setView)
  const baseRef = useRef<HTMLCanvasElement>(null)
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
  // Verzögert schließen und wechseln: wer vom Kopf zum Eintrag fährt, verlässt die Säule
  // kurz oder streift die Nachbarsäule, und das Menü war dann schon weg
  const closeTimer = useRef(0)
  const switchTimer = useRef(0)
  useEffect(
    () => () => {
      clearTimeout(closeTimer.current)
      clearTimeout(switchTimer.current)
    },
    [],
  )
  const hoverOpen = (g: NavGroup) => {
    clearTimeout(closeTimer.current)
    clearTimeout(switchTimer.current)
    if (open === g) return
    const show = () => {
      openedAt.current = Date.now()
      setOpen(g)
    }
    if (open) switchTimer.current = window.setTimeout(show, MENU_SWITCH_MS)
    else show()
  }
  const hoverLeave = () => {
    clearTimeout(switchTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(null), MENU_CLOSE_MS)
  }
  const clickColumn = (g: NavGroup) => {
    clearTimeout(closeTimer.current)
    clearTimeout(switchTimer.current)
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
        if (!steps.length) {
          hero.setSampler(FALLBACK_WIND)
          return
        }
        const step = steps[nearestStepIndex(steps, runMs(meta), Date.now())]
        return loadGlobeField('ecmwf-ifs', meta.runId, 'uv10', step).then((f) => {
          if (cancelled) return
          hero.setSampler((lat, lon) => sampleWind(f, lat, lon))
          setCaption(`Wind 10 m · ECMWF IFS · Lauf ${runLabel(runMs(meta))} · gültig ${validLabel(validMs(meta, step))}`)
        })
      })
      // Ohne Lauf das Ersatzfeld — und die Bildunterschrift bleibt leer, denn
      // es ist KEINE Vorhersage
      .catch(() => !cancelled && hero.setSampler(FALLBACK_WIND))
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

  // Untergrund (render/heroBase.ts): das AKTUELLE Geocolour-Bild — es bringt
  // Tag und Nacht selbst mit, samt Schnee und Stadtlichtern. Erst wenn es
  // nicht zu bekommen ist, der Rückfall aus Blue und Black Marble mit der
  // Dämmerungslinie; der wartet einige Sekunden, damit er beim normalen
  // Laden nicht kurz aufblitzt.
  const [satTime, setSatTime] = useState<number | null>(null)
  useEffect(() => {
    const canvas = baseRef.current
    if (!canvas) return
    let cancelled = false
    let sat: { img: HTMLImageElement; time: number } | null = null
    let fallback = false
    let night: HTMLImageElement | null = null
    let day: HTMLImageElement | null = null
    let loadingNight = false
    let loadingDay = false
    const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null
    const loadImg = (url: string) =>
      new Promise<HTMLImageElement>((ok, fail) => {
        const im = new Image()
        im.onload = () => ok(im)
        im.onerror = fail
        im.src = url
      })
    const product = SATELLITE_PRODUCTS.find((p) => p.id === 'geocolour')!
    const show = (img: HTMLImageElement, time: number) => {
      if (cancelled) return
      sat = { img, time }
      setSatTime(time)
      redraw()
    }
    // SCHNELL: der Worker nennt den neuesten Termin, der im Vorrat liegt
    // (`sat/geocolour/latest.json`), und beide Stufen kommen same-origin aus
    // R2 — zuerst die Vorschau, gleich danach das scharfe Bild. Über das
    // Capabilities von EUMETView war es oft ein Termin, den der Vorrat noch
    // nicht hatte, und EUMETView rendert ihn dann 1 bis über 10 Sekunden.
    const fromMirror = async (): Promise<boolean> => {
      const r = await fetch(`${import.meta.env.BASE_URL}sat/geocolour/latest.json`, { cache: 'no-cache' })
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false
      const { time } = (await r.json()) as { time: number }
      if (sat && sat.time >= time) return true
      const url = (tier: 'lo' | 'hi') => `${import.meta.env.BASE_URL}${satelliteMirrorKey(product, time, tier)}`
      const lo = await loadImg(url('lo'))
      if (!sat || sat.time < time) show(lo, time)
      loadImg(url('hi'))
        .then((hi) => show(hi, time))
        .catch(() => {})
      return true
    }
    const loadSat = async () => {
      if (dev?.get('base') === 'fallback') return
      try {
        if (await fromMirror()) return
      } catch {
        /* weiter über EUMETView */
      }
      try {
        const ext = await fetchSatelliteExtent(product)
        // jüngster Termin zuerst; fehlt er noch im Vorrat und beim Dienst,
        // tut es der davor
        for (const t of satelliteTimes(ext, 30 * 60_000).reverse().slice(0, 3)) {
          if (cancelled || (sat && sat.time >= t)) return
          try {
            const url = await loadSatelliteImage(product, t, 'hi')
            const img = await loadImg(url)
            URL.revokeObjectURL(url)
            show(img, t)
            return
          } catch {
            /* nächster Termin */
          }
        }
      } catch {
        /* Rückfall greift */
      }
      fallback = true
      redraw()
    }
    const redraw = () => {
      if (cancelled) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const p = heroProjection(w, h)
      if (sat) {
        drawSatelliteBase(canvas, p, w, h, dpr, GROUND_BOUNDS, sat.img)
        canvas.style.opacity = '1'
        return
      }
      if (!fallback) return
      // nur im Dev-Build: `?t=2026-11-02T15:30Z` zeigt den Rückfall zu einer
      // anderen Zeit, `?base=fallback` erzwingt ihn
      const devT = dev?.get('t')
      const now = devT ? Date.parse(devT) : Date.now()
      const need = dayNightNeeds(p, w, h, now)
      if (need.night && !night && !loadingNight) {
        loadingNight = true
        loadImg(NIGHT_URL)
          .then((im) => {
            night = im
            redraw()
          })
          .catch(() => {})
      }
      if (need.day && !day && !loadingDay) {
        loadingDay = true
        loadImg(GROUND_URL)
          .then((im) => {
            day = im
            redraw()
          })
          .catch(() => {})
      }
      drawDayNightBase(canvas, p, w, h, dpr, GROUND_BOUNDS, day, night, now)
      if (day || night) canvas.style.opacity = '1'
    }
    void loadSat()
    const fallbackTimer = setTimeout(() => {
      fallback = true
      redraw()
    }, 6000)
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    // neuer Satellitentermin alle 10 Minuten; im Rückfall wandert die
    // Dämmerungslinie ~2,5° Länge in dieser Zeit
    const id = setInterval(() => {
      void loadSat()
      redraw()
    }, 10 * 60_000)
    return () => {
      cancelled = true
      ro.disconnect()
      clearInterval(id)
      clearTimeout(fallbackTimer)
    }
  }, [])

  const tabs = POINT_FORECASTS_ENABLED ? NAV_TABS : NAV_TABS.filter((t) => t.id !== 'workbench')

  return (
    <div className="landing">
      <section className="landing-hero">
        <canvas ref={baseRef} className="landing-canvas landing-base" aria-hidden="true" />
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
      <div className="landing-columns" onMouseLeave={hoverLeave}>
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
        <span className="label-muted landing-credit">
          {satTime != null
            ? `Untergrund: EUMETSAT MTG Geocolour, ${new Date(satTime).toISOString().slice(11, 16)} UTC`
            : 'Untergrund: NASA Blue Marble und Black Marble'}
        </span>
        <span className="label-muted">© 2026 meteojunkie</span>
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
