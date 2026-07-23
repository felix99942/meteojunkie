import { getModel, isDomainInCoverage, isInCoverage, MODELS } from '../config/models'
import { MAP_ENABLED } from '../config/features'
import { getColorScale } from '../config/colorscales'
import { getVariable, HOURLY_VARIABLES, type VariableInfo } from '../config/variables'
import { MAX_MODELS_PER_PANEL, SERIES_COLORS } from '../config/colors'
import { useWorkbench, type PanelConfig, type PanelMode } from '../state/workbench'

// `panel` ist die EFFEKTIVE Config (bei aktivem Sync die gemeinsamen Werte).
// Änderungen in einem sync-aktiven Panel schreiben deshalb in den gemeinsamen
// Zustand und wirken auf alle Sync-Panels; ohne Sync in die lokale Config.
export function PanelHeader({ index, panel }: { index: number; panel: PanelConfig }) {
  const updatePanel = useWorkbench((s) => s.updatePanel)
  const togglePanelModel = useWorkbench((s) => s.togglePanelModel)
  const toggleSharedModel = useWorkbench((s) => s.toggleSharedModel)
  const setSharedMapModel = useWorkbench((s) => s.setSharedMapModel)
  const setPanelVariable = useWorkbench((s) => s.setPanelVariable)
  const toggleSync = useWorkbench((s) => s.toggleSync)
  const activateParSync = useWorkbench((s) => s.activateParSync)
  const deactivateParSync = useWorkbench((s) => s.deactivateParSync)
  const parSyncSource = useWorkbench((s) => s.parSyncSource)
  const location = useWorkbench((s) => s.lockedLocation)
  const domain = useWorkbench((s) => s.domain)

  const isMap = panel.mode === 'map'
  // Profile haben keine Einzelvariable (alle Drucklevel-Größen zugleich) —
  // Parameter-Dropdown und parsync entfallen; Modellauswahl bleibt.
  const isProfile = panel.mode === 'profile'

  // Radio-Semantik: Button-Zustand ausschließlich aus parSyncSource ableiten —
  // Quelle (bedienbar) / deaktiviert (andere Quelle aktiv) / normal
  const isParSyncSource = parSyncSource === index
  const parSyncBlocked = parSyncSource !== null && !isParSyncSource

  // Parameter-Dropdown anhand der Registry filtern (SPEC §7): nur Variablen,
  // die die gewählten Modelle liefern — im Kartenmodus zusätzlich nur solche
  // mit definierter Farbskala. Die aktuell gewählte bleibt sichtbar.
  let variables: VariableInfo[]
  if (isMap) {
    const mapModel = getModel(panel.mapModel)
    variables = HOURLY_VARIABLES.filter(
      (v) => getColorScale(v.id) !== undefined && mapModel.availableVariables.includes(v.id),
    )
  } else {
    const selectedModels = panel.models.map(getModel)
    variables = HOURLY_VARIABLES.filter(
      (v) =>
        selectedModels.length === 0 ||
        selectedModels.every((m) => m.availableVariables.includes(v.id)),
    )
  }
  if (variables.length === 0) variables = HOURLY_VARIABLES
  if (!variables.some((v) => v.id === panel.variable)) {
    variables = [getVariable(panel.variable), ...variables]
  }

  const atModelLimit = panel.models.length >= MAX_MODELS_PER_PANEL

  return (
    <div className="panel-header">
      <select
        className="panel-mode"
        value={panel.mode}
        onChange={(e) => updatePanel(index, { mode: e.target.value as PanelMode })}
      >
        <option value="meteogram">Meteogramm</option>
        <option value="map" disabled={!MAP_ENABLED}>
          Karte{MAP_ENABLED ? '' : ' (in dieser Version aus)'}
        </option>
        <option value="profile">Vertikalprofil</option>
        <option value="ensemble" disabled>
          Ensemble (Phase 3)
        </option>
      </select>

      {isMap ? (
        // Karte: genau ein Modell. Verfügbarkeit wird abgeleitet, nicht pro
        // Domain gepflegt: wählbar, wenn die coverage die Domain-BBox
        // vollständig enthält. Empfohlene Modelle der Domain zuerst.
        (() => {
          const eligible = MODELS.filter((m) => isDomainInCoverage(m, domain.bbox))
          const recommended = domain.recommendedModels
            .map((id) => eligible.find((m) => m.id === id))
            .filter((m) => m !== undefined)
          const others = eligible.filter((m) => !domain.recommendedModels.includes(m.id))
          const currentIneligible = !eligible.some((m) => m.id === panel.mapModel)
          return (
            <select
              className="panel-map-model"
              value={panel.mapModel}
              onChange={(e) =>
                panel.sync
                  ? setSharedMapModel(e.target.value)
                  : updatePanel(index, { mapModel: e.target.value })
              }
            >
              <optgroup label="Empfohlen">
                {recommended.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Weitere Modelle">
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              {currentIneligible && (
                <option value={panel.mapModel}>
                  {getModel(panel.mapModel).label} ⚠ außerhalb Domain
                </option>
              )}
            </select>
          )
        })()
      ) : (
        <details className="model-picker">
          <summary>
            {panel.models.length} {panel.models.length === 1 ? 'Modell' : 'Modelle'} ▾
          </summary>
          <div className="model-picker-list">
            {MODELS.map((m) => {
              const selected = panel.models.includes(m.id)
              const outside = location !== null && !isInCoverage(m, location.lat, location.lon)
              return (
                <label key={m.id} className={outside ? 'model-outside' : undefined}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!selected && atModelLimit}
                    onChange={() =>
                      panel.sync ? toggleSharedModel(m.id) : togglePanelModel(index, m.id)
                    }
                  />
                  <span
                    className="model-chip"
                    style={{
                      background: selected
                        ? SERIES_COLORS[panel.modelSlots[m.id]]
                        : 'transparent',
                    }}
                  />
                  {m.label}
                  <span className="label-muted">
                    {' '}
                    {m.provider}
                    {m.resolutionKm > 0 ? ` · ${m.resolutionKm} km` : ''}
                  </span>
                  {outside && (
                    <span title="Standort außerhalb der Modellabdeckung" className="model-warn">
                      {' '}
                      ⚠
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </details>
      )}

      {!isProfile && (
        <>
          <select
            className="panel-variable"
            value={panel.variable}
            // Folge-Panels: Parameter-Dropdown gesperrt, solange parsync aktiv —
            // Modell, Modus und Zeit-Sync bleiben frei bedienbar
            disabled={parSyncBlocked}
            title={
              parSyncBlocked
                ? `Parameter wird von Panel ${(parSyncSource ?? 0) + 1} gespiegelt (parsync)`
                : undefined
            }
            onChange={(e) => setPanelVariable(index, e.target.value)}
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} ({v.unit})
              </option>
            ))}
          </select>

          <button
            type="button"
            className={isParSyncSource ? 'sync-toggle parsync active' : 'sync-toggle parsync'}
            disabled={parSyncBlocked}
            title={
              parSyncBlocked
                ? `parsync ist in Panel ${(parSyncSource ?? 0) + 1} aktiv`
                : isParSyncSource
                  ? 'Dieses Panel ist die Parameter-Quelle — Klick gibt alle wieder frei'
                  : 'Diesen Parameter auf alle Panels spiegeln (nur eine Quelle möglich)'
            }
            onClick={() => (isParSyncSource ? deactivateParSync(index) : activateParSync(index))}
          >
            ParSync
          </button>
        </>
      )}

      <button
        type="button"
        className={panel.sync ? 'sync-toggle main-sync active' : 'sync-toggle main-sync'}
        title="Zeit-Cursor, Kartenzoom und Modellauswahl folgen den anderen Sync-Panels"
        onClick={() => toggleSync(index)}
      >
        SYNC
      </button>
    </div>
  )
}
