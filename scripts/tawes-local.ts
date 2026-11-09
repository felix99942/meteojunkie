// Füllt den TAWES-Speicher für die Entwicklung (public/tawes/), mit demselben Code wie der Cron
// des Workers. Danach den Dev-Server neu starten, neue Dateien kennt Vite sonst nicht.
// Aufruf: npm run ingest:tawes

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TAWES_STORE_KEY } from '../src/config/tawesStore'
import type { R2BucketLike } from '../worker/r2'
import { updateTawes } from '../worker/tawes'

const path = `public/${TAWES_STORE_KEY}`
const bucket = {
  get: async () => {
    if (!existsSync(path)) return null
    return { body: new Blob([readFileSync(path)]).stream() }
  },
  put: async (_key: string, value: ArrayBuffer) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, new Uint8Array(value))
  },
} as unknown as R2BucketLike

const { stations } = JSON.parse(readFileSync('public/at/stations.json', 'utf8')) as { stations: { id: number; has10min?: boolean }[] }
console.log(await updateTawes(bucket, stations.filter((s) => s.has10min).map((s) => s.id)))
