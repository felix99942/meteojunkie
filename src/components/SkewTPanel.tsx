// Vertikalprofil-/Skew-T-Panel (SPEC §13, Phase 3): Drucklevel-Sondierung am
// Location-Lock-Punkt, mehrere Modelle überlagert. Custom-Canvas (kein uPlot):
// Hintergrund aus skewt.ts, darüber T-/Td-Kurve pro Modell, Windbarben und —
// fürs Bezugsmodell — der gehobene Parzellenweg mit CAPE (rot) / CIN (blau).
// Darunter eine Vergleichstabelle der Kennzahlen (Parameter × Modell).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles } from '../api/queries'
import type { Profile } from '../api/openmeteo'
import { SERIES_COLORS } from '../config/colors'
import { getModel } from '../config/models'
import { formatRun, latestRun, RUN_TITLE } from '../config/runs'
import { supportsPressureLevels } from '../config/levels'
import { formatCursorTime, PROFILE_FORECAST_DAYS, timeToIndex } from '../config/time'
import {
  columnFromProfile,
  computeSounding,
  type SoundingColumn,
  type SoundingParams,
  type SurfacePoint,
} from '../lib/sounding'
import {
  DEFAULT_SKEWT_THEME,
  drawHodograph,
  drawParcel,
  drawSkewTBackground,
  drawWindBarb,
  makeGeometry,
  xFromTP,
  yFromP,
  type HodoPoint,
  type SkewTGeometry,
} from '../render/skewt'
import { useWorkbench, type PanelConfig } from '../state/workbench'

const MS_TO_KT = 1.94384
/** Mindest-Pixelabstand zwischen Windbarben (verhindert Überlappung, thint adaptiv). */
/**
 * Mindestabstand der Windfahnen in px — und damit die Dichte der Spalte.
 *
 * DIE ZAHL DER FAHNEN IST NACH OBEN HART BEGRENZT, und zwar nicht hier,
 * sondern von der API: Open-Meteo liefert genau die 19 Drucklevel aus
 * `PRESSURE_LEVELS`, davon 16 im Achsenbereich (1050–100 hPa). Die
 * Zwischenlevel 750/650/550/450/350 hPa gibt es NICHT — live geprüft
 * (2026-09-16): HTTP 200 mit lauter `null`, während 700 und 600 im selben
 * Request Werte liefern. Das ist die Falle aus SPEC §6, nicht ein Tippfehler.
 *
 * Gerechnet für eine 420-px-Achse: bei 13 px werden 12 Fahnen gezeichnet, bei
 * 8 px sind es 14 — mehr geht nicht, weil 1000/975/950/925 nur 4,5–4,9 px
 * auseinanderliegen (logarithmische Druckachse). Tiefer als 8 px zu gehen
 * bringt deshalb KEINE weitere Fahne, nur Überlappung.
 */
const BARB_MIN_GAP = 8
/**
 * Schaftlänge, passend zum Abstand: bei 8 px Abstand sind 30 px Schaft zu
 * lang, die Fiedern der Nachbarn greifen ineinander.
 */
const BARB_LEN = 22

const dash = (v: string | number | null | undefined): string =>
  v == null ? '–' : typeof v === 'number' ? String(v) : v

// Tabellenzeilen: Parameter × Modell. ML-Paket ist das Bezugspaket im Diagramm
// (robuster als SB gegen die abendliche Grenzschichtproblematik).
const TABLE_ROWS: { label: string; get: (s: SoundingParams) => string }[] = [
  { label: 'PWAT', get: (s) => `${s.pwat.toFixed(1)} mm` },
  // ML ZUERST: es ist das Bezugspaket dieses Panels — der Parzellenweg im
  // Diagramm und der LI stammen daraus. SB und MU stehen als Vergleich
  // daneben, nicht als Hauptwert.
  { label: 'ML-CAPE', get: (s) => `${Math.round(s.ml.cape)}` },
  { label: 'SB-CAPE', get: (s) => `${Math.round(s.sb.cape)}` },
  { label: 'MU-CAPE', get: (s) => `${Math.round(s.mu.cape)}` },
  // Ohne LFC gibt es keine Sperre — dann steht hier „–" und keine Zahl.
  { label: 'CIN (ML)', get: (s) => dash(s.ml.cin != null ? `${Math.round(s.ml.cin)}` : null) },
  { label: 'LCL', get: (s) => dash(s.ml.lclP != null ? `${Math.round(s.ml.lclP)} hPa` : null) },
  { label: 'LFC', get: (s) => dash(s.ml.lfcP != null ? `${Math.round(s.ml.lfcP)} hPa` : null) },
  { label: 'EL', get: (s) => dash(s.ml.elP != null ? `${Math.round(s.ml.elP)} hPa` : null) },
  { label: 'LI (ML)', get: (s) => dash(s.li != null ? s.li.toFixed(1) : null) },
  { label: 'K-Index', get: (s) => dash(s.kIndex != null ? `${Math.round(s.kIndex)}` : null) },
  { label: 'Total Totals', get: (s) => dash(s.totalTotals != null ? `${Math.round(s.totalTotals)}` : null) },
  // Nullgradgrenze in METERN: so liest man sie (Schneefall- und
  // Vereisungsgrenze), nicht in hPa. Der Druck bleibt als Rückfall, falls das
  // Modell keine Geopotentialhöhen liefert — „–" wäre dort unzutreffend, der
  // Wert ist ja bekannt, nur nicht in der gewünschten Einheit.
  {
    label: '0 °C',
    get: (s) =>
      s.freezingLevelZ != null
        ? `${Math.round(s.freezingLevelZ / 10) * 10} m`
        : dash(s.freezingLevelP != null ? `${Math.round(s.freezingLevelP)} hPa` : null),
  },
  { label: 'Shear 0–6 km', get: (s) => dash(s.shear06 != null ? `${Math.round(s.shear06 * MS_TO_KT)} kt` : null) },
]

