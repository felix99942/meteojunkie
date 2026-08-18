// Klassisches Meteogramm (SPEC-Ergänzung): EIN Ort, EIN Modell, die
// Standardgrößen als Stapel übereinander — Temperatur/gefühlte Temperatur,
// Niederschlag, Bewölkung, Wind mit Richtungspfeilen. Das ist bewusst NICHT
// dasselbe wie „Punktprognosen" (freie Variable, bis zu 8 Modelle
// überlagert): ein gestapeltes Meteogramm mit mehreren Modellen je Zeile wäre
// visuell Chaos, deshalb genau ein wählbares Modell.
//
// Eigenes, schlankes Gerüst wie die Klimakarte (kein Panel-Raster) — teilt
// sich aber den `lockedLocation` mit Punktprognosen/Ensemble/Profil: wer den
// Ort dort setzt, sieht ihn hier sofort, und umgekehrt.

import { useMemo, useState } from 'react'
import type { HourlySeries } from '../api/openmeteo'
import { useMeteogramSeries } from '../api/queries'
import { ChartRow } from './ChartStack'
import { chartHasData, type ChartDef } from '../config/chartDef'
import { getModel, isInCoverage, MODELS, modelHorizonEnd } from '../config/models'
import { formatRun, latestRun } from '../config/runs'
import { timeGridMs } from '../config/time'
import { useWorkbench } from '../state/workbench'
import { LocationPicker } from './LocationPicker'

const DEFAULT_MODEL = 'ecmwf_ifs025'
// UTC, wie der Rest der App intern durchgehend rechnet (siehe CLAUDE.md) — der
// Fetch-Layer fragt in openmeteo.ts überall explizit `timezone: 'UTC'` ab,
// eine echte Ortszeit je Standort gäbe es nur über einen zusätzlichen
// Zeitzonen-Lookup, den es hier (noch) nicht gibt. 12/18 UTC sind auf den
// Achsen deshalb NICHT die Ortszeit des gewählten Punkts.
const TZ = 'Etc/UTC'
// Nur Mindesthöhe für uPlots Erstaufbau (falls CSS-Flex beim Mount noch nicht
// gegriffen hat) — die tatsächliche Höhe kommt aus .meteo-row/.meteo-plotwrap
// (Flex-Grow, gleich verteilt auf die vier Zeilen) und wird per
// ResizeObserver in ChartStack.tsx nachgezogen.
const CHART_HEIGHT = 190
// Tick-Mindestabstand für die x-Achse: 6-Stunden-Schritte (00/06/12/18) waren
// zu eng, uPlot wählt bei diesem Wert stattdessen bevorzugt 12-Stunden-Schritte
// (00/12) — bei schmalen Fenstern fällt es automatisch auf 24 h zurück, nie
// überlappend.
const X_TICK_SPACE = 40

const COLOR_T2M = '#d95926'
const COLOR_FEELS = '#9b59d0'
const COLOR_PRECIP = '#3987e5'
const COLOR_WIND = '#199e70'

