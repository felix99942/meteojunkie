// OPERA — das europäische Radarkomposit von EUMETNET, für die Fläche, die der
// DWD nicht abdeckt: ÖSTERREICH (das DWD-Komposit endet bei 13–14 °O, Linz,
// Wien, Graz und Klagenfurt liegen draußen). Läuft im 5-Minuten-Cron wie
// DMax/VIL und legt dieselbe Art Bild + Index in R2 (`radar/opera/`).
//
// Quelle, gemessen 2026-11-24 (Details in docs/radar.md):
// - Katalog über MeteoGate (`api.meteogate.eu/eu-eumetnet-weather-radar`,
//   Plattform `0-20010-0-OPERA`, Parameter `DBZH:comp`), die Dateien liegen
//   im Objektspeicher bei ECMWF unter einem BILDBAREN Namen — der Katalog
//   wird deshalb gar nicht gefragt (er hat ein Limit von 200 Abrufen je
//   Stunde ohne Schlüssel). Der früher gemessene Host bei CloudFerro
//   antwortet inzwischen mit 404.
// - ODIM-HDF5, `MAX`-Komposit der Reflektivität, 3800×4400 Punkte à 1 km in
//   LAEA (lat_0 55, lon_0 10), **float64** in dBZ (gain 1, offset 0),
//   deflate in Blöcken von 760×880. Eine Datei ~2,6 MB, roh wären es 134 MB
//   — mehr als ein Worker belegen darf. Entpackt werden deshalb nur die
//   Blöcke, die den Ausschnitt schneiden, und daraus nur der Ausschnitt.
// - Name = ENDE eines 10-Minuten-Fensters (`starttime` 12:35:01, `endtime`
//   12:45:00 für die Datei 12:45), Takt 5 Minuten, ~4 Minuten Verzug.
// - KEIN österreichisches Radar ist dabei; Österreich decken die Nachbarn ab
//   (`OPERA_AT_RADARS`). Ein Termin ohne genug davon wird übersprungen.

import * as hdf5 from 'jsfive'
import {
  OPERA_AREA,
  OPERA_AT_RADARS,
  OPERA_ID,
  OPERA_MIN_AT_RADARS,
  WN_LEGEND,
  ownRadarImageKey,
  radarStamp,
  type OwnRadarIndex,
} from '../src/config/radar'
import type { GeoBox } from '../src/config/wmsTime'
import { encodeIndexedPng, readChunkBTree, stampTime, type IndexedImage } from './radar'
import { listKeys, type R2BucketLike } from './r2'

const OPERA_BASE = 'https://object-store.os-api.cci1.ecmwf.int/openradar-24h-backup'
const STEP_MS = 5 * 60_000
/** Der Speicher hält 24 h vor; nachgeholt werden 3 h wie bei DMax/VIL. */
const BACKFILL_MS = 3 * 3_600_000
const INDEX_MS = 6 * 3_600_000
/** Ein Termin kostet ~2,6 MB Abruf; nach einem Ausfall nicht alles auf einmal. */
const MAX_PER_RUN = 4
/**
 * Unvollständige Termine werden NICHT nachgeliefert (gemessen: 12:50 blieb
 * bei 102, 12:55 bei 23 Radaren) — nach dieser Zeit nicht mehr nachfragen,
 * sonst holte jeder Lauf dieselben Dateien bis zum Ende des Nachholfensters.
 */
const RETRY_MS = 20 * 60_000
/** Bildbreite: ~0,7 km je Pixel bei 47 °N, also feiner als das 1-km-Gitter. */
export const OPERA_IMAGE_WIDTH = 1200

export function operaUrl(time: number): string {
  const s = radarStamp(time) // 20261124T1245Z
  return `${OPERA_BASE}/${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}/OPERA/COMP/OPERA@${s.slice(0, 13)}@0@DBZH.h5`
}

