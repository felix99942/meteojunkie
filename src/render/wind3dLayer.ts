// Windpartikel auf dem Relief der Ansicht „Alpen 3D", aus dem Windvolumen von ICON-D2 samt
// echtem Vertikalwind: eine eigene WebGL-Ebene, weil die Spuren durch den Raum laufen und die
// Karte sich neigen lässt.
//
// Tempo wie die 2D-Partikel (`pxPerSecondAt10`), gerafft. Waagrecht und senkrecht mit DERSELBEN
// Raffung je Partikel, die Steigung der Bahn ist also die echte (nur um die Geländeüberhöhung
// gestreckt): am Hang steigt ein Partikel durch das `w` des Modells, nicht durch einen Kunstgriff.
//
// Die Spur ist ein schmales, zum Ende hin dünner und blasser werdendes BAND aus Instanzen
// (GL-Linien sind fest 1 Pixel breit). Die Deckkraft hängt am Alter jedes Stützpunkts, nicht an
// seiner Nummer: sonst sprängen die Stufen bei jedem Weiterrücken, und die Spur wirkte kantig.

import maplibregl from 'maplibre-gl'
import { speedColor, type Wind3dSample } from '../config/wind3d'
import { RELIEF_EXAGGERATION, TOPO_MAX_ZOOM } from './globeTopo'
import { pxPerSecondAt10 } from './windParticles'

export const WIND3D_LAYER = 'wind3d-particles'

/** Wind an einem Punkt in der Höhe z (m über NN), oder null */
export type Wind3dSampler = (lon: number, lat: number, z: number) => Wind3dSample | null

const COUNT = 3000
/** Stützpunkte je Spur, alle `TRAIL_DT` Sekunden einer: zusammen knapp anderthalb Sekunden */
const TRAIL = 24
const TRAIL_DT = 0.06
const FLOATS = 12 // von xyz, nach xyz, rgb, Deckkraft an beiden Enden, Breite
/** Breite des Kerns in Pixeln, wächst mit der Geschwindigkeit bis `WIDTH_FULL_KMH` */
const WIDTH_MIN = 1.4
const WIDTH_ADD = 1.5
const WIDTH_FULL_KMH = 50
/** Am Spurende bleibt so viel der Breite */
const TAIL_WIDTH = 0.45
const LIFE_MIN = 2
const LIFE_MAX = 5
const FADE_S = 0.5
const SPAWN_TRIES = 12
const SPAWN_CELLS_X = 5
const SPAWN_CELLS_Y = 4
const M_PER_DEG = 111_320
const EARTH_M = 40_075_016.68
/** Bodenwind knapp über dem Gelände (Meter nach der Überhöhung) */
const GROUND_LIFT_M = 15
/**
 * Das Modell kennt nur ein geglättetes 2,2-km-Gelände. Bodennah gilt deshalb die Höhe über dem
 * echten Relief; dieser Anteil klingt mit der Höhe über Grund ab (e-Faltung in Metern).
 */
const RELIEF_BLEND_M = 1500
/** Gezeigt wird der Wind bis so hoch über Grund (m); die Höhe liest man in der 2D-Ansicht */
const TOP_AGL_M = 1000
/** So weit darf eine Bahn darüber hinausragen, bevor sie neu startet (m) */
const TOP_MARGIN_M = 100
/**
 * Bezugstempo (m/s), das auf dem Schirm so schnell läuft wie sonst 10 m/s: am Boden klein,
 * damit Talwind ins Auge fällt, nach oben größer, sonst rasen die Partikel im Höhenwind.
 */
const REF_SPEED_GROUND = 6
const REF_SPEED_PER_M = 12 / 3000
/** Die Geländehöhe wird reihum nur für jedes n-te Partikel je Bild neu gelesen */
const TERRAIN_EVERY = 3
const TERRAIN_FOLLOW = 0.5
const MAX_DT = 0.05
const FRAME_MS = 16

