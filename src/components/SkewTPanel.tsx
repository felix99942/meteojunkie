// Vertikalprofil-/Skew-T-Panel (SPEC §13, Phase 3): Drucklevel-Sondierung am
// Location-Lock-Punkt, mehrere Modelle überlagert. Custom-Canvas (kein uPlot):
// Hintergrund aus skewt.ts, darüber T-/Td-Kurve pro Modell, Windbarben und —
// fürs Bezugsmodell — der gehobene Parzellenweg mit CAPE (rot) / CIN (blau).
// Darunter eine Vergleichstabelle der Kennzahlen (Parameter × Modell).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { seriesKey } from '../lib/dataKey'
import { useProfiles, useSonde, useSondeIndex } from '../api/queries'
import {
  distanceKm,
  formatLaunch,
  formatTerm,
  nearestSonde,
  SONDE_AUTO_KM,
  sondeColumn,
  thinColumn,
} from '../api/sondes'
import type { Profile } from '../api/openmeteo'
import { SERIES_COLORS } from '../config/colors'
import { getModel } from '../config/models'
import { formatRun, latestRun, RUN_TITLE } from '../config/runs'
import { supportsPressureLevels } from '../config/levels'
import { formatCursorTime, PROFILE_FORECAST_DAYS, TIME_RANGE, timeToIndex } from '../config/time'
import {
  columnFromProfile,
  computeSounding,
  thetaEProfile,
  wetBulbColumn,
  type SoundingColumn,
  type SoundingParams,
  type SurfacePoint,
  type ThetaEProfile,
} from '../lib/sounding'
import {
  DEFAULT_SKEWT_THEME,
  drawHodograph,
  drawParcel,
  drawDowndraft,
  drawSkewTBackground,
  drawThetaEColumn,
  drawWindBarb,
  makeGeometry,
  WETBULB_LINE,
  xFromTP,
  yFromP,
  type HodoPoint,
  type SkewTGeometry,
} from '../render/skewt'
import { useWorkbench, type PanelConfig } from '../state/workbench'

// Die Dokumentation bringt KaTeX samt Schriften mit — erst beim ersten Klick
// auf „Info" laden, nicht mit dem Bereich.
const SoundingInfo = lazy(() => import('./SoundingInfo'))

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
 * Breite der θe-Spalte samt Abstand. 76 px reichen für eine Kurve über
 * 40–60 K Spanne und die beiden Randbeschriftungen; mehr nähme dem Skew-T
 * die Fläche, auf die es hier ankommt.
 */
const THETAE_W = 76
/**
 * Schaftlänge, passend zum Abstand: bei 8 px Abstand sind 30 px Schaft zu
 * lang, die Fiedern der Nachbarn greifen ineinander.
 */
const BARB_LEN = 22

/**
 * Ausdünnung der Messung für θe-Spalte und Windfiedern (hPa). Die Modelle
 * liefern ohnehin nur 13–19 Level; eine Sonde mit Punkten alle 2 hPa wäre
 * dort ein Klumpen. Rund 25 Schichten über die Troposphäre — genug, um
 * eine Inversion oder einen Scherungsknick zu zeigen.
 */
const OBS_DISPLAY_STEP_HPA = 25

/**
 * Farbe der MESSUNG. Weiss, weil sie keine Modellfarbe sein darf (die Slots
 * gehören den Modellen) und weil sie die Bezugskurve ist, gegen die man die
 * Modelle liest — sie soll obenauf am hellsten sein. Gegen den ebenfalls
 * hellen ML-Parzellenweg trennt sie Strichart und Breite: der ist dünn und
 * gepunktet, die Messung kräftig, durchgezogen und dunkel unterlegt.
 */