export async function updateOpera(bucket: R2BucketLike, now = Date.now()): Promise<string> {
  const prefix = `radar/${OPERA_ID}/`
  const have = new Map<number, string>()
  for (const key of await listKeys(bucket, prefix)) {
    const t = stampTime(key)
    if (t !== null) have.set(t, key)
  }
  const last = Math.floor(now / STEP_MS) * STEP_MS
  const wanted: number[] = []
  for (let t = last; t > now - BACKFILL_MS; t -= STEP_MS) if (!have.has(t)) wanted.push(t)

  // Termine, die schon einmal unvollständig waren und älter als RETRY_MS
  // sind, stehen im Index und werden nicht mehr geholt
  const prev = await readIndex(bucket, `${prefix}index.json`)
  const skip = new Set((prev?.incomplete ?? []).filter((t) => t > now - BACKFILL_MS))

  const persistKey = `${prefix}${PERSIST_FILE}`
  const persist = await readPersistence(bucket, persistKey)
  let persistDirty = false
  let persistState: Uint8Array | null = persist
  let filtered = 0

  let added = 0
  let fetched = 0
  const incomplete: number[] = [...skip]
  const notes: string[] = []
  for (const time of wanted) {
    if (fetched >= MAX_PER_RUN * 2 || added >= MAX_PER_RUN) break
    if (skip.has(time)) continue
    const res = await fetch(operaUrl(time))
    if (res.status === 404 || res.status === 403) continue // noch nicht da
    if (!res.ok) throw new Error(`OPERA HTTP ${res.status}`)
    fetched++
    const field = await decodeOpera(await res.arrayBuffer(), OPERA_AREA)
    if (field.atRadars < OPERA_MIN_AT_RADARS) {
      notes.push(`${radarStamp(time)} unvollständig (${field.atRadars}/${OPERA_AT_RADARS.length})`)
      if (time < now - RETRY_MS) incomplete.push(time)
      continue
    }
    const state = persistState && persistState.length === field.width * field.height ? persistState : new Uint8Array(field.width * field.height)
    updatePersistence(state, field)
    filtered += filterEchoes(field, state)
    persistState = state
    persistDirty = true
    const img = renderOpera(field, OPERA_IMAGE_WIDTH)
    await bucket.put(ownRadarImageKey(OPERA_ID, time), await encodeIndexedPng(img), {
      httpMetadata: { contentType: 'image/png' },
    })
    have.set(time, ownRadarImageKey(OPERA_ID, time))
    added++
  }
  if (persistDirty && persistState) await bucket.put(persistKey, persistState)
  if (filtered) notes.push(`${filtered} Störpunkte entfernt`)
  const incompleteChanged = incomplete.length !== (prev?.incomplete ?? []).length
  if (added === 0 && !incompleteChanged) return `OPERA: nichts Neues${notes.length ? ` · ${notes.join(', ')}` : ''}`

  const index: OperaIndex = {
    stepMs: STEP_MS,
    times: [...have.keys()].filter((t) => t > now - INDEX_MS).sort((a, b) => a - b),
    geo: OPERA_AREA,
    incomplete: [...new Set(incomplete)].sort((a, b) => a - b),
  }
  await bucket.put(`${prefix}index.json`, JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  })
  const old = [...have.entries()].filter(([t]) => t <= now - INDEX_MS).map(([, k]) => k)
  if (old.length) await bucket.delete(old.slice(0, 1000))
  return `OPERA: ${added} neu, ${index.times.length} im Index${notes.length ? ` · ${notes.join(', ')}` : ''}`
}

/** Der Index trägt zusätzlich die aufgegebenen Termine (das Frontend liest ihn als `OwnRadarIndex`). */
interface OperaIndex extends OwnRadarIndex {
  incomplete: number[]
}

async function readIndex(bucket: R2BucketLike, key: string): Promise<OperaIndex | null> {
  const obj = await bucket.get(key)
  if (!obj || !('text' in obj)) return null
  try {
    return JSON.parse(await obj.text()) as OperaIndex
  } catch {
    return null
  }
}

// --- HDF5 ----------------------------------------------------------------------

/** Ausschnitt des Komposits als Palettenindex je Gitterpunkt (0 = kein Echo, 1 = keine Daten). */
export interface OperaField {
  /** Gitterfenster: Spalten c0…c0+width, Zeilen r0…r0+height (Zeile 0 = Norden). */
  c0: number
  r0: number
  width: number
  height: number
  classes: Uint8Array
  /** Wie viele der `OPERA_AT_RADARS` im Komposit stecken. */
  atRadars: number
  nodes: number
}

