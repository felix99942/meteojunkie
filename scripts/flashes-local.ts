// Lokaler Lauf von worker/flashes.ts für `npm run dev`: dieselbe Rechnung wie im
// Worker-Cron, die Ablage geht nach public/ statt nach R2. Zugangsdaten aus
// ~/.config/meteojunkie/eumetsat.env (CONSUMER_KEY, CONSUMER_SECRET).
//   npm run ingest:flashes
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { updateFlashes } from '../worker/flashes'
import type { R2BucketLike } from '../worker/r2'

const root = join(process.cwd(), 'public')
const env = Object.fromEntries(
  readFileSync(join(homedir(), '.config/meteojunkie/eumetsat.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
    }),
)

const bucket: R2BucketLike = {
  async get(key) {
    const p = join(root, key)
    if (!existsSync(p)) return null
    const text = readFileSync(p, 'utf8')
    return { key, httpEtag: '', writeHttpMetadata() {}, body: new ReadableStream(), text: async () => text }
  },
  async put(key, value) {
    const p = join(root, key)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, typeof value === 'string' ? value : new Uint8Array(value as ArrayBuffer))
  },
  async delete(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) rmSync(join(root, k), { force: true })
  },
  async list({ prefix = '' }) {
    const dir = join(root, prefix)
    const objects = existsSync(dir) ? readdirSync(dir).map((n) => ({ key: prefix + n })) : []
    return { objects, truncated: false }
  },
}

const t0 = performance.now()
console.log(await updateFlashes(bucket, { EUMETSAT_KEY: env.CONSUMER_KEY, EUMETSAT_SECRET: env.CONSUMER_SECRET }))
console.log(`${Math.round(performance.now() - t0)} ms`)