/**
 * T- oder Td-Kurve aus der SONDIERUNGSSPALTE zeichnen.
 *
 * Bewusst aus der Spalte und nicht mehr aus den Rohleveln: die Spalte ist
 * dieselbe, aus der die Kennzahlen gerechnet werden (`columnFromProfile`) —
 * sie beginnt am Boden und lässt die unterirdisch extrapolierten Level weg.
 * Zeichnete das Diagramm weiter aus den Rohdaten, zeigte es eine Kurve, die
 * unterhalb des Geländes weiterläuft, während die Tabelle daneben etwas
 * anderes ausweist.
 */
function strokeColumnLine(
  ctx: CanvasRenderingContext2D,
  g: SkewTGeometry,
  col: SoundingColumn,
  values: number[],
  color: string,
  linedash: number[],
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(linedash)
  ctx.beginPath()
  let pen = false
  for (let i = 0; i < col.p.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) {
      pen = false
      continue
    }
    const x = xFromTP(g, v, col.p[i])
    const y = yFromP(g, col.p[i])
    if (pen) ctx.lineTo(x, y)
    else {
      ctx.moveTo(x, y)
      pen = true
    }
  }
  ctx.stroke()
  ctx.restore()
}

/** Bodenpunkt eines Profils zum Zeitindex. */
function surfaceAt(p: Profile, ti: number): SurfacePoint | null {
  const pressure = p.surface.pressure[ti]
  if (pressure == null || !Number.isFinite(pressure)) return null
  return {
    pressure,
    temperature: p.surface.temperature[ti] ?? null,
    dewpoint: p.surface.dewpoint[ti] ?? null,
    windSpeed: p.surface.windSpeed[ti] ?? null,
    windDirection: p.surface.windDirection[ti] ?? null,
    elevation: p.elevation,
  }
}