interface JsfiveDataObjects {
  dtype: unknown
  filter_pipeline: Map<string, unknown>[] | null
  _get_chunk_params(): void
  _chunk_address: number | bigint
  chunks: number[]
}

const XSIZE = 3800
const YSIZE = 4400
const CELL = 1000

export async function decodeOpera(buf: ArrayBuffer, area: GeoBox): Promise<OperaField> {
  const f = new hdf5.File(buf, 'opera.h5')
  const attrs = (path: string) => (f.get(path) as unknown as { attrs: Record<string, unknown> }).attrs
  const where = attrs('where')
  const what = attrs('dataset1/data1/what')
  const nodes = String(attrs('how').nodes ?? '')
    .replaceAll('\u0000', '')
    .replace(/[' ]/g, '')
    .split(',')
    .filter(Boolean)
  // Das Gitter muss das gemessene sein — sonst stimmt `laea` nicht
  if (where.xsize !== XSIZE || where.ysize !== YSIZE || where.xscale !== CELL || !String(where.projdef).includes('+proj=laea +lat_0=55.0 +lon_0=10.0'))
    throw new Error(`OPERA-Gitter unerwartet: ${String(where.projdef)} ${String(where.xsize)}×${String(where.ysize)}`)
  if (what.gain !== 1 || what.offset !== 0) throw new Error(`OPERA gain/offset ${String(what.gain)}/${String(what.offset)}`)
  const nodata = what.nodata as number
  const undetect = what.undetect as number

  const ds = f.get('dataset1/data1/data') as unknown as { shape: number[]; _dataobjects: JsfiveDataObjects }
  const o = ds._dataobjects
  if (o.dtype !== '<f8') throw new Error(`Datentyp ${String(o.dtype)} statt <f8`)
  const filters = (o.filter_pipeline ?? []).map((m) => Number(m.get('filter_id')))
  if (filters.some((id) => id !== 1)) throw new Error(`Filter ${filters.join(',')} — erwartet nur deflate (1)`)
  o._get_chunk_params()
  const [ch, cw] = o.chunks

  // Gitterfenster um den Ausschnitt: Ecken und Kantenmitten projizieren
  // (die LAEA-Ränder sind gekrümmt, die Mitten reichen bei 5° Höhe)
  const pts: [number, number][] = []
  for (const lon of [area.west, (area.west + area.east) / 2, area.east])
    for (const lat of [area.south, (area.south + area.north) / 2, area.north]) pts.push(laeaGrid(lon, lat))
  const c0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))) - 2)
  const c1 = Math.min(XSIZE, Math.ceil(Math.max(...pts.map((p) => p[0]))) + 2)
  const r0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))) - 2)
  const r1 = Math.min(YSIZE, Math.ceil(Math.max(...pts.map((p) => p[1]))) + 2)
  const width = c1 - c0
  const height = r1 - r0
  const classes = new Uint8Array(width * height).fill(1)

  const thresholds = WN_LEGEND.map((s) => Number(s.label.replace(',', '.')))
  const classify = (x: number): number => {
    if (x === nodata || Number.isNaN(x)) return 1
    if (x === undetect) return 0
    let k = -1
    while (k + 1 < thresholds.length && x >= thresholds[k + 1]) k++
    return k < 0 ? 0 : k + 2
  }

  const blocks = readChunkBTree(buf, Number(o._chunk_address), 2)
  const scratch = new DataView(new ArrayBuffer(8))
  for (const b of blocks) {
    const [br, bc] = b.offsets
    if (br >= r1 || br + ch <= r0 || bc >= c1 || bc + cw <= c0) continue
    const reader = new Blob([new Uint8Array(buf, b.address, b.size)]).stream()
      .pipeThrough(new DecompressionStream('deflate'))
      .getReader()
    let row = br
    let col = bc
    let carry = 0 // Bytes eines Werts, der über eine Stromgrenze fällt
    const rowEnd = Math.min(br + ch, r1)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value as Uint8Array
      const dv = new DataView(part.buffer, part.byteOffset, part.byteLength)
      let i = 0
      if (carry) {
        const need = 8 - carry
        for (let k = 0; k < need && k < part.length; k++) scratch.setUint8(carry + k, part[k])
        if (part.length < need) {
          carry += part.length
          continue
        }
        take(scratch.getFloat64(0, true))
        carry = 0
        i = need
      }
      // Zeilen vor dem Fenster werden übersprungen, ohne zu dekodieren
      for (; i + 8 <= part.length; i += 8) {
        if (row >= r0 && col >= c0 && col < c1) take(dv.getFloat64(i, true))
        else advance()
      }
      for (; i < part.length; i++) scratch.setUint8(carry++, part[i])
      if (row >= rowEnd) {
        await reader.cancel()
        break
      }
    }
    function take(v: number) {
      if (row >= r0 && row < r1 && col >= c0 && col < c1) classes[(row - r0) * width + (col - c0)] = classify(v)
      advance()
    }
    function advance() {
      if (++col >= bc + cw) {
        col = bc
        row++
      }
    }
  }
  const atRadars = OPERA_AT_RADARS.filter((n) => nodes.includes(n)).length
  return { c0, r0, width, height, classes, atRadars, nodes: nodes.length }
}

