// Windvolumen für die 3D-Partikel der Ansicht „Alpen 3D" (ICON-D2-Modellflächen, im
// Querschnitt-Ingest mit erzeugt): Datenform und die reine Rechnung.

export interface Wind3dGrid {
  nx: number
  ny: number
  /** Modellflächen von unten nach oben */
  levels: number
  lon0: number
  lat0: number
  dlon: number
  dlat: number
  uvStep: number
  wStep: number
  missing: number
}

export interface Wind3dField {
  grid: Wind3dGrid
  /** je Fläche u, v, w, je ny × nx; `missing` = kein Wert */
  wind: Int8Array
  /** Höhe über NN (m) je Fläche × ny × nx, danach das Modellgelände */
  heights: Int16Array
}

export interface Wind3dSample {
  /** m/s nach Osten, Norden, oben */
  u: number
  v: number
  w: number
  /** Höhe über NN und über Grund (m) */
  z: number
  agl: number
}

/**
 * Farbe nach Geschwindigkeit (km/h). Bewusst nicht die Skala der Windkarte: darauf wären
 * die Partikel in der Farbe ihres Untergrunds. Ab 30 km/h deutlich warm, damit Föhn auffällt.
 */
export const WIND3D_SPEED_STOPS: { kmh: number; rgb: [number, number, number] }[] = [
  { kmh: 0, rgb: [0.5, 0.82, 1] },
  { kmh: 15, rgb: [0.8, 0.96, 1] },
  { kmh: 25, rgb: [1, 1, 0.85] },
  { kmh: 30, rgb: [1, 0.92, 0.25] },
  { kmh: 45, rgb: [1, 0.62, 0.12] },
  { kmh: 65, rgb: [1, 0.22, 0.18] },
  { kmh: 90, rgb: [1, 0.2, 0.85] },
  { kmh: 120, rgb: [0.72, 0.4, 1] },
]

export function speedColor(kmh: number): [number, number, number] {
  const s = WIND3D_SPEED_STOPS
  if (kmh <= s[0].kmh) return s[0].rgb
  for (let i = 1; i < s.length; i++) {
    if (kmh <= s[i].kmh) {
      const t = (kmh - s[i - 1].kmh) / (s[i].kmh - s[i - 1].kmh)
      const a = s[i - 1].rgb
      const b = s[i].rgb
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]
    }
  }
  return s[s.length - 1].rgb
}

/**
 * Wind an (lon, lat) auf der gebrochenen Fläche `level`, bilinear in der Ebene und linear
 * zwischen den Flächen; null außerhalb des Gitters oder wenn ein Nachbar keinen Wert hat.
 */
export function sampleWind3d(f: Wind3dField, lon: number, lat: number, level: number): Wind3dSample | null {
  const { nx, ny, levels, lon0, lat0, dlon, dlat, uvStep, wStep, missing } = f.grid
  const fx = (lon - lon0) / dlon
  const fy = (lat - lat0) / dlat
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1 || level < 0 || level > levels - 1) return null
  const l0 = Math.min(Math.floor(level), levels - 2)
  const tx = fx - i
  const ty = fy - j
  const tl = level - l0
  const a = (1 - tx) * (1 - ty)
  const b = tx * (1 - ty)
  const c = (1 - tx) * ty
  const d = tx * ty
  const p00 = j * nx + i
  const p01 = p00 + 1
  const p10 = p00 + nx
  const p11 = p10 + 1
  const plane = ny * nx

  const out = [0, 0, 0]
  for (let comp = 0; comp < 3; comp++) {
    let v = 0
    for (let l = 0; l < 2; l++) {
      const base = (l0 + l) * 3 * plane + comp * plane
      const v00 = f.wind[base + p00]
      const v01 = f.wind[base + p01]
      const v10 = f.wind[base + p10]
      const v11 = f.wind[base + p11]
      if (v00 === missing || v01 === missing || v10 === missing || v11 === missing) return null
      v += (l ? tl : 1 - tl) * (a * v00 + b * v01 + c * v10 + d * v11)
    }
    out[comp] = v
  }
  const heightAt = (l: number) => {
    const base = l * plane
    return a * f.heights[base + p00] + b * f.heights[base + p01] + c * f.heights[base + p10] + d * f.heights[base + p11]
  }
  const z0 = heightAt(l0)
  const z1 = heightAt(l0 + 1)
  const z = z0 + tl * (z1 - z0)
  return { u: out[0] * uvStep, v: out[1] * uvStep, w: out[2] * wStep, z, agl: z - heightAt(levels) }
}

/**
 * Wind in der Höhe `z` (m über NN). Unter der untersten Modellfläche gilt die unterste
 * (dort gleitet ein Partikel am Gelände entlang, `Wind3dSample.z` sagt, wo es dann liegt),
 * über der obersten gibt es nichts.
 *
 * Bewusst über die HÖHE und nicht entlang der Flächen: die folgen dem Gelände, und `w` ist die
 * Bewegung im Raum. Entlang einer Fläche gerechnet hebt man ein Partikel am Berg doppelt.
 */
export function sampleWind3dAtHeight(f: Wind3dField, lon: number, lat: number, z: number): Wind3dSample | null {
  const { nx, ny, levels, lon0, lat0, dlon, dlat } = f.grid
  const fx = (lon - lon0) / dlon
  const fy = (lat - lat0) / dlat
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return null
  const tx = fx - i
  const ty = fy - j
  const p00 = j * nx + i
  const plane = ny * nx
  const heightAt = (l: number) => {
    const o = l * plane + p00
    const h = f.heights
    return (1 - ty) * ((1 - tx) * h[o] + tx * h[o + 1]) + ty * ((1 - tx) * h[o + nx] + tx * h[o + nx + 1])
  }
  let below = heightAt(0)
  if (z <= below) return sampleWind3d(f, lon, lat, 0)
  for (let l = 1; l < levels; l++) {
    const above = heightAt(l)
    if (z <= above) return sampleWind3d(f, lon, lat, l - 1 + (z - below) / (above - below))
    below = above
  }
  return null
}

/** Index des Volumens, das dem Zeitpunkt am nächsten liegt, oder -1 wenn keines nah genug ist. */
export function nearestWind3dStep(runMs: number, steps: number[], targetMs: number, maxGapH = 2): number {
  let best = -1
  let bestGap = maxGapH * 3_600_000
  steps.forEach((h, i) => {
    const gap = Math.abs(runMs + h * 3_600_000 - targetMs)
    if (gap <= bestGap) {
      bestGap = gap
      best = i
    }
  })
  return best
}
