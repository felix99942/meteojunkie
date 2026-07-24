// Diskrete Colorbar/Legende für eine ColorScale (Österreich-Klimakarte, Schritt 3).
// Zeigt die Farbbänder mit ihren Schwellenwerten — dieselbe Skala, die die
// Stationspunkte einfärbt, damit Karte und Legende konsistent bleiben.

import type { ColorScale } from '../config/colorscales'

export function Colorbar({ scale, unit }: { scale: ColorScale; unit: string }) {
  const stops = scale.stops
  // Nicht jede Schwelle beschriften, wenn es viele sind (Temperatur: 37 Bänder) —
  // etwa 8 Labels gleichmäßig verteilt reichen zum Ablesen.
  const labelEvery = Math.max(1, Math.round(stops.length / 8))
  return (
    <div className="colorbar" title={`Skala in ${unit}`}>
      <div className="colorbar-bands">
        {stops.map((s, i) => (
          <div key={i} className="colorbar-band" style={{ background: s.color }}>
            {i % labelEvery === 0 && <span className="colorbar-tick">{s.value}</span>}
          </div>
        ))}
      </div>
      <span className="colorbar-unit">{unit}</span>
    </div>
  )
}