// --- Störechos -------------------------------------------------------------------
//
// Gemessen 2026-11-24 über 35 Termine (10:00–12:45 UTC) im Ausschnitt:
// 1. Flüchtige SPRENKEL aus wenigen Punkten, vor allem über der Slowakei und
//    Ungarn — jeder Termin anders verteilt. → Größenfilter.
// 2. ORTSFESTE kleine Flecken und Striche (östlich von Wien in > 80 % der
//    Termine an derselben Stelle, Windparks/Bodenechos), teils kräftig
//    (37–46 dBZ) und damit über jeder Größen-Ausnahme für starke Kerne.
//    → Ortsfestigkeit, aber NUR für kleine Flecken: echter, stundenlang
//    stehender Niederschlag (Adria, Nordost-Slowakei, und in Österreich
//    jede Staulage) ist ebenso ortsfest — aber großflächig.
// 3. Ein Störkeil (Funk, RLAN) über Franken, groß und ortsfest — bleibt,
//    kein Filter hier unterscheidet ihn von einem stehenden Regenband.
// Der Qualitätsindex der Datei (`quality1`, qi_total) taugt NICHT: er steht
// auch bei echtem Niederschlag meist auf 0.

/** Kleiner als das (Punkte à 1 km²) und nicht kräftig → Sprenkel. */
export const SPECKLE_MAX_KM2 = 16
/** Ab dieser Klasse (37 dBZ) bleibt ein kleiner Fleck — eher junge Zelle als Sprenkel. */
const STRONG_CLASS = WN_LEGEND.findIndex((s) => s.label === '37') + 2
/** Ortsfeste Störechos: Flecken bis zu dieser Größe … */
export const CLUTTER_MAX_KM2 = 60
/** … deren Punkte im Mittel so oft Echo hatten (0–255, ≈ 50 %). */
export const CLUTTER_MIN_PERSIST = 128
/**
 * Gleitender Mittelwert „Echo ja/nein" je Punkt, Gewicht des neuen Termins
 * 1/12 — bei 5-Minuten-Takt rund eine Stunde Gedächtnis. Ein Windpark mit
 * Echo in 80 % der Termine steht nach ~40 min über der Schwelle; ein
 * durchziehender Schauer bleibt darunter.
 */
const PERSIST_WEIGHT = 12
export const PERSIST_FILE = 'persistence.bin'

/** Nimmt den ROHEN Termin (vor dem Filtern) in den gleitenden Mittelwert auf. */
export function updatePersistence(state: Uint8Array, field: OperaField): void {
  const c = field.classes
  for (let i = 0; i < state.length; i++) {
    const target = c[i] >= 2 ? 255 : 0
    state[i] += Math.trunc((target - state[i]) / PERSIST_WEIGHT)
  }
}

/**
 * Entfernt Sprenkel und ortsfeste kleine Störechos (Klasse → 0 = kein Echo),
 * je zusammenhängendem Fleck (8er-Nachbarschaft). Gibt die Zahl der
 * entfernten Punkte zurück.
 */
