// Ortswahl-Karte des Soundings-Bereichs: bindet `LocationMap` an die Modelle,
// die dort gerade gezeigt werden.
//
// Getrennt von `LocationMap`, weil die Karte selbst nichts über Panels weiss —
// sie bekommt eine Modell-Liste und nichts sonst. So lässt sie sich später
// ohne Umbau auch neben das klassische Meteogramm oder das Ensemble stellen
// (der Ort ist globaler Zustand).

import { useShallow } from 'zustand/react/shallow'
import { useSondeIndex } from '../api/queries'
import { supportsPressureLevels } from '../config/levels'
import { useWorkbench, visiblePanelIndices } from '../state/workbench'
import { LocationMap } from './LocationMap'

/**
 * Drucklevelfähige Modelle aller SICHTBAREN Profil-Panels.
 *
 * Ausgeblendete Panels holen keine Daten (siehe Layout-Semantik im Store) —
 * ihre Abdeckung darf die Karte deshalb auch nicht einschränken. Die
 * Sync-Regel wird mitgeführt: ein sync-aktives Panel zeigt `sharedModels`,
 * nicht seine eigene Liste.
 */
function useProfileModels(): string[] {
  return useWorkbench(
    useShallow((s) => {
      const out = new Set<string>()
      for (const i of visiblePanelIndices(s.layouts.profile)) {
        const p = s.panels[i]
        if (!p) continue
        for (const m of p.sync ? s.sharedModels : p.models) {
          if (supportsPressureLevels(m)) out.add(m)
        }
      }
      return [...out]
    }),
  )
}

/** `width` kommt vom ziehbaren Trenner; null = noch nicht vermessen. */
export function ProfileMapPane({ width }: { width: number | null }) {
  const models = useProfileModels()
  const sondes = useSondeIndex().data?.stations
  const obsOnly = useWorkbench((s) => s.soundingSource === 'obs')
  return (
    <LocationMap
      models={obsOnly ? [] : models}
      gated={!obsOnly}
      width={width}
      sondes={sondes}
    />
  )
}
