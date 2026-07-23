import { useWorkbench } from '../state/workbench'
import { useApiUsage } from '../state/apiUsage'
import { DOMAIN_PRESETS } from '../config/domains'
import { MAP_ENABLED } from '../config/features'
import { MOCK_MODE, mockGridDims } from '../api/mock'
import { LocationPicker } from './LocationPicker'
import { PresetBar } from './PresetBar'

export function TopBar() {
  const domain = useWorkbench((s) => s.domain)
  const setDomain = useWorkbench((s) => s.setDomain)
  const gridLocations = useApiUsage((s) => s.gridLocations)
  const pointLocations = useApiUsage((s) => s.pointLocations)
  const requests = useApiUsage((s) => s.requests)
  const resetUsage = useApiUsage((s) => s.reset)

  return (
    <header className="topbar">
      <span className="topbar-title">Meteo Workbench</span>
      {MOCK_MODE !== 'off' &&
        (() => {
          // aktive Mock-Auflösung anzeigen — nie unklar lassen, ob man
          // Real- oder Testauflösung sieht
          const dims = mockGridDims(domain)
          const res = dims ? ` · ${dims.ny}×${dims.nx}` : ''
          return (
            <span
              className="mock-badge"
              title={
                `Synthetische Daten — kein API-Verbrauch. ` +
                (dims
                  ? `Testauflösung ${dims.ny}×${dims.nx} via ?mockres.`
                  : `Gitter in Realauflösung (${domain.gridLat}×${domain.gridLon}); ?mockres=N übersteuert.`) +
                ` Abschalten: ?mock aus der URL entfernen.`
              }
            >
              MOCK{MOCK_MODE !== 'data' ? ` · ${MOCK_MODE.toUpperCase()}` : ''}
              {res}
            </span>
          )
        })()}
      <LocationPicker />
      <PresetBar />
      <span
        className="api-usage"
        title={
          `Gewichteter API-Verbrauch dieser Session — Open-Meteo zählt nach Locations ` +
          `(Limits: 600/min, 5.000/h, 10.000/Tag). Cache-Treffer zählen nicht.\n` +
          `Gitter (Karten): ${gridLocations.toLocaleString('de-DE')} · ` +
          `Meteogramme: ${pointLocations.toLocaleString('de-DE')} · ` +
          `HTTP-Requests: ${requests}`
        }
      >
        API: {(gridLocations + pointLocations).toLocaleString('de-DE')} Locations
      </span>
      <button
        type="button"
        className="api-usage-reset"
        title="Zähler zurücksetzen — damit lässt sich der Verbrauch einer einzelnen Aktion messen"
        onClick={resetUsage}
      >
        ⟲
      </button>
      {MAP_ENABLED && (
        <label className="topbar-domain" title="Kartendomain — nur für Karten-Panels">
          <span className="label-muted">Domain</span>
          <select
            value={domain.id}
            onChange={(e) => {
              const d = DOMAIN_PRESETS.find((p) => p.id === e.target.value)
              if (d) setDomain(d)
            }}
          >
            {DOMAIN_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} (~{d.approxResolutionKm} km)
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  )
}
