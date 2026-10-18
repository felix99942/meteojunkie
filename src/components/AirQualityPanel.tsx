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

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAirQuality } from '../api/queries'
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

/** Mittelungszeiträume der Kästen neben dem Jetzt-Wert (Stunden). */
const SUMMARY_WINDOWS = [8, 24] as const
/** Die Stoffe in den Mittelwert-Kästen — Feinstaub steckt schon im Index. */
const SUMMARY_VARS = [
  { v: 'nitrogen_dioxide', label: 'NO₂' },
  { v: 'ozone', label: 'O₃' },
] as const

const WHO = WHO_GUIDELINES
const WhoLink = () => (
  <a href={WHO_SOURCE_URL} target="_blank" rel="noreferrer">
    WHO-Luftgüteleitlinien 2021
  </a>
)

/**
 * Erläuterung je Größe hinter dem ⓘ: welcher WHO-Richtwert gilt und — das ist
 * die eigentliche Frage — ab wann ihn STUNDENwerte reißen. Bei den meisten
 * Richtwerten gar nicht: sie gelten für ein Mittel über 8 oder 24 Stunden,
 * ein einzelner Stundenwert darüber ist noch keine Überschreitung. Deshalb
 * stehen die Werte bewusst NICHT als Linien im Diagramm (auf Wunsch wieder
 * entfernt — gegen Stundenkurven gelesen täuschen sie).
 */
const INFO: Record<string, ReactNode> = {
  eaqi: (
    <>
      <p>
        Der Europäische Luftqualitätsindex (EAQI) der Europäischen Umweltagentur fasst Feinstaub, NO₂, Ozon und SO₂
        zusammen. Jeder Stoff bekommt einen Teilindex, der Gesamtindex ist der <b>höchste</b> davon — oben steht,
        welcher Stoff ihn gerade setzt.
      </p>
      <p>Stufen: 0–20 gut · 20–40 ausreichend · 40–60 mäßig · 60–80 schlecht · 80–100 sehr schlecht · über 100 extrem schlecht.</p>
    </>
  ),
  pm: (
    <>
      <p>
        WHO-Richtwerte: <b>PM2,5 {WHO.pm2_5.value} µg/m³</b> und <b>PM10 {WHO.pm10.value} µg/m³</b>, jeweils im{' '}
        <b>24-Stunden-Mittel</b>.
      </p>
      <p>
        Einen Stundenrichtwert gibt es für Feinstaub nicht: ein einzelner Stundenwert darüber reißt nichts.
        Überschritten ist der Richtwert erst, wenn das Mittel über 24 Stunden darüber liegt — rechnerisch also, wenn
        die Stundenwerte einen ganzen Tag lang im Schnitt über {WHO.pm2_5.value} bzw. {WHO.pm10.value} µg/m³ bleiben.
        Ein kurzer Spitzenwert von 60 µg/m³ am Abend kann den Tag unter dem Richtwert lassen.
      </p>
      <p>Langfristig (Jahresmittel): PM2,5 5 µg/m³, PM10 15 µg/m³. Quelle: <WhoLink />.</p>
    </>
  ),
  no2: (
    <>
      <p>
        WHO-Richtwert: <b>{WHO.nitrogen_dioxide.value} µg/m³ im 24-Stunden-Mittel</b> — ein einzelner Stundenwert
        darüber reißt ihn nicht, erst ein Tagesschnitt darüber.
      </p>
      <p>
        Zusätzlich gilt ein <b>Stundenwert von 200 µg/m³</b> (aus den Leitlinien von 2005 übernommen): das ist der
        einzige Richtwert hier, den schon eine einzige Stunde überschreiten kann. Er wird abseits stark befahrener
        Straßen praktisch nie erreicht, und das ~10-km-Raster des Modells löst Straßenschluchten ohnehin nicht auf.
      </p>
      <p>Langfristig (Jahresmittel): 10 µg/m³. Quelle: <WhoLink />.</p>
    </>
  ),
  o3: (
    <>
      <p>
        WHO-Richtwert: <b>{WHO.ozone.value} µg/m³ als höchstes 8-Stunden-Mittel des Tages</b>. Einen
        Stundenrichtwert gibt es nicht — überschritten ist er, wenn acht aufeinanderfolgende Stunden im Schnitt über{' '}
        {WHO.ozone.value} µg/m³ liegen. An Sommernachmittagen ist das die typische Lage.
      </p>
      <p>Für das Sommerhalbjahr gilt zusätzlich ein Saisonwert von 60 µg/m³. Quelle: <WhoLink />.</p>
    </>
  ),
  dust: (
    <>
      <p>
        Mineralstaub, meist aus der Sahara. Einen eigenen WHO-Richtwert gibt es nicht: der Staub ist <b>Teil des
        Feinstaubs</b> und zählt dort gegen die PM10- und PM2,5-Richtwerte mit. Diese Zeile zeigt, wie viel davon aus
        der Wüste kommt.
      </p>
    </>
  ),
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

    const curvesFor = (list: { v: string; label: string; color: string; width?: number; fill?: number }[]): Curve[] =>
      list.map((c) => ({
        label: c.label,
        color: c.color,
        type: 'line',
        values: cut(c.v),
        width: c.width ?? 1.6,
        ...(c.fill ? { fill: c.fill } : {}),
      }))

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
  }, [dataKey])


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
          <span className="air-now-place">{placeName}</span>
          <span className="air-now-label">Jetzt</span>
          <b style={{ color: band.color }}>{Math.round(nowEaqi!)}</b>
          <span className="air-now-band" style={{ color: band.color }}>
            {band.label}
          </span>
          {driver && <span className="air-now-driver">maßgeblich {driver}</span>}
        </div>
      )}
      {/* 8- und 24-h-Mittel daneben: NO₂ und Ozon richten sich nach Mitteln
          (WHO 24 h bzw. 8 h), der Stundenwert allein sagt dort zu wenig */}
      {summary.map((b) => (
        <div
          key={b.w}
          className="air-mean"
          style={b.color ? { borderColor: b.color } : undefined}
          title={`Gleitendes ${b.w}-Stunden-Mittel bis zur laufenden Stunde, eingeordnet in die Stufen des Luftqualitätsindex. WHO-Richtwerte: NO₂ ${WHO_GUIDELINES.nitrogen_dioxide.value} µg/m³ im 24-h-Mittel, Ozon ${WHO_GUIDELINES.ozone.value} µg/m³ im 8-h-Mittel — jeweils die Grenze zu „mäßig".`}
        >
          <span className="air-mean-head">{b.w}-h-Mittel</span>
          {b.items.map((it) => (
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
      ))}
      </div>
      {data && (
        <div className="meteo-stack">
          {rows.map(({ id, info, chart: c }) => (
            <div key={id} className="atfc-chart meteo-row" style={{ flexGrow: c.flex ?? 1, minHeight: 88 }}>
              <div className="atfc-chartcap">
                <span className="air-cap">
                  {c.title} <span className="label-muted">({c.unit})</span>
                  {/* Erläuterung zum Aufklappen statt Linien im Diagramm */}
                  <details className="air-pop">
                    <summary className="air-info-btn" title="Erläuterung und WHO-Richtwert">
                      ⓘ
                    </summary>
                    <div className="air-pop-body">{INFO[info]}</div>
                  </details>
                </span>
                <span className="atfc-legend">
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
