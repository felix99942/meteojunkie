// 3D-Radar (Stufe 1): aus den VOLUMENSCANS aller 17 DWD-Radare ein Stapel
// HÖHENSCHICHTEN (CAPPI, Constant Altitude PPI) über Deutschland, alle 5
// Minuten im Cron des Workers. Daraus zeigt der Radarbereich eine wählbare
// Höhe und einen senkrechten QUERSCHNITT entlang einer gezogenen Linie.
//
// Quelle: opendata.dwd.de/weather/radar/sites/sweep_vol_z/<standort>/hdf5/
// filter_polarimetric/ — je Standort und Termin 10 Elevationen (0,5 … 25°)
// als ODIM-HDF5, 360 Strahlen × 250 m bis 180 km (8° bis 124 km, 12/17/25°
// bis 60 km). Kein CORS, deshalb hier und nicht im Browser — dieselbe
// Begründung wie bei DMax/VIL (`radar.ts`).
//
// Geometrie: Strahlausbreitung mit 4/3-Erdradius (Standardatmosphäre). Für
// jeden Kartenpunkt und jede Höhe die zwei Elevationen darüber und darunter
// und LINEAR in der Höhe zwischen ihnen (in dBZ); liegt die Höhe ausserhalb
// der gescannten Hülle, zählt die nächste Elevation nur innerhalb ihrer
// halben Strahlbreite — sonst KEIN Wert. Lücken bleiben Lücken (Kegel über
// dem Radar, unterste Kilometer in der Ferne): auffüllen hiesse erfinden.
// Mehrere Radare über demselben Punkt: das MAXIMUM (übliche Komposit-Regel,
// Abschattung und Dämpfung eines Radars drücken sonst den Wert).
//
// Kodierung je Zelle ein Byte: 0 = abgedeckt, kein Echo; 1…254 =
// (dBZ + 32) · 2 (also −31,5 … 95 dBZ in 0,5-dB-Stufen); 255 = nicht
// abgedeckt. Ein Termin = Schichten × Zeilen × Spalten Byte, gzip.

import * as hdf5 from 'jsfive'
import type { GeoBox } from '../src/config/wmsTime'
import { radarStamp } from '../src/config/radar'
import type { R3dIndex } from '../src/config/radar3d'
import type { R2BucketLike } from './r2'

/** Höhen über NN in m: 1 … 12 km in 500-m-Schritten */
export const R3D_LEVELS_M = Array.from({ length: 23 }, (_, i) => 1000 + i * 500)
/** Kartenfläche: alle Standorte samt 180 km Reichweite */
export const R3D_GEO: GeoBox = { west: 3.4, east: 17.2, south: 45.8, north: 56.0 }
/** ~0,9 km je Pixel bei 51° N — die Strahlen haben 250 m × 1°, in 100 km also 1,7 km quer */
export const R3D_WIDTH = 1000

export const R3D_NODATA = 255
export const R3D_STATIONS = [
  'asb', 'boo', 'drs', 'eis', 'ess', 'fbg', 'fld', 'hnr', 'isn', 'mem', 'neu', 'nhb', 'oft', 'pro', 'ros', 'tur', 'umd',
] as const

const RE = 6371000 * (4 / 3)
const HALF_BEAM = (0.5 * Math.PI) / 180
const RAD = Math.PI / 180

export interface Sweep {
  /** Elevation in Grad */
  elev: number
  nrays: number
  nbins: number
  /** Gate-Länge und Beginn in m */
  rscale: number
  rstart: number
  /** je Strahl × Gate das kodierte Byte (siehe oben) */
  q: Uint8Array
}

export interface RadarVolume {
  lon: number
  lat: number
  /** Antennenhöhe über NN in m */
  height: number
  sweeps: Sweep[]
}

/** Eine Elevation (ODIM-HDF5 des DWD) → `Sweep` plus Standort. */
export function decodeSweep(buf: ArrayBuffer): { sweep: Sweep; lon: number; lat: number; height: number } {
  const f = new hdf5.File(buf, 'sweep.h5')
  const attrs = (p: string) => (f.get(p) as unknown as { attrs: Record<string, number> }).attrs
  const where = attrs('where')
  const dw = attrs('dataset1/where')
  const what = attrs('dataset1/data1/what')
  const ds = f.get('dataset1/data1/data') as unknown as { value: ArrayLike<number>; shape: number[] }
  const [nrays, nbins] = ds.shape
  const raw = ds.value
  const q = new Uint8Array(nrays * nbins)
  const { gain, offset, nodata, undetect } = what
  for (let k = 0; k < q.length; k++) {
    const v = raw[k]
    if (v === nodata) q[k] = R3D_NODATA
    else if (v === undetect) q[k] = 0
    else {
      const c = Math.round((v * gain + offset + 32) * 2)
      q[k] = c < 1 ? 0 : c > 254 ? 254 : c
    }
  }
  return {
    sweep: { elev: dw.elangle, nrays, nbins, rscale: dw.rscale, rstart: (dw.rstart ?? 0) * 1000, q },
    lon: where.lon,
    lat: where.lat,
    height: where.height,
  }
}

