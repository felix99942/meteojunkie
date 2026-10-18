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

import { useCallback, useMemo, useRef, useState } from 'react'
import { useAirQuality } from '../api/queries'
import { seriesKey } from '../lib/dataKey'
import { ChartRow } from './ChartStack'
import { chartHasData, type ChartDef } from '../config/chartDef'
import {
  AIR_DOMAINS,
  currentIndex,
  dataEnd,
  dominantPollutant,
  EAQI_BANDS,
  eaqiAxisTop,
  eaqiBand,
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

const MS_PER_DAY = 86_400_000
const COLOR_EAQI = '#e0e3e8'
const COLOR_PM25 = '#d9822b'
const COLOR_PM10 = '#b8a04a'
const COLOR_NO2 = '#c0607a'
const COLOR_O3 = '#4f97e0'
const COLOR_DUST = '#c9a227'

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

  const { xs, charts } = useMemo(() => {
    if (!data) return { xs: [] as number[], charts: [] as ChartDef[] }
    // Die API füllt den angefragten Zeitraum über den Modellhorizont hinaus
    // mit null — die Achse endet am letzten Wert statt an einer leeren Fläche
    const end = dataEnd(data) ?? -Infinity
    const n = data.times.filter((t) => t <= end).length
    // Der Vortag ist nur für die gleitenden Mittel da — gezeigt wird ab heute
    // 00 UTC, wie im Meteogramm
    const todayStart = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
    const s0 = Math.max(0, data.times.findIndex((t) => t >= todayStart))
    const cut = (v: string) => (data.values[v] ?? []).slice(s0, n)
    // Gleitendes Mittel über den Zeitraum des WHO-Richtwerts — über die
    // VOLLE Reihe gerechnet, damit die ersten Stunden von heute ihr Fenster haben
    const mean = (v: keyof typeof WHO_GUIDELINES) =>
      rollingMean(data.values[v] ?? [], WHO_GUIDELINES[v].hours).slice(s0, n)
    const pm25Mean = mean('pm2_5')
    const pm10Mean = mean('pm10')
    const no2Mean = mean('nitrogen_dioxide')
    const o3Mean = mean('ozone')
    /**
     * Achsenboden, damit die WHO-Linie ins Bild kommt — aber nur, wenn das
     * Mittel ihr nahekommt (60 %). Sonst bleibt die Achse eng an den Daten
     * und die Linie liegt außerhalb; der Wert steht dann in der Kopfzeile.
     */
    const reach = (floor: number, vals: (number | null)[], v: keyof typeof WHO_GUIDELINES) => {
      const g = WHO_GUIDELINES[v].value
      let max = 0
      for (const x of vals) if (x != null && x > max) max = x
      return max >= 0.6 * g ? Math.max(floor, g * 1.08) : floor
    }
    const whoLine = (v: keyof typeof WHO_GUIDELINES, color: string, name: string) => ({
      value: WHO_GUIDELINES[v].value,
      color,
      dash: [6, 4],
      label: `WHO-Richtwert ${name} ${WHO_GUIDELINES[v].value} (${WHO_GUIDELINES[v].hours}-h-Mittel)`,
    })
    const charts: ChartDef[] = [
      {
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
        // Jede Stufe als Fläche in ihrer Farbe, groß beschriftet — man liest
        // die Kurve gegen die Einteilung, ohne eine Legende zu suchen
        yZones: EAQI_BANDS.map((b, i) => ({
          from: i === 0 ? 0 : EAQI_BANDS[i - 1].upTo,
          to: b.upTo,
          color: b.color,
          label: b.label,
        })),
        note: EAQI_BANDS.map((b, i) =>
          Number.isFinite(b.upTo)
            ? `${i === 0 ? 0 : EAQI_BANDS[i - 1].upTo}–${b.upTo} ${b.label}`
            : `über ${EAQI_BANDS[i - 1].upTo} ${b.label}`,
        ).join(' · '),
        curves: [{ label: 'Index', color: COLOR_EAQI, type: 'line', values: cut('european_aqi'), width: 2 }],
      },
      {
        title: 'Feinstaub',
        unit: 'µg/m³',
        zeroBased: true,
        // Achse folgt dem Datenmaximum; die kleinen Böden verhindern nur, dass
        // ein Hauch (0,5 µg/m³) die ganze Zeile füllt
        minTop: Math.max(reach(5, pm25Mean, 'pm2_5'), reach(5, pm10Mean, 'pm10')),
        note: 'WHO-Richtwerte im 24-h-Mittel: PM2,5 15 · PM10 45 µg/m³',
        refLines: [whoLine('pm2_5', COLOR_PM25, 'PM2,5'), whoLine('pm10', COLOR_PM10, 'PM10')],
        curves: [
          { label: 'PM2,5', color: COLOR_PM25, type: 'line', values: cut('pm2_5'), width: 1.8 },
          { label: 'PM10', color: COLOR_PM10, type: 'line', values: cut('pm10'), width: 1.4 },
          { label: 'PM2,5 24-h-Mittel', color: COLOR_PM25, type: 'line', values: pm25Mean, width: 1.3, dash: [2, 3] },
          { label: 'PM10 24-h-Mittel', color: COLOR_PM10, type: 'line', values: pm10Mean, width: 1.3, dash: [2, 3] },
        ],
      },
      {
        title: 'Stickstoffdioxid',
        unit: 'µg/m³',
        zeroBased: true,
        minTop: reach(5, no2Mean, 'nitrogen_dioxide'),
        note: 'WHO-Richtwert 25 µg/m³ im 24-h-Mittel',
        refLines: [whoLine('nitrogen_dioxide', COLOR_NO2, 'NO₂')],
        curves: [
          { label: 'NO₂', color: COLOR_NO2, type: 'line', values: cut('nitrogen_dioxide'), width: 1.6 },
          { label: 'NO₂ 24-h-Mittel', color: COLOR_NO2, type: 'line', values: no2Mean, width: 1.3, dash: [2, 3] },
        ],
      },
      {
        title: 'Ozon',
        unit: 'µg/m³',
        zeroBased: true,
        minTop: reach(10, o3Mean, 'ozone'),
        note: 'WHO-Richtwert 100 µg/m³ im 8-h-Mittel',
        refLines: [whoLine('ozone', COLOR_O3, 'O₃')],
        curves: [
          { label: 'O₃', color: COLOR_O3, type: 'line', values: cut('ozone'), width: 1.6 },
          { label: 'O₃ 8-h-Mittel', color: COLOR_O3, type: 'line', values: o3Mean, width: 1.3, dash: [2, 3] },
        ],
      },
      {
        title: 'Wüstenstaub',
        unit: 'µg/m³',
        zeroBased: true,
        // Saharastaub kommt in Schüben — ohne Boden sähe ein Hauch von
        // 0,3 µg/m³ wie ein Ereignis aus
        minTop: 5,
        note: 'Mineralstaub, meist aus der Sahara — steckt auch im Feinstaub',
        curves: [{ label: 'Staub', color: COLOR_DUST, type: 'line', values: cut('dust'), width: 1.6, fill: 0.18 }],
      },
    ]
    // Wenige, breite Zeilen: die Werteanzeige am Zeiger darf groß sein, und
    // sie nennt die Kurve — PM2,5 und PM10 teilen sich Einheit und Zeile
    for (const c of charts) {
      c.readoutPx = 16
      c.readoutLabels = true
    }
    return { xs: data.times.slice(s0, n).map((t) => t / 1000), charts }
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
      {band && (
        <div
          className="air-now"
          style={{ borderColor: band.color }}
          title="Europäischer Luftqualitätsindex (EAQI) für die laufende Stunde — der Index ist das Maximum der Teilindizes, der genannte Schadstoff setzt ihn."
        >
          <span className="air-now-label">Jetzt</span>
          <b style={{ color: band.color }}>{Math.round(nowEaqi!)}</b>
          <span className="air-now-band" style={{ color: band.color }}>
            {band.label}
          </span>
          {driver && <span className="air-now-driver">maßgeblich {driver}</span>}
        </div>
      )}
      {data && (
        <div className="meteo-stack">
          {charts.map((c) => (
            <div key={c.title} className="atfc-chart meteo-row" style={{ flexGrow: c.flex ?? 1, minHeight: 88 }}>
              <div className="atfc-chartcap">
                <span>
                  {c.title} <span className="label-muted">({c.unit})</span>
                </span>
                <span className="atfc-legend">
                  {c.note && <span className="label-muted">{c.note}</span>}
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
          Richtwerte:{' '}
          <a href={WHO_SOURCE_URL} target="_blank" rel="noreferrer">
            WHO Global Air Quality Guidelines 2021
          </a>{' '}
          (Kurzzeitwerte; verglichen wird das gleitende Mittel, nicht der Stundenwert).
        </span>
      </div>
    </div>
  )
}
