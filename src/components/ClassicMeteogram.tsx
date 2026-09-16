// Klassisches Meteogramm (SPEC-Ergänzung): EIN Ort, EIN Modell, die
// Standardgrößen als Stapel übereinander — aufgebaut nach dem etablierten
// Schema der Wetterdienste (DWD/ZAMG/ECMWF-Meteogramm), von oben nach unten:
//
//   1. Wettersymbole (WMO-Code)          — was passiert überhaupt
//   2. Bewölkung in ACHTELN + Schichten  — wie viel Himmel, und in welcher Höhe
//   3. Temperatur / Taupunkt / gefühlt   — mit markierter 0-°C-Linie
//   4. Niederschlag (Regen/Schnee) + Wahrscheinlichkeit
//   5. Wind mit WINDFIEDERN (Knoten) + Böen
//   6. Luftdruck (MSL)
//
// Dazu die Tag/Nacht-Schattierung über alle Zeilen. Diese Reihenfolge und
// dieser Satz Größen sind bewusst NICHT frei konfigurierbar: das ist der
// Kanon, den man von einem Meteogramm erwartet — wer eigene Parameter
// kombinieren will, nimmt den Bereich „Punktprognosen".
//
// Bewusst NICHT dasselbe wie „Punktprognosen" (freie Variable, bis zu 8
// Modelle überlagert): ein gestapeltes Meteogramm mit mehreren Modellen je
// Zeile wäre visuell Chaos, deshalb genau ein wählbares Modell.
//
// Eigenes, schlankes Gerüst wie die Klimakarte (kein Panel-Raster) — teilt
// sich aber den `lockedLocation` mit Punktprognosen/Ensemble/Profil: wer den
// Ort dort setzt, sieht ihn hier sofort, und umgekehrt.

import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import type { HourlySeries } from '../api/openmeteo'
import { useMeteogramSeries } from '../api/queries'
import { ChartRow } from './ChartStack'
import {
  chartHasData,
  RIGHT_AXIS_SIZE,
  Y_AXIS_SIZE,
  type ChartDef,
  type PointMark,
} from '../config/chartDef'
import {
  getModel,
  groupModelsByScale,
  isInCoverage,
  modelHorizonEnd,
  resolutionLabel,
  SCALE_LABELS,
  SELECTABLE_MODELS,
} from '../config/models'
import { formatRunLong, latestRun, RUN_TITLE } from '../config/runs'
import { timeGridMs } from '../config/time'
import { useWorkbench } from '../state/workbench'
import { LocationPicker } from './LocationPicker'
import { OpenMeteoAttribution } from './Attribution'

const DEFAULT_MODEL = 'ecmwf_ifs025'
// UTC, wie der Rest der App intern durchgehend rechnet (siehe CLAUDE.md) — der
// Fetch-Layer fragt in openmeteo.ts überall explizit `timezone: 'UTC'` ab,
// eine echte Ortszeit je Standort gäbe es nur über einen zusätzlichen
// Zeitzonen-Lookup, den es hier (noch) nicht gibt. 12/18 UTC sind auf den
// Achsen deshalb NICHT die Ortszeit des gewählten Punkts. Die
// Tag/Nacht-Schattierung stimmt dagegen ortsgenau: sie kommt aus dem
// Modellfeld `is_day`, nicht aus der Uhrzeit.
const TZ = 'Etc/UTC'
// Nur Mindesthöhe für uPlots Erstaufbau (falls CSS-Flex beim Mount noch nicht
// gegriffen hat) — die tatsächliche Höhe kommt aus .meteo-row/.meteo-plotwrap
// (Flex-Grow nach `ChartDef.flex`) und wird per ResizeObserver in
// ChartStack.tsx nachgezogen.
const CHART_HEIGHT = 110
// Tick-Mindestabstand für die x-Achse: 6-Stunden-Schritte (00/06/12/18) waren
// zu eng, uPlot wählt bei diesem Wert stattdessen bevorzugt 12-Stunden-Schritte
// (00/12) — bei schmalen Fenstern fällt es automatisch auf 24 h zurück, nie
// überlappend.
const X_TICK_SPACE = 40
// Extremwerte werden nur beschriftet, wenn ihr Zeitfenster im Raster
// weitgehend vollständig ist. Am Modellhorizont bricht die Reihe mitten im
// Fenster ab — das „Maximum" der letzten paar Stunden wäre dann eine falsche
// Aussage, kein Tageshöchstwert. (Tag = 24 Stunden, Nacht = 12.)
const MIN_HOURS_FOR_DAILY_MAX = 18
const MIN_HOURS_FOR_NIGHT_MIN = 9
const MS_PER_DAY = 86_400_000

