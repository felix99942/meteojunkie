import { Fragment, useEffect, useRef } from 'react'
import {
  compareModelsByScale,
  getModel,
  groupModelsByScale,
  isDomainInCoverage,
  isInCoverage,
  resolutionLabel,
  SCALE_HINTS,
  SCALE_LABELS,
  SELECTABLE_MODELS,
} from '../config/models'
import { MAP_ENABLED } from '../config/features'
import { getColorScale } from '../config/colorscales'
import {
  getVariable,
  HOURLY_VARIABLES,
  parseVariableValue,
  variableOptions,
  type VariableInfo,
} from '../config/variables'
import { MAX_MODELS_PER_PANEL, SERIES_COLORS } from '../config/colors'
import {
  ENSEMBLE_MODELS,
  ensembleVariableOptions,
  getEnsembleModel,
  getEnsembleVariable,
  parseEnsembleVariableValue,
  ensembleVariableFor,
} from '../config/ensemble'
import { isPanelSection, useAppView } from '../state/appView'
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

  // <details> schließt von sich aus NUR über sein Summary — ein Klick daneben
  // ließ die Modellliste offen stehen und über das Panel darunter liegen.
  // Deshalb hier von Hand: Klick außerhalb oder Escape schließt sie.
  const pickerRef = useRef<HTMLDetailsElement>(null)
  /**
   * Gespeicherte Presets können eine Größe mit einem Modell kombinieren, das
   * sie nicht liefert (850 hPa + ICON-Ensemble). Dann hier korrigieren, statt
   * eine leere Plume zu zeigen — dasselbe Muster wie die Schwellen-Korrektur
   * in `VerifyPanel`. Ein Modellwechsel über das Dropdown ist schon
   * abgefangen; das hier fängt alles, was von außen in den Zustand kommt.
   */
  const fixedEnsembleVariable = ensembleVariableFor(panel.ensembleModel, panel.ensembleVariable)
  useEffect(() => {
    if (fixedEnsembleVariable !== panel.ensembleVariable) {
      updatePanel(index, { ensembleVariable: fixedEnsembleVariable })
    }
  }, [fixedEnsembleVariable, panel.ensembleVariable, index, updatePanel])

  useEffect(() => {
    const close = () => {
      if (pickerRef.current?.open) pickerRef.current.open = false
    }
    const onPointerDown = (e: MouseEvent) => {
      const el = pickerRef.current
      if (el?.open && !el.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Der BEREICH bestimmt, was der Kopf anbietet (siehe appView.ts):
  //   ensemble → eigene Modell-/Parameterwahl (eigene API-Registry), kein
  //     parsync — der gespiegelte Parameter existiert dort oft gar nicht
  //   profile  → keine Einzelvariable (alle Drucklevel-Größen zugleich),
  //     deshalb weder Parameter-Dropdown noch parsync; Modellauswahl bleibt
  //   workbench → Modus-Dropdown Meteogramm ↔ Karte plus alles Übrige
  const view = useAppView((s) => s.view)
  const section = isPanelSection(view) ? view : 'workbench'
  const isEnsemble = section === 'ensemble'
  const isProfile = section === 'profile'
  const isMap = section === 'workbench' && panel.mode === 'map'

  // Radio-Semantik: Button-Zustand ausschließlich aus parSyncSource ableiten —
  // Quelle (bedienbar) / deaktiviert (andere Quelle aktiv) / normal
  const isParSyncSource = parSyncSource === index
  const parSyncBlocked = parSyncSource !== null && !isParSyncSource

  // Parameter-Dropdown anhand der Registry filtern (SPEC §7): nur Variablen,
  // die die gewählten Modelle liefern — im Kartenmodus zusätzlich nur solche
  // mit definierter Farbskala. Die aktuell gewählte bleibt sichtbar.
  // `chartOnly`-Variablen (Wettercode, Tag/Nacht) sind Bausteine des
  // klassischen Meteogramms, keine frei wählbaren Parameter — als Kurve über
  // der Zeit wären sie sinnlos.
  const pickable = HOURLY_VARIABLES.filter((v) => !v.chartOnly)
  let variables: VariableInfo[]
  if (isMap) {
    const mapModel = getModel(panel.mapModel)
    variables = pickable.filter(
      (v) => getColorScale(v.id) !== undefined && mapModel.availableVariables.includes(v.id),
    )
  } else {
    const selectedModels = panel.models.map(getModel)
    variables = pickable.filter(
      (v) =>
        selectedModels.length === 0 ||
        selectedModels.every((m) => m.availableVariables.includes(v.id)),
    )
  }
  if (variables.length === 0) variables = pickable
  if (!variables.some((v) => v.id === panel.variable)) {
    variables = [getVariable(panel.variable), ...variables]
  }
  // Summengrößen erscheinen im Meteogramm als ZWEI Einträge (Rate/Summe); auf
  // der Karte nicht — dort steht ein Zeitschritt, eine Summe hätte keinen
  // Bezugszeitraum.
  const options = variableOptions(variables, !isMap)
  const selectedValue =
    !isMap && getVariable(panel.variable).accum
      ? `${panel.variable}:${panel.accumView}`
      : panel.variable

  const atModelLimit = panel.models.length >= MAX_MODELS_PER_PANEL

  return (
    <div className="panel-header">
      {/* Nur im Meteogramm-Bereich: Ensemble und Profil sind eigene Bereiche */}
      {section === 'workbench' && (
        <select
          className="panel-mode"
          value={panel.mode}
          onChange={(e) => updatePanel(index, { mode: e.target.value as PanelMode })}
        >
          <option value="meteogram">Meteogramm</option>
          <option value="map" disabled={!MAP_ENABLED}>
            Karte{MAP_ENABLED ? '' : ' (in dieser Version aus)'}
          </option>
        </select>
      )}

      {isEnsemble ? (
        // Ensemble: eigenes Modell UND eigene Variable — die Ensemble-API führt
        // andere Modelle und andere Größen (Höhenwetter) als die Forecast-API.
        // Bewusst NICHT an SYNC gekoppelt: jede Auswahl kostet ~5 Locations.
        <>
          <select
            className="panel-map-model"
            value={panel.ensembleModel}
            title={getEnsembleModel(panel.ensembleModel).note}
            onChange={(e) => {
              // Größe MIT umstellen: die ICON-Ensembles haben kein 850 hPa,
              // also ausgerechnet nicht den Startparameter. Ohne Rückfall
              // wechselt man das Modell und sieht ein leeres Diagramm, ohne
              // zu erfahren warum (siehe `ensembleVariableFor`).
              const ensembleModel = e.target.value
              updatePanel(index, {
                ensembleModel,
                ensembleVariable: ensembleVariableFor(ensembleModel, panel.ensembleVariable),
              })
            }}
          >
            {/* Auflösung UND Mitgliederzahl: die Liste mischt jetzt 1 km mit
                11 Mitgliedern und 25 km mit 51 — beides entscheidet, was die
                Plume aussagt, und beides gehört an den Eintrag. */}
            {ENSEMBLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.members} Member · {m.resolutionKm === 0 ? 'variabel' : `${String(m.resolutionKm).replace('.', ',')} km`}
              </option>
            ))}
          </select>
          {/* Summengrößen stehen zweimal drin (Summe / 6 h) — die Darstellung
              ist Teil der Auswahl, nicht ein Umschalter daneben. */}
          <select
            className="panel-variable"
            value={
              getEnsembleVariable(panel.ensembleVariable).kind === 'accum'
                ? `${panel.ensembleVariable}:${panel.ensembleAccumView}`
                : panel.ensembleVariable
            }
            onChange={(e) => {
              const { variable, view } = parseEnsembleVariableValue(e.target.value)
              updatePanel(index, { ensembleVariable: variable, ensembleAccumView: view })
            }}
          >
            {ensembleVariableOptions(panel.ensembleModel).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      ) : isMap ? (
        // Karte: genau ein Modell. Verfügbarkeit wird abgeleitet, nicht pro
        // Domain gepflegt: wählbar, wenn die coverage die Domain-BBox
        // vollständig enthält. Empfohlene Modelle der Domain zuerst.
        (() => {
          const eligible = SELECTABLE_MODELS.filter((m) => isDomainInCoverage(m, domain.bbox))
          const recommended = domain.recommendedModels
            .map((id) => eligible.find((m) => m.id === id))
            .filter((m) => m !== undefined)
          const others = eligible
            .filter((m) => !domain.recommendedModels.includes(m.id))
            // Sortiert wie überall: Skala, darin Familie, darin Auflösung.
            // „Empfohlen" behält dagegen die Reihenfolge der Domain — das ist
            // eine Priorisierung, keine Sortierung.
            .sort(compareModelsByScale)
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
              {/* Auflösung an jedem Eintrag: sie erklärt, warum ein Feld
                  glatter oder körniger aussieht als das daneben. */}
              <optgroup label="Empfohlen">
                {recommended.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {resolutionLabel(m)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Weitere Modelle">
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {resolutionLabel(m)}
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
        <details className="model-picker" ref={pickerRef}>
          <summary>
            {panel.models.length} {panel.models.length === 1 ? 'Modell' : 'Modelle'} ▾
          </summary>
          <div className="model-picker-list">
            {/* Nach SKALA gruppiert wie in der Verifikation und im
                klassischen Meteogramm — eine flache Registry-Liste stellte
                AROME neben ARPEGE und IFS neben GFS. */}
            {groupModelsByScale([...SELECTABLE_MODELS]).map((group) => (
              <Fragment key={group.scale}>
                <span className="model-picker-group label-muted" title={SCALE_HINTS[group.scale]}>
                  {SCALE_LABELS[group.scale]}
                </span>
                {group.models.map((m) => {
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
                    {m.provider} · {resolutionLabel(m)}
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
              </Fragment>
            ))}
          </div>
        </details>
      )}

      {!isProfile && !isEnsemble && (
        <>
          <select
            className="panel-variable"
            value={selectedValue}
            // Folge-Panels: Parameter-Dropdown gesperrt, solange parsync aktiv —
            // Modell, Modus und Zeit-Sync bleiben frei bedienbar
            disabled={parSyncBlocked}
            title={
              parSyncBlocked
                ? `Parameter wird von Panel ${(parSyncSource ?? 0) + 1} gespiegelt (parsync)`
                : undefined
            }
            onChange={(e) => {
              const { variable, view } = parseVariableValue(e.target.value)
              // Ansicht mitschreiben; setPanelVariable kümmert sich ums
              // parsync-Spiegeln (gespiegelt wird der Parameter, nicht die
              // Ansicht — die bleibt panel-lokal)
              updatePanel(index, { accumView: view })
              setPanelVariable(index, variable)
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
