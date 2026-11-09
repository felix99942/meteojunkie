// Rollender Speicher der TAWES-10-Minuten-Werte (R2: `tawes/recent.bin`): der Worker schreibt
// ihn alle 10 Minuten, der Browser liest ihn für den Zeitschieber der Klimakarte. Direkt bei
// GeoSphere dauert derselbe Abruf 6 bis 8 s je Größe (gemessen 2026-11-09).
//
// 96 Stunden, weil der Schieber 72 h zurückreicht und die 24-h-Böe davor noch ihr Fenster braucht.
// Dateiform (gzip): 4 Byte Kopflänge, JSON-Kopf, Int16-Werte je Größe. Keine Abhängigkeit vom
// Browser oder vom Worker: beide lesen über diese Datei.

export const TAWES_STORE_KEY = 'tawes/recent.bin'
export const TAWES_STEP_MS = 600_000
export const TAWES_STORE_HOURS = 96
export const TAWES_SLIDER_HOURS = 72
/** Termine je Station, ältester zuerst */
export const TAWES_NT = TAWES_STORE_HOURS * 6 + 1

/** Größen und ihr Speicherfaktor (0,1 °C, 0,1 m/s, ganze % und Grad) */
export const TAWES_CODES = { tl: 10, rf: 1, ff: 10, ffx: 10, dd: 1 } as const
export type TawesCode = keyof typeof TAWES_CODES
const CODES = Object.keys(TAWES_CODES) as TawesCode[]

const NO_VALUE = -32768

export interface TawesStore {
  /** Zeit des letzten Termins (Index `TAWES_NT - 1`), ms */
  endMs: number
  ids: number[]
  /** je Größe `ids.length × TAWES_NT`, Station für Station */
  values: Record<TawesCode, Int16Array>
}

export const tawesStepMs = (store: TawesStore, step: number): number =>
  store.endMs - (TAWES_NT - 1 - step) * TAWES_STEP_MS

/** Neuer Speicher mit Ende `endMs`; was `old` im Überlappungsbereich hat, wird übernommen. */
export function newTawesStore(endMs: number, ids: number[], old?: TawesStore | null): TawesStore {
  const values = {} as Record<TawesCode, Int16Array>
  for (const code of CODES) values[code] = new Int16Array(ids.length * TAWES_NT).fill(NO_VALUE)
  if (old) {
    const shift = Math.round((endMs - old.endMs) / TAWES_STEP_MS)
    const oldIndex = new Map(old.ids.map((id, i) => [id, i]))
    ids.forEach((id, s) => {
      const o = oldIndex.get(id)
      if (o == null) return
      for (const code of CODES) {
        for (let t = 0; t < TAWES_NT; t++) {
          const from = t + shift
          if (from >= 0 && from < TAWES_NT) values[code][s * TAWES_NT + t] = old.values[code][o * TAWES_NT + from]
        }
      }
    })
  }
  return { endMs, ids, values }
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
  const steps = timestamps.map((t) => TAWES_NT - 1 - (store.endMs - Date.parse(t)) / TAWES_STEP_MS)
  let written = 0
  store.ids.forEach((id, s) => {
    const data = byStation[id]
    if (!data) return
    steps.forEach((step, i) => {
      const v = data[i]
      if (v == null || !Number.isFinite(v) || !Number.isInteger(step) || step < 0 || step >= TAWES_NT) return
      store.values[code][s * TAWES_NT + step] = Math.max(-32767, Math.min(32767, Math.round(v * factor)))
      written++
    })
  })
  return written
}

/** Reihen einer Größe in ihrer Einheit, je Station */
export function tawesSeries(store: TawesStore, code: TawesCode): Map<number, (number | null)[]> {
  const factor = TAWES_CODES[code]
  const out = new Map<number, (number | null)[]>()
  store.ids.forEach((id, s) => {
    const series = new Array<number | null>(TAWES_NT)
    for (let t = 0; t < TAWES_NT; t++) {
      const v = store.values[code][s * TAWES_NT + t]
      series[t] = v === NO_VALUE ? null : v / factor
    }
    out.set(id, series)
  })
  return out
}

async function through(bytes: BlobPart, stream: GenericTransformStream): Promise<ArrayBuffer> {
  return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
}

export async function packTawesStore(store: TawesStore): Promise<ArrayBuffer> {
  const header = new TextEncoder().encode(JSON.stringify({ endMs: store.endMs, ids: store.ids, nt: TAWES_NT, codes: CODES }))
  const n = store.ids.length * TAWES_NT
  // Kopf auf gerade Länge auffüllen, die Int16-Werte beginnen dann auf einer geraden Stelle
  const headLen = header.length + (header.length % 2)
  const out = new Uint8Array(4 + headLen + CODES.length * n * 2)
  new DataView(out.buffer).setUint32(0, headLen, true)
  out.fill(0x20, 4, 4 + headLen)
  out.set(header, 4)
  CODES.forEach((code, c) => {
    const v = store.values[code]
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
      codes: TawesCode[]
    }
    if (head.nt !== TAWES_NT) return null
    const n = head.ids.length * TAWES_NT
    const values = {} as Record<TawesCode, Int16Array>
    head.codes.forEach((code, c) => {
      values[code] = new Int16Array(raw.slice(4 + headLen + c * n * 2, 4 + headLen + (c + 1) * n * 2))
    })
    return CODES.every((c) => values[c]?.length === n) ? { endMs: head.endMs, ids: head.ids, values } : null
  } catch {
    return null
  }
}