const COLOR_T2M = '#d95926'
const COLOR_TMIN = '#4f97e0'
const COLOR_DEW = '#3f9e5a'
const COLOR_FEELS = '#9b59d0'
const COLOR_RAIN = '#3987e5'
const COLOR_SNOW = '#8fd3ea'
const COLOR_PROB = '#6f7c8c'
const COLOR_WIND = '#199e70'
const COLOR_GUST = '#7fbfa5'
const COLOR_PRESSURE = '#c9a227'
// Standardluftdruck 1013,25 hPa als Bezugslinie — „hoch oder tief" ist die
// erste Frage an eine Druckkurve, und ohne Bezug beantwortet sie eine Achse
// mit zwei Beschriftungen nur mühsam.
const COLOR_PRESSURE_REF = '#7a6a2a'
const COLOR_FREEZING = '#5a7fa8'

// Die Stunden-Achse zeigt nur noch die Uhrzeit — das Datum übernimmt der
// eigene Datumsstreifen unter JEDER Zeile (`dayRow` in ChartStack.tsx), mit
// dem Trennstrich bei 00 UTC, der von der Diagrammfläche bis in den Streifen
// durchläuft.
const hourFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })
const formatMeteoTick = (ts: number): string => hourFmt.format(new Date(ts * 1000))
/**
 * Große Modellzeit in der Leiste zwischen Bewölkung und Temperatur — die
 * Angabe, auf die sich beim Überfahren ALLE Zeilen beziehen. Groß und an der
 * Zeigerposition, weil sie sonst als kleine Zahl irgendwo am Rand steht und
 * man beim Ablesen zwischen Kurve und Ecke hin- und herspringt.
 */
const timeBarFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

/**
 * Zuordnung eines Zeitpunkts zu dem Fenster, über das ein Extremwert gesucht
 * wird — `null`, wenn der Zeitpunkt in keinem Fenster liegt (die Nachtfenster
 * lassen den Tag aus).
 */
type ExtremeWindow = (ms: number) => { key: number; start: number; end: number } | null

/** Kalendertag 00–00 UTC — das Fenster für das Tagesmaximum. */
const CALENDAR_DAY: ExtremeWindow = (ms) => {
  const key = Math.floor(ms / MS_PER_DAY)
  return { key, start: key * MS_PER_DAY, end: (key + 1) * MS_PER_DAY }
}

/**
 * Synoptische Nacht, 18 bis 06 UTC — das Fenster für das Tagesminimum.
 *
 * Über den Kalendertag gerechnet stand vor und nach Mitternacht je ein
 * Minimum, obwohl es EINE Nacht mit EINEM Minimum ist: die Tagesgrenze
 * schneidet genau dort durch, wo die Temperatur ihren Tiefpunkt hat. Das
 * Nachtfenster ist die synoptische Konvention (Tmin gehört zur Nacht, nicht
 * zum Kalendertag) und liefert je Nacht genau einen Wert.
 *
 * Das Maximum bleibt bewusst beim Kalendertag: dort ist die Tagesgrenze kein
 * Schnitt durch ein Extremum, und bei inversem Tagesgang kann der
 * Höchstwert überall im Tag liegen — auch nachts.
 */
const NIGHT_START_H = 18
const NIGHT_END_H = 6
const NIGHT_HOURS = 24 - NIGHT_START_H + NIGHT_END_H
const MS_PER_HOUR = 3_600_000

const SYNOPTIC_NIGHT: ExtremeWindow = (ms) => {
  const hour = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR)
  if (hour >= NIGHT_END_H && hour < NIGHT_START_H) return null
  const day = Math.floor(ms / MS_PER_DAY)
  const key = hour >= NIGHT_START_H ? day : day - 1
  const start = key * MS_PER_DAY + NIGHT_START_H * MS_PER_HOUR
  return { key, start, end: start + NIGHT_HOURS * MS_PER_HOUR }
}

