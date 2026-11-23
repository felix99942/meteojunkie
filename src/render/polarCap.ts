// POLKAPPE DER KUGEL als eigene WebGL-Ebene (seit 2026-11-21, auf Wunsch — der Polarwirbel
// sitzt genau dort). MapLibre zieht Rasterkacheln nur bis 85,05° (Ende von Web-Mercator) und
// streckt die letzte Zeile bis an den Pol; deshalb tragen die Kacheln dort seit jeher nur das
// Ringmittel (`POLE_ROWS`, `poleSide`) und keine Linien — ein einfarbiger, blinder Kreis von
// gut 550 km Radius, mitten im Wirbel.
//
// Hier wird die Kappe ab `CAP_LAT` als SCHEIBE gezeichnet: ein Ringnetz in Länge/Breite, auf
// die Kugel gelegt über MapLibres eigene Projektionsfunktion (`interpolateProjection` aus dem
// Shader-Vorspann), eingefärbt mit einer Textur in POLARER Abbildung (azimutal abstandstreu um
// den Pol). Die Textur rechnet die CPU aus demselben Feld mit derselben Farbtabelle und
// derselben Isolinienregel wie die Kacheln (`colorizeTile`, `contourTile`), die Kante bei
// `CAP_LAT` ist deshalb unsichtbar.
//
// ZWEI Ebenen: die FLÄCHE liegt direkt über dem Feld (unter Relief, Gradnetz und Küsten), die
// LINIEN über allem wie die Isolinien-Kacheln. Linien zeichnet die Kappe nur nördlich der Zeile,
// ab der die Kacheln selbst keine mehr haben (`bandLat`) — so laufen sie ohne Lücke und ohne
// doppelten Strich ineinander über.

import maplibregl from 'maplibre-gl'
import { gridX, gridY, POLE_ROWS, tilePixelLat, type GlobeField } from '../config/globe'
import type { ColorScale } from '../config/colorscales'
import { buildLut, LUT_SIZE } from './fieldImage'
import type { ContourStyle } from './globeContours'

/** Südrand der Kappe. Südlich der gestreckten Kachelzeilen auf jeder Stufe (Stufe 0: 82,7°). */
export const CAP_LAT = 82
const CAP_SPAN = 90 - CAP_LAT

/** Breite/Länge eines Texels (Mitte), oder null außerhalb der Scheibe. */
export function capTexelLatLon(px: number, py: number, size: number): { lat: number; lon: number } | null {
  const u = ((px + 0.5) / size) * 2 - 1
  const v = ((py + 0.5) / size) * 2 - 1
  const r = Math.hypot(u, v)
  if (r > 1) return null
  return { lat: 90 - r * CAP_SPAN, lon: (Math.atan2(u, v) * 180) / Math.PI }
}

/** Texelkoordinaten (0…1) eines Punkts — die Umkehrung, so rechnet auch der Shader. */
export function capUV(lat: number, lon: number): [number, number] {
  const r = (90 - lat) / CAP_SPAN
  const l = (lon * Math.PI) / 180
  return [0.5 + 0.5 * r * Math.sin(l), 0.5 + 0.5 * r * Math.cos(l)]
}

/** Bilinear im Gitter über die CODES wie `colorizeTile`; NaN ohne Wert. */
function codeAt(f: GlobeField, lat: number, lon: number): number {
  const { ni, nj } = f.grid
  const gx = gridX(f.grid, lon)
  const gy = gridY(f.grid, lat)
  if (gx == null || gy == null) return NaN
  const i0 = Math.min(ni - 1, Math.floor(gx))
  const i1 = i0 + 1 === ni ? 0 : i0 + 1
  const j0 = Math.min(nj - 2, Math.floor(gy))
  const fx = gx - i0
  const fy = gy - j0
  const c = f.codes
  const r0 = j0 * ni
  const r1 = r0 + ni
  const a = c[r0 + i0]
  const b = c[r0 + i1]
  const d = c[r1 + i0]
  const e = c[r1 + i1]
  if (a === 0 || b === 0 || d === 0 || e === 0) return NaN
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
}

