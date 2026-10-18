// Luftqualität am Punkt (Bereich „Luftqualität") — CAMS-Vorhersage über
// Open-Meteo, als Stapel aus kleinen Zeitreihen wie das klassische
// Meteogramm, mit dem Europäischen Luftqualitätsindex obenauf.
//
// Punkt statt Karte, und das ist Budget: ein Feld kostete bei Open-Meteo
// ~Punktzahl Calls (siehe CLAUDE.md, Rate-Limit), ein Ort kostet hier EINEN
// Abruf für alle Größen. Der Ort ist derselbe globale `lockedLocation` wie im
// Meteogramm, im Ensemble und in den Soundings.
//
// Registry, Domänenwahl und die live geprüften Fallen der API stehen in
// `config/airQuality.ts`.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAirQuality, useAtAirStations, useMeasuredAt } from '../api/queries'
import { seriesKey } from '../lib/dataKey'
import { ChartRow } from './ChartStack'
import { chartHasData, type ChartDef, type Curve } from '../config/chartDef'
import {
  AIR_DOMAINS,
  currentIndex,
  dataEnd,
  dominantPollutant,
  EAQI_BANDS,
  eaqiAxisTop,
  eaqiBand,
  concBand,
  EAQI_BANDS as BANDS_ORDER,
  rollingMean,
  WHO_GUIDELINES,
  WHO_SOURCE_URL,
} from '../config/airQuality'
import {
  distanceKm,
  MEASURED_MAX_KM,
  MEASURED_POLLUTANTS,
  measuredFor,
  measuredMean,
  stationKind,
  type MeasuredSeries,
} from '../config/airMeasured'
import { useWorkbench } from '../state/workbench'
import { LocationPicker } from './LocationPicker'
import { QuickPoints } from './QuickPoints'
import { AirQualityAttribution } from './Attribution'

const TZ = 'Etc/UTC'
const CHART_HEIGHT = 110
const X_TICK_SPACE = 40
const hourFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })
const formatTick = (ts: number): string => hourFmt.format(new Date(ts * 1000))
const readoutFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const MS_PER_DAY = 86_400_000
const COLOR_EAQI = '#e0e3e8'
const COLOR_PM25 = '#d9822b'
const COLOR_PM10 = '#b8a04a'
const COLOR_NO2 = '#c0607a'
const COLOR_O3 = '#4f97e0'
const COLOR_DUST = '#c9a227'
/** Gemessen = WEISS: hebt sich von allen Modellfarben ab, und Weiß ist auch im
 *  Skew-T die Farbe der Messung (Radiosonde). */
const COLOR_MEASURED = '#f2f2ef'
const kmFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** Mittelungszeiträume der Kästen neben dem Jetzt-Wert (Stunden). */
const SUMMARY_WINDOWS = [8, 24] as const
/** Die Stoffe in den Mittelwert-Kästen — Feinstaub steckt schon im Index. */
const SUMMARY_VARS = [
  { v: 'nitrogen_dioxide', label: 'NO₂' },
  { v: 'ozone', label: 'O₃' },
] as const
/**
 * Feinstaub nur im GEMESSENEN 24-h-Kasten: sein WHO-Richtwert gilt fürs
 * 24-h-Mittel (ein 8-h-Mittel hat keinen Bezug), und der Jetzt-Index darüber
 * ist ein Modellwert — gemessener Feinstaub käme oben sonst nirgends vor.
 */
const MEASURED_PM_VARS = [
  { v: 'pm10', label: 'PM10' },
  { v: 'pm2_5', label: 'PM2,5' },
] as const

const WHO = WHO_GUIDELINES
const WhoLink = () => (
  <a href={WHO_SOURCE_URL} target="_blank" rel="noreferrer">
    (WHO 2021)
  </a>
)

/**
 * Erläuterung je Größe hinter dem ⓘ — auf Wunsch so kurz wie möglich: der
 * WHO-Richtwert samt Mittelungszeitraum, denn ob ein STUNDENwert ihn reißt,
 * hängt genau daran (meist nicht, er gilt für ein Mittel).
 */
