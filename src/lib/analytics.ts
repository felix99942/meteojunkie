// Lädt den GoatCounter-Zähler (siehe `config/analytics.ts`) und meldet
// Bereichswechsel als EREIGNIS. Die Seite ist eine Einzelseiten-Anwendung:
// ohne die Ereignisse sähe das Dashboard nur „/" und nie, welche Bereiche
// (Radar, Soundings, Modellkarten …) tatsächlich benutzt werden.

import { ANALYTICS_ENABLED, GOATCOUNTER_CODE, GOATCOUNTER_HOST } from '../config/analytics'
import { useAppView } from '../state/appView'

interface GoatCounter {
  count?: (vars: { path: string; title?: string; event?: boolean }) => void
}

declare global {
  interface Window {
    goatcounter?: GoatCounter
  }
}

export function startAnalytics(): void {
  if (!ANALYTICS_ENABLED || !GOATCOUNTER_CODE) return
  const s = document.createElement('script')
  s.async = true
  s.src = `https://${GOATCOUNTER_HOST}/count.js`
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`
  document.head.appendChild(s)

  // Der Startbereich steckt im Seitenaufruf selbst; gemeldet werden nur WECHSEL.
  // Lädt das Skript nicht (Blocker), fällt das still weg — `count` fehlt dann.
  useAppView.subscribe((st, prev) => {
    if (st.view === prev.view) return
    window.goatcounter?.count?.({ path: `bereich/${st.view}`, title: st.view, event: true })
  })
}