const VERT = `#version 300 es
in vec3 a_from;
in vec3 a_to;
in vec3 a_rgb;
in vec2 a_alpha;
in float a_width;
uniform mat4 u_matrix;
uniform vec2 u_size;
out vec3 v_rgb;
out float v_alpha;
out float v_across;
out float v_core;
const float ALONG[6] = float[6](0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
const float SIDE[6] = float[6](-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);
const float MARGIN = 2.2;
void main() {
  vec4 a = u_matrix * vec4(a_from, 1.0);
  vec4 b = u_matrix * vec4(a_to, 1.0);
  float t = ALONG[gl_VertexID];
  v_alpha = mix(a_alpha.x, a_alpha.y, t);
  v_rgb = a_rgb;
  v_core = a_width * (${TAIL_WIDTH.toFixed(2)} + ${(1 - TAIL_WIDTH).toFixed(2)} * v_alpha) * 0.5;
  float half_px = v_core + MARGIN;
  v_across = SIDE[gl_VertexID] * half_px;
  vec2 d = (b.xy / b.w - a.xy / a.w) * u_size;
  float len = length(d);
  vec2 n = len > 1e-5 ? vec2(-d.y, d.x) / len : vec2(0.0);
  vec4 p = mix(a, b, t);
  p.xy += n * v_across * 2.0 / u_size * p.w;
  // Leicht zum Betrachter, sonst schneidet das Gelände die bodennahen Spuren an
  p.z -= 0.0012 * p.w;
  gl_Position = p;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec3 v_rgb;
in float v_alpha;
in float v_across;
in float v_core;
out vec4 color;
void main() {
  float d = abs(v_across);
  float core = 1.0 - smoothstep(v_core - 0.5, v_core + 0.5, d);
  // Weicher dunkler Saum: über hellen Flächen wären die dünnen Spuren sonst weg
  float halo = (1.0 - smoothstep(v_core, v_core + 2.0, d)) * 0.35;
  float a = core + (1.0 - core) * halo;
  color = vec4(v_rgb * core * v_alpha, a * v_alpha);
}`

const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
/** Höhe in Mercator-Einheiten, wie `MercatorCoordinate.fromLngLat` */
const mercZ = (meters: number, lat: number) => meters / (EARTH_M * Math.cos((lat * Math.PI) / 180))

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('Shader nicht anlegbar')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader-Fehler')
  return s
}

// je Partikel: Länge, Breite, Alter, Lebensdauer (< 0 = neu anlegen), Höhe über NN (m),
// Geländehöhe des Reliefs: zuletzt gelesen und geglättet
const STATE = 7

export class Wind3dLayer implements maplibregl.CustomLayerInterface {
  readonly id = WIND3D_LAYER
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map: maplibregl.Map | null = null
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private vao: WebGLVertexArrayObject | null = null
  private uMatrix: WebGLUniformLocation | null = null
  private uSize: WebGLUniformLocation | null = null
  private sampler: Wind3dSampler | null = null
  private last = 0
  private trailClock = 0
  private frame = 0
  private timer = 0
  /** Geografische Lage der Rasterpunkte des Bildschirms (lon, lat), null bis zur ersten Messung */
  private spawnGrid: Float64Array | null = null

  private readonly state = new Float32Array(COUNT * STATE)
  // je Partikel die Stützpunkte der Spur (Mercator), neuester zuerst
  private readonly trail = new Float32Array(COUNT * TRAIL * 3)
  private readonly filled = new Uint8Array(COUNT)
  private readonly instances = new Float32Array(COUNT * (TRAIL - 1) * FLOATS)
  private readonly where = new maplibregl.LngLat(0, 0)

  /** Neues Windfeld (oder null = aus). Die Partikel bleiben, wo sie sind. */
  setSampler(sampler: Wind3dSampler | null): void {
    this.sampler = sampler
    this.updateSpawnGrid()
    this.map?.triggerRepaint()
  }