/**
 * Extremwerte einer Reihe je Zeitfenster als beschriftete Punkte.
 *
 * Der PUNKT sitzt exakt auf dem Zeitpunkt des Extremums; nur die ZAHL wird
 * über `spanStart`/`spanEnd` in das Fenster hineingezogen, damit sie nicht
 * über dessen Rand steht und dem Nachbarfenster zugeordnet werden kann.
 *
 * `minHours` verwirft angeschnittene Fenster: am Modellhorizont bricht die
 * Reihe mitten im Fenster ab, das „Extremum" der letzten paar Stunden wäre
 * dann eine falsche Aussage.
 */
function extremeMarks(
  gridMs: number[],
  values: (number | null)[],
  kind: 'max' | 'min',
  window: ExtremeWindow,
  minHours: number,
): PointMark[] {
  const byWindow = new Map<number, { t: number; value: number; hours: number; start: number; end: number }>()
  for (let i = 0; i < gridMs.length; i++) {
    const v = values[i]
    if (v == null) continue
    const w = window(gridMs[i])
    if (!w) continue
    const cur = byWindow.get(w.key)
    if (!cur) {
      byWindow.set(w.key, { t: gridMs[i], value: v, hours: 1, start: w.start, end: w.end })
      continue
    }
    cur.hours++
    if (kind === 'max' ? v > cur.value : v < cur.value) {
      cur.value = v
      cur.t = gridMs[i]
    }
  }
  const out: PointMark[] = []
  for (const w of byWindow.values()) {
    if (w.hours < minHours) continue
    out.push({
      t: w.t / 1000,
      value: w.value,
      label: `${w.value.toFixed(1).replace('.', ',')}°`,
      spanStart: w.start / 1000,
      spanEnd: w.end / 1000,
    })
  }
  return out
}

/** Serie auf das gemeinsame Zeitraster legen (Zeitstempel-Abgleich statt Index-Annahme). */
function alignToGrid(gridMs: number[], series: HourlySeries | undefined): (number | null)[] {
  if (!series) return gridMs.map(() => null)
  const byTime = new Map<number, number | null>()
  for (let i = 0; i < series.times.length; i++) byTime.set(series.times[i], series.values[i])
  return gridMs.map((t) => byTime.get(t) ?? null)
}

