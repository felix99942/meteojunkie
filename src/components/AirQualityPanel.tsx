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
    const cut = (v: string) => (data.values[v] ?? []).slice(0, n)
    const charts: ChartDef[] = [
      {
        title: 'Europäischer Luftqualitätsindex',
        unit: 'EAQI',
        flex: 1.2,
        zeroBased: true,
        // Die Achse endet auf der nächsten Stufengrenze über dem Höchstwert —
        // eng gezoomt, solange der Index niedrig bleibt, und sofort weiter,
        // sobald ein einzelner Wert in die nächste Stufe kommt
        minTop: eaqiAxisTop(cut('european_aqi')),
        ySpace: 18,
        // Die Stufengrenzen in den Farben der Stufe darüber — so liest man
        // die Kurve gegen die Einteilung, ohne eine Legende zu suchen
        refLines: EAQI_BANDS.slice(0, 5).map((b, i) => ({
          value: b.upTo,
          color: EAQI_BANDS[i + 1].color,
          dash: [3, 4],
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
        minTop: 5,
        curves: [
          { label: 'PM2,5', color: COLOR_PM25, type: 'line', values: cut('pm2_5'), width: 1.8 },
          { label: 'PM10', color: COLOR_PM10, type: 'line', values: cut('pm10'), width: 1.4 },
        ],
      },
      {
        title: 'Stickstoffdioxid',
        unit: 'µg/m³',
        zeroBased: true,
        minTop: 5,
        curves: [{ label: 'NO₂', color: COLOR_NO2, type: 'line', values: cut('nitrogen_dioxide'), width: 1.6 }],
      },
      {
        title: 'Ozon',
        unit: 'µg/m³',
        zeroBased: true,
        minTop: 10,
        curves: [{ label: 'O₃', color: COLOR_O3, type: 'line', values: cut('ozone'), width: 1.6 }],
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
    return { xs: data.times.slice(0, n).map((t) => t / 1000), charts }
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
        {band && (
          <span
            className="air-now"
            style={{ borderColor: band.color }}
            title="Europäischer Luftqualitätsindex (EAQI) für die laufende Stunde — der Index ist das Maximum der Teilindizes, der genannte Schadstoff setzt ihn."
          >
            <i style={{ background: band.color }} />
            Jetzt <b>{Math.round(nowEaqi!)}</b> · {band.label}
            {driver && <span className="label-muted"> · maßgeblich {driver}</span>}
          </span>
        )}
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
      </div>
    </div>
  )
}