const OBS_COLOR = '#f4f4f4'

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
  /**
   * FEUCHTKUGEL-Nullgradgrenze — die für den Niederschlagstyp entscheidende
   * der beiden. Schnee, der in ungesättigte Luft fällt, kühlt sie durch
   * Schmelzen und Verdunsten auf die Feuchtkugeltemperatur ab und überlebt
   * deshalb bis etwa hierher; bei trockener Luft sind das mehrere hundert
   * Meter unter der „trockenen" Nullgradgrenze darüber.
   */
  {
    label: '0 °C feucht',
    get: (s) =>
      s.wetBulbZeroZ != null
        ? `${Math.round(s.wetBulbZeroZ / 10) * 10} m`
        : dash(s.wetBulbZeroP != null ? `${Math.round(s.wetBulbZeroP)} hPa` : null),
  },
  // DCAPE: Energie des ABWINDS. Hoch bei trockener Mittelschicht — das
  // Kennzeichen für Fallböen (Sturm am Boden ohne viel Regen).
  { label: 'DCAPE', get: (s) => dash(s.dcape != null ? `${Math.round(s.dcape)}` : null) },
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
  lineWidth = 2,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
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
  /**
   * QUELLE des Diagramms — Vorhersage, Messung oder beides. Bewusst drei
   * getrennte Ansichten statt einer Messkurve, die nur dazukommt: ein Skew-T
   * liest man über die Flächen (CAPE, CIN, DCAPE), und die gehören immer zu
   * GENAU EINEM Profil. Im Vergleich bleiben sie beim Modell; in der
   * Messansicht gehören Paket, Flächen, Windfiedern und Hodograf dem Aufstieg.
   */
  const source = useWorkbench((s) => s.soundingSource)
  const setSource = useWorkbench((s) => s.setSoundingSource)
  const wantModels = source !== 'obs'
  const wantObs = source !== 'model'
  // Im Messmodus werden die Modelle gar nicht erst geholt — das ist Budget
  // (rund 10 gewichtete Calls je Modell), nicht nur Anzeige.
  const models = useMemo(() => (wantModels ? panel.models : []), [wantModels, panel.models])
  const results = useProfiles(location, models)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hodoContainerRef = useRef<HTMLDivElement>(null)
  const hodoCanvasRef = useRef<HTMLCanvasElement>(null)
  // Kennzahlen sind standardmässig SICHTBAR: sie sind der Grund, warum man
  // ein Sounding aufschlägt, und seit die Grenze zur Karte ziehbar ist, hat
  // das Diagramm den Platz dafür. Ausblenden bleibt möglich.
  const [showParams, setShowParams] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const closeInfo = useCallback(() => setShowInfo(false), [])
  const [showHodo, setShowHodo] = useState(false)
  /**
   * θe-Spalte neben dem Diagramm. Vorgabe AN: sie beantwortet eine Frage, die
   * man am T/Td-Paar erst zusammensetzen muss (siehe `thetaEProfile`), und
   * kostet nur Platz, keine Daten — gerechnet wird aus denselben Leveln.
   */
  const [showThetaE, setShowThetaE] = useState(true)
  /**
   * Feuchtkugelkurve. Sie liegt zwischen T und Td und ist die Kurve, an der
   * man abliest, wie weit Verdunstung die Luft abkühlen kann — Schneefall-
   * grenze (Tw = 0 °C) und Abwindtemperatur hängen daran. Bei mehreren
   * Modellen wird es zu dritt eng, deshalb abschaltbar und
   * standardmäßig aus.
   */
  const [showWetBulb, setShowWetBulb] = useState(false)
  /**
   * Abwindweg samt DCAPE-Fläche. Wie der Parzellenweg nur für das
   * Bezugsmodell — zwei Absinkkurven übereinander sagen nichts, was die Zahl
   * in der Tabelle nicht besser sagt.
   */
  const [showDowndraft, setShowDowndraft] = useState(false)
  /**
   * Die übrigen Schichten des Diagramms. Sie stehen als Häkchen IN der
   * Legende — die Legende sagt ohnehin, was welche Farbe bedeutet, und wer
   * eine Fläche sucht, sucht sie dort. Ein zweiter Satz Knöpfe oben wäre
   * dieselbe Auskunft an einer zweiten Stelle.
   */
  const [showParcel, setShowParcel] = useState(true)
  const [showCape, setShowCape] = useState(true)
  const [showCin, setShowCin] = useState(true)

  const panelTime = panel.sync ? cursorTime : panel.localTime
  const setCursorTime = useWorkbench((s) => s.setCursorTime)

  // ── GEMESSENER AUFSTIEG ─────────────────────────────────────────────────
  // Automatisch die nächste Station, wenn sie nahe genug liegt
  // (SONDE_AUTO_KM); eine Wahl von Hand gilt nur für DIESEN Ort — beim
  // nächsten Ortswechsel greift wieder die Automatik, sonst stünde nach
  // einem Sprung nach Wien weiter der Aufstieg von Payerne im Diagramm.
  const sondeIndex = useSondeIndex()
  const locKey = location ? `${location.lat},${location.lon}` : ''
  const [obsPick, setObsPick] = useState<{ loc: string; id: string } | null>(null)
  const [obsTermPick, setObsTermPick] = useState<string | null>(null)
  const sondeStations = sondeIndex.data?.stations ?? []
  const nearest = location ? nearestSonde(sondeStations, location) : null
  // In der reinen Messansicht IMMER die nächste Station — dort gibt es kein
  // Modellprofil, das man mit einem entfernten Aufstieg verwechseln könnte.
  // Im Vergleich nur in der Nähe (SONDE_AUTO_KM).
  const obsStationId =
    obsPick?.loc === locKey
      ? obsPick.id
      : nearest && (source === 'obs' || nearest.km <= SONDE_AUTO_KM)
        ? nearest.station.id
        : 'none'
  const obsStation = sondeStations.find((s) => s.id === obsStationId) ?? null
  const obsEntry =
    obsStation?.soundings.find((e) => e.term === obsTermPick) ?? obsStation?.soundings[0] ?? null
  const obsKm = obsStation && location ? distanceKm(location, obsStation) : null
  const sonde = useSonde(wantObs && obsEntry ? obsEntry.file : null)
  const obsColumn = useMemo(
    () => (wantObs && sonde.data && sonde.data.term === obsEntry?.term ? sondeColumn(sonde.data) : null),
    [wantObs, sonde.data, obsEntry?.term],
  )
  const obsSounding = useMemo(() => (obsColumn ? computeSounding(obsColumn) : null), [obsColumn])
  const obsColumnRef = useRef(obsColumn)
  obsColumnRef.current = obsColumn
  const obsSoundingRef = useRef(obsSounding)
  obsSoundingRef.current = obsSounding
  const obsTermMs = obsEntry ? Date.parse(obsEntry.term) : null
  // Nach Stationen sortiert nach Entfernung — die Liste ist eine Ortswahl.
  const stationOptions = useMemo(
    () =>
      location
        ? [...sondeStations]
            .map((s) => ({ s, km: distanceKm(location, s) }))
            .sort((a, b) => a.km - b.km)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sondeIndex.data, locKey],
  )
  // Über die IDENTITÄT der Serien, nicht über „geladen ja/nein": ein Wechsel
  // zwischen zwei bereits geladenen Punkten ließ den Schlüssel sonst
  // unverändert, und das Skew-T zeigte weiter das alte Profil — an einem
  // Sounding die denkbar unauffälligste Art, falsch zu sein
  // (Messung in `lib/dataKey.ts`).
  const loadedKey = seriesKey(results.map((r) => r.data))
  const modelsKey = models.join()

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
      models.map((_id, i) => {
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
    let col: SoundingColumn
    if (source === 'obs') {
      if (!obsColumn) return null
      col = obsColumn
    } else {
      let idx = models.findIndex((id, k) => id === 'ecmwf_ifs025' && columns[k])
      if (idx < 0) idx = columns.findIndex((c) => c != null)
      if (idx < 0) return null
      col = columns[idx] as SoundingColumn
    }
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
  }, [columns, models, source, obsColumn])

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

      // Die θe-Spalte nimmt dem Diagramm Breite weg — sie steht ZWISCHEN
      // Diagramm und Windfiedern, damit beide ihre Druckachse behalten.
      const teW = showThetaE ? THETAE_W : 0
      const g = makeGeometry(38, 8, w - 38 - 44 - teW, h - 8 - 22)
      drawSkewTBackground(ctx, g, DEFAULT_SKEWT_THEME)

      const sounds = soundingsRef.current
      const cols = columnsRef.current
      let barb: { col: SoundingColumn; color: string; gap?: number } | null = null
      let refParcelDrawn = false

      const obs = obsColumnRef.current
      const obsS = obsSoundingRef.current
      // In der Messansicht gehören Paket und Flächen dem AUFSTIEG.
      if (source === 'obs' && obs && obsS) {
        drawParcel(ctx, g, obsS.ml, { path: showParcel, cape: showCape, cin: showCin })
        if (showDowndraft && obsS.downdraft) drawDowndraft(ctx, g, obsS.downdraft)
        refParcelDrawn = true
        if (showWetBulb) {
          strokeColumnLine(ctx, g, obs, wetBulbColumn(obs), WETBULB_LINE, [2, 3], 1.5)
        }
        barb = { col: thinColumn(obs, OBS_DISPLAY_STEP_HPA), color: OBS_COLOR, gap: 14 }
      }

      models.forEach((id, i) => {
        const col = cols[i]
        if (!col) return
        const color = SERIES_COLORS[panel.modelSlots[id] ?? 0]
        // Bezugsmodell = erstes mit Sondierung: ML-Paket + CAPE/CIN zuerst (unten).
        // ML statt SB, weil das SB-Paket abends durch die Grenzschichtproblematik
        // (nächtliche Bodeninversion) irreführendes CAPE liefert.
        if (!refParcelDrawn && sounds[i]) {
          drawParcel(ctx, g, sounds[i]!.ml, {
            path: showParcel,
            cape: showCape,
            cin: showCin,
          })
          // Der Abwind ZUERST wäre falsch herum: die DCAPE-Fläche liegt
          // unten, wo auch CIN liegt, und soll obenauf sichtbar bleiben.
          const dd = sounds[i]!.downdraft
          if (showDowndraft && dd) drawDowndraft(ctx, g, dd)
          refParcelDrawn = true
        }
        strokeColumnLine(ctx, g, col, col.T, color, [])
        strokeColumnLine(ctx, g, col, col.Td, color, [4, 3])
        // Feuchtkugel: fein gepunktet und dünner als T/Td — sie ist die
        // dritte Kurve desselben Modells und soll die beiden nicht
        // überstimmen.
        if (showWetBulb) {
          strokeColumnLine(ctx, g, col, wetBulbColumn(col), WETBULB_LINE, [2, 3], 1.5)
        }
        if (!barb) barb = { col, color }
      })

      // Messung ZULETZT und damit obenauf, dunkel unterlegt: sie ist die
      // Bezugskurve, und dicht über einer Modellkurve soll sie nicht in
      // deren Farbe verschwinden.
      if (obs) {
        // Td DURCHGEZOGEN, nicht gestrichelt wie bei den Modellen: eine
        // hochaufgelöste Sonde liefert alle 2 hPa einen Punkt, und an scharf
        // begrenzten Trockenschichten springt der Taupunkt um 15 K auf
        // wenigen Metern (echt, gemessen). Die Strichelung zerhackte das zu
        // einem Rauschen. Welche Kurve Td ist, sagt die Lage — sie liegt
        // immer links von T.
        strokeColumnLine(ctx, g, obs, obs.T, 'rgba(0,0,0,0.7)', [], 5)
        strokeColumnLine(ctx, g, obs, obs.Td, 'rgba(0,0,0,0.7)', [], 4)
        strokeColumnLine(ctx, g, obs, obs.T, OBS_COLOR, [], 2.5)
        strokeColumnLine(ctx, g, obs, obs.Td, OBS_COLOR, [], 1.5)
      }

      if (showThetaE) {
        // Kurven für ALLE Modelle (der Vergleich ist der Sinn dieses
        // Bereichs), Schichtungsbänder nur vom ERSTEN — übereinandergelegte
        // Bänder ergäben eine Farbe, die keiner Schicht mehr entspricht.
        const curves: { profile: ThetaEProfile; color: string }[] = []
        models.forEach((id, i) => {
          const col = cols[i]
          if (!col) return
          const profile = thetaEProfile(col)
          if (profile) curves.push({ profile, color: SERIES_COLORS[panel.modelSlots[id] ?? 0] })
        })
        // Die Messung als Kurve dazu, aber NICHT als Bänder: die Schichtung
        // bleibt die des ersten Modells — sonst wechselte die Bedeutung der
        // Farbfläche mit dem An- und Abschalten der Messung.
        const obsProfile = obs ? thetaEProfile(thinColumn(obs, OBS_DISPLAY_STEP_HPA)) : null
        const bands = curves[0]?.profile.layers ?? obsProfile?.layers ?? null
        if (obsProfile) curves.push({ profile: obsProfile, color: OBS_COLOR })
        drawThetaEColumn(
          ctx,
          g,
          g.left + g.width + 8,
          THETAE_W - 12,
          curves,
          bands,
          DEFAULT_SKEWT_THEME,
        )
      }

      if (barb) {
        const { col, color, gap } = barb as { col: SoundingColumn; color: string; gap?: number }
        const bx = g.left + g.width + (showThetaE ? THETAE_W : 0) + 20
        // So viele Level wie ohne Überlappung passen (adaptiv statt fester
        // Liste). Die Obergrenze setzt die API, nicht diese Schleife — siehe
        // BARB_MIN_GAP. Gezeichnet wird aus derselben Spalte wie die Kurven,
        // also ohne die unterirdischen Level und mit dem Bodenwind zuunterst.
        let lastBarbY = Infinity
        for (let i = 0; i < col.p.length; i++) {
          const y = yFromP(g, col.p[i])
          if (Math.abs(y - lastBarbY) < (gap ?? BARB_MIN_GAP)) continue
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
  }, [
    loadedKey,
    panelTime,
    modelsKey,
    panel.modelSlots,
    showThetaE,
    showWetBulb,
    showDowndraft,
    showParcel,
    showCape,
    showCin,
    obsColumn,
    source,
  ])

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
  // Profile werden nur für PROFILE_FORECAST_DAYS geholt, das Zeitraster reicht
  // aber über 16 Tage. Ohne diese Meldung würde das Panel stillschweigend das
  // LETZTE verfügbare Profil zeichnen und so eine falsche Zeit behaupten.
  const profileEnd = results.reduce(
    (end, r) => (r.data?.times.length ? Math.max(end, r.data.times[r.data.times.length - 1]) : end),
    0,
  )
  const hasSondes = sondeStations.length > 0
  /**
   * Warum gerade NICHTS gezeichnet werden kann — als Meldung IM Panel statt
   * als frühes `return`: der Quellen-Umschalter muss stehen bleiben, sonst
   * käme man aus einer leeren Ansicht nicht mehr heraus.
   */
  const blocker: string | null = wantModels
    ? panel.models.length === 0
      ? 'Keine Modelle gewählt'
      : !panel.models.some((id) => supportsPressureLevels(id))
        ? 'Keines der gewählten Modelle liefert Drucklevel-Daten'
        : profileEnd > 0 && panelTime > profileEnd
          ? `Vertikalprofile enden bei +${PROFILE_FORECAST_DAYS * 24} h — Zeit-Cursor liegt dahinter`
          : null
    : sondeIndex.isPending
      ? null
      : !hasSondes
        ? 'Keine Messungen vorhanden — lokal erst nach „npm run ingest:sondes".'
        : !obsStation
          ? 'Keine Station gewählt'
          : null

  const sourceSwitch = (
    <div className="skewt-source" role="radiogroup" aria-label="Quelle des Profils">
      {(
        [
          {
            id: 'model',
            label: 'Vorhersage',
            sub: 'Modelle',
            title: 'Nur die Modellprofile zum Zeit-Cursor — wie die Atmosphäre werden SOLL.',
          },
          {
            id: 'obs',
            label: 'Messung',
            sub: 'Radiosonde',
            title:
              'Nur der gemessene Radiosondenaufstieg — wie die Atmosphäre WAR. ML-Paket, CAPE/CIN, DCAPE, Windfiedern und Hodograf gehören dann dem Aufstieg. Kostet kein Modellbudget.',
          },
          {
            id: 'both',
            label: 'Vergleich',
            sub: 'Modell + Messung',
            title:
              'Messung als weisse Kurve über den Modellen. Paket und Flächen bleiben beim ersten Modell; für einen fairen Vergleich den Zeit-Cursor auf den Termin des Aufstiegs setzen.',
          },
        ] as const
      ).map((o) => {
        const disabled = o.id !== 'model' && !hasSondes
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={source === o.id}
            className={`skewt-source-btn is-${o.id}`}
            disabled={disabled}
            onClick={() => setSource(o.id)}
            title={disabled ? 'Keine Messungen vorhanden (Ingest fehlt)' : o.title}
          >
            <span className="skewt-source-label">{o.label}</span>
            <span className="skewt-source-sub">{o.sub}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`skewt is-${source}${showThetaE ? ' has-thetae' : ''}`}>
      <div ref={containerRef} className="skewt-canvas">
        <canvas ref={canvasRef} />
      </div>
      {blocker && <div className="panel-placeholder skewt-blocker">{blocker}</div>}
      <div className="skewt-topleft">
        {sourceSwitch}
        {/* WAS GEZEIGT WIRD, in der Farbe seiner Quelle: Vorhersage nennt
            Modellzeit und Modellhöhe, Messung Station, Termin und Start. */}
        {wantModels && (
          <span className="skewt-time skewt-time-model">
            <span className="skewt-time-tag">Vorhersage</span>
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
        )}
      {/* BILDLEGENDE ALS SCHALTBRETT, links oben unter der Zeit.
          Sie sagt, was welche Farbe bedeutet — und schaltet dieselbe Schicht
          gleich ein und aus: wer eine Fläche loswerden will, sucht sie dort,
          wo ihre Farbe erklärt ist, nicht in einer Knopfreihe am anderen Ende.
          Bewusst AUSSERHALB der Kennzahlentabelle: die kann man zuklappen, die
          Legende muss stehen bleiben. T und Td haben kein Häkchen — ohne sie
          gäbe es kein Diagramm. */}
        {wantObs && hasSondes && (
          <div className="skewt-time skewt-time-obs">
            <span className="skewt-time-tag">Messung</span>
            <select
              value={obsStationId}
              onChange={(e) => {
                setObsPick({ loc: locKey, id: e.target.value })
                setObsTermPick(null)
              }}
              title={
                source === 'obs'
                  ? 'Radiosondenstation — vorgewählt ist die nächste zum gewählten Punkt.'
                  : `Radiosondenstation. Automatisch gewählt wird die nächste, wenn sie höchstens ${SONDE_AUTO_KM} km entfernt ist — weiter weg misst die Sonde eine andere Luftsäule, und der Unterschied sähe wie ein Modellfehler aus.`
              }
            >
              <option value="none">— keine Station —</option>
              {stationOptions.map(({ s, km }) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({Math.round(km)} km)
                </option>
              ))}
            </select>
            {obsStation && (
              <select
                value={obsEntry?.term ?? ''}
                onChange={(e) => setObsTermPick(e.target.value)}
                title="Termin des Aufstiegs (Nenntermin). Gestartet wird bis zu zwei Stunden davor bzw. danach — die echte Startzeit steht daneben."
              >
                {obsStation.soundings.map((e) => (
                  <option key={e.term} value={e.term}>
                    {formatTerm(e.term)}
                  </option>
                ))}
              </select>
            )}
            {obsStation == null && nearest && (
              <span className="skewt-obs-note">
                nächste Station {nearest.station.name}, {Math.round(nearest.km)} km
              </span>
            )}
            {obsEntry && obsStation && (
              <span className="skewt-obs-note">
                Start {formatLaunch(obsEntry.launch)} · {obsStation.elev} m
                {obsKm != null && obsKm >= 1 ? ` · ${Math.round(obsKm)} km vom Punkt` : ''}
                {obsEntry.top > 150 ? ` · endet bei ${Math.round(obsEntry.top)} hPa` : ''}
                {sonde.isPending ? ' · lädt …' : sonde.isError ? ' · ✕ nicht ladbar' : ''}
              </span>
            )}
            {/* Modell und Messung zu VERSCHIEDENEN Zeiten zu vergleichen ist
                der naheliegende Fehlgriff: der Zeit-Cursor steht beim Öffnen
                auf „jetzt", der Aufstieg ist Stunden alt. */}
            {source === 'both' && obsTermMs != null && obsTermMs !== panelTime && (
              obsTermMs >= TIME_RANGE.start && panel.sync ? (
                <button
                  type="button"
                  className="skewt-obs-sync"
                  onClick={() => setCursorTime(obsTermMs)}
                  title="Zeit-Cursor auf den Termin des Aufstiegs setzen — erst dann vergleichen Modell und Messung dieselbe Luftsäule zur selben Zeit."
                >
                  ⚠ Zeiten verschieden — Modell auf Termin setzen
                </button>
              ) : (
                <span
                  className="skewt-obs-note skewt-obs-warn"
                  title="Das Zeitraster der Modelle beginnt heute 00 UTC; ältere Termine sind nur als Messung zu sehen."
                >
                  ⚠ Modell zeigt eine andere Zeit
                </span>
              )
            )}
          </div>
        )}
        <div className="skewt-legend">
          <span className="skewt-legend-static">
            <i className="sl-line" /> T
          </span>
          <span className="skewt-legend-static">
            <i className="sl-line sl-dash" /> Td
          </span>
          <label title="Feuchtkugeltemperatur: worauf Verdunstung die Luft abkühlen kann. Liegt zwischen Td und T; an Tw = 0 °C liest man die Schneefallgrenze ab.">
            <input
              type="checkbox"
              checked={showWetBulb}
              onChange={(e) => setShowWetBulb(e.target.checked)}
            />
            <i className="sl-line sl-dot" style={{ color: WETBULB_LINE }} /> Tw
          </label>
          <label title="Weg des gehobenen ML-Pakets samt LCL/LFC/EL-Marken am linken Rand.">
            <input
              type="checkbox"
              checked={showParcel}
              onChange={(e) => setShowParcel(e.target.checked)}
            />
            <i className="sl-line sl-dot" style={{ color: 'rgb(232,228,220)' }} /> ML-Paket
          </label>
          <label title="Fläche, auf der das gehobene Paket WÄRMER ist als die Umgebung — die Energie des Aufwinds. Sie beginnt etwas über der LFC-Marke: gerechnet wird der Auftrieb über die Virtualtemperatur (feuchte Luft ist bei gleicher Temperatur leichter), gezeichnet sind die echten Temperaturen, und die kreuzen sich erst ein Stück höher.">
            <input
              type="checkbox"
              checked={showCape}
              onChange={(e) => setShowCape(e.target.checked)}
            />
            <i className="sl-area" style={{ background: 'rgba(214,58,43,0.55)' }} /> CAPE
          </label>
          <label title="Fläche, auf der das Paket unterhalb des LFC KÄLTER ist — die Sperre, die erst überwunden werden muss.">
            <input
              type="checkbox"
              checked={showCin}
              onChange={(e) => setShowCin(e.target.checked)}
            />
            <i className="sl-area" style={{ background: 'rgba(74,147,232,0.55)' }} /> CIN
          </label>
          <label title="Absinkender, durch Verdunstung gekühlter Abwind vom θe-Minimum zum Boden. Die Fläche IST die DCAPE.">
            <input
              type="checkbox"
              checked={showDowndraft}
              onChange={(e) => setShowDowndraft(e.target.checked)}
            />
            <i className="sl-area" style={{ background: 'rgba(118,104,224,0.6)' }} /> DCAPE
          </label>
        </div>
        {/* ZUSATZSCHICHTEN direkt unter der Legende: θe-Spalte und Hodograf
            ändern, was man sieht, und gehören deshalb dorthin, wo man die
            Bildinhalte schaltet — nicht klein zwischen „Info" und „Kennzahlen"
            an den rechten Rand. Als Umschalter mit sichtbarem Zustand. */}
        <div className="skewt-layers">
          <button
            type="button"
            className="skewt-layer-btn"
            aria-pressed={showThetaE}
            onClick={() => setShowThetaE((v) => !v)}
            title="θe-Spalte ein-/ausblenden: äquivalentpotentielle Temperatur über die Höhe, hinterlegt mit der Schichtung — rot = potentiell instabil (θe nimmt nach oben ab), blau = stabil, grau = neutral."
          >
            θe-Spalte
          </button>
          <button
            type="button"
            className="skewt-layer-btn"
            aria-pressed={showHodo}
            onClick={() => setShowHodo((v) => !v)}
            title="Hodograf ein-/ausblenden (unten links im Diagramm)"
          >
            Hodograf
          </button>
        </div>
      </div>

      <div className="skewt-toggles">
        {/* Bewusst GROSS und abgesetzt: die Frage „wie ist das gerechnet"
            stellt man einmal, dann aber dringend — sie soll nicht zwischen
            den Layout-Schaltern gesucht werden müssen. */}
        <button
          type="button"
          className="skewt-info-btn"
          onClick={() => setShowInfo((v) => !v)}
          aria-expanded={showInfo}
          title="Wie ML-CAPE, CIN, DCAPE und die Feuchtkugeltemperatur gerechnet werden"
        >
          <span className="skewt-info-icon" aria-hidden="true">
            i
          </span>
          Info
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
      {showInfo && (
        <Suspense fallback={<div className="skewt-info skewt-info-loading">Lade Dokumentation …</div>}>
          <SoundingInfo onClose={closeInfo} />
        </Suspense>
      )}
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
          {/* Die Bildlegende steht jetzt als eigene Leiste über dem Diagramm
              (`.skewt-legend`) — dort schaltet sie zugleich die Schichten.
              Hier bleibt nur, was die TABELLE erklärt. */}
          <span
            className="skewt-hint"
            title="Bezugspaket ist ML (Mittel der untersten 100 hPa) — daraus stammen der Parzellenweg im Diagramm und der LI. SB (bodenbasiert) und MU (labilstes Paket) stehen zum Vergleich daneben."
          >
            Bezugspaket ML · CAPE/CIN/DCAPE in J/kg
          </span>
          {/* Die Bänder der θe-Spalte brauchen eine Lesart — eine Farbe ohne
              Legende ist Dekoration. Steht hier statt unter der Spalte: dort
              sind 64 px, hier ist die Zeile ohnehin für die Bildlegende da. */}
          {showThetaE && (
            <span
              className="skewt-hint"
              title="θe = äquivalentpotentielle Temperatur: die Wärme des Pakets PLUS die, die beim Auskondensieren seines Dampfs frei wird. Sie bleibt bei trockener wie feuchter Hebung erhalten. Nimmt sie mit der Höhe AB, labilisiert sich die Schicht beim Heben von selbst (potentielle Instabilität) — die klassische Gewitterlage vor einer Hebung."
            >
              θe-Spalte:{' '}
              <span style={{ color: 'rgb(214,90,58)' }}>▉ pot. instabil</span> ·{' '}
              <span style={{ color: '#9a9a9a' }}>▉ neutral</span> ·{' '}
              <span style={{ color: 'rgb(110,160,220)' }}>▉ stabil</span>
            </span>
          )}
          <table className="skewt-table">
            <thead>
              <tr>
                <th />
                {models.map((id) => (
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
                {obsColumn && obsStation && obsEntry && (
                  <th className="skewt-obs-col">
                    <span className="legend-chip" style={{ background: OBS_COLOR }} />
                    Messung {obsStation.name}{' '}
                    <span className="legend-run" title={`Start ${formatLaunch(obsEntry.launch)}`}>
                      {formatTerm(obsEntry.term)}
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {models.map((id, i) => {
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
                  {obsColumn && <td className="skewt-obs-col">{obsSounding ? row.get(obsSounding) : '–'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