const INFO: Record<string, ReactNode> = {
  eaqi: (
    <p>
      Höchster Teilindex aus Feinstaub, NO₂, Ozon und SO₂ (EEA). 0–20 gut · 20–40 ausreichend · 40–60 mäßig · 60–80
      schlecht · 80–100 sehr schlecht · über 100 extrem schlecht.
    </p>
  ),
  pm: (
    <p>
      WHO-Richtwert: PM2,5 <b>{WHO.pm2_5.value}</b>, PM10 <b>{WHO.pm10.value} µg/m³</b> im <b>24-h-Mittel</b> — ein
      einzelner Stundenwert darüber reißt ihn nicht. <WhoLink />
    </p>
  ),
  no2: (
    <p>
      WHO-Richtwert: <b>{WHO.nitrogen_dioxide.value} µg/m³</b> im <b>24-h-Mittel</b>, als Stundenwert erst{' '}
      <b>200 µg/m³</b>. <WhoLink />
    </p>
  ),
  o3: (
    <p>
      WHO-Richtwert: <b>{WHO.ozone.value} µg/m³</b> im <b>8-h-Mittel</b> — ein einzelner Stundenwert darüber reißt ihn
      nicht. <WhoLink />
    </p>
  ),
  dust: <p>Wüstenstaub, meist aus der Sahara. Kein eigener Richtwert — zählt beim Feinstaub mit.</p>,
}

/** Wie lange eine geöffnete Erläuterung von selbst stehen bleibt. */
const INFO_AUTO_CLOSE_MS = 10_000

/**
 * ⓘ mit aufklappender Erläuterung. Schließt sich beim Klick daneben, mit
 * Escape und nach `INFO_AUTO_CLOSE_MS` von selbst — ein natives <details>
 * blieb offen, bis man das ⓘ ein zweites Mal traf, und lag dann über dem
 * Diagramm.
 */
function InfoPop({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const timer = window.setTimeout(() => setOpen(false), INFO_AUTO_CLOSE_MS)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="air-pop" ref={ref}>
      <button
        type="button"
        className="air-info-btn"
        title="Erläuterung und WHO-Richtwert"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⓘ
      </button>
      {open && <div className="air-pop-body">{children}</div>}
    </div>
  )
}

const endFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Kasten mit NO₂ und Ozon als Mittel — Modell oder Messung (weiße Kopfzeile). */
function MeanBox({
  head,
  sub,
  items,
  color,
  title,
  measured = false,
}: {
  head: string
  sub?: string
  items: { v: string; label: string; value: number | null; band: { label: string; color: string } | null }[]
  color?: string
  title: string
  measured?: boolean
}) {
  return (
    <div className={`air-mean${measured ? ' is-measured' : ''}`} style={color ? { borderColor: color } : undefined} title={title}>
      <span className="air-mean-head">
        {head}
        {sub && <span className="air-mean-sub">{sub}</span>}
      </span>
      {items.map((it) => (
        <span key={it.v} className="air-mean-item">
          <span className="air-mean-name">{it.label}</span>
          {it.value != null && it.band ? (
            <>
              <b style={{ color: it.band.color }}>{Math.round(it.value)}</b>
              <span className="air-mean-unit">µg/m³</span>
              <span className="air-mean-band" style={{ color: it.band.color }}>
                {it.band.label}
              </span>
            </>
          ) : (
            <span className="label-muted">—</span>
          )}
        </span>
      ))}
    </div>
  )
}

interface RowSpec {
  id: string
  info: string
  chart: ChartDef
}

