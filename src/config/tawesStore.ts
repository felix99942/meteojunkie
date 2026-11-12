// Rollender Speicher der TAWES-10-Minuten-Werte in R2: der Worker schreibt ihn alle 10 Minuten,
// der Browser liest ihn für den Bereich TAWES und für den Zeitschieber der Klimakarte. Direkt bei
// GeoSphere dauert derselbe Abruf 6 bis 8 s je Größe (gemessen 2026-11-09).
//
// EINE DATEI JE GRÖSSE (`tawes/10min/<code>.bin`, seit 2026-11-12): mit allen 23 Größen in einer
// Datei wären es ~3 MB bei jedem Öffnen, gebraucht wird meist eine. Alle Dateien eines Laufs
// haben dieselbe Zeitachse; der Browser legt sie über `mergeTawesStores` zusammen.
//
// 120 Stunden: der Schieber reicht 72 h zurück, und die 48-h-Niederschlagssumme braucht an seinem
// ältesten Termin noch ihr Fenster. Dateiform (gzip): 4 Byte Kopflänge, JSON-Kopf, Int16-Werte je
// Größe. Keine Abhängigkeit vom Browser oder vom Worker: beide lesen über diese Datei.

export const TAWES_STORE_DIR = 'tawes/10min/'
export const tawesStoreKey = (code: TawesCode) => `${TAWES_STORE_DIR}${code}.bin`
export const TAWES_STEP_MS = 600_000
export const TAWES_STORE_HOURS = 120
export const TAWES_SLIDER_HOURS = 72
/** Termine je Station, ältester zuerst */
export const TAWES_NT = TAWES_STORE_HOURS * 6 + 1

/**
 * Alle Messgrößen von klima-v2-10min (live geprüft 2026-11-12) und ihr Speicherfaktor. Int16:
 * Temperaturen und Druck in Zehnteln (Druck bis 3276 hPa), Wind in 0,1 m/s, Niederschlag in
 * 0,1 mm, der Rest ganzzahlig. Nicht dabei: `zeitx` (Uhrzeit der Spitzenböe — als Karte ohne
 * Aussage, die Böe selbst steht in `ffx`).
 */
export const TAWES_CODES = {
  tl: 10,
  tlmax: 10,
  tlmin: 10,
  ts: 10,
  tsmax: 10,
  tsmin: 10,
  tb10: 10,
  tb20: 10,
  tb50: 10,
  rf: 1,
  ff: 10,
  ffam: 10,
  ffx: 10,
  dd: 1,
  ddx: 1,
  p: 10,
  pred: 10,
  rr: 10,
  rrm: 1,
  so: 1,
  cglo: 1,
  chim: 1,
  sh: 1,
} as const
export type TawesCode = keyof typeof TAWES_CODES
export const ALL_TAWES_CODES = Object.keys(TAWES_CODES) as TawesCode[]

const NO_VALUE = -32768

export interface TawesStore {
  /** Zeit des letzten Termins (Index `TAWES_NT - 1`), ms */
  endMs: number
  ids: number[]
  /** je Größe `ids.length × TAWES_NT`, Station für Station; nur die geladenen Größen */
  values: Partial<Record<TawesCode, Int16Array>>
}

export const tawesStepMs = (store: TawesStore, step: number): number =>
  store.endMs - (TAWES_NT - 1 - step) * TAWES_STEP_MS

/** Index des Termins `ms` (gerundet), kann außerhalb 0 … NT−1 liegen */
export const tawesStepOf = (store: TawesStore, ms: number): number =>
  TAWES_NT - 1 - Math.round((store.endMs - ms) / TAWES_STEP_MS)

/** Werte von `from` in `to` übernehmen, verschoben auf die Zeitachse von `to` */
function copyInto(to: TawesStore, from: TawesStore): void {
  const shift = Math.round((to.endMs - from.endMs) / TAWES_STEP_MS)
  const fromIndex = new Map(from.ids.map((id, i) => [id, i]))
  for (const code of Object.keys(from.values) as TawesCode[]) {
    const src = from.values[code]!
    const dst = (to.values[code] ??= new Int16Array(to.ids.length * TAWES_NT).fill(NO_VALUE))
    to.ids.forEach((id, s) => {
      const o = fromIndex.get(id)
      if (o == null) return
      for (let t = 0; t < TAWES_NT; t++) {
        const f = t + shift
        if (f >= 0 && f < TAWES_NT) dst[s * TAWES_NT + t] = src[o * TAWES_NT + f]
      }
    })
  }
}

/** Neuer Speicher mit Ende `endMs`; was `old` im Überlappungsbereich hat, wird übernommen. */
export function newTawesStore(
  endMs: number,
  ids: number[],
  old?: TawesStore | null,
  codes: TawesCode[] = ALL_TAWES_CODES,
): TawesStore {
  const values: Partial<Record<TawesCode, Int16Array>> = {}
  for (const code of codes) values[code] = new Int16Array(ids.length * TAWES_NT).fill(NO_VALUE)
  const store = { endMs, ids, values }
  if (old) copyInto(store, old)
  return store
}

