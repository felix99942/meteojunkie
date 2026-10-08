// Worker-Pool der Modellkarten (Hauptthread-Seite von `globeWorker.ts`).
//
// ZUORDNUNG NACH FELD, nicht reihum: jede Anfrage geht an den Worker, der für
// ihre Feld-URL zuständig ist. Ein Feld wird so genau EINMAL dekodiert und
// geglättet, und alle Kacheln dieses Felds treffen den Cache — reihum verteilt
// müsste jeder Worker jedes Feld selbst laden (2 MB, ~50 ms Dekodieren, bei
// Isobaren noch einmal so viel Glätten). Parallel wird es trotzdem: Farbfläche,
// Isobaren und 500 hPa sind drei Felder, und beim Durchblättern liegen
// mehrere Zeitschritte gleichzeitig in Arbeit.

import type { GlobeField, GlobeGrid, GlobeVarId, ContourId } from '../config/globe'

/** Alles, was ein Worker zum Laden eines Felds braucht — er kennt keine Meta. */
export interface FieldSource {
  /** absolute URL; sie trägt den Lauf und ist der Cache-Schlüssel */
  url: string
  grid: GlobeGrid
  lo: number
  step: number
  encoding?: 'rgb3' | 'uv8'
}

export type WorkerRequest =
  | { type: 'field'; id: number; src: FieldSource; reply: boolean }
  | {
      type: 'tile'
      id: number
      src: FieldSource
      varId: GlobeVarId
      z: number
      x: number
      y: number
      contour?: { id: ContourId; interval: number; smooth: number }
    }
  | { type: 'cancel'; id: number }

export type WorkerResponse =
  | { id: number; bitmap: ImageBitmap }
  | { id: number; field: GlobeField }
  | { id: number; ok: true }
  | { id: number; aborted: true }
  | { id: number; error: string }

type Pending = { resolve: (r: WorkerResponse) => void; worker: Worker }

let workers: Worker[] | null = null
const pending = new Map<number, Pending>()
let nextId = 1

/** Kerne minus einer für den Hauptthread, mindestens 2, höchstens 4. */
function poolSize(): number {
  const n = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  return Math.max(2, Math.min(4, n - 1))
}

function pool(): Worker[] {
  if (workers) return workers
  workers = Array.from({ length: poolSize() }, () => {
    const w = new Worker(new URL('./globeWorker.ts', import.meta.url), { type: 'module', name: 'globe' })
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id)
      if (p) {
        pending.delete(ev.data.id)
        p.resolve(ev.data)
      } else if ('bitmap' in ev.data) ev.data.bitmap.close() // längst abbestellt
    }
    w.onerror = (ev) => console.error('[globe worker]', ev.message)
    return w
  })
  return workers
}

/** FNV-1a über die URL → fester Worker je Feld. */
function workerFor(url: string): Worker {
  const ws = pool()
  let h = 2166136261
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619)
  return ws[(h >>> 0) % ws.length]
}

function abortError(): Error {
  // Am Namen erkennt MapLibre einen Abbruch und meldet dann keinen Fehler
  const e = new Error('AbortError')
  e.name = 'AbortError'
  return e
}

function send(req: Exclude<WorkerRequest, { type: 'cancel' }>, signal?: AbortSignal): Promise<WorkerResponse> {
  if (signal?.aborted) return Promise.reject(abortError())
  const worker = workerFor(req.src.url)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (!pending.delete(req.id)) return
      worker.postMessage({ type: 'cancel', id: req.id } satisfies WorkerRequest)
      reject(abortError())
    }
    pending.set(req.id, {
      worker,
      resolve: (r) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(r)
      },
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage(req)
  })
}

/** Kachel rechnen lassen. Abbruch über `signal` bestellt sie auch im Worker ab. */
export async function requestTile(
  src: FieldSource,
  varId: GlobeVarId,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
  contour?: { id: ContourId; interval: number; smooth: number },
): Promise<ImageBitmap> {
  const r = await send({ type: 'tile', id: nextId++, src, varId, z, x, y, contour }, signal)
  if ('bitmap' in r) return r.bitmap
  if ('aborted' in r) throw abortError()
  throw new Error('error' in r ? r.error : 'unerwartete Antwort')
}

/** Feld für den Hauptthread (Werteanzeige, Windpartikel) — eine Kopie, das Original bleibt im Worker. */
export async function requestField(src: FieldSource): Promise<GlobeField> {
  const r = await send({ type: 'field', id: nextId++, src, reply: true })
  if ('field' in r) return r.field
  throw new Error('error' in r ? r.error : 'Feld nicht geladen')
}

/** Feld im zuständigen Worker vorwärmen, ohne es zurückzuholen (Vorladen). */
export async function warmField(src: FieldSource): Promise<void> {
  const r = await send({ type: 'field', id: nextId++, src, reply: false })
  if ('error' in r) throw new Error(r.error)
}