export interface R3dGrid {
  width: number
  height: number
  /** Breite je Zeile (Mitte), Nord → Süd */
  lats: Float64Array
  /** Länge je Spalte (Mitte) */
  lons: Float64Array
}

export function r3dGrid(geo = R3D_GEO, width = R3D_WIDTH): R3dGrid {
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const m0 = merc(geo.south)
  const m1 = merc(geo.north)
  const height = Math.round((width * (m1 - m0)) / ((geo.east - geo.west) * RAD))
  const lats = new Float64Array(height)
  for (let j = 0; j < height; j++) lats[j] = Math.atan(Math.sinh(m1 - ((j + 0.5) / height) * (m1 - m0))) / RAD
  const lons = new Float64Array(width)
  for (let i = 0; i < width; i++) lons[i] = geo.west + ((i + 0.5) / width) * (geo.east - geo.west)
  return { width, height, lats, lons }
}

/** Höhe über NN (m) und Schrägentfernung (m) eines Strahls bei Bodenentfernung s */
export function beamAt(s: number, elevDeg: number, h0: number): { h: number; r: number } {
  const th = elevDeg * RAD
  const phi = s / RE
  const c = Math.cos(th + phi)
  return { h: ((RE + h0) * Math.cos(th)) / c - RE, r: ((RE + h0) * Math.sin(phi)) / c }
}

/**
 * Ein Volumen in den Stapel `out` (Schichten × Zeilen × Spalten) einrechnen,
 * als Maximum über die Radare. `out` muss mit `R3D_NODATA` vorbelegt sein.
 */
export function addVolume(out: Uint8Array, grid: R3dGrid, vol: RadarVolume, levels = R3D_LEVELS_M): void {
  const sweeps = [...vol.sweeps].sort((a, b) => a.elev - b.elev)
  const nK = sweeps.length
  const ds = 250 // Raster der Tabellen in Bodenentfernung
  const maxR = Math.max(...sweeps.map((w) => w.rstart + w.nbins * w.rscale))
  const nS = Math.ceil(maxR / ds) + 1
  const nL = levels.length
  // je Schicht und Entfernungsstufe: die beiden Elevationen und ihre Gates
  const kLo = new Int8Array(nL * nS).fill(-1)
  const kHi = new Int8Array(nL * nS).fill(-1)
  const bLo = new Uint16Array(nL * nS)
  const bHi = new Uint16Array(nL * nS)
  const wHi = new Uint8Array(nL * nS)
  const hs = new Float64Array(nK)
  const bins = new Int32Array(nK)
  const halfW = new Float64Array(nK)
  for (let si = 0; si < nS; si++) {
    const s = (si + 0.5) * ds
    for (let k = 0; k < nK; k++) {
      const w = sweeps[k]
      const { h, r } = beamAt(s, w.elev, vol.height)
      hs[k] = h
      const b = Math.floor((r - w.rstart) / w.rscale)
      bins[k] = b >= 0 && b < w.nbins ? b : -1
      halfW[k] = r * Math.tan(HALF_BEAM)
    }
    for (let L = 0; L < nL; L++) {
      const z = levels[L]
      let lo = -1
      let hi = -1
      for (let k = 0; k < nK; k++) {
        if (bins[k] < 0) continue
        if (hs[k] <= z) lo = k
        else if (hi < 0) hi = k
      }
      const t = L * nS + si
      if (lo >= 0 && hi >= 0) {
        kLo[t] = lo
        kHi[t] = hi
        bLo[t] = bins[lo]
        bHi[t] = bins[hi]
        wHi[t] = Math.round((255 * (z - hs[lo])) / (hs[hi] - hs[lo]))
      } else {
        // ausserhalb der Hülle: nur innerhalb der halben Strahlbreite
        const k = lo >= 0 ? lo : hi
        if (k >= 0 && Math.abs(z - hs[k]) <= halfW[k]) {
          kLo[t] = k
          bLo[t] = bins[k]
        }
      }
    }
  }
  const { width, height, lats, lons } = grid
  const N = width * height
  const kLat = 6371000 * RAD
  const dLat = maxR / kLat
  const j0 = Math.max(0, lats.findIndex((la) => la <= vol.lat + dLat))
  const nrays = sweeps.map((w) => w.nrays)
  const nbins = sweeps.map((w) => w.nbins)
  const qs = sweeps.map((w) => w.q)
  for (let j = j0; j < height; j++) {
    const lat = lats[j]
    if (lat < vol.lat - dLat) break
    const dy = (lat - vol.lat) * kLat
    const kLon = kLat * Math.cos(((lat + vol.lat) / 2) * RAD)
    const dLon = maxR / kLon
    for (let i = 0; i < width; i++) {
      const lon = lons[i]
      if (lon < vol.lon - dLon || lon > vol.lon + dLon) continue
      const dx = (lon - vol.lon) * kLon
      const s = Math.hypot(dx, dy)
      if (s >= maxR) continue
      const si = Math.floor(s / ds)
      let az = Math.atan2(dx, dy) / RAD
      if (az < 0) az += 360
      const pix = j * width + i
      for (let L = 0; L < nL; L++) {
        const t = L * nS + si
        const kl = kLo[t]
        if (kl < 0) continue
        const ql = qs[kl][Math.floor((az * nrays[kl]) / 360) * nbins[kl] + bLo[t]]
        const kh = kHi[t]
        let v: number
        if (kh < 0) v = ql
        else {
          const qh = qs[kh][Math.floor((az * nrays[kh]) / 360) * nbins[kh] + bHi[t]]
          if (ql === R3D_NODATA) v = qh
          else if (qh === R3D_NODATA) v = ql
          else v = Math.round(ql + ((qh - ql) * wHi[t]) / 255)
        }
        if (v === R3D_NODATA) continue
        const o = L * N + pix
        const cur = out[o]
        if (cur === R3D_NODATA || v > cur) out[o] = v
      }
    }
  }
}

