// Die Teile der R2-Bindung, die der Worker benutzt — bewusst ohne
// @cloudflare/workers-types (Begründung in worker/index.ts).

export interface R2ObjectLike {
  key: string
  httpEtag: string
  writeHttpMetadata(headers: Headers): void
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream
  text(): Promise<string>
}
export interface R2BucketLike {
  get(key: string, options?: { onlyIf?: Headers }): Promise<R2ObjectBodyLike | R2ObjectLike | null>
  put(
    key: string,
    value: ArrayBuffer | string | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    cursor?: string
  }>
}

/** Alle Schlüssel unter einem Präfix (je Seite 1.000, eine Klasse-A-Operation). */
export async function listKeys(bucket: R2BucketLike, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 })
    for (const o of page.objects) keys.add(o.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys
}