// Die Stunden-Achse zeigt nur noch die Uhrzeit — den Tag übernimmt die eigene
// Tageszeile (`dayRow` in ChartStack.tsx, mit Trennlinie an der Tagesgrenze).
const hourFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })
const formatMeteoTick = (ts: number): string => hourFmt.format(new Date(ts * 1000))

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

  const gridMs = useMemo(() => timeGridMs(), [])
  const xs = useMemo(() => gridMs.map((t) => t / 1000), [gridMs])

  // Acht Einzelabrufe (1 Modell × 1 Variable) — der Batcher in openmeteo.ts
  // bündelt Anfragen desselben Ticks zu einem Request pro Punkt, wie bei
  // mehreren gleichzeitig sichtbaren Punktprognosen-Panels auch.
  const t2mQ = useMeteogramSeries(location, [modelId], 'temperature_2m')[0]
  const feelsQ = useMeteogramSeries(location, [modelId], 'apparent_temperature')[0]
  const precipQ = useMeteogramSeries(location, [modelId], 'precipitation')[0]
  // Bewölkung nach Höhenschicht statt Gesamtbedeckung — dieselben drei
  // Größen, die auch die klassischen Wetterdienst-Meteogramme als
  // Grauwert-Raster zeigen (tief/mittel/hoch statt einer Summenlinie, die
  // verdeckt, ob es sich um flache Nebeldecke oder hohen Cirrus handelt).
  const cloudLowQ = useMeteogramSeries(location, [modelId], 'cloud_cover_low')[0]
  const cloudMidQ = useMeteogramSeries(location, [modelId], 'cloud_cover_mid')[0]
  const cloudHighQ = useMeteogramSeries(location, [modelId], 'cloud_cover_high')[0]
  const windQ = useMeteogramSeries(location, [modelId], 'wind_speed_10m')[0]
  const windDirQ = useMeteogramSeries(location, [modelId], 'wind_direction_10m')[0]

  const loadedKey = [t2mQ, feelsQ, precipQ, cloudLowQ, cloudMidQ, cloudHighQ, windQ, windDirQ]
    .map((q) => (q.data ? '1' : '0'))
    .join('')

  const charts = useMemo<ChartDef[]>(() => {
    const horizon = modelHorizonEnd(model)
    // Serie endet am Registry-Horizont — keine Extrapolation darüber hinaus,
    // wie im Meteogramm der Punktprognosen.
    const mask = (vals: (number | null)[]) => vals.map((v, i) => (gridMs[i] > horizon ? null : v))
    const t2m = mask(alignToGrid(gridMs, t2mQ.data))
    const feels = mask(alignToGrid(gridMs, feelsQ.data))
    const precip = mask(alignToGrid(gridMs, precipQ.data))
    const cloudLow = mask(alignToGrid(gridMs, cloudLowQ.data))
    const cloudMid = mask(alignToGrid(gridMs, cloudMidQ.data))
    const cloudHigh = mask(alignToGrid(gridMs, cloudHighQ.data))
    const wind = mask(alignToGrid(gridMs, windQ.data))
    const windDir = mask(alignToGrid(gridMs, windDirQ.data))

    return [
      {
        title: 'Temperatur',
        unit: '°C',
        curves: [
          { label: 'Temperatur', color: COLOR_T2M, type: 'line', values: t2m },
          { label: 'Gefühlt', color: COLOR_FEELS, type: 'line', values: feels, dash: [4, 3] },
        ],
      },
      {
        title: 'Niederschlag',
        unit: 'mm/h',
        zeroBased: true,
        curves: [{ label: 'Niederschlag', color: COLOR_PRECIP, type: 'bars', values: precip }],
      },
      {
        title: 'Bewölkung',
        unit: '%',
        curves: [],
        bands: {
          unit: '%',
          range: [0, 100],
          // Von oben nach unten wie am Himmel: hoch, mittel, tief.
          rows: [
            { label: 'Hoch', values: cloudHigh },
            { label: 'Mittel', values: cloudMid },
            { label: 'Tief', values: cloudLow },
          ],
        },
      },
      {
        title: 'Wind',
        unit: 'km/h',
        zeroBased: true,
        curves: [{ label: 'Wind', color: COLOR_WIND, type: 'line', values: wind, direction: windDir }],
      },
    ]
    // Query-Objekte sind bei TanStack Query jede Renderrunde neue Referenzen —
    // auf `loadedKey` (geladen ja/nein je Serie) keyen wie im Meteogramm der
    // Punktprognosen, sonst rechnet der Memo bei jedem Render neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, gridMs, model])

  const syncKey = 'classic-meteogram'
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
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {location !== null && !isInCoverage(m, location.lat, location.lon) ? ' ⚠' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="label-muted">Lauf {formatRun(run)}</span>
        <span className="label-muted" title="Zeitachse in UTC, nicht in der Ortszeit des gewählten Punkts.">
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
          {charts.map((c) => (
            <div key={c.title} className="atfc-chart meteo-row">
              <div className="atfc-chartcap">
                <span>
                  {c.title} <span className="label-muted">({c.unit})</span>
                </span>
                {c.curves.length > 1 && (
                  <span className="atfc-legend">
                    {c.curves.map((s) => (
                      <span key={s.label}>
                        <i style={{ background: s.color }} /> {s.label}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className="meteo-plotwrap">
                <ChartRow
                  xs={xs}
                  chart={c}
                  tz={TZ}
                  formatTick={formatMeteoTick}
                  xSpace={X_TICK_SPACE}
                  dayRow
                  syncKey={syncKey}
                  height={CHART_HEIGHT}
                />
                {!chartHasData(c) && (
                  <div className="panel-placeholder atdetail-overlay">Keine Daten von {model.label}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