// --- Cron: Volumen holen, rechnen, ablegen -------------------------------------


const SWEEP_BASE = 'https://opendata.dwd.de/weather/radar/sites/sweep_vol_z/'
/** Kennzahl im Dateinamen je Standort (`…-isn-10873-hd5`) */
const STATION_IDS: Record<(typeof R3D_STATIONS)[number], number> = {
  asb: 10103, boo: 10132, drs: 10488, eis: 10780, ess: 10410, fbg: 10908, fld: 10440, hnr: 10339, isn: 10873,
  mem: 10950, neu: 10557, nhb: 10605, oft: 10629, pro: 10392, ros: 10169, tur: 10832, umd: 10356,
}
/**
 * Beginn der Elevationen 00 … 09 in Sekunden nach dem 5-Minuten-Termin —
 * gemessen 2026-11-02 über zwei Tage Verzeichnis: je Standort fest auf ±1 s.
 * Zwei Scanpläne: Memmingen, Rostock und Ummendorf scannen die oberen
 * Elevationen in anderem Takt. So werden die Namen GEBILDET statt aus der
 * Verzeichnisliste gelesen (die sind je Standort ~1 MB, ungzipped).
 */
const OFFSETS_A = [57, 80, 103, 126, 149, 180, 202, 215, 228, 242]
const OFFSETS_B = [57, 80, 103, 126, 149, 173, 194, 212, 229, 247]
const PLAN_B = new Set(['mem', 'ros', 'umd'])
const TRIES = [0, 1, -1, 2, -2]

const STEP_MS = 5 * 60_000
/** Termine je Lauf — ein Termin ~2,5 s CPU (gemessen lokal, alle 17 Radare) */
const MAX_PER_RUN = 2
/** So weit zurück wird nachgeholt (der DWD hält ~2 Tage vor) */
const BACKFILL_MS = 30 * 60_000
const INDEX_MS = 3 * 3_600_000
const FETCH_CONCURRENCY = 6


export const r3dKey = (time: number) => `radar/r3d/${radarStamp(time)}.bin`
const R3D_INDEX = 'radar/r3d/index.json'

