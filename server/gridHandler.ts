// HTTP-Handler des Grid-Proxys: GET /api/grid?domain=&model=&variables=a,b,c
// → JSON { fields: { var: {lats,lons,times,values,unit} }, cost, run }.
// Wird vom Vite-Plugin (dev) bzw. später einem Standalone-Server eingehängt.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { getGridFields } from './fieldCache'

export async function handleGrid(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const domain = url.searchParams.get('domain')
  const model = url.searchParams.get('model')
  const variables = (url.searchParams.get('variables') ?? '').split(',').filter(Boolean)

  res.setHeader('content-type', 'application/json; charset=utf-8')

  if (!domain || !model || variables.length === 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'domain, model und variables sind erforderlich' }))
    return
  }

  try {
    const result = await getGridFields(domain, model, variables)
    // Innerhalb eines Laufs ändern sich Felder nicht — Clients dürfen cachen.
    res.setHeader('cache-control', 'public, max-age=600')
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Upstream-/Rate-Fehler als 502 durchreichen, damit der Client sie anzeigt
    res.statusCode = 502
    res.end(JSON.stringify({ error: message }))
  }
}