/** Fläche der Kappe als RGBA (nicht vormultipliziert), 2 × 2 überabgetastet wie die Kacheln. */
export function capFillRaster(f: GlobeField, scale: ColorScale, size: number): Uint8ClampedArray {
  const lut = buildLut(scale)
  const sMin = scale.stops[0].value
  const sMax = scale.stops[scale.stops.length - 1].value
  const transparentBelow = scale.belowMin ? scale.belowMin === 'transparent' : scale.kind === 'stepped'
  const k = (LUT_SIZE - 1) / (sMax - sMin)
  const out = new Uint8ClampedArray(size * size * 4)
  const sub = size * 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          // Rand der Scheibe noch EIN Texel weiter füllen: die Textur wird linear gelesen,
          // sonst mischte sich am Kappenrand das Durchsichtige ein
          const ll = capTexelLatLon(px * 2 + dx, py * 2 + dy, sub) ?? edgeLatLon(px * 2 + dx, py * 2 + dy, sub)
          if (!ll) continue
          const code = codeAt(f, ll.lat, ll.lon)
          if (code !== code) continue
          const val = f.lo + (code - 1) * f.step
          if (transparentBelow && val < sMin) continue
          const li = Math.min(LUT_SIZE - 1, Math.max(0, Math.round((val - sMin) * k)))
          const q = li * 4
          const al = lut[q + 3]
          sr += lut[q] * al
          sg += lut[q + 1] * al
          sb += lut[q + 2] * al
          sa += al
        }
      if (sa === 0) continue
      const o = (py * size + px) * 4
      out[o] = sr / sa
      out[o + 1] = sg / sa
      out[o + 2] = sb / sa
      out[o + 3] = sa / 4
    }
  }
  return out
}

/** Knapp außerhalb der Scheibe: auf den Rand projiziert (Saum gegen lineares Lesen). */
function edgeLatLon(px: number, py: number, size: number): { lat: number; lon: number } | null {
  const u = ((px + 0.5) / size) * 2 - 1
  const v = ((py + 0.5) / size) * 2 - 1
  const r = Math.hypot(u, v)
  if (r > 1 + 4 / size) return null
  return { lat: CAP_LAT, lon: (Math.atan2(u, v) * 180) / Math.PI }
}

/** Wert, den der Shader als „kein Wert" liest */
export const CAP_NO_VALUE = -1e30

/**
 * WERTE der Kappe (geglättetes Feld, bilinear) im Texelraster — für die Isolinien. Die Linie
 * zeichnet erst der Shader, je Bildschirmpixel aus Wert und Gefälle (d = |v − L| / |∇v|, wie
 * `contourTile`). Ein fertiges Linienbild wurde beim Zoomen mitvergrößert und die Linien
 * dabei FETT (gemeldet); so bleibt die Breite bei jedem Zoom genau gleich, auch während der
 * Bewegung, und die Textur muss beim Zoomen nicht neu gerechnet werden.
 */
export function capValueRaster(f: GlobeField, smooth: Float32Array, size: number): Float32Array {
  const { ni, nj } = f.grid
  const out = new Float32Array(size * size).fill(CAP_NO_VALUE)
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      // Saum über den Rand der Scheibe hinaus, damit das bilineare Lesen am Rand Werte hat
      const ll = capTexelLatLon(px, py, size) ?? edgeLatLon(px, py, size)
      if (!ll) continue
      const gx = gridX(f.grid, ll.lon)
      const gy = gridY(f.grid, ll.lat)
      if (gx == null || gy == null) continue
      const i0 = Math.min(ni - 1, Math.floor(gx))
      const i1 = i0 + 1 === ni ? 0 : i0 + 1
      const j0 = Math.min(nj - 2, Math.floor(gy))
      const fx = gx - i0
      const fy = gy - j0
      const r0 = j0 * ni
      const r1 = r0 + ni
      const v =
        (smooth[r0 + i0] * (1 - fx) + smooth[r0 + i1] * fx) * (1 - fy) +
        (smooth[r1 + i0] * (1 - fx) + smooth[r1 + i1] * fx) * fy
      if (v === v) out[py * size + px] = v
    }
  return out
}

