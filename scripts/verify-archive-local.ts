// Lokaler Lauf von worker/verifyArchive.ts für `npm run dev`: übernimmt die
// Punktwerte, die ein lokaler Ingest nach public/verify/points/ gelegt hat
// (z. B. `python3 scripts/arome-ingest.py`), ins Archiv unter public/verify/.
//   npm run ingest:verify-archive
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { updateVerifyArchive } from '../worker/verifyArchive'
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
console.log(await updateVerifyArchive(bucket))
console.log(`${Math.round(performance.now() - t0)} ms`)