  /**
   * Neue Spuren entstehen gleichmäßig über den BILDSCHIRM statt über `getBounds()`: das
   * reicht bei gekippter Karte bis zum Horizont, und ein Tal im Vordergrund bekäme fast
   * nichts ab. Nur nach einer Bewegung gerechnet, `unproject` liest mit Relief den Puffer aus.
   */
  private updateSpawnGrid(): void {
    const map = this.map
    if (!map) return
    const { clientWidth: w, clientHeight: h } = map.getContainer()
    const grid = new Float64Array((SPAWN_CELLS_X + 1) * (SPAWN_CELLS_Y + 1) * 2)
    let o = 0
    for (let j = 0; j <= SPAWN_CELLS_Y; j++) {
      for (let i = 0; i <= SPAWN_CELLS_X; i++) {
        const ll = map.unproject([(i / SPAWN_CELLS_X) * w, (j / SPAWN_CELLS_Y) * h])
        grid[o++] = ll.lng
        grid[o++] = ll.lat
      }
    }
    this.spawnGrid = grid
  }

  /** Nach einer Bewegung: was nicht mehr im Bild ist, wird neu angelegt, sonst bleibt es dort leer */
  private readonly onMoveEnd = (): void => {
    const map = this.map
    if (!map) return
    this.updateSpawnGrid()
    const { clientWidth: w, clientHeight: h } = map.getContainer()
    for (let p = 0; p < COUNT; p++) {
      const o = p * STATE
      if (this.state[o + 3] < 0) continue
      const q = map.project([this.state[o], this.state[o + 1]])
      if (q.x < 0 || q.y < 0 || q.x > w || q.y > h) this.state[o + 3] = -1
    }
    map.triggerRepaint()
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map
    map.on('moveend', this.onMoveEnd)
    const g = gl as WebGL2RenderingContext
    const program = g.createProgram()
    if (!program) throw new Error('Programm nicht anlegbar')
    g.attachShader(program, compile(g, g.VERTEX_SHADER, VERT))
    g.attachShader(program, compile(g, g.FRAGMENT_SHADER, FRAG))
    g.linkProgram(program)
    this.program = program
    this.uMatrix = g.getUniformLocation(program, 'u_matrix')
    this.uSize = g.getUniformLocation(program, 'u_size')
    this.buffer = g.createBuffer()
    this.vao = g.createVertexArray()
    g.bindVertexArray(this.vao)
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer)
    g.bufferData(g.ARRAY_BUFFER, this.instances.byteLength, g.DYNAMIC_DRAW)
    const stride = FLOATS * 4
    const attr = (name: string, size: number, offset: number) => {
      const loc = g.getAttribLocation(program, name)
      g.enableVertexAttribArray(loc)
      g.vertexAttribPointer(loc, size, g.FLOAT, false, stride, offset)
      g.vertexAttribDivisor(loc, 1)
    }
    attr('a_from', 3, 0)
    attr('a_to', 3, 12)
    attr('a_rgb', 3, 24)
    attr('a_alpha', 2, 36)
    attr('a_width', 1, 44)
    g.bindVertexArray(null)
    for (let p = 0; p < COUNT; p++) this.state[p * STATE + 3] = -1
  }

  onRemove(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const g = gl as WebGL2RenderingContext
    if (this.program) g.deleteProgram(this.program)
    if (this.buffer) g.deleteBuffer(this.buffer)
    if (this.vao) g.deleteVertexArray(this.vao)
    window.clearTimeout(this.timer)
    map.off('moveend', this.onMoveEnd)
    this.map = null
  }

  private groundAt(lon: number, lat: number, zoom: number): number {
    const terrain = this.map!.terrain
    if (!terrain) return 0
    this.where.lng = lon
    this.where.lat = lat
    return terrain.getElevationForLngLatZoom(this.where, zoom)
  }

  /** Zeichenhöhe (m, überhöht): nah am Boden über dem echten Relief, weiter oben die Modellhöhe */
  private drawHeight(s: Wind3dSample, ground: number): number {
    const gap = ground - (s.z - s.agl) * RELIEF_EXAGGERATION
    return Math.max(ground + GROUND_LIFT_M, s.z * RELIEF_EXAGGERATION + gap * Math.exp(-s.agl / RELIEF_BLEND_M))
  }

  private spawn(p: number, sampler: Wind3dSampler, zoom: number, fresh: boolean): boolean {
    const map = this.map!
    const b = map.getBounds()
    const grid = this.spawnGrid
    for (let t = 0; t < SPAWN_TRIES; t++) {
      let lon = b.getWest() + Math.random() * (b.getEast() - b.getWest())
      let lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth())
      if (grid) {
        const fx = Math.random() * SPAWN_CELLS_X
        const fy = Math.random() * SPAWN_CELLS_Y
        const i = Math.floor(fx)
        const j = Math.floor(fy)
        const tx = fx - i
        const ty = fy - j
        const c00 = (j * (SPAWN_CELLS_X + 1) + i) * 2
        const c10 = c00 + 2
        const c01 = c00 + (SPAWN_CELLS_X + 1) * 2
        const c11 = c01 + 2
        const mix = (k: number) =>
          (1 - ty) * ((1 - tx) * grid[c00 + k] + tx * grid[c10 + k]) + ty * ((1 - tx) * grid[c01 + k] + tx * grid[c11 + k])
        lon = mix(0)
        lat = mix(1)
      }
      // Unterste Fläche = Gelände des Modells; zum Boden hin dichter, dort spielt die Musik
      const floor = sampler(lon, lat, -Infinity)
      if (!floor) continue
      const r = Math.random()
      const z = floor.z - floor.agl + TOP_AGL_M * r * r
      if (!sampler(lon, lat, z)) continue
      const ground = this.groundAt(lon, lat, zoom)
      const o = p * STATE
      const life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)
      this.state[o] = lon
      this.state[o + 1] = lat
      // Beim Massenstart verteilt, sonst stürben alle zugleich
      this.state[o + 2] = fresh ? Math.random() * life * 0.7 : 0
      this.state[o + 3] = life
      this.state[o + 4] = z
      this.state[o + 5] = ground
      this.state[o + 6] = ground
      this.filled[p] = 0
      return true
    }
    return false
  }

  /** Bewegt alle Partikel und füllt die Instanzen; gibt ihre Zahl zurück. */
  private step(dt: number, sampler: Wind3dSampler): number {
    const map = this.map!
    const center = map.getCenter()
    const mapZoom = map.getZoom()
    const zoom = Math.min(TOPO_MAX_ZOOM, Math.floor(mapZoom))
    const mPerPx = (EARTH_M * Math.cos((center.lat * Math.PI) / 180)) / (512 * 2 ** mapZoom)
    // Gerechnete Sekunden Luftbewegung je Sekunde, bei einem Bezugstempo von 1 m/s
    const baseScale = pxPerSecondAt10(mapZoom) * mPerPx
    this.trailClock += dt
    const shift = this.trailClock >= TRAIL_DT
    if (shift) this.trailClock %= TRAIL_DT
    this.frame++
    const trailSpan = (TRAIL - 1) * TRAIL_DT
    const alphaAt = (k: number) => Math.max(0, 1 - (k === 0 ? 0 : (k - 1) * TRAIL_DT + this.trailClock) / trailSpan)
    let v = 0
    for (let p = 0; p < COUNT; p++) {
      const o = p * STATE
      const life = this.state[o + 3]
      this.state[o + 2] += dt
      let wind = life >= 0 && this.state[o + 2] < life ? sampler(this.state[o], this.state[o + 1], this.state[o + 4]) : null
      if (wind && wind.agl > TOP_AGL_M + TOP_MARGIN_M) wind = null
      if (!wind) {
        if (!this.spawn(p, sampler, zoom, life < 0)) continue
        wind = sampler(this.state[o], this.state[o + 1], this.state[o + 4])
        if (!wind) continue
      }
      if ((p + this.frame) % TERRAIN_EVERY === 0) this.state[o + 5] = this.groundAt(this.state[o], this.state[o + 1], zoom)
      const { u: uw, v: vw, w: ww } = wind
      const lat = this.state[o + 1]
      const scale = baseScale / (REF_SPEED_GROUND + Math.max(0, wind.agl) * REF_SPEED_PER_M)
      this.state[o] += (uw * scale * dt) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
      this.state[o + 1] += (vw * scale * dt) / M_PER_DEG
      // `wind.z`, nicht die alte Höhe: unter der untersten Fläche gleitet das Partikel am Gelände
      this.state[o + 4] = wind.z + ww * scale * dt
      // Weich der Geländehöhe nach: sie wird nur reihum gelesen
      this.state[o + 6] += (this.state[o + 5] - this.state[o + 6]) * TERRAIN_FOLLOW

      const x = mercX(this.state[o])
      const y = mercY(this.state[o + 1])
      const z = mercZ(this.drawHeight(wind, this.state[o + 6]), this.state[o + 1])
      const t = p * TRAIL * 3
      if (!this.filled[p]) {
        for (let i = 0; i < TRAIL; i++) {
          this.trail[t + i * 3] = x
          this.trail[t + i * 3 + 1] = y
          this.trail[t + i * 3 + 2] = z
        }
        this.filled[p] = 1
      } else if (shift) {
        this.trail.copyWithin(t + 3, t, t + (TRAIL - 1) * 3)
      }
      this.trail[t] = x
      this.trail[t + 1] = y
      this.trail[t + 2] = z

      const age = this.state[o + 2]
      const fade = Math.max(0, Math.min(1, age / FADE_S, (this.state[o + 3] - age) / FADE_S))
      const kmh = Math.hypot(uw, vw) * 3.6
      const [r, g, b] = speedColor(kmh)
      const width = WIDTH_MIN + WIDTH_ADD * Math.min(1, kmh / WIDTH_FULL_KMH)
      const inst = this.instances
      for (let i = 0; i < TRAIL - 1; i++) {
        const j = t + i * 3
        inst[v] = this.trail[j]
        inst[v + 1] = this.trail[j + 1]
        inst[v + 2] = this.trail[j + 2]
        inst[v + 3] = this.trail[j + 3]
        inst[v + 4] = this.trail[j + 4]
        inst[v + 5] = this.trail[j + 5]
        inst[v + 6] = r
        inst[v + 7] = g
        inst[v + 8] = b
        inst[v + 9] = fade * alphaAt(i)
        inst[v + 10] = fade * alphaAt(i + 1)
        inst[v + 11] = width
        v += FLOATS
      }
    }
    return v / FLOATS
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput): void {
    const map = this.map
    const { sampler } = this
    if (!map || !sampler || !this.program) return
    const now = performance.now()
    const dt = this.last ? Math.min(MAX_DT, (now - this.last) / 1000) : 0.016
    this.last = now
    const count = this.step(dt, sampler)
    const g = gl as WebGL2RenderingContext
    g.useProgram(this.program)
    // Die Positionen sind Mercator-Koordinaten 0..1, dafür gilt `mainMatrix`
    g.uniformMatrix4fv(this.uMatrix, false, new Float32Array(args.defaultProjectionData.mainMatrix))
    g.uniform2f(this.uSize, g.drawingBufferWidth, g.drawingBufferHeight)
    g.bindVertexArray(this.vao)
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer)
    g.bufferSubData(g.ARRAY_BUFFER, 0, this.instances.subarray(0, count * FLOATS))
    g.enable(g.BLEND)
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
    g.enable(g.DEPTH_TEST)
    g.depthFunc(g.LEQUAL)
    g.depthMask(false)
    g.disable(g.CULL_FACE)
    g.drawArraysInstanced(g.TRIANGLES, 0, 6, count)
    g.bindVertexArray(null)
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => map.triggerRepaint(), FRAME_MS)
  }
}
