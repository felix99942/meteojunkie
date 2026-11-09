// Föhn-Querschnitt aus den ICON-D2-Modellflächen (`scripts/icon-section-ingest.py`):
// Datenform, Farbskalen und die reine Rechnung (Zeitschritt, Isolinien, Wert am Zeiger).
// Gezeichnet wird in `components/FoehnSection.tsx`.

import type { ColorScale } from './colorscales'

export interface SectionMeridians {
  min: number
  max: number
  step: number
  latSouth: number
  latNorth: number
}

export interface SectionMeta {
  runId: string
  /** Init-Zeit des Laufs, ISO */
  run: string
  steps: number[]
  /** Nord-Süd-Linien zum Durchziehen; fehlt bei älteren Läufen */
  meridians?: SectionMeridians
}

/** Auswahl „frei gezogene Linie" neben den festen Föhnachsen. */
export const FREE_SECTION = 'free'

/** Auf das Raster der vorberechneten Linien, innerhalb ihres Bereichs. */
export function snapLon(lon: number, m: Pick<SectionMeridians, 'min' | 'max' | 'step'>): number {
  const clamped = Math.min(m.max, Math.max(m.min, lon))
  return Math.round(Math.round((clamped - m.min) / m.step) * m.step * 10 + m.min * 10) / 10
}

/** Dateiname der Linie auf dieser Länge (`lon-114`), wie im Ingest. */
export function meridianId(lon: number): string {
  return `lon-${String(Math.round(lon * 10)).padStart(3, '0')}`
}

export interface SectionData {
  id: string
  label: string
  runId: string
  /** Vorhersagestunden */
  steps: number[]
  /** Entfernung entlang der Achse je Spalte */
  km: number[]
  marks: { name: string; km: number }[]
  /** Modellgelände (m) je Spalte */
  terrain: number[]
  /** Höhe (m) je Fläche × Spalte, von unten nach oben */
  z: number[][]
  /** je Schritt × Fläche × Spalte: 0,1 K */
  theta: (number | null)[][][]
  /** 0,1 m/s, positiv zum Achsenende */
  along: (number | null)[][][]
  /** 0,01 m/s, positiv aufwärts */
  w: (number | null)[][][]
}

export type SectionMode = 'w' | 'along'

export const SECTION_TOP_M = 8000
export const THETA_STEP_K = 2

// Dunkel in der Mitte, nach außen heller: fast überall ist die Bewegung klein, nur
// Hebung und Absinken sollen leuchten. Abwärts bzw. nach Süden blau, sonst rot.
const SECTION_COLORS = [
  '#eaf6ff', '#b3dbf6', '#74b7e8', '#3f8fd0', '#2a6596', '#23415e',
  '#25282d',
  '#55302c', '#8a3a2c', '#c24a2c', '#ea6a33', '#f59c55', '#fbc98f', '#fff0d8',
]
const scale = (steps: number[]): ColorScale => ({
  kind: 'stepped',
  belowMin: 'clamp',
  stops: steps.map((value, i) => ({ value, color: SECTION_COLORS[i] })),
})

export const SECTION_SCALES: Record<SectionMode, { scale: ColorScale; unit: string; label: string }> = {
  w: {
    scale: scale([-3, -2, -1.5, -1, -0.6, -0.3, -0.1, 0.1, 0.3, 0.6, 1, 1.5, 2, 3]),
    unit: 'm/s',
    label: 'Vertikalwind',
  },
  along: {
    scale: scale([-80, -60, -40, -30, -20, -10, -5, 5, 10, 20, 30, 40, 60, 80]),
    unit: 'km/h',
    label: 'Wind längs der Achse',
  },
}

/** Wert einer Zelle in der Anzeigeeinheit. */
export function displayValue(mode: SectionMode, raw: number): number {
  return mode === 'w' ? raw / 100 : (raw / 10) * 3.6
}

/** Index des Schritts, der dem Zeitpunkt am nächsten liegt. */
export function nearestSectionStep(runMs: number, steps: number[], targetMs: number): number {
  let best = 0
  let bestDist = Infinity
  steps.forEach((h, i) => {
    const d = Math.abs(runMs + h * 3_600_000 - targetMs)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

/** [x1, z1, x2, z2] */
export type IsoSegment = [number, number, number, number]

/**
 * Isolinie über dem Gitter aus Spalten (x) und Flächen (z je Fläche × Spalte), Marching
 * Squares. Das Gitter folgt dem Gelände, gerechnet wird deshalb in Index-Koordinaten:
 * die Kanten eines Vierecks werden linear geteilt, x und z je für sich.
 */
export function isoSegments(x: number[], z: number[][], f: (number | null)[][], level: number): IsoSegment[] {
  const out: IsoSegment[] = []
  const cross = (va: number, vb: number, xa: number, za: number, xb: number, zb: number): [number, number] => {
    const t = (level - va) / (vb - va)
    return [xa + t * (xb - xa), za + t * (zb - za)]
  }
  for (let k = 0; k < z.length - 1; k++) {
    for (let i = 0; i < x.length - 1; i++) {
      const a = f[k][i]
      const b = f[k][i + 1]
      const c = f[k + 1][i + 1]
      const d = f[k + 1][i]
      if (a == null || b == null || c == null || d == null) continue
      const pts: [number, number][] = []
      if (a < level !== b < level) pts.push(cross(a, b, x[i], z[k][i], x[i + 1], z[k][i + 1]))
      if (b < level !== c < level) pts.push(cross(b, c, x[i + 1], z[k][i + 1], x[i + 1], z[k + 1][i + 1]))
      if (c < level !== d < level) pts.push(cross(c, d, x[i + 1], z[k + 1][i + 1], x[i], z[k + 1][i]))
      if (d < level !== a < level) pts.push(cross(d, a, x[i], z[k + 1][i], x[i], z[k][i]))
      if (pts.length === 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
      else if (pts.length === 4) {
        // Sattel: die Kanten paarweise, welche Paarung gilt, ist hier nicht entscheidbar
        out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]], [pts[2][0], pts[2][1], pts[3][0], pts[3][1]])
      }
    }
  }
  return out
}

/** Linienwerte auf Vielfachen von `step`, die im Bereich der Werte liegen. */
export function isoLevels(min: number, max: number, step: number): number[] {
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

/** Index der Fläche, deren Höhe in der Spalte `z` am nächsten liegt. */
export function nearestLevel(z: number[][], column: number, height: number): number {
  let best = 0
  let bestDist = Infinity
  for (let k = 0; k < z.length; k++) {
    const d = Math.abs(z[k][column] - height)
    if (d < bestDist) {
      bestDist = d
      best = k
    }
  }
  return best
}