export function ClassicMeteogram() {
  const location = useWorkbench((s) => s.lockedLocation)
  const [modelId, setModelId] = useState(DEFAULT_MODEL)
  const model = getModel(modelId)

  // Werteanzeige am überfahrenen Zeitpunkt — OHNE Verzögerung: eine
  // Verweilzeit ließ das Diagramm haken, obwohl nichts rechnete. Der
  // Zeitpunkt gilt für den GANZEN Stapel, deshalb liegt der Zustand hier und
  // nicht in den einzelnen Zeilen; über den Cursor-Sync melden ohnehin alle
  // Zeilen dieselbe Stunde.
  const [readoutMs, setReadoutMs] = useState<number | null>(null)
  const hoverMsRef = useRef<number | null>(null)

  // Der Guard auf „gleiche Stunde" ist der eigentliche Hebel für die
  // Flüssigkeit: `setCursor` feuert bei JEDER Mausbewegung und aus jeder der
  // sechs Zeilen — neu gezeichnet wird aber nur, wenn sich die Stunde ändert.
  const handleHover = useCallback((ms: number | null) => {
    if (ms === hoverMsRef.current) return
    hoverMsRef.current = ms
    setReadoutMs(ms)
  }, [])

  // Die Zeitachse endet am Horizont des GEWÄHLTEN Modells, nicht am
  // 16-Tage-Raster. Das klassische Meteogramm zeigt genau EIN Modell — eine
  // Achse, die vier Fünftel leer bleibt, weil AROME nach 78 Stunden endet,
  // sieht aus wie ein Fehler und drückt die interessanten drei Tage in einen
  // schmalen Streifen links. (In den Punktprognosen ist das anders: dort
  // liegen mehrere Modelle übereinander, die gemeinsame Achse muss das
  // längste tragen und die kürzeren werden schraffiert.)
  const horizon = modelHorizonEnd(model)
  const gridMs = useMemo(() => timeGridMs().filter((t) => t <= horizon), [horizon])
  const xs = useMemo(() => gridMs.map((t) => t / 1000), [gridMs])

  // Einzelabrufe (1 Modell × 1 Variable) — der Batcher in openmeteo.ts bündelt
  // Anfragen desselben Ticks zu EINEM Request pro Punkt, wie bei mehreren
  // gleichzeitig sichtbaren Punktprognosen-Panels auch. Der ganze Stapel
  // kostet also einen Request, nicht sechzehn.
  const t2mQ = useMeteogramSeries(location, [modelId], 'temperature_2m')[0]
  const feelsQ = useMeteogramSeries(location, [modelId], 'apparent_temperature')[0]
  const dewQ = useMeteogramSeries(location, [modelId], 'dew_point_2m')[0]
  const precipQ = useMeteogramSeries(location, [modelId], 'precipitation')[0]
  const snowQ = useMeteogramSeries(location, [modelId], 'snowfall')[0]
  // Nicht jedes Modell führt eine Wahrscheinlichkeit (AROME/UKMO/AIFS liefern
  // durchgehend null) — `useMeteogramSeries` gatet den Abruf an der Registry,
  // die Kurve bleibt dann einfach leer.
  const probQ = useMeteogramSeries(location, [modelId], 'precipitation_probability')[0]
  // Bewölkung nach Höhenschicht PLUS Gesamtbedeckung: die Achtel-Angabe oben
  // ist die klassische Größe der Wetterdienste, das Schichtenraster darunter
  // sagt, WO die Bewölkung sitzt (flache Nebeldecke vs. hoher Cirrus).
  const cloudQ = useMeteogramSeries(location, [modelId], 'cloud_cover')[0]
  const cloudLowQ = useMeteogramSeries(location, [modelId], 'cloud_cover_low')[0]
  const cloudMidQ = useMeteogramSeries(location, [modelId], 'cloud_cover_mid')[0]
  const cloudHighQ = useMeteogramSeries(location, [modelId], 'cloud_cover_high')[0]
  const windQ = useMeteogramSeries(location, [modelId], 'wind_speed_10m')[0]
  const gustQ = useMeteogramSeries(location, [modelId], 'wind_gusts_10m')[0]
  const windDirQ = useMeteogramSeries(location, [modelId], 'wind_direction_10m')[0]
  const pressureQ = useMeteogramSeries(location, [modelId], 'pressure_msl')[0]
  const codeQ = useMeteogramSeries(location, [modelId], 'weather_code')[0]
  const dayQ = useMeteogramSeries(location, [modelId], 'is_day')[0]

  const loadedKey = [
    t2mQ, feelsQ, dewQ, precipQ, snowQ, probQ, cloudQ, cloudLowQ, cloudMidQ,
    cloudHighQ, windQ, gustQ, windDirQ, pressureQ, codeQ, dayQ,
  ]
    .map((q) => (q.data ? '1' : '0'))
    .join('')

  const charts = useMemo<ChartDef[]>(() => {
    // Sicherheitsnetz: das Raster ist bereits am Horizont beschnitten, aber
    // liefert ein Modell früher nichts mehr, wird hier nicht extrapoliert.
    const mask = (vals: (number | null)[]) => vals.map((v, i) => (gridMs[i] > horizon ? null : v))
    const g = (q: { data?: HourlySeries }) => mask(alignToGrid(gridMs, q.data))

    const t2m = g(t2mQ)
    const feels = g(feelsQ)
    const dew = g(dewQ)
    const precip = g(precipQ)
    const snow = g(snowQ)
    const prob = g(probQ)
    const cloud = g(cloudQ)
    const cloudLow = g(cloudLowQ)
    const cloudMid = g(cloudMidQ)
    const cloudHigh = g(cloudHighQ)
    const wind = g(windQ)
    const gust = g(gustQ)
    const windDir = g(windDirQ)
    const pressure = g(pressureQ)
    const codes = g(codeQ)
    const night = g(dayQ)

    // Niederschlagsphase trennen: fällt in dieser Stunde Schnee, gehört die
    // GANZE Menge in den Schnee-Balken. Zwei sich ausschließende Balkenreihen
    // statt einer eingefärbten — so bleibt die Summe je Stunde die Menge aus
    // dem Modell und nicht die Summe zweier gestapelter Reihen.
    const rainBars = precip.map((v, i) => (v == null ? null : (snow[i] ?? 0) > 0 ? null : v))
    const snowBars = precip.map((v, i) => (v == null ? null : (snow[i] ?? 0) > 0 ? v : null))

    return [
      {
        title: 'Wetter',
        unit: '',
        // Nur die Symbole — keine Achse, keine Kopfzeile. Was diese Zeile
        // zeigt, erklärt sich von selbst, und jeder Pixel, den sie NICHT
        // braucht, geht an die Parameter darunter.
        flex: 0.34,
        // Uhrzeiten und Datum stehen unter jedem anderen Parameter — hier
        // fräßen sie nur die Höhe, die die Symbole zum Lesbarsein brauchen.
        // Die Tagesgrenz-Linie bleibt.
        hideXAxis: true,
        // Das Symbol IST der Wert — Cursorlinie und Wertekästchen würden hier
        // nur verdecken, was man ablesen will.
        hideCursor: true,
        curves: [],
        night,
        symbols: { codes, isDay: night },
      },
      {
        title: 'Bewölkung',
        unit: 'Achtel',
        flex: 1.15,
        curves: [],
        night,
        // Je Zeitschritt ein WMO-Stationskreis, die Schichten untereinander in
        // der Reihenfolge, in der sie am Himmel stehen (hoch oben, tief unten).
        // Ein Kreis sagt „5 von 8" genau — eine Graustufe nur „ungefähr dunkel".
        octaRows: {
          rows: [
            { label: 'Gesamt', values: cloud, withNumber: true },
            { label: 'Hoch', values: cloudHigh },
            { label: 'Mittel', values: cloudMid },
            { label: 'Tief', values: cloudLow },
          ],
        },
      },
      {
        title: 'Temperatur',
        unit: '°C',
        flex: 1.3,
        night,
        // Tageshöchst- und -tiefstwerte als beschriftete Punkte auf der
        // T2m-Kurve — die Zahlen, nach denen im Meteogramm zuerst gesucht
        // wird. Farben wie die Kurve/das Thermometer: Maximum warm, Minimum
        // blau.
        marks: [
          {
            points: extremeMarks(gridMs, t2m, 'max', CALENDAR_DAY, MIN_HOURS_FOR_DAILY_MAX),
            color: COLOR_T2M,
            place: 'above' as const,
          },
          {
            points: extremeMarks(gridMs, t2m, 'min', SYNOPTIC_NIGHT, MIN_HOURS_FOR_NIGHT_MIN),
            color: COLOR_TMIN,
            place: 'below' as const,
          },
        ],
        note: 'Max je Kalendertag · Min je Nacht 18–06 UTC',
        // Achse in 5-K-Schritten (…, 5, 10, 15, 20, …) statt auf krummen
        // Werten. `ySpace` MUSS dafür klein genug sein: uPlot nimmt die
        // nächstgröbere erlaubte Schrittweite, sobald zwei Ticks enger als
        // `space` beieinanderlägen — mit dem Standard 30 px sprang die Achse
        // bei üblicher Zeilenhöhe auf 10-K-Schritte zurück.
        yStep: 5,
        ySpace: 16,
        // Die 0-°C-Linie ist im Meteogramm der Wetterdienste eigens markiert —
        // an ihr hängen Frost, Glätte und die Phase des Niederschlags.
        refLines: [{ value: 0, color: COLOR_FREEZING, dash: [5, 4] }],
        curves: [
          { label: 'Temperatur', color: COLOR_T2M, type: 'line', values: t2m, width: 2 },
          { label: 'Taupunkt', color: COLOR_DEW, type: 'line', values: dew, width: 1.3 },
          { label: 'Gefühlt', color: COLOR_FEELS, type: 'line', values: feels, dash: [4, 3], width: 1.3 },
        ],
      },
      {
        title: 'Niederschlag',
        unit: 'mm/h',
        flex: 1.15,
        zeroBased: true,
        // Die Achse wächst frei mit einem Starkregenereignis mit; nach unten
        // aber nicht unter 2 mm/h, sonst füllt ein Nieselregen von 0,2 mm/h
        // die ganze Zeile und liest sich wie ein Wolkenbruch.
        minTop: 2,
        night,
        // Wahrscheinlichkeit auf eigener rechter Achse in % — dieselbe Zeile,
        // andere Größe: wie viel fällt (Balken) und wie sicher (Fläche).
        rightAxis: { unit: '%', range: [0, 100] },
        curves: [
          { label: 'Regen', color: COLOR_RAIN, type: 'bars', values: rainBars },
          { label: 'Schnee', color: COLOR_SNOW, type: 'bars', values: snowBars },
          {
            label: 'Wahrscheinlichkeit',
            color: COLOR_PROB,
            type: 'line',
            values: prob,
            rightAxis: true,
            width: 1.2,
            fill: 0.16,
          },
        ],
      },
      {
        title: 'Wind',
        unit: 'km/h',
        flex: 1.15,
        zeroBased: true,
        // Wie beim Niederschlag: an einem windstillen Tag (Böen um 8 km/h)
        // sähe die Kurve sonst nach Sturm aus.
        minTop: 25,
        night,
        // Feinere Abstufung: der Wind läuft oft nur zwischen 0 und 30 km/h,
        // mit dem Standardabstand blieben zwei bis drei Ticks übrig.
        ySpace: 18,
        // Oberes Drittel für die Windfiedern freihalten — die y-Skala wird
        // dafür gestreckt, sonst läuft die Spitze der Böen-Kurve in den
        // Fiedern-Streifen und wirkt, als ginge sie aus der Skala.
        topReserve: 0.32,
        curves: [
          { label: 'Wind', color: COLOR_WIND, type: 'line', values: wind, direction: windDir, width: 1.8 },
          { label: 'Böen', color: COLOR_GUST, type: 'line', values: gust, dash: [4, 3], width: 1.2 },
        ],
      },
      {
        title: 'Luftdruck',
        unit: 'hPa',
        flex: 1.05,
        night,
        // Der Luftdruck schwankt über Tage oft nur um wenige hPa — dann legt
        // uPlot eine Achse mit einer EINZIGEN Beschriftung an („1020"), an der
        // sich der Verlauf nicht ablesen lässt. Mindestspanne plus engere
        // Ticks geben der Zeile eine benutzbare Achse; die Kurvenform bleibt
        // dieselbe, sie wird nur nicht mehr auf Rauschen aufgezoomt.
        minSpan: 12,
        ySpace: 20,
        refLines: [{ value: 1013.25, color: COLOR_PRESSURE_REF, dash: [2, 4] }],
        curves: [{ label: 'Luftdruck (MSL)', color: COLOR_PRESSURE, type: 'line', values: pressure, width: 1.6 }],
      },
    ]
    // Query-Objekte sind bei TanStack Query jede Renderrunde neue Referenzen —
    // auf `loadedKey` (geladen ja/nein je Serie) keyen wie im Meteogramm der
    // Punktprognosen, sonst rechnet der Memo bei jedem Render neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, gridMs, horizon])

  const syncKey = 'classic-meteogram'
  // Die Zeitleiste zwischen Bewölkung und Temperatur trägt den Zeitpunkt —
  // in den Zeilen selbst stünde er nur klein und doppelt.
  const timeBarBefore = charts.findIndex((c) => c.title === 'Temperatur')
  // Anteil des Zeigers an der Zeitachse; die Leiste rechnet ihn mit denselben
  // Achsenbreiten in eine Pixelposition um, die auch die Diagramme benutzen.
  const readoutFrac =
    readoutMs === null || gridMs.length < 2
      ? null
      : Math.min(
          1,
          Math.max(0, (readoutMs - gridMs[0]) / (gridMs[gridMs.length - 1] - gridMs[0])),
        )
  const run = latestRun(model, Date.now())
  const outsideCoverage = location !== null && !isInCoverage(model, location.lat, location.lon)

  return (
    <div className="meteo">
      <div className="atclima-bar">
        <span className="atclima-title">Meteogramm</span>
        <LocationPicker />
        <label className="atclima-ctrl">
          <span className="label-muted">Modell</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {/* Nach SKALA gruppiert wie in der Verifikation — eine flache
                Liste stellte AROME neben ARPEGE und IFS neben GFS. Im nativen
                <select> macht das `optgroup`; innerhalb einer Gruppe ordnet
                die Modellfamilie (siehe `compareModelsByScale`).
                Die Auflösung steht an jedem Eintrag, sonst ist nicht zu sehen,
                warum ein Globalmodell im Alpental danebenliegt — im <option>
                geht nur Text, deshalb als Trennpunkt. */}
            {groupModelsByScale([...SELECTABLE_MODELS]).map((group) => (
              <optgroup key={group.scale} label={SCALE_LABELS[group.scale]}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {resolutionLabel(m)}
                    {location !== null && !isInCoverage(m, location.lat, location.lon)
                      ? ' ⚠'
                      : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="label-muted" title={RUN_TITLE}>
          Lauf {formatRunLong(run, Date.now())}
        </span>
        <span
          className="label-muted"
          title="Vorhersagehorizont des gewählten Modells — so weit reicht die Zeitachse."
        >
          Horizont +{Math.round((horizon - Date.now()) / 3_600_000)} h
        </span>
        <span className="label-muted" title="Zeitachse in UTC, nicht in der Ortszeit des gewählten Punkts. Die Nachtschattierung kommt dagegen ortsgenau aus dem Modell.">
          Zeiten in UTC
        </span>
      </div>

      {!location && <div className="panel-placeholder">Ort wählen, um das Meteogramm zu laden</div>}
      {outsideCoverage && (
        <div className="atdetail-note">
          {model.label} deckt diesen Ort nicht ab — die Serien bleiben leer. Anderes Modell wählen.
        </div>
      )}
      {location && (
        <div className="meteo-stack">
          {charts.map((c, i) => (
            <Fragment key={c.title}>
            {i === timeBarBefore && (
              <div className="meteo-timebar">
                {readoutFrac === null ? (
                  <span className="meteo-timebar-idle">Modellzeit folgt dem Zeiger</span>
                ) : (
                  <span
                    className="meteo-timebar-value"
                    style={{
                      left: `calc(${Y_AXIS_SIZE}px + ${readoutFrac} * (100% - ${
                        Y_AXIS_SIZE + RIGHT_AXIS_SIZE
                      }px))`,
                      // An den Rändern nicht mehr mittig hängen, sonst schneidet
                      // die Leiste die Zeit ab.
                      transform:
                        readoutFrac < 0.07
                          ? 'translateX(0)'
                          : readoutFrac > 0.93
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)',
                    }}
                  >
                    {timeBarFmt.format(new Date(readoutMs!))} UTC
                  </span>
                )}
              </div>
            )}
            <div
              className="atfc-chart meteo-row"
              // Mindesthöhen knapp halten: sie sind nur das Sicherheitsnetz
              // für kleine Fenster. Zu groß gesetzt reißen sie die Summe über
              // die Fensterhöhe, der Stapel scrollt — und dann wächst KEINE
              // Zeile mehr per Flex, obwohl Platz da wäre.
              style={{ flexGrow: c.flex ?? 1, minHeight: c.symbols ? 46 : 88 }}
            >
              {/* Die Wettersymbolzeile bekommt keine Kopfzeile: „Wetter" über
                  einer Reihe Wettersymbole sagt nichts, kostet aber Höhe. */}
              {!c.symbols && (
              <div className="atfc-chartcap">
                <span>
                  {c.title} {c.unit && <span className="label-muted">({c.unit})</span>}
                </span>
                <span className="atfc-legend">
                  {c.note && <span className="label-muted">{c.note}</span>}
                  {c.octaRows && (
                    <span className="label-muted">Achtel je Zeitschritt · 0 = klar, 8 = bedeckt</span>
                  )}
                  {c.curves.some((s) => s.direction) && <span className="label-muted">Fiedern in Knoten</span>}
                  {c.curves.length > 1 &&
                    c.curves.map((s) => (
                      <span key={s.label}>
                        <i style={{ background: s.color }} /> {s.label}
                      </span>
                    ))}
                </span>
              </div>
              )}
              <div className="meteo-plotwrap">
                <ChartRow
                  xs={xs}
                  chart={c}
                  tz={TZ}
                  formatTick={formatMeteoTick}
                  xSpace={X_TICK_SPACE}
                  // Datum unter JEDER Zeile: wer die Windzeile liest, soll
                  // nicht über vier Diagramme hinweg nach unten suchen müssen,
                  // welcher Tag gerade gilt. Der Trennstrich bei 00 UTC läuft
                  // jeweils bis in den Datumsstreifen hinein. Zeilen ohne
                  // Stundenachse (Wettersymbole) bekommen nur den Strich.
                  dayRow={!c.hideXAxis}
                  dayGrid={c.hideXAxis}
                  readoutTime={readoutMs ?? undefined}
                  onHoverTime={handleHover}
                  syncKey={syncKey}
                  height={CHART_HEIGHT}
                />
                {!chartHasData(c) && (
                  <div className="panel-placeholder atdetail-overlay">Keine Daten von {model.label}</div>
                )}
              </div>
            </div>
            </Fragment>
          ))}
        </div>
      )}
      <OpenMeteoAttribution className="app-attribution" />
    </div>
  )
}
