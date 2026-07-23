// Kartenfeld → ImageData für die MapLibre-image-Source.
//
// Die image-Source spannt das Bild LINEAR im Web-Mercator-Raum zwischen die
// Eckkoordinaten. Das lat/lon-Gitter ist aber in Breitengraden linear — darum
// wird beim Erzeugen vorverzerrt: pro Ziel-Pixelzeile die Latitude über die
// inverse Mercator-Projektion bestimmen und erst dann im Gitter samplen.
// (Longitude ist in Mercator linear, Spalten brauchen keine Korrektur.)
// Ohne das ist die Darstellung bei großen Domains merklich verschoben.
//
// Bilineare Interpolation zwischen Gitterpunkten; fehlende Werte (NaN, z.B.
// außerhalb der Modellabdeckung) werden transparent gerendert.

import type { GridField } from '../api/openmeteo'
import type { ColorScale } from '../config/colorscales'

const IMAGE_WIDTH = 512
const LUT_SIZE = 256

function mercatorY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360))
}

function inverseMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI
}

function parseHex(color: string): [number, number, number, number] {
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  const a = color.length >= 9 ? parseInt(color.slice(7, 9), 16) : 255
  return [r, g, b, a]
}

// Lookup-Tabelle über [min, max] — einmal pro Skala, danach O(1) pro Pixel
const lutCache = new WeakMap<ColorScale, Uint8ClampedArray>()

function buildLut(scale: ColorScale): Uint8ClampedArray {
  const cached = lutCache.get(scale)
  if (cached) return cached

  const lut = new Uint8ClampedArray(LUT_SIZE * 4)
  const stops = scale.stops
  const min = stops[0].value
  const max = stops[stops.length - 1].value
  const rgba = stops.map((s) => parseHex(s.color))

  for (let i = 0; i < LUT_SIZE; i++) {
    const v = min + ((max - min) * i) / (LUT_SIZE - 1)
    let color: [number, number, number, number]
    if (scale.kind === 'stepped') {
      // letzter Stop mit value <= v; unterhalb des ersten → transparent
      let idx = -1
      for (let s = 0; s < stops.length && stops[s].value <= v; s++) idx = s
      color = idx < 0 ? [0, 0, 0, 0] : rgba[idx]
    } else {
      let s = 0
      while (s < stops.length - 2 && stops[s + 1].value < v) s++
      const span = stops[s + 1].value - stops[s].value
      const f = span > 0 ? Math.min(1, Math.max(0, (v - stops[s].value) / span)) : 0
      color = [
        rgba[s][0] + (rgba[s + 1][0] - rgba[s][0]) * f,
        rgba[s][1] + (rgba[s + 1][1] - rgba[s][1]) * f,
        rgba[s][2] + (rgba[s + 1][2] - rgba[s][2]) * f,
        rgba[s][3] + (rgba[s + 1][3] - rgba[s][3]) * f,
      ]
    }
    lut.set(color, i * 4)
  }
  lutCache.set(scale, lut)
  return lut
}

/** Feld zum Zeitschritt tIndex in den Canvas rendern. Gibt false zurück, wenn nichts zu rendern ist. */
export function renderFieldToCanvas(
  field: GridField,
  tIndex: number,
  scale: ColorScale,
  canvas: HTMLCanvasElement,
): boolean {
  const nx = field.lons.length
  const ny = field.lats.length
  if (nx < 2 || ny < 2) return false

  const latMin = field.lats[0]
  const latMax = field.lats[ny - 1]
  const lonSpanRad = ((field.lons[nx - 1] - field.lons[0]) * Math.PI) / 180
  const mercTop = mercatorY(latMax)
  const mercBottom = mercatorY(latMin)

  const width = IMAGE_WIDTH
  const height = Math.min(
    1024,
    Math.max(64, Math.round((width * (mercTop - mercBottom)) / lonSpanRad)),
  )
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const lut = buildLut(scale)
  const scaleMin = scale.stops[0].value
  const scaleMax = scale.stops[scale.stops.length - 1].value
  // Unter dem ersten Schwellenwert: transparent (Basiskarte durch) ODER auf die
  // unterste Bandfarbe clampen (Vollbereichsgrößen wie Temperatur). Default bei
  // gestuften Skalen ist transparent; sonst würde der LUT-Clamp auf Index 0 die
  // erste Stufe färben, wo eigentlich „nichts“ gemeint ist.
  const transparentBelowMin = scale.belowMin
    ? scale.belowMin === 'transparent'
    : scale.kind === 'stepped'
  const img = ctx.createImageData(width, height)
  const px = img.data
  const base = tIndex * nx * ny
  const values = field.values

  // Pixelzeile → Gitter-y (inverse Mercator) einmal vorberechnen
  const gridY = new Float64Array(height)
  for (let py = 0; py < height; py++) {
    const merc = mercTop + ((py + 0.5) / height) * (mercBottom - mercTop)
    const lat = inverseMercatorY(merc)
    gridY[py] = ((lat - latMin) / (latMax - latMin)) * (ny - 1)
  }

  for (let py = 0; py < height; py++) {
    const gy = Math.min(ny - 1, Math.max(0, gridY[py]))
    const iy0 = Math.min(ny - 2, Math.floor(gy))
    const fy = gy - iy0
    const row0 = base + iy0 * nx
    const row1 = row0 + nx
    let out = py * width * 4

    for (let pxi = 0; pxi < width; pxi++) {
      const gx = ((pxi + 0.5) / width) * (nx - 1)
      const ix0 = Math.min(nx - 2, Math.floor(gx))
      const fx = gx - ix0

      const v00 = values[row0 + ix0]
      const v01 = values[row0 + ix0 + 1]
      const v10 = values[row1 + ix0]
      const v11 = values[row1 + ix0 + 1]

      // fehlende Nachbarn → Pixel transparent, kein Farbwert
      if (Number.isNaN(v00) || Number.isNaN(v01) || Number.isNaN(v10) || Number.isNaN(v11)) {
        out += 4
        continue
      }

      const v =
        (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy

      if (transparentBelowMin && v < scaleMin) {
        out += 4
        continue
      }

      let li = Math.round(((v - scaleMin) / (scaleMax - scaleMin)) * (LUT_SIZE - 1))
      if (li < 0) li = 0
      else if (li > LUT_SIZE - 1) li = LUT_SIZE - 1
      const lo = li * 4

      px[out++] = lut[lo]
      px[out++] = lut[lo + 1]
      px[out++] = lut[lo + 2]
      px[out++] = lut[lo + 3]
    }
  }

  ctx.putImageData(img, 0, 0)

  // Instrumentierung: „schwarz“ kann Layout, fehlende Daten ODER eine leere
  // Skala sein — diese Zahlen unterscheiden das, ein Screenshot nicht.
  let validPoints = 0
  for (let i = 0; i < nx * ny; i++) if (!Number.isNaN(values[base + i])) validPoints++
  let paintedPx = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) paintedPx++
  console.debug(
    `[field] t=${tIndex}: ${validPoints}/${nx * ny} Gitterpunkte gültig, ` +
      `${paintedPx}/${width * height} Pixel gemalt (${Math.round((100 * paintedPx) / (width * height))}%)`,
  )
  return true
}
