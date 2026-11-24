// Diagramme der Verifikation (auf Wunsch, 2026-11-24): drei Bilder zu dem,
// was die Rangliste in Zahlen sagt — „wie viel besser als nichts tun",
// „wie schnell wird es mit dem Vorlauf schlechter" und „woran liegt der
// Fehler". Alles aus den schon geladenen Läufen (eine Abfrage je Modell
// trägt alle Vorlaufzeiten), also ohne zusätzliches API-Budget.
//
// Bewusst schlichtes SVG statt uPlot: Balken und sieben Stützpunkte brauchen
// keine Zeitachse, und die Diagramme sollen sich an die Breite der Rangliste
// halten. Farbe = Modell (Slot aus SERIES_COLORS in Auswahlreihenfolge, wie in
// den Meteogrammen), nie der Rang. Werte am Zeiger über `<title>` — der
// Zeilenstreifen ist das Ziel, nicht der dünne Balken.

import type { ModelInfo } from '../config/models'
import type { Scores, Skill } from './verify'

export interface ChartRow {
  model: ModelInfo
  color: string
  /** Je Vorlauf (Tage) die Bewertung — fehlt ein Vorlauf, hat das Modell ihn nicht. */
  byLead: Map<number, { scores: Scores; skill: Skill; climSkill: Skill }>
}

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',')
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v * 100))} %`

const ROW_H = 30
const LABEL_W = 160

/** Modellname, gekürzt auf die Labelspalte. */
function ModelLabel({ y, label }: { y: number; label: string }) {
  return (
    <text x={LABEL_W - 8} y={y + ROW_H / 2} textAnchor="end" dominantBaseline="central" className="vchart-label">
      {label.length > 20 ? `${label.slice(0, 19)}…` : label}
    </text>
  )
}

// --- 1. Skill-Balken -------------------------------------------------------------

/**
 * Skill Score als Prozent „besser als die Referenz" — zwei kleine Diagramme
 * mit GEMEINSAMER Achse (Persistenz links, Klimatologie rechts), damit die
 * Balken direkt vergleichbar sind. 0 = so gut wie die Referenz, 100 % =
 * fehlerfrei, negativ = schlechter als nichts tun. Negative Werte unter
 * −100 % werden an der Achse gekappt und markiert.
 */
export function SkillChart({ rows, lead }: { rows: ChartRow[]; lead: number }) {
  const data = rows
    .map((r) => ({ r, c: r.byLead.get(lead) }))
    .filter((d): d is { r: ChartRow; c: NonNullable<typeof d.c> } => d.c != null && d.c.scores.n > 0)
  if (data.length === 0) return null
  const vals = data.flatMap((d) => [d.c.skill.ss, d.c.climSkill.ss]).filter(Number.isFinite)
  const lo = Math.max(-1, Math.min(0, ...vals))
  const PLOT_W = 230
  // Abstand der beiden Hälften: die Endbeschriftung links („+100 %") darf die
  // Null rechts nicht berühren
  const GAP = 70
  const width = LABEL_W + 2 * PLOT_W + GAP + 8
  const top = 22
  const height = top + data.length * ROW_H + 22
  const xOf = (v: number, x0: number) => x0 + ((Math.max(lo, v) - lo) / (1 - lo)) * PLOT_W
  const panels = [
    { key: 'pers', title: 'gegen Persistenz', x0: LABEL_W, get: (c: (typeof data)[0]['c']) => c.skill },
    { key: 'clim', title: 'gegen Klimatologie', x0: LABEL_W + PLOT_W + GAP, get: (c: (typeof data)[0]['c']) => c.climSkill },
  ]
  const ticks = [lo, 0, 0.5, 1].filter((t, i, a) => a.indexOf(t) === i && t >= lo)
  return (
    <figure className="vchart">
      <figcaption>
        <strong>Skill Score (SS = 1 − MSE Modell / MSE Referenz)</strong>
        <span className="label-muted">
          Referenz: Persistenz („wie gestern") bzw. Klimatologie (Mittel des Zeitraums). 0 = nicht besser als die
          Referenz, 100 % = fehlerfrei
        </span>
      </figcaption>
      <svg width={width} height={height} role="img" aria-label="Skill Score je Modell gegen Persistenz und Klimatologie">
        {panels.map((p) => (
          <g key={p.key}>
            <text x={p.x0} y={12} className="vchart-axis">
              {p.title}
            </text>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={xOf(t, p.x0)} x2={xOf(t, p.x0)} y1={top - 2} y2={top + data.length * ROW_H} className={t === 0 ? 'vchart-zero' : 'vchart-grid'} />
                <text x={xOf(t, p.x0)} y={top + data.length * ROW_H + 15} textAnchor="middle" className="vchart-axis">
                  {t === 0 ? '0' : pct(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const s = p.get(d.c)
              const y = top + i * ROW_H
              if (!Number.isFinite(s.ss))
                return (
                  <text key={d.r.model.id} x={xOf(0, p.x0) + 4} y={y + ROW_H / 2} dominantBaseline="central" className="vchart-axis">
                    nicht bestimmbar
                  </text>
                )
              const x0 = xOf(0, p.x0)
              const x1 = xOf(s.ss, p.x0)
              const clipped = s.ss < lo
              return (
                <g key={d.r.model.id}>
                  <title>
                    {`${d.r.model.label}: ${s.ss >= 0 ? `${Math.round(s.ss * 100)} % kleinerer` : `${Math.round(-s.ss * 100)} % GRÖSSERER`} quadratischer Fehler als ${p.key === 'pers' ? 'die Persistenz' : 'die Klimatologie'} (${s.n} Tage)`}
                  </title>
                  <rect x={p.x0} y={y} width={PLOT_W} height={ROW_H} fill="transparent" />
                  <rect
                    x={Math.min(x0, x1)}
                    y={y + 6}
                    width={Math.max(1, Math.abs(x1 - x0))}
                    height={ROW_H - 12}
                    rx={2}
                    fill={d.r.color}
                    opacity={s.ss < 0 ? 0.55 : 1}
                  />
                  <text
                    x={s.ss >= 0 ? x1 + 4 : x1 - 4}
                    y={y + ROW_H / 2}
                    textAnchor={s.ss >= 0 ? 'start' : 'end'}
                    dominantBaseline="central"
                    className="vchart-value"
                  >
                    {clipped ? `≪ ${pct(lo)}` : pct(s.ss)}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
        {data.map((d, i) => (
          <ModelLabel key={d.r.model.id} y={top + i * ROW_H} label={d.r.model.label} />
        ))}
      </svg>
    </figure>
  )
}

// --- 2. Fehler nach Vorlauf --------------------------------------------------------

/**
 * Mittlerer absoluter Fehler je Modell über den Vorlauf +1 … +7 Tage. Eine
 * Linie endet dort, wo das Modell keinen Vorlauf mehr trägt (AROME/ICON-D2
 * nur +1 — dort steht ein einzelner Punkt). Der eingestellte Vorlauf ist als
 * senkrechte Linie markiert. Bei kurzen Zeiträumen ist der Verlauf Rauschen
 * (gemessen: über 14 Tage SANK der IFS-Fehler mit dem Vorlauf) — die
 * Unterzeile sagt das.
 */
export function LeadChart({ rows, lead, unit, days }: { rows: ChartRow[]; lead: number; unit: string; days: number }) {
  const leads = [...new Set(rows.flatMap((r) => [...r.byLead.keys()]))].sort((a, b) => a - b)
  const series = rows
    .map((r) => ({
      r,
      pts: leads
        .map((n) => ({ n, s: r.byLead.get(n)?.scores }))
        .filter((p): p is { n: number; s: Scores } => p.s != null && p.s.n > 0 && Number.isFinite(p.s.mae)),
    }))
    .filter((s) => s.pts.length > 0)
  if (series.length === 0 || leads.length === 0) return null
  const maxMae = Math.max(...series.flatMap((s) => s.pts.map((p) => p.s.mae)))
  const step = niceStep(maxMae / 3)
  const yMax = Math.ceil(maxMae / step) * step
  const W = 520
  const H = 270
  const pad = { l: 46, r: 14, t: 16, b: 30 }
  const xOf = (n: number) =>
    leads.length === 1 ? pad.l + (W - pad.l - pad.r) / 2 : pad.l + ((n - leads[0]) / (leads[leads.length - 1] - leads[0])) * (W - pad.l - pad.r)
  const yOf = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b)
  const yTicks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)
  return (
    <figure className="vchart">
      <figcaption>
        <strong>Mittlerer absoluter Fehler (MAE) nach Vorlauf</strong>
        <span className="label-muted">
          {days} Tage
          {days < 30 ? ' — bei so kurzen Reihen ist der Verlauf noch weitgehend Zufall' : ''}
        </span>
      </figcaption>
      <svg width={W} height={H} role="img" aria-label="Mittlerer absoluter Fehler je Modell über die Vorlaufzeit">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} className={t === 0 ? 'vchart-zero' : 'vchart-grid'} />
            <text x={pad.l - 5} y={yOf(t)} textAnchor="end" dominantBaseline="central" className="vchart-axis">
              {step < 1 ? fmt1(t) : String(t)}
            </text>
          </g>
        ))}
        <text x={4} y={pad.t - 2} className="vchart-axis">
          {unit}
        </text>
        {leads.map((n) => (
          <text key={n} x={xOf(n)} y={H - 9} textAnchor="middle" className={n === lead ? 'vchart-value' : 'vchart-axis'}>
            +{n} d
          </text>
        ))}
        <line x1={xOf(lead)} x2={xOf(lead)} y1={pad.t} y2={H - pad.b} className="vchart-cursor" />
        {series.map(({ r, pts }) => (
          <g key={r.model.id}>
            {pts.length > 1 && (
              <polyline
                points={pts.map((p) => `${xOf(p.n)},${yOf(p.s.mae)}`).join(' ')}
                fill="none"
                stroke={r.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            )}
            {pts.map((p) => (
              <g key={p.n}>
                <title>{`${r.model.label}, +${p.n} d: ${fmt1(p.s.mae)} ${unit} mittlerer Fehler (${p.s.n} Tage)`}</title>
                <circle cx={xOf(p.n)} cy={yOf(p.s.mae)} r={12} fill="transparent" />
                <circle cx={xOf(p.n)} cy={yOf(p.s.mae)} r={p.n === lead ? 5 : 4} fill={r.color} stroke="var(--bg-panel)" strokeWidth={2} />
              </g>
            ))}
          </g>
        ))}
      </svg>
      <Legend rows={series.map((s) => s.r)} />
    </figure>
  )
}

/** Runde Schrittweite (1, 2, 5 · 10ⁿ) ab `v` — für Achsenteilungen ohne krumme Werte. */
function niceStep(v: number): number {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

function Legend({ rows }: { rows: ChartRow[] }) {
  return (
    <div className="vchart-legend">
      {rows.map((r) => (
        <span key={r.model.id}>
          <i style={{ background: r.color }} />
          {r.model.label}
        </span>
      ))}
    </div>
  )
}

// --- 3. Fehlerursachen ---------------------------------------------------------------

/**
 * Murphy-Zerlegung des quadratischen Fehlers als gestapelter Balken je
 * Modell: Versatz (Bias²) · Schwankungsbreite ((σf−σo)²) · Verlauf
 * (2σfσo(1−r)). Die Balkenlänge ist der GANZE quadratische Fehler, damit die
 * Modelle untereinander vergleichbar bleiben; am Ende steht der RMSE in der
 * Einheit der Größe (K² liest niemand). Die Anteile stehen im Tooltip.
 * Farben bewusst NICHT aus den Serienfarben (die tragen hier das Modell),
 * sondern drei Helligkeitsstufen — die Legende benennt sie.
 */
const PARTS = [
  { key: 'bias2', label: 'Bias² (Versatz)', hint: 'systematisch zu hoch/zu tief — nachträglich korrigierbar', color: '#e0ddd2' },
  { key: 'amplitude', label: '(σf − σo)² (Amplitude)', hint: 'schwankt zu wenig oder zu stark (z. B. gedämpfter Tagesgang)', color: '#9a978e' },
  { key: 'phase', label: '2σfσo(1 − r) (Korrelation)', hint: 'Auf und Ab zur falschen Zeit — das eigentliche Modellversagen', color: '#5c5a55' },
] as const

export function DecompChart({ rows, lead, unit }: { rows: ChartRow[]; lead: number; unit: string }) {
  const data = rows
    .map((r) => ({ r, s: r.byLead.get(lead)?.scores }))
    .filter((d): d is { r: ChartRow; s: Scores } => d.s != null && d.s.n > 1)
  if (data.length === 0) return null
  const mse = (s: Scores) => s.decomp.bias2 + s.decomp.amplitude + s.decomp.phase
  const maxMse = Math.max(...data.map((d) => mse(d.s)))
  const PLOT_W = 300
  const width = LABEL_W + PLOT_W + 80
  const height = data.length * ROW_H + 4
  return (
    <figure className="vchart">
      <figcaption>
        <strong>Zerlegung des MSE nach Murphy (1988)</strong>
        <span className="label-muted">MSE = Bias² + (σf − σo)² + 2σfσo(1 − r) · Balkenlänge = MSE, am Ende RMSE</span>
      </figcaption>
      <svg width={width} height={height} role="img" aria-label="Zerlegung des quadratischen Fehlers je Modell">
        {data.map((d, i) => {
          const y = i * ROW_H
          const total = mse(d.s)
          let x = LABEL_W
          const scale = maxMse > 0 ? PLOT_W / maxMse : 0
          return (
            <g key={d.r.model.id}>
              <title>
                {`${d.r.model.label} — RMSE ${fmt1(Math.sqrt(total))} ${unit}\n` +
                  PARTS.map((p) => `${p.label}: ${total > 0 ? Math.round((d.s.decomp[p.key] / total) * 100) : 0} %`).join('\n')}
              </title>
              <rect x={0} y={y} width={width} height={ROW_H} fill="transparent" />
              <ModelLabel y={y} label={d.r.model.label} />
              {PARTS.map((p) => {
                const w = Math.max(0, d.s.decomp[p.key]) * scale
                const seg = (
                  <rect key={p.key} x={x} y={y + 6} width={Math.max(0, w - 2)} height={ROW_H - 12} rx={2} fill={p.color} />
                )
                x += w
                return seg
              })}
              <text x={x + 4} y={y + ROW_H / 2} dominantBaseline="central" className="vchart-value">
                {fmt1(Math.sqrt(total))} {unit}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="vchart-legend">
        {PARTS.map((p) => (
          <span key={p.key} title={p.hint}>
            <i style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