export function filterEchoes(field: OperaField, persist: Uint8Array | null): number {
  const { width: w, height: h, classes } = field
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const comp: number[] = []
  let removed = 0
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || classes[start] < 2) continue
    comp.length = 0
    let strong = false
    let persistSum = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      comp.push(p)
      if (classes[p] >= STRONG_CLASS) strong = true
      if (persist) persistSum += persist[p]
      const x = p % w
      const y = (p - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (!seen[q] && classes[q] >= 2) {
            seen[q] = 1
            stack.push(q)
          }
        }
      }
    }
    const n = comp.length
    const speckle = n < SPECKLE_MAX_KM2 && !strong
    const clutter = persist !== null && n <= CLUTTER_MAX_KM2 && persistSum / n >= CLUTTER_MIN_PERSIST
    if (speckle || clutter) {
      for (const p of comp) classes[p] = 0
      removed += n
    }
  }
  return removed
}

async function readPersistence(bucket: R2BucketLike, key: string): Promise<Uint8Array | null> {
  const obj = await bucket.get(key)
  if (!obj || !('body' in obj)) return null
  return new Uint8Array(await new Response(obj.body).arrayBuffer())
}

// --- Projektion ------------------------------------------------------------------

// LAEA auf dem WGS84-Ellipsoid (Snyder 1987, „Lambert Azimuthal Equal-Area,
// ellipsoidal", S. 187), wie im `projdef` der Dateien. Gegengeprüft: die
// Ecken UL/LR aus `where` landen auf (0, 0) bzw. (3800, 4400) km — auf
// Bruchteile eines Millimeters.
const A = 6378137
const E2 = 0.0066943799901413165
const E = Math.sqrt(E2)
const qOf = (phi: number) => {
  const s = Math.sin(phi)
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)))
}
const QP = qOf(Math.PI / 2)
const RQ = A * Math.sqrt(QP / 2)
const PHI0 = (55 * Math.PI) / 180
const LAM0 = (10 * Math.PI) / 180
const BETA1 = Math.asin(qOf(PHI0) / QP)
const D = (A * (Math.cos(PHI0) / Math.sqrt(1 - E2 * Math.sin(PHI0) ** 2))) / (RQ * Math.cos(BETA1))
const X0 = 1950000
const Y0 = -2100000

/** lon/lat → Gitterkoordinate (Spalte, Zeile; Zeile 0 = Nordrand), als Gleitkommazahl. */
export function laeaGrid(lonDeg: number, latDeg: number): [number, number] {
  const beta = Math.asin(qOf((latDeg * Math.PI) / 180) / QP)
  const dl = (lonDeg * Math.PI) / 180 - LAM0
  const B = RQ * Math.sqrt(2 / (1 + Math.sin(BETA1) * Math.sin(beta) + Math.cos(BETA1) * Math.cos(beta) * Math.cos(dl)))
  const x = B * D * Math.cos(beta) * Math.sin(dl) + X0
  const y = (B / D) * (Math.cos(BETA1) * Math.sin(beta) - Math.sin(BETA1) * Math.cos(beta) * Math.cos(dl)) + Y0
  return [x / CELL, -y / CELL]
}

// --- Bild ----------------------------------------------------------------------

const hex = (c: string): [number, number, number, number] => [
  parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255,
]

/** Ausschnitt → Mercator-Bild über `OPERA_AREA` (nächster Nachbar, dieselbe Palette wie DMax). */
export function renderOpera(field: OperaField, width: number, geo: GeoBox = OPERA_AREA): IndexedImage {
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const m0 = merc(geo.south)
  const m1 = merc(geo.north)
  const height = Math.round((width * (m1 - m0)) / (((geo.east - geo.west) * Math.PI) / 180))
  const palette: [number, number, number, number][] = [[0, 0, 0, 0], [125, 125, 125, 128], ...WN_LEGEND.map((s) => hex(s.color))]
  const pixels = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) {
    const lat = (Math.atan(Math.sinh(m1 - ((j + 0.5) / height) * (m1 - m0))) * 180) / Math.PI
    for (let i = 0; i < width; i++) {
      const lon = geo.west + ((i + 0.5) / width) * (geo.east - geo.west)
      const [gx, gy] = laeaGrid(lon, lat)
      const x = Math.floor(gx) - field.c0
      const y = Math.floor(gy) - field.r0
      pixels[j * width + i] = x < 0 || y < 0 || x >= field.width || y >= field.height ? 1 : field.classes[y * field.width + x]
    }
  }
  return { width, height, pixels, palette, geo }
}
