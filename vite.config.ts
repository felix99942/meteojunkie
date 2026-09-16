import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gridProxyPlugin } from './server/plugin.ts'

/**
 * BUILD-KENNUNG aus Git, zur Bauzeit eingesetzt.
 *
 * Der Zweck ist Vergleichbarkeit: „ist das schon der neue Stand?" war an
 * diesem Projekt mehrfach nicht zu beantworten, ohne das ausgelieferte Bundle
 * zu durchsuchen — beim Re-Run eines alten Laufs, beim leeren Impressum, bei
 * einer gecachten index.html. Mit Commit und Datum in der Oberfläche
 * beantwortet ein Blick, was `git log` sagt.
 *
 * NICHT aus `package.json`: die Version dort müsste man pflegen und sie würde
 * driften. Der Commit ist die einzige Angabe, die nicht lügen kann.
 *
 * In GitHub Actions liefert `GITHUB_SHA` den Stand direkt; lokal fragt es Git.
 * Schlägt beides fehl (Tarball ohne .git), bleibt „unbekannt" — eine erfundene
 * Nummer wäre schlimmer als keine.
 */
function buildInfo(): { commit: string; date: string; dirty: boolean } {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      return ''
    }
  }
  const sha = process.env.GITHUB_SHA ?? git('rev-parse HEAD')
  return {
    commit: sha ? sha.slice(0, 7) : 'unbekannt',
    // Commit-Datum, nicht Bauzeit: ein Re-Run baut denselben Stand neu, und
    // dann ist das Commit-Datum die Angabe, die den Stand identifiziert.
    date: git('log -1 --format=%cI') || new Date().toISOString(),
    dirty: git('status --porcelain') !== '',
  }
}

// https://vite.dev/config/
// base: lokal '/'; GitHub-Project-Pages liegen unter /<repo>/ — der
// Deploy-Workflow setzt VITE_BASE entsprechend.
const build = buildInfo()

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), gridProxyPlugin()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(build.commit),
    __BUILD_DATE__: JSON.stringify(build.date),
    // Nur lokal je wahr — markiert einen Build aus einem geänderten Baum,
    // der zu keinem Commit gehört.
    __BUILD_DIRTY__: JSON.stringify(build.dirty),
  },
})