/**
 * Mehrere Einzeldateien zu einem Speicher: Zeitachse und Stationen der jüngsten. Eine Datei aus
 * einem älteren Lauf (ein Upload ist gescheitert) wird auf die Zeitachse verschoben, nicht
 * verworfen — es fehlen dann nur ihre jüngsten Termine.
 */
export function mergeTawesStores(stores: TawesStore[]): TawesStore | null {
  if (stores.length === 0) return null
  const newest = stores.reduce((a, b) => (b.endMs > a.endMs ? b : a))
  const out: TawesStore = { endMs: newest.endMs, ids: newest.ids, values: {} }
  for (const s of stores) {
    if (s.endMs === out.endMs && s.ids === out.ids) Object.assign(out.values, s.values)
    else copyInto(out, s)
  }
  return out
}

/**
 * Trägt eine Antwort von GeoSphere ein. Null überschreibt nichts: ein schon vorhandener Wert
 * bleibt, verspätet gemeldete Termine füllen die Lücke beim nächsten Lauf. Gibt die Zahl der
 * eingetragenen Werte zurück.
 */
export function applyTawesSeries(
  store: TawesStore,
  code: TawesCode,
  timestamps: string[],
  byStation: Record<number, (number | null)[] | undefined>,
): number {
  const factor = TAWES_CODES[code]
  const dst = (store.values[code] ??= new Int16Array(store.ids.length * TAWES_NT).fill(NO_VALUE))
  const steps = timestamps.map((t) => TAWES_NT - 1 - (store.endMs - Date.parse(t)) / TAWES_STEP_MS)
  let written = 0
  store.ids.forEach((id, s) => {
    const data = byStation[id]
    if (!data) return
    steps.forEach((step, i) => {
      const v = data[i]
      if (v == null || !Number.isFinite(v) || !Number.isInteger(step) || step < 0 || step >= TAWES_NT) return
      dst[s * TAWES_NT + step] = Math.max(-32767, Math.min(32767, Math.round(v * factor)))
      written++
    })
  })
  return written
}

/** Reihen einer Größe in ihrer Einheit, je Station; leer, wenn die Größe nicht geladen ist */
export function tawesSeries(store: TawesStore, code: TawesCode): Map<number, (number | null)[]> {
  const factor = TAWES_CODES[code]
  const src = store.values[code]
  const out = new Map<number, (number | null)[]>()
  if (!src) return out
  store.ids.forEach((id, s) => {
    const series = new Array<number | null>(TAWES_NT)
    for (let t = 0; t < TAWES_NT; t++) {
      const v = src[s * TAWES_NT + t]
      series[t] = v === NO_VALUE ? null : v / factor
    }
    out.set(id, series)
  })
  return out
}

async function through(bytes: BlobPart, stream: GenericTransformStream): Promise<ArrayBuffer> {
  return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
}

/** Packt die genannten Größen (Vorgabe: alle geladenen) in eine Datei */
export async function packTawesStore(store: TawesStore, codes?: TawesCode[]): Promise<ArrayBuffer> {
  const list = (codes ?? (Object.keys(store.values) as TawesCode[])).filter((c) => store.values[c])
  const header = new TextEncoder().encode(JSON.stringify({ endMs: store.endMs, ids: store.ids, nt: TAWES_NT, codes: list }))
  const n = store.ids.length * TAWES_NT
  // Kopf auf gerade Länge auffüllen, die Int16-Werte beginnen dann auf einer geraden Stelle
  const headLen = header.length + (header.length % 2)
  const out = new Uint8Array(4 + headLen + list.length * n * 2)
  new DataView(out.buffer).setUint32(0, headLen, true)
  out.fill(0x20, 4, 4 + headLen)
  out.set(header, 4)
  list.forEach((code, c) => {
    const v = store.values[code]!
    out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), 4 + headLen + c * n * 2)
  })
  return through(out, new CompressionStream('gzip'))
}

/** null, wenn die Datei nicht zu dieser Fassung passt (etwa die HTML-Seite des Dev-Servers) */
export async function unpackTawesStore(gz: ArrayBuffer): Promise<TawesStore | null> {
  try {
    const raw = await through(gz, new DecompressionStream('gzip'))
    const headLen = new DataView(raw).getUint32(0, true)
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 4, headLen))) as {
      endMs: number
      ids: number[]
      nt: number
      codes: string[]
    }
    if (head.nt !== TAWES_NT) return null
    const n = head.ids.length * TAWES_NT
    if (raw.byteLength !== 4 + headLen + head.codes.length * n * 2) return null
    const values: Partial<Record<TawesCode, Int16Array>> = {}
    head.codes.forEach((code, c) => {
      if (code in TAWES_CODES) values[code as TawesCode] = new Int16Array(raw.slice(4 + headLen + c * n * 2, 4 + headLen + (c + 1) * n * 2))
    })
    return { endMs: head.endMs, ids: head.ids, values }
  } catch {
    return null
  }
}