/**
 * Breite, ab der die Kacheln einer Stufe keine Linien mehr haben (oberste `POLE_ROWS` Zeilen
 * der obersten Kachelreihe) — dort übernimmt die Kappe.
 */
export function bandLat(tileZoom: number): number {
  return tilePixelLat(tileZoom, 0, POLE_ROWS, 256)
}

// --- WebGL-Ebene --------------------------------------------------------------

const RINGS = 32
const SEGMENTS = 256

function buildMesh(): { pos: Float32Array; idx: Uint16Array } {
  const pos = new Float32Array((RINGS + 1) * (SEGMENTS + 1) * 2)
  let o = 0
  for (let r = 0; r <= RINGS; r++) {
    const lat = CAP_LAT + (CAP_SPAN * r) / RINGS
    for (let s = 0; s <= SEGMENTS; s++) {
      pos[o++] = lat
      pos[o++] = -180 + (360 * s) / SEGMENTS
    }
  }
  const idx = new Uint16Array(RINGS * SEGMENTS * 6)
  let q = 0
  for (let r = 0; r < RINGS; r++)
    for (let s = 0; s < SEGMENTS; s++) {
      const a = r * (SEGMENTS + 1) + s
      const b = a + SEGMENTS + 1
      idx.set([a, b, a + 1, a + 1, b, b + 1], q)
      q += 6
    }
  return { pos, idx }
}

const FILL_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, v_uv); }`

// Isolinie je Bildschirmpixel: Wert bilinear aus der Werte-Textur (R32F lässt sich nicht
// überall linear filtern, deshalb vier texelFetch), Abstand zur Linie über die Ableitung im
// Bildschirm. Breiten in CSS-Pixeln wie `contourTile`, mal Pixeldichte.
const LINE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_val;
uniform float u_size, u_step, u_shift, u_min, u_core, u_halo, u_haloA, u_from, u_dpr;
uniform vec3 u_cc, u_hc;
in vec2 v_uv;
out vec4 fragColor;
const float CAP_SPAN = ${CAP_SPAN.toFixed(1)};
float val(vec2 uv) {
  vec2 p = uv * u_size - 0.5;
  ivec2 i = clamp(ivec2(floor(p)), ivec2(0), ivec2(int(u_size) - 2));
  vec2 f = clamp(p - vec2(i), 0.0, 1.0);
  float a = texelFetch(u_val, i, 0).r;
  float b = texelFetch(u_val, i + ivec2(1, 0), 0).r;
  float c = texelFetch(u_val, i + ivec2(0, 1), 0).r;
  float d = texelFetch(u_val, i + ivec2(1, 1), 0).r;
  if (min(min(a, b), min(c, d)) < -1e29) return -1e30;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  float lat = 90.0 - length(v_uv * 2.0 - 1.0) * CAP_SPAN;
  if (lat < u_from) discard;
  float v = val(v_uv);
  if (v < -1e29) discard;
  float e0 = v - u_shift;
  float L = floor(e0 / u_step + 0.5) * u_step;
  if (L < u_min) discard;
  float e = e0 - L;
  float g = length(vec2(dFdx(v), dFdy(v)));
  if (g < 1e-12) discard;
  float d = abs(e) / g / u_dpr;
  float core = clamp(u_core + 0.5 - d, 0.0, 1.0);
  float halo = clamp(u_halo + 0.5 - d, 0.0, 1.0) * u_haloA;
  float a = core + (1.0 - core) * halo;
  if (a <= 0.0) discard;
  vec3 col = mix(u_hc, u_cc, core / a) / 255.0;
  fragColor = vec4(col * a, a);
}`

