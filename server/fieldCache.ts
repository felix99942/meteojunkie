// Serverseitiger Feld-Cache (SPEC §5): ein Modelllauf wird EINMAL geholt und
// von allen Clients geteilt — das entkoppelt die Nutzungsfrequenz vom
// API-Verbrauch (der eigentliche Sinn des Proxys). Zwei Ebenen:
//   - Memory-Map (heiß, pro Prozess)
//   - Disk (überlebt Neustart; Key trägt den Lauf-Bucket → neuer Lauf = Miss)
// Plus Dedup: fragen zwei Clients gleichzeitig ein noch fehlendes Feld an,
// läuft nur EIN Upstream-Fetch (inflight-Map).
//
// Der Lauf-Bucket kommt aus derselben latestRun-Logik wie die Panel-Anzeige —
// gezeigter Lauf und gecachte Daten bleiben kohärent.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DOMAIN_PRESETS } from '../src/config/domains'
import { getModel } from '../src/config/models'
import { latestRun } from '../src/config/runs'
import { fetchGridFields, type ServerGridField } from './gridSource'

const CACHE_DIR = join(process.cwd(), 'server', '.cache')

interface DiskEntry {
  runBucket: number
  field: ServerGridField
}

const memory = new Map<string, ServerGridField>()
const inflight = new Map<string, Promise<ServerGridField | undefined>>()

function key(domain: string, model: string, variable: string, runBucket: number): string {
  return `${domain}_${model}_${variable}_${runBucket}`
}

function diskPath(k: string): string {
  return join(CACHE_DIR, `${k.replace(/[^\w.-]/g, '_')}.json`)
}

async function readDisk(k: string, runBucket: number): Promise<ServerGridField | undefined> {
  try {
    const raw = await fs.readFile(diskPath(k), 'utf8')
    const entry = JSON.parse(raw) as DiskEntry
    return entry.runBucket === runBucket ? entry.field : undefined
  } catch {
    return undefined
  }
}

async function writeDisk(
  k: string,
  runBucket: number,
  field: ServerGridField,
  prunePrefix: string,
): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    const entry: DiskEntry = { runBucket, field }
    await fs.writeFile(diskPath(k), JSON.stringify(entry))
    // veraltete Läufe derselben (Domain, Modell, Variable) aufräumen
    const files = await fs.readdir(CACHE_DIR)
    const keep = `${k.replace(/[^\w.-]/g, '_')}.json`
    await Promise.all(
      files
        .filter((f) => f.startsWith(prunePrefix) && f !== keep)
        .map((f) => fs.rm(join(CACHE_DIR, f)).catch(() => {})),
    )
  } catch {
    // best effort
  }
}

export interface GridResponse {
  fields: Record<string, ServerGridField>
  /** Gewichtete Locations, die dieser Request tatsächlich bei Open-Meteo verbraucht hat (0 = alles gecacht). */
  cost: number
  run: { initTime: number; initHourUtc: number }
}

/** Felder eines (Domain, Modell)-Paars — aus Cache oder frisch geholt und gecacht. */
export async function getGridFields(
  domainId: string,
  modelId: string,
  variables: string[],
): Promise<GridResponse> {
  const domain = DOMAIN_PRESETS.find((d) => d.id === domainId)
  if (!domain) throw new Error(`Unbekannte Domain: ${domainId}`)
  const model = getModel(modelId) // wirft bei unbekanntem Modell
  const run = latestRun(model, Date.now())
  const runBucket = run.initTime

  const fields: Record<string, ServerGridField> = {}
  const toFetch: string[] = []
  const awaited: { variable: string; promise: Promise<ServerGridField | undefined> }[] = []

  for (const v of variables) {
    const k = key(domainId, modelId, v, runBucket)
    const mem = memory.get(k)
    if (mem) {
      fields[v] = mem
      continue
    }
    const disk = await readDisk(k, runBucket)
    if (disk) {
      memory.set(k, disk)
      fields[v] = disk
      continue
    }
    const inf = inflight.get(k)
    if (inf) {
      awaited.push({ variable: v, promise: inf })
      continue
    }
    toFetch.push(v)
  }

  // Auf laufende Fetches anderer Requests warten (Dedup)
  for (const { variable, promise } of awaited) {
    const f = await promise
    if (f) fields[variable] = f
  }

  let cost = 0
  if (toFetch.length > 0) {
    const resolvers = new Map<string, (f: ServerGridField | undefined) => void>()
    for (const v of toFetch) {
      inflight.set(
        key(domainId, modelId, v, runBucket),
        new Promise<ServerGridField | undefined>((resolve) => resolvers.set(v, resolve)),
      )
    }
    try {
      const result = await fetchGridFields(domain, modelId, toFetch)
      cost = result.cost
      for (const v of toFetch) {
        const k = key(domainId, modelId, v, runBucket)
        const f = result.fields[v]
        if (f) {
          memory.set(k, f)
          fields[v] = f
          void writeDisk(k, runBucket, f, `${domainId}_${modelId}_${v}_`)
        }
        resolvers.get(v)?.(f)
        inflight.delete(k)
      }
    } catch (err) {
      for (const v of toFetch) {
        resolvers.get(v)?.(undefined)
        inflight.delete(key(domainId, modelId, v, runBucket))
      }
      throw err
    }
  }

  return { fields, cost, run: { initTime: run.initTime, initHourUtc: run.initHourUtc } }
}
