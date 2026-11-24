// Lokaler Lauf von worker/opera.ts für `npm run dev`: dieselbe Rechnung wie im
// Worker-Cron, die Ablage geht nach public/ statt nach R2. Ohne Zugangsdaten
// (OPERA ist offen). Holt je Aufruf höchstens 4 Termine — für eine volle
// Schleife mehrmals laufen lassen.
//   npm run ingest:opera
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { updateOpera } from '../worker/opera'
import type { R2BucketLike } from '../worker/r2'

const root = join(process.cwd(), 'public')

const bucket: R2BucketLike = {
  async get(key) {
    const p = join(root, key)
    if (!existsSync(p)) return null
    const bytes = readFileSync(p)
    return { key, httpEtag: '', writeHttpMetadata() {}, body: new Blob([bytes]).stream(), text: async () => bytes.toString('utf8') }
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
console.log(await updateOpera(bucket))
console.log(`${Math.round(performance.now() - t0)} ms`)