function sweepName(st: string, elev: number, time: number): string {
  const d = new Date(time)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}00`
  return `${st}/hdf5/filter_polarimetric/ras07-vol5minng01_sweeph5onem_dbzh_${p(elev)}-${stamp}-${st}-${STATION_IDS[st as keyof typeof STATION_IDS]}-hd5`
}

async function fetchSweep(st: string, elev: number, term: number): Promise<ArrayBuffer | null> {
  const base = (PLAN_B.has(st) ? OFFSETS_B : OFFSETS_A)[elev]
  for (const d of TRIES) {
    const res = await fetch(SWEEP_BASE + sweepName(st, elev, term + (base + d) * 1000))
    if (res.ok) return res.arrayBuffer()
    if (res.status !== 404) throw new Error(`DWD HTTP ${res.status}`)
  }
  return null
}

async function fetchVolume(st: string, term: number): Promise<RadarVolume | null> {
  const bufs = await Promise.all(Array.from({ length: 10 }, (_, e) => fetchSweep(st, e, term).catch(() => null)))
  const vol: RadarVolume = { lon: 0, lat: 0, height: 0, sweeps: [] }
  for (const b of bufs) {
    if (!b) continue
    const d = decodeSweep(b)
    vol.sweeps.push(d.sweep)
    vol.lon = d.lon
    vol.lat = d.lat
    vol.height = d.height
  }
  // ohne die unteren Elevationen bliebe das Volumen löchrig — dann lieber
  // ohne diesen Standort (seine Fläche zeigt dann „keine Daten")
  return vol.sweeps.length >= 6 ? vol : null
}

/** Ein Termin über alle Standorte → gzip-Stapel; `null`, wenn noch kein Radar da ist. */
export async function buildR3d(term: number): Promise<{ data: Uint8Array; stations: number } | null> {
  const grid = r3dGrid()
  const out = new Uint8Array(grid.width * grid.height * R3D_LEVELS_M.length).fill(R3D_NODATA)
  let stations = 0
  const queue = [...R3D_STATIONS]
  // wenige gleichzeitig: Abrufe laufen parallel, gerechnet wird je Standort
  // sofort und dann verworfen — es liegt nie mehr als eine Handvoll Volumen im Speicher
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      for (let st = queue.shift(); st; st = queue.shift()) {
        const vol = await fetchVolume(st, term)
        if (!vol) continue
        addVolume(out, grid, vol)
        stations++
      }
    }),
  )
  if (stations === 0) return null
  const gz = await new Response(new Blob([out]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  return { data: new Uint8Array(gz), stations }
}

export async function updateRadar3d(bucket: R2BucketLike, now = Date.now()): Promise<string> {
  const obj = await bucket.get(R3D_INDEX)
  const old: R3dIndex | null = obj && 'text' in obj ? JSON.parse(await obj.text()) : null
  const have = new Map<number, number>()
  old?.times.forEach((t, i) => have.set(t, old.stations[i] ?? 0))
  // der jüngste VOLLSTÄNDIGE Termin: die letzte Elevation beginnt 4 min danach
  const last = Math.floor((now - 4.5 * 60_000) / STEP_MS) * STEP_MS
  const wanted: number[] = []
  for (let t = last; t > now - BACKFILL_MS; t -= STEP_MS) if (!have.has(t)) wanted.push(t)
  let added = 0
  const notes: string[] = []
  for (const t of wanted) {
    if (added >= MAX_PER_RUN) break
    const r = await buildR3d(t)
    if (!r) continue
    await bucket.put(r3dKey(t), r.data, { httpMetadata: { contentType: 'application/octet-stream' } })
    have.set(t, r.stations)
    added++
    notes.push(`${radarStamp(t)} ${r.stations} Radare ${(r.data.length / 1e6).toFixed(2)} MB`)
  }
  if (added === 0) return '3D-Radar: nichts Neues'
  const grid = r3dGrid()
  const times = [...have.keys()].filter((t) => t > now - INDEX_MS).sort((a, b) => a - b)
  const index: R3dIndex = {
    stepMs: STEP_MS,
    times,
    stations: times.map((t) => have.get(t) ?? 0),
    geo: R3D_GEO,
    width: grid.width,
    height: grid.height,
    levels: R3D_LEVELS_M,
  }
  await bucket.put(R3D_INDEX, JSON.stringify(index), { httpMetadata: { contentType: 'application/json' } })
  const gone = [...have.keys()].filter((t) => t <= now - INDEX_MS).map(r3dKey)
  if (gone.length) await bucket.delete(gone.slice(0, 1000))
  return `3D-Radar: ${notes.join(' · ')}`
}
