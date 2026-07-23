// Vite-Dev-Plugin: hängt den Grid-Proxy als Middleware unter /api/grid in den
// Dev-Server (gleiche Origin wie die App → kein CORS, kein zweiter Prozess).
// Die eigentliche Logik wird zur Laufzeit per ssrLoadModule geladen — so
// bekommt sie HMR und Vites Modulauflösung (die src/config-Importe der
// Server-Module lösen sonst unter Node-ESM nicht auf).
//
// Bewusst schlank und ohne src/config-Import: dieses File wird mit vite.config
// unter tsconfig.node (nodenext) getypt; die schweren Module hängen hinter dem
// ssrLoadModule-String. Für ein späteres Standalone-Deployment werden
// server/* gebündelt — der Handler (gridHandler.ts) ist framework-neutral.

import type { Plugin } from 'vite'

export function gridProxyPlugin(): Plugin {
  return {
    name: 'meteo-grid-proxy',
    configureServer(server) {
      server.middlewares.use('/api/grid', (req, res) => {
        void (async () => {
          try {
            const mod = await server.ssrLoadModule('/server/gridHandler.ts')
            await (mod as { handleGrid: (req: unknown, res: unknown) => Promise<void> }).handleGrid(
              req,
              res,
            )
          } catch (err) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: String((err as Error)?.message ?? err) }))
          }
        })()
      })
    },
  }
}
