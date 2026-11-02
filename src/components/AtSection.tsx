// Klima (Stationsdaten Österreich/Deutschland) bzw. MOS-Vorhersage (MOSMIX,
// DACH-Raum). Bis 2026-11-02 EIN Bereich mit Umschalter („Klima + MOS"); seit
// der Gliederung nach Vorhersage und Beobachtung zwei Bereiche, die dasselbe
// Gerüst (`.atsection`) teilen — die Karte, Farbskalen und das Stationsdetail
// sind ohnehin gemeinsam.

import { AtClimatePanel } from './AtClimatePanel'
import { AtForecastPanel } from './AtForecastPanel'

export function AtSection({ mode }: { mode: 'klima' | 'vorhersage' }) {
  return <div className="atsection">{mode === 'klima' ? <AtClimatePanel /> : <AtForecastPanel />}</div>
}