export function AirQualityPanel() {
  const location = useWorkbench((s) => s.lockedLocation)
  const q = useAirQuality(location)
  const data = q.data

  // GEMESSEN (nur Österreich): erst die Messstellen, und nur wenn eine im
  // Umkreis liegt, der eine Abruf für ganz Österreich
  const stationsQ = useAtAirStations(location !== null)
  const nearStation =
    location !== null &&
    (stationsQ.data ?? []).some((st) => distanceKm(location.lat, location.lon, st.lat, st.lon) <= MEASURED_MAX_KM)
  // Ab GESTERN: das gemessene 24-h-Mittel braucht die Stunden vor Mitternacht
  // (~280 statt ~140 KB, weiterhin ein Abruf)
  const measuredDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const measuredQ = useMeasuredAt(measuredDay, nearStation)
  /** Messreihe je Open-Meteo-Variable (nächste Hintergrundstation ≤ 15 km). */
  const measured = useMemo(() => {
    const out: Record<string, MeasuredSeries | null> = {}
    if (!location || !stationsQ.data || !measuredQ.data) return out
    for (const p of MEASURED_POLLUTANTS) {
      out[p.variable] = measuredFor(p.code, location.lat, location.lon, stationsQ.data, measuredQ.data)
    }
    return out
  }, [location, stationsQ.data, measuredQ.data])
  const measuredKey = seriesKey([measuredQ.data, stationsQ.data, location])

  // Werteanzeige am überfahrenen Zeitpunkt für den ganzen Stapel — dasselbe
  // Muster wie im klassischen Meteogramm (neu gezeichnet nur bei neuer Stunde)
  const [readoutMs, setReadoutMs] = useState<number | null>(null)
  const hoverMsRef = useRef<number | null>(null)
  const handleHover = useCallback((ms: number | null) => {
    if (ms === hoverMsRef.current) return
    hoverMsRef.current = ms
    setReadoutMs(ms)
  }, [])

  // Über die IDENTITÄT der Daten keyen, nicht über „geladen ja/nein"
  // (Begründung in `lib/dataKey.ts`)
  const dataKey = seriesKey([data])

  const { xs, rows } = useMemo(() => {
    if (!data) return { xs: [] as number[], rows: [] as RowSpec[] }
    // Die API füllt den angefragten Zeitraum über den Modellhorizont hinaus
    // mit null — die Achse endet am letzten Wert statt an einer leeren Fläche
    const end = dataEnd(data) ?? -Infinity
    const n = data.times.filter((t) => t <= end).length
    // Der Vortag ist nur für die gleitenden Mittel da — gezeigt wird ab heute
    // 00 UTC, wie im Meteogramm
    const todayStart = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
    const s0 = Math.max(0, data.times.findIndex((t) => t >= todayStart))
    const cut = (v: string) => (data.values[v] ?? []).slice(s0, n)

    const times = data.times.slice(s0, n)
    /**
     * Modellkurven einer Zeile, dazu — wo es eine Messstelle gibt — die
     * gemessenen Stundenmittel in WEISS (bei zwei Stoffen in einer Zeile der
     * zweite gestrichelt). Gezeichnet am Ende der Messstunde.
     */
    const curvesFor = (list: { v: string; label: string; color: string; width?: number; fill?: number }[]): Curve[] => {
      const out: Curve[] = list.map((c) => ({
        label: c.label,
        color: c.color,
        type: 'line',
        values: cut(c.v),
        width: c.width ?? 1.6,
        ...(c.fill ? { fill: c.fill } : {}),
      }))
      list.forEach((c, i) => {
        const m = measured[c.v]
        if (!m) return
        out.push({
          label: `${c.label} gemessen`,
          color: COLOR_MEASURED,
          type: 'line',
          values: times.map((t) => m.values.get(t) ?? null),
          width: 1.8,
          ...(i > 0 ? { dash: [5, 3] } : {}),
        })
      })
      return out
    }
    /** Herkunft der Messung für die Kopfzeile: Station, Abstand, Typ. */
    const measuredNote = (vars: string[]) => {
      const seen = new Map<string, MeasuredSeries>()
      for (const v of vars) {
        const m = measured[v]
        if (m) seen.set(m.station.name, m)
      }
      if (!seen.size) return undefined
      return (
        'gemessen: ' +
        [...seen.values()].map((m) => `${m.station.name} (${kmFmt.format(m.km)} km, ${stationKind(m.station)})`).join(' · ')
      )
    }

    const rows: RowSpec[] = [
      {
        id: 'eaqi',
        info: 'eaqi',
        chart: {
          title: 'Europäischer Luftqualitätsindex',
          unit: 'EAQI',
          // Höher als die übrigen Zeilen: die Stufen stehen als beschriftete
          // Flächen darin, und die Schrift braucht Streifenhöhe
          flex: 1.4,
          zeroBased: true,
          // Die Achse endet auf der nächsten Stufengrenze über dem Höchstwert —
          // eng gezoomt, solange der Index niedrig bleibt, und sofort weiter,
          // sobald ein einzelner Wert in die nächste Stufe kommt
          minTop: eaqiAxisTop(cut('european_aqi')),
          ySpace: 18,
          // Jede Stufe als Fläche in ihrer Farbe, groß beschriftet
          yZones: EAQI_BANDS.map((b, i) => ({
            from: i === 0 ? 0 : EAQI_BANDS[i - 1].upTo,
            to: b.upTo,
            color: b.color,
            label: b.label,
          })),
          curves: [{ label: 'Index', color: COLOR_EAQI, type: 'line', values: cut('european_aqi'), width: 2 }],
        },
      },
      {
        id: 'pm',
        info: 'pm',
        chart: {
          title: 'Feinstaub',
          unit: 'µg/m³',
          note: measuredNote(['pm2_5', 'pm10']),
          zeroBased: true,
          // Achse folgt dem Datenmaximum; der kleine Boden verhindert nur, dass
          // ein Hauch (0,5 µg/m³) die ganze Zeile füllt
          minTop: 5,
          curves: curvesFor([
            { v: 'pm2_5', label: 'PM2,5', color: COLOR_PM25, width: 1.8 },
            { v: 'pm10', label: 'PM10', color: COLOR_PM10, width: 1.4 },
          ]),
        },
      },
      {
        id: 'no2',
        info: 'no2',
        chart: {
          title: 'Stickstoffdioxid',
          unit: 'µg/m³',
          note: measuredNote(['nitrogen_dioxide']),
          zeroBased: true,
          minTop: 5,
          curves: curvesFor([{ v: 'nitrogen_dioxide', label: 'NO₂', color: COLOR_NO2 }]),
        },
      },
      {
        id: 'o3',
        info: 'o3',
        chart: {
          title: 'Ozon',
          unit: 'µg/m³',
          note: measuredNote(['ozone']),
          zeroBased: true,
          minTop: 10,
          curves: curvesFor([{ v: 'ozone', label: 'O₃', color: COLOR_O3 }]),
        },
      },
      {
        id: 'dust',
        info: 'dust',
        chart: {
          title: 'Wüstenstaub',
          unit: 'µg/m³',
          zeroBased: true,
          // Saharastaub kommt in Schüben — ohne Boden sähe ein Hauch von
          // 0,3 µg/m³ wie ein Ereignis aus
          minTop: 5,
          curves: curvesFor([{ v: 'dust', label: 'Staub', color: COLOR_DUST, fill: 0.18 }]),
        },
      },
    ]
    // Wenige, breite Zeilen: die Werteanzeige am Zeiger darf groß sein, und
    // sie nennt die Kurve — PM2,5 und PM10 teilen sich Einheit und Zeile
    for (const r of rows) {
      r.chart.readoutPx = 16
      r.chart.readoutLabels = true
    }
    return { xs: data.times.slice(s0, n).map((t) => t / 1000), rows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, measuredKey])


  // „Jetzt" einmal je Datenstand — Date.now() direkt im Render gäbe jeder
  // Zeile bei jedem Neuzeichnen einen neuen Markerzeitpunkt
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowMs = useMemo(() => Date.now(), [dataKey])
  const nowIdx = data ? currentIndex(data.times, nowMs) : null
  const nowEaqi = data && nowIdx != null ? data.values.european_aqi[nowIdx] : null
  const band = nowEaqi != null ? eaqiBand(nowEaqi) : null
  const driver = data && nowIdx != null ? dominantPollutant(data, nowIdx) : null
  const domain = data ? AIR_DOMAINS[data.domain] : null
  /**
   * Nachlaufende 8- und 24-h-Mittel von NO₂ und Ozon zur laufenden Stunde —
   * eingeordnet in die EAQI-Stufen (die Grenze zu „mäßig" ist dort der
   * WHO-Richtwert). Feinstaub fehlt bewusst: er bestimmt schon den Index.
   */
  const summary = useMemo(() => {
    if (!data || nowIdx == null) return []
    return SUMMARY_WINDOWS.map((w) => {
      const items = SUMMARY_VARS.map(({ v, label }) => {
        const m = rollingMean(data.values[v] ?? [], w)[nowIdx]
        return { v, label, value: m, band: m != null ? concBand(v, m) : null }
      })
      // Rand in der Farbe der schlechteren Stufe
      const worst = items.reduce<number>((acc, it) => Math.max(acc, it.band ? BANDS_ORDER.indexOf(it.band) : -1), -1)
      return { w, items, color: worst >= 0 ? BANDS_ORDER[worst].color : undefined }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, nowIdx])
  /**
   * Dieselben Mittel aus der MESSUNG (nur Österreich, nur mit Messstelle in
   * der Nähe) — endend an der jüngsten gemessenen Stunde, die steht im Kasten.
   */
  const measuredSummary = useMemo(() => {
    return SUMMARY_WINDOWS.map((w) => {
      let end: number | null = null
      const stations = new Set<string>()
      const vars = w === 24 ? [...SUMMARY_VARS, ...MEASURED_PM_VARS] : SUMMARY_VARS
      const items = vars.map(({ v, label }) => {
        const m = measured[v]
        const r = m ? measuredMean(m.values, w) : null
        if (m && r) {
          stations.add(m.station.name)
          end = end == null ? r.end : Math.max(end, r.end)
        }
        return { v, label, value: r?.value ?? null, band: r ? concBand(v, r.value) : null }
      })
      const worst = items.reduce<number>((acc, it) => Math.max(acc, it.band ? BANDS_ORDER.indexOf(it.band) : -1), -1)
      return { w, items, end, stations: [...stations], color: worst >= 0 ? BANDS_ORDER[worst].color : undefined }
    }).filter((b) => b.items.some((it) => it.value != null))
  }, [measured])
  const placeName = location
    ? (location.label ?? `${location.lat.toFixed(2)}° N, ${location.lon.toFixed(2)}° O`)
    : ''
  // Zeitpunkt unter dem Zeiger als Kästchen in der Indexzeile — die Achse
  // beschriftet nur jede dritte Stunde. NUR dort: in den flachen
  // Konzentrationszeilen schob es sich über die Werte (gesehen), und der
  // Cursor ist ohnehin über alle Zeilen gekoppelt
  const readoutLabel = readoutMs != null ? `${readoutFmt.format(new Date(readoutMs))} UTC` : undefined

  return (
    <div className="meteo air-panel">
      <div className="atclima-bar air-bar">
        <span className="atclima-title">Luftqualität</span>
        <LocationPicker />
        <QuickPoints />
        {domain && (
          <span
            className="label-muted air-domain"
            title="Vorhersage des Copernicus Atmosphere Monitoring Service, ein Lauf am Tag. CAMS Europa reicht rund vier Tage; außerhalb Europas springt CAMS global ein."
          >
            {domain.label} · {domain.resolution}
          </span>
        )}
        <span className="label-muted" title="Zeitachse in UTC, nicht in der Ortszeit des gewählten Punkts.">
          Zeiten in UTC
        </span>
      </div>

      {!location && <div className="panel-placeholder">Ort wählen, um die Luftqualität zu laden</div>}
      {location && q.isPending && <div className="panel-placeholder">Lade Luftqualität…</div>}
      {location && q.isError && (
        <div className="atdetail-note">Luftqualität nicht verfügbar: {q.error.message}</div>
      )}
      {data && data.domain === 'cams_global' && (
        <div className="atdetail-note">
          Dieser Ort liegt außerhalb von CAMS Europa — gezeigt wird das gröbere globale Modell (~45 km).
        </div>
      )}
      {/* Der Index der laufenden Stunde ist die Antwort, mit der man den
          Bereich öffnet — deshalb groß und links oben über dem ersten
          Diagramm, nicht klein am Ende der Leiste */}
      <div className="air-summary">
      {band && (
        <div
          className="air-now"
          style={{ borderColor: band.color }}
          title="Europäischer Luftqualitätsindex (EAQI) für die laufende Stunde — der Index ist das Maximum der Teilindizes, der genannte Schadstoff setzt ihn."
        >
          {/* Der Ort steht mit dabei: der Kasten ist die Antwort, und ohne
              Ort weiß man bei einem Blick nicht, wofür sie gilt */}
          <span className="air-now-main">
            <span className="air-now-place">{placeName}</span>
            <span className="air-now-label">Jetzt</span>
            <b style={{ color: band.color }}>{Math.round(nowEaqi!)}</b>
            <span className="air-now-band" style={{ color: band.color }}>
              {band.label}
            </span>
          </span>
          {driver && <span className="air-now-driver">maßgeblich {driver}</span>}
        </div>
      )}
      {/* 8- und 24-h-Mittel daneben: NO₂ und Ozon richten sich nach Mitteln
          (WHO 24 h bzw. 8 h), der Stundenwert allein sagt dort zu wenig */}
      {/* Je Zeitraum ENTWEDER die Messung ODER das Modell (auf Wunsch): wo
          eine Messstelle das Mittel liefert, gilt die Messung — das
          Modellmittel daneben wäre die schwächere Auskunft zur selben Frage */}
      {summary.filter((b) => !measuredSummary.some((m) => m.w === b.w)).map((b) => (
        <MeanBox
          key={b.w}
          head={`Modell ${b.w}-h-Mittel`}
          items={b.items}
          color={b.color}
          title={`Modell: gleitendes ${b.w}-Stunden-Mittel bis zur laufenden Stunde, eingeordnet in die Stufen des Luftqualitätsindex. WHO-Richtwerte: NO₂ ${WHO_GUIDELINES.nitrogen_dioxide.value} µg/m³ im 24-h-Mittel, Ozon ${WHO_GUIDELINES.ozone.value} µg/m³ im 8-h-Mittel — jeweils die Grenze zu „mäßig".`}
        />
      ))}
      {measuredSummary.map((b) => (
        <MeanBox
          key={`m${b.w}`}
          measured
          head={`gemessen ${b.w}-h-Mittel`}
          sub={b.end != null ? `bis ${endFmt.format(new Date(b.end))} UTC` : undefined}
          items={b.items}
          color={b.color}
          title={`Gemessen: ${b.w}-Stunden-Mittel bis zur jüngsten gemeldeten Stunde (WHO-Richtwerte im 24-h-Mittel: NO₂ ${WHO_GUIDELINES.nitrogen_dioxide.value}, PM2,5 ${WHO_GUIDELINES.pm2_5.value}, PM10 ${WHO_GUIDELINES.pm10.value} µg/m³; Ozon ${WHO_GUIDELINES.ozone.value} im 8-h-Mittel) (die Messung kommt 2–3 h verzögert), ${b.stations.join(' / ')}. Aktuelle, noch ungeprüfte Werte über die Europäische Umweltagentur.`}
        />
      ))}
      {/* Alles hier ist CAMS-MODELL, auch der „Jetzt"-Wert und die Mittel über
          die vergangenen Stunden — keine Messung. Ohne den Hinweis liest sich
          „Jetzt 42" wie ein Messwert. */}
      {band && (
        <span
          className="air-src"
          title="Kästen und farbige Kurven sind Modellwerte des Copernicus-Atmosphärendienstes (CAMS Europa, ~10 km), auch der aktuelle Wert und die Mittel über die vergangenen Stunden. Weiß sind gemessene Stundenmittel der nächsten österreichischen Messstelle im Umkreis von 15 km (Hintergrundstationen bevorzugt) — aktuelle, noch ungeprüfte Werte über die Europäische Umweltagentur, rund 2–3 Stunden Verzug."
        >
          farbig: Modell (CAMS)
          <br />
          {Object.values(measured).some(Boolean)
            ? 'weiß: Messung'
            : nearStation && measuredQ.isPending
              ? 'Messung lädt …'
              : nearStation && measuredQ.isError
                ? 'Messung nicht erreichbar'
                : 'keine Messstelle nahe'}
        </span>
      )}
      </div>
      {data && (
        <div className="meteo-stack">
          {rows.map(({ id, info, chart: c }) => (
            <div key={id} className="atfc-chart meteo-row" style={{ flexGrow: c.flex ?? 1, minHeight: 88 }}>
              <div className="atfc-chartcap">
                <span className="air-cap">
                  {c.title} <span className="label-muted">({c.unit})</span>
                  {/* Erläuterung zum Aufklappen statt Linien im Diagramm */}
                  <InfoPop>{INFO[info]}</InfoPop>
                </span>
                <span className="atfc-legend">
                  {c.note && <span className="air-measured-note">{c.note}</span>}
                  {c.curves.length > 1 &&
                    c.curves.map((s) => (
                      <span key={s.label}>
                        <i style={{ background: s.color }} /> {s.label}
                      </span>
                    ))}
                </span>
              </div>
              <div className="meteo-plotwrap">
                <ChartRow
                  xs={xs}
                  chart={c}
                  tz={TZ}
                  formatTick={formatTick}
                  xSpace={X_TICK_SPACE}
                  dayRow
                  markTime={nowMs}
                  readoutTime={readoutMs ?? undefined}
                  readoutLabel={id === 'eaqi' ? readoutLabel : undefined}
                  onHoverTime={handleHover}
                  syncKey="air-quality"
                  height={CHART_HEIGHT}
                />
                {!chartHasData(c) && (
                  <div className="panel-placeholder atdetail-overlay">Keine Daten</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="app-attribution">
        <AirQualityAttribution />
        {Object.values(measured).some(Boolean) && (
          <span className="attribution">
            Messwerte (weiß):{' '}
            <a href="https://www.eea.europa.eu/en/datahub/datahubitem-view/778ef9f5-6293-4846-badd-56a29c70880d" target="_blank" rel="noreferrer">
              Europäische Umweltagentur
            </a>{' '}
            mit Daten der Messnetze der Länder und des Umweltbundesamts — aktuelle, noch ungeprüfte Werte.
          </span>
        )}
        <span className="attribution">
          Richtwerte in den Erläuterungen (ⓘ):{' '}
          <a href={WHO_SOURCE_URL} target="_blank" rel="noreferrer">
            WHO Global Air Quality Guidelines 2021
          </a>
          .
        </span>
      </div>
    </div>
  )
}