export function SkewTPanel({ panel }: { panel: PanelConfig }) {
  const location = useWorkbench((s) => s.lockedLocation)
  const cursorTime = useWorkbench((s) => s.cursorTime)
  const results = useProfiles(location, panel.models)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hodoContainerRef = useRef<HTMLDivElement>(null)
  const hodoCanvasRef = useRef<HTMLCanvasElement>(null)
  // Kennzahlen sind standardmässig SICHTBAR: sie sind der Grund, warum man
  // ein Sounding aufschlägt, und seit die Grenze zur Karte ziehbar ist, hat
  // das Diagramm den Platz dafür. Ausblenden bleibt möglich.
  const [showParams, setShowParams] = useState(true)
  const [showHodo, setShowHodo] = useState(false)

  const panelTime = panel.sync ? cursorTime : panel.localTime
  const loadedKey = results.map((r) => (r.data ? '1' : '0')).join('')
  const modelsKey = panel.models.join()

  /**
   * Geländehöhe, mit der die Modelle hier rechnen — die wichtigste Angabe zum
   * gewählten PUNKT, seit man ihn auf der Karte setzt: das Profil beginnt auf
   * dieser Höhe, nicht auf der realen. Ein Klick ins Inntal, den das Modell
   * als geglätteten Hang führt, erklärt eine Bodenschicht, die sonst wie ein
   * Fehler aussieht.
   *
   * Als SPANNE, wenn die Modelle sich uneinig sind: gemessen melden sie
   * meist dieselbe Höhe (Open-Meteo rechnet jedes auf sein eigenes 90-m-DEM
   * herunter), verlassen sollte man sich darauf nicht — eine einzelne Zahl
   * wäre dann die Höhe irgendeines Modells.
   */
  const elevationText = useMemo(() => {
    const vals = results
      .map((r) => r.data?.elevation)
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (!vals.length) return null
    const lo = Math.round(Math.min(...vals))
    const hi = Math.round(Math.max(...vals))
    return lo === hi ? `${lo} m` : `${lo}–${hi} m`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, modelsKey])

  // Sondierungsspalte UND Kennzahlen je Modell zum aktuellen Zeitpunkt
  // (memoisiert; auf geladene Daten + Zeit keyen, results ist jede Runde ein
  // neues Array). Die Spalte wird auch gezeichnet — Diagramm und Tabelle
  // sollen nicht aus zwei verschiedenen Datenständen kommen.
  const columns = useMemo(
    () =>
      panel.models.map((_id, i) => {
        const p = results[i]?.data
        if (!p) return null
        const ti = Math.min(timeToIndex(panelTime), p.times.length - 1)
        return columnFromProfile(
          p.levels,
          p.temperature,
          p.dewpoint,
          p.windSpeed,
          p.windDirection,
          p.height,
          ti,
          surfaceAt(p, ti),
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedKey, panelTime, modelsKey],
  )
  const soundings = useMemo(
    () => columns.map((col) => (col ? computeSounding(col) : null)),
    [columns],
  )
  const soundingsRef = useRef(soundings)
  soundingsRef.current = soundings
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  /**
   * Hodograf-Daten für EIN Modell: bevorzugt ECMWF (auf Wunsch), sonst das
   * erste mit Daten. u/v (kt) je Level, Höhe über Grund, Boden zuerst.
   *
   * Aus der SPALTE, nicht aus den Rohleveln — sonst stünden hier dieselben
   * unterirdisch extrapolierten Winde, und gerade der Hodograf lebt vom
   * bodennahen Teil: die Scherung der untersten Kilometer ist sein Zweck.
   */
  const hodoData = useMemo<HodoPoint[] | null>(() => {
    let idx = panel.models.findIndex((id, k) => id === 'ecmwf_ifs025' && columns[k])
    if (idx < 0) idx = columns.findIndex((c) => c != null)
    if (idx < 0) return null
    const col = columns[idx] as SoundingColumn
    const pts: HodoPoint[] = []
    let surfaceZ: number | null = null
    for (let l = 0; l < col.p.length; l++) {
      const u = col.u[l]
      const v = col.v[l]
      const z = col.z[l]
      if (u == null || v == null || z == null) continue
      if (surfaceZ == null) surfaceZ = z
      pts.push({ zAgl: z - surfaceZ, u: u * MS_TO_KT, v: v * MS_TO_KT })
    }
    return pts.length >= 2 ? pts : null
  }, [columns, panel.models])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 10 || h < 10) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const g = makeGeometry(38, 8, w - 38 - 44, h - 8 - 22)
      drawSkewTBackground(ctx, g, DEFAULT_SKEWT_THEME)

      const sounds = soundingsRef.current
      const cols = columnsRef.current
      let barb: { col: SoundingColumn; color: string } | null = null
      let refParcelDrawn = false

      panel.models.forEach((id, i) => {
        const col = cols[i]
        if (!col) return
        const color = SERIES_COLORS[panel.modelSlots[id] ?? 0]
        // Bezugsmodell = erstes mit Sondierung: ML-Paket + CAPE/CIN zuerst (unten).
        // ML statt SB, weil das SB-Paket abends durch die Grenzschichtproblematik
        // (nächtliche Bodeninversion) irreführendes CAPE liefert.
        if (!refParcelDrawn && sounds[i]) {
          drawParcel(ctx, g, sounds[i]!.ml)
          refParcelDrawn = true
        }
        strokeColumnLine(ctx, g, col, col.T, color, [])
        strokeColumnLine(ctx, g, col, col.Td, color, [4, 3])
        if (!barb) barb = { col, color }
      })

      if (barb) {
        const { col, color } = barb as { col: SoundingColumn; color: string }
        const bx = g.left + g.width + 20
        // So viele Level wie ohne Überlappung passen (adaptiv statt fester
        // Liste). Die Obergrenze setzt die API, nicht diese Schleife — siehe
        // BARB_MIN_GAP. Gezeichnet wird aus derselben Spalte wie die Kurven,
        // also ohne die unterirdischen Level und mit dem Bodenwind zuunterst.
        let lastBarbY = Infinity
        for (let i = 0; i < col.p.length; i++) {
          const y = yFromP(g, col.p[i])
          if (Math.abs(y - lastBarbY) < BARB_MIN_GAP) continue
          const u = col.u[i]
          const v = col.v[i]
          if (u == null || v == null) continue
          // u/v (m/s) zurück in Betrag und Herkunftsrichtung
          const spdKt = Math.hypot(u, v) * MS_TO_KT
          const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
          drawWindBarb(ctx, bx, y, spdKt, dir, color, BARB_LEN)
          lastBarbY = y
        }
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, panelTime, modelsKey, panel.modelSlots])

  // Hodograf in sein Overlay zeichnen (nur wenn geöffnet)
  useEffect(() => {
    if (!showHodo) return
    const canvas = hodoCanvasRef.current
    const container = hodoContainerRef.current
    if (!canvas || !container) return
    const draw = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 10 || h < 10) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (hodoData) drawHodograph(ctx, w, h, hodoData)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [showHodo, hodoData])

  if (!location) {
    return <div className="panel-placeholder">Kein Standort gewählt — oben Ort suchen oder Karte klicken</div>
  }
  if (panel.models.length === 0) {
    return <div className="panel-placeholder">Keine Modelle gewählt</div>
  }
  if (!panel.models.some((id) => supportsPressureLevels(id))) {
    return (
      <div className="panel-placeholder">Keines der gewählten Modelle liefert Drucklevel-Daten</div>
    )
  }
  // Profile werden nur für PROFILE_FORECAST_DAYS geholt, das Zeitraster reicht
  // aber über 16 Tage. Ohne diese Meldung würde das Panel stillschweigend das
  // LETZTE verfügbare Profil zeichnen und so eine falsche Zeit behaupten.
  const profileEnd = results.reduce(
    (end, r) => (r.data?.times.length ? Math.max(end, r.data.times[r.data.times.length - 1]) : end),
    0,
  )
  if (profileEnd > 0 && panelTime > profileEnd) {
    return (
      <div className="panel-placeholder">
        Vertikalprofile enden bei +{PROFILE_FORECAST_DAYS * 24} h — Zeit-Cursor liegt dahinter
      </div>
    )
  }

  return (
    <div className="skewt">
      <div ref={containerRef} className="skewt-canvas">
        <canvas ref={canvasRef} />
      </div>
      <span className="skewt-time">
        {formatCursorTime(panelTime)}
        {elevationText && (
          <span
            className="skewt-elev"
            title="Geländehöhe, mit der das Modell an diesem Punkt rechnet — nicht die reale Höhe. Das Profil beginnt hier."
          >
            Modell {elevationText}
          </span>
        )}
      </span>
      <div className="skewt-toggles">
        <button
          type="button"
          className="skewt-params-toggle"
          onClick={() => setShowHodo((v) => !v)}
          title="Hodograf ein-/ausblenden"
        >
          Hodograf {showHodo ? '✕' : '▾'}
        </button>
        <button
          type="button"
          className="skewt-params-toggle"
          onClick={() => setShowParams((v) => !v)}
          title="Kennzahlentabelle ein-/ausblenden — das Diagramm bleibt in voller Größe"
        >
          Kennzahlen {showParams ? '✕' : '▾'}
        </button>
      </div>
      {showHodo && (
        <div ref={hodoContainerRef} className="skewt-hodo">
          <canvas ref={hodoCanvasRef} />
          {!hodoData && <span className="skewt-hodo-empty">Kein Wind-/Höhenprofil</span>}
        </div>
      )}
      {showParams && (
        <div className="skewt-params">
          {/* Kurz halten: der Kasten steht jetzt dauerhaft da, und ein
              Erklärsatz, den man einmal liest, kostet sonst jede Sitzung
              Fläche. Das Bezugspaket steht ohnehin an den Zeilen („LI (ML)",
              „CIN (ML)"), der Rest im Tooltip. */}
          <span
            className="skewt-hint"
            title="Bezugspaket ist ML (Mittel der untersten 100 hPa) — daraus stammen der Parzellenweg im Diagramm und der LI. SB (bodenbasiert) und MU (labilstes Paket) stehen zum Vergleich daneben. CAPE/CIN in J/kg."
          >
            — T · - - Td · ⋯ ML-Paket · <span style={{ color: '#d63a2b' }}>▉ CAPE</span>{' '}
            <span style={{ color: '#4a93e8' }}>▉ CIN</span>
          </span>
          <table className="skewt-table">
            <thead>
              <tr>
                <th />
                {panel.models.map((id) => (
                  <th key={id}>
                    <span
                      className="legend-chip"
                      style={{ background: SERIES_COLORS[panel.modelSlots[id] ?? 0] }}
                    />
                    {getModel(id).label}
                    {/* Welcher Lauf das Profil ist — bei einer Schichtung
                        entscheidet das Alter über die Aussage. */}
                    <span className="legend-run" title={RUN_TITLE}>
                      {formatRun(latestRun(getModel(id), Date.now()))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {panel.models.map((id, i) => {
                    const s = soundings[i]
                    const r = results[i]
                    return (
                      <td key={id}>
                        {!supportsPressureLevels(id)
                          ? 'n. v.'
                          : s
                            ? row.get(s)
                            : r?.isPending
                              ? '…'
                              : r?.isError
                                ? '✕'
                                : '–'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