function vert(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}
in vec2 a_ll;
out vec2 v_uv;
const float CAP_SPAN = ${CAP_SPAN.toFixed(1)};
void main() {
  float lat = radians(a_ll.x);
  float lon = radians(a_ll.y);
  float r = (90.0 - a_ll.x) / CAP_SPAN;
  v_uv = vec2(0.5 + 0.5 * r * sin(lon), 0.5 + 0.5 * r * cos(lon));
#ifdef GLOBE
  // dieselbe Kugelposition wie projectToSphere, aber aus Länge/Breite statt aus Mercator —
  // Mercator endet bei 85,05°, genau das ist ja das Problem
  vec3 pos = vec3(sin(lon) * cos(lat), sin(lat), cos(lon) * cos(lat));
  // flacher Rückfall (nur beim Übergang Kugel → Karte nahe dem Pol relevant): Mercator geklemmt
  float latc = radians(min(a_ll.x, 89.5));
  vec2 merc = vec2(a_ll.y / 360.0 + 0.5, 0.5 - log(tan(0.785398 + latc / 2.0)) / 6.283185);
  vec2 inTile = (merc - u_projection_tile_mercator_coords.xy) / u_projection_tile_mercator_coords.zw;
  gl_Position = interpolateProjection(inTile, pos, 0.0);
#else
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
}`
}

/** Eine Linienart in der Kappe: Werte plus Abstand und Stil wie bei den Kacheln. */
export interface CapContour {
  values: Float32Array
  size: number
  /** Linienabstand OHNE die Verdopplung auf der ganzen Kugel — die rechnet die Ebene je Bild */
  interval: number
  /** halbe Speicherstufe, siehe `contourTile` */
  shift: number
  min?: number
  style: ContourStyle
}

const CORE_HW = 0.75
const HALO_HW = 1.9
const HALO_ALPHA = 0.55

type Prog = { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null>; aLL: number }

/**
 * Eine Kappenebene: FLÄCHE (fertiges RGBA-Bild) oder LINIEN (Werte, im Shader gezeichnet).
 * `tileZoom` liefert die aktuelle Kachelstufe der Isolinien — daran hängen die Verdopplung
 * des Abstands auf der ganzen Kugel und die Grenze, ab der die Kappe übernimmt; beides wird
 * so in JEDEM Bild nachgeführt, auch mitten im Zoom.
 */
export class PolarCapLayer implements maplibregl.CustomLayerInterface {
  readonly type = 'custom' as const
  readonly renderingMode = '2d' as const
  readonly id: string
  private readonly mode: 'fill' | 'lines'
  private readonly tileZoom: () => number
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, Prog>()
  private vbo: WebGLBuffer | null = null
  private ibo: WebGLBuffer | null = null
  private count = 0
  private fillTex: WebGLTexture | null = null
  private pendingFill: { rgba: Uint8ClampedArray; size: number } | null | undefined = undefined
  private hasFill = false
  private lineTex: { tex: WebGLTexture; c: CapContour }[] = []
  private pendingLines: CapContour[] | undefined = undefined

  constructor(id: string, mode: 'fill' | 'lines', tileZoom: () => number = () => 3) {
    this.id = id
    this.mode = mode
    this.tileZoom = tileZoom
  }

  /** Fläche: neue Textur (RGBA, nicht vormultipliziert) — null blendet aus. */
  setImage(rgba: Uint8ClampedArray | null, size: number): void {
    this.pendingFill = rgba ? { rgba, size } : null
    this.map?.triggerRepaint()
  }

  /** Linien: die Linienarten (leer blendet aus). */
  setContours(list: CapContour[]): void {
    this.pendingLines = list
    this.map?.triggerRepaint()
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map
    this.gl = gl as WebGL2RenderingContext
    const { pos, idx } = buildMesh()
    this.vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW)
    this.ibo = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    this.count = idx.length
    this.fillTex = gl.createTexture()
  }

  onRemove(): void {
    const gl = this.gl
    if (gl) {
      for (const p of this.programs.values()) gl.deleteProgram(p.prog)
      gl.deleteBuffer(this.vbo)
      gl.deleteBuffer(this.ibo)
      gl.deleteTexture(this.fillTex)
      for (const l of this.lineTex) gl.deleteTexture(l.tex)
    }
    this.lineTex = []
    this.programs.clear()
    this.map = null
    this.gl = null
  }

  private program(shaderData: maplibregl.CustomRenderMethodInput['shaderData']): Prog {
    const gl = this.gl!
    const hit = this.programs.get(shaderData.variantName)
    if (hit) return hit
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert(shaderData.vertexShaderPrelude, shaderData.define)))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, this.mode === 'fill' ? FILL_FRAG : LINE_FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'Programm')
    const names = [
      'u_projection_matrix', 'u_projection_tile_mercator_coords', 'u_projection_clipping_plane',
      'u_projection_transition', 'u_projection_fallback_matrix',
      'u_tex', 'u_val', 'u_size', 'u_step', 'u_shift', 'u_min', 'u_core', 'u_halo', 'u_haloA',
      'u_from', 'u_dpr', 'u_cc', 'u_hc',
    ]
    const loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]))
    const p = { prog, loc, aLL: gl.getAttribLocation(prog, 'a_ll') }
    this.programs.set(shaderData.variantName, p)
    return p
  }

  private upload(gl: WebGL2RenderingContext): void {
    if (this.pendingFill !== undefined) {
      const p = this.pendingFill
      this.pendingFill = undefined
      this.hasFill = !!p
      if (p) {
        gl.bindTexture(gl.TEXTURE_2D, this.fillTex)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.size, p.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
    }
    if (this.pendingLines !== undefined) {
      const list = this.pendingLines
      this.pendingLines = undefined
      for (const l of this.lineTex) gl.deleteTexture(l.tex)
      this.lineTex = list.map((c) => {
        const tex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, c.size, c.size, 0, gl.RED, gl.FLOAT, c.values)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        return { tex, c }
      })
    }
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput): void {
    const gl = this.gl
    const map = this.map
    if (!gl || !map) return
    this.upload(gl)
    // Nur auf der Kugel: flach endet die Karte ohnehin bei 85,05°
    if (!args.shaderData.define.includes('GLOBE')) return
    if (this.mode === 'fill' ? !this.hasFill : !this.lineTex.length) return
    const p = this.program(args.shaderData)
    const pd = args.defaultProjectionData
    gl.useProgram(p.prog)
    gl.uniformMatrix4fv(p.loc.u_projection_matrix, false, pd.mainMatrix as Float32Array)
    gl.uniform4f(p.loc.u_projection_tile_mercator_coords, ...pd.tileMercatorCoords)
    gl.uniform4f(p.loc.u_projection_clipping_plane, ...pd.clippingPlane)
    gl.uniform1f(p.loc.u_projection_transition, pd.projectionTransition)
    gl.uniformMatrix4fv(p.loc.u_projection_fallback_matrix, false, pd.fallbackMatrix as Float32Array)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(p.aLL)
    gl.vertexAttribPointer(p.aLL, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.activeTexture(gl.TEXTURE0)
    if (this.mode === 'fill') {
      gl.bindTexture(gl.TEXTURE_2D, this.fillTex)
      gl.uniform1i(p.loc.u_tex, 0)
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0)
    } else {
      const zt = this.tileZoom()
      gl.uniform1f(p.loc.u_from, bandLat(zt))
      gl.uniform1f(p.loc.u_dpr, map.getPixelRatio())
      gl.uniform1i(p.loc.u_val, 0)
      for (const { tex, c } of this.lineTex) {
        const st = c.style
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.uniform1f(p.loc.u_size, c.size)
        gl.uniform1f(p.loc.u_step, c.interval * (zt <= 2 ? 2 : 1))
        gl.uniform1f(p.loc.u_shift, c.shift)
        gl.uniform1f(p.loc.u_min, c.min ?? -1e30)
        gl.uniform1f(p.loc.u_core, st.coreHW ?? CORE_HW)
        gl.uniform1f(p.loc.u_halo, st.haloHW ?? HALO_HW)
        gl.uniform1f(p.loc.u_haloA, st.haloAlpha ?? HALO_ALPHA)
        gl.uniform3f(p.loc.u_cc, ...st.core)
        gl.uniform3f(p.loc.u_hc, ...st.halo)
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0)
      }
    }
    gl.disableVertexAttribArray(p.aLL)
  }
}
