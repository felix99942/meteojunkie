// Füllt den TAWES-Speicher für die Entwicklung (public/tawes/10min/), mit demselben Code wie der
// Cron des Workers. Danach den Dev-Server neu starten, neue Dateien kennt Vite sonst nicht.
// Aufruf: npm run ingest:tawes

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { R2BucketLike } from '../worker/r2'
import { updateTawes } from '../worker/tawes'

const pathOf = (key: string) => `public/${key}`
const bucket = {
  get: async (key: string) => {
    const path = pathOf(key)
    if (!existsSync(path)) return null
    return { body: new Blob([readFileSync(path)]).stream() }
  },
  put: async (key: string, value: ArrayBuffer) => {
    const path = pathOf(key)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, new Uint8Array(value))
  },
} as unknown as R2BucketLike

const { stations } = JSON.parse(readFileSync('public/at/stations.json', 'utf8')) as { stations: { id: number; has10min?: boolean }[] }
console.log(await updateTawes(bucket, stations.filter((s) => s.has10min).map((s) => s.id)))
