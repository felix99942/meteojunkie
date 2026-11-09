// Panel-Ansicht der Modellkarten: 4 oder 6 flache Karten nebeneinander
// (Europa oder Österreich), jede mit eigenem Modell und eigener Größe — wie
// das Panel-Raster der Punktprognosen, mit SYNC (gemeinsame Zeit und
// gemeinsamer Kartenausschnitt) und den Kopplungen PARSYNC (eine Größe für
// alle → Modellvergleich) bzw. MODSYNC (ein Modell für alle → Synoptik).
// Hier die reinen Teile: Regionen, Vorgaben, Kopplung, Zeitraster.

import { validMs, type GlobeMeta, type GlobeModelId, type GlobeVarId } from './globe'

export type PanelCount = 4 | 6
export type PanelRegionId = 'europe' | 'austria'

export interface PanelRegion {
  id: PanelRegionId
  label: string
  /** [[W, S], [O, N]] */
  bounds: [[number, number], [number, number]]
}

export const PANEL_REGIONS: PanelRegion[] = [
  { id: 'europe', label: 'Europa', bounds: [[-25, 34], [42, 71]] },
  // Österreich mit etwas Rand: Föhn- und Staulagen liest man über den Alpenhauptkamm hinweg
  { id: 'austria', label: 'Österreich', bounds: [[9.0, 46.1], [17.4, 49.2]] },
]

export interface MapPanelConfig {
  model: GlobeModelId
  varId: GlobeVarId
  /** gemeinsame Zeit und gemeinsamer Kartenausschnitt */
  sync: boolean
  /** eigene Gültigkeitszeit, solange SYNC aus ist */
  localMs: number | null
}

/**
 * Kopplung wie parsync in den Punktprognosen: GENAU EIN Quellpanel, dessen
 * Größe (`var`) bzw. Modell (`model`) alle übrigen übernehmen. Höchstens eine
 * Kopplung zugleich — beide zusammen machten alle Panels gleich.
 */
export type Coupling = { kind: 'var' | 'model'; source: number } | null

/**
 * Vorgaben: je Panel ein anderes Modell (für den Modellvergleich) UND eine
 * andere Größe (für die Synoptik) — welche davon gilt, entscheidet die
 * Kopplung. Beim Öffnen (auf Wunsch, 2026-11-02): ÖSTERREICH, Niederschlag,
 * die vier hochaufgelösten Modelle — IFS 9 km, ICON-EU, ICON-D2, Varda —
 * im 4er-Raster; im 6er kommen IFS 0,25° und (Wiederholung, es gibt nur
 * fünf) noch einmal IFS 9 km dazu.
 */
export const DEFAULT_PANEL_MODELS: GlobeModelId[] = ['ecmwf-hres', 'icon-eu', 'icon-d2', 'varda', 'ecmwf-ifs', 'ecmwf-hres']
export const DEFAULT_PANEL_VARS: GlobeVarId[] = ['precip', 't850', 'reltop', 'wind10', 'tcc', 'wind300']
/** Vorgabe beim Öffnen: Modellvergleich mit der Größe aus Panel 1 */
export const DEFAULT_COUPLING: Coupling = { kind: 'var', source: 0 }

export const DEFAULT_PANEL_REGION: PanelRegionId = 'austria'

export function defaultPanels(): MapPanelConfig[] {
  return DEFAULT_PANEL_MODELS.map((model, i) => ({ model, varId: DEFAULT_PANEL_VARS[i], sync: true, localMs: null }))
}

/**
 * Vorgabe JE PANELZAHL (auf Wunsch, 2026-11-02), auch ohne gespeichertes
 * Preset:
 *   4er  Modellvergleich über ÖSTERREICH — Niederschlag in IFS 9 km,
 *        ICON-EU, ICON-D2 und Varda (ParSync auf Panel 1)
 *   6er  Synoptik über EUROPA in IFS 9 km (ModSync auf Panel 1):
 *        oben T 850 · T 2 m · 500 hPa, unten Böen · Niederschlag · Neuschnee
 */
export interface PanelSetup {
  region: PanelRegionId
  coupling: Coupling
  panels: MapPanelConfig[]
}

export const SIX_PANEL_VARS: GlobeVarId[] = ['t850', 't2m', 'gh500', 'gust', 'precip', 'newsnow']

export function defaultSetup(count: PanelCount): PanelSetup {
  if (count === 6)
    return {
      region: 'europe',
      coupling: { kind: 'model', source: 0 },
      panels: SIX_PANEL_VARS.map((varId) => ({ model: 'ecmwf-hres', varId, sync: true, localMs: null })),
    }
  return { region: DEFAULT_PANEL_REGION, coupling: DEFAULT_COUPLING, panels: defaultPanels() }
}

/** Was ein Panel tatsächlich zeigt — die gekoppelte Hälfte kommt vom Quellpanel. */
export function effectivePanel(panels: MapPanelConfig[], i: number, coupling: Coupling): MapPanelConfig {
  const p = panels[i]
  if (!coupling || coupling.source === i) return p
  const src = panels[coupling.source]
  return coupling.kind === 'var' ? { ...p, varId: src.varId } : { ...p, model: src.model }
}

/**
 * Kopplung lösen: der gespiegelte Wert bleibt in allen Panels STEHEN (wie
 * parsync beim Abschalten) — sonst spränge jedes Panel auf seine alte Wahl
 * zurück, und das Bild änderte sich durch bloßes Abschalten.
 */
export function releaseCoupling(panels: MapPanelConfig[], coupling: Coupling): MapPanelConfig[] {
  if (!coupling) return panels
  return panels.map((_, i) => effectivePanel(panels, i, coupling))
}

/** Gültigkeitszeiten (ms) einer Größe eines Laufs, aufsteigend. */
export function validTimes(meta: GlobeMeta | null | undefined, varId: GlobeVarId): number[] {
  const steps = meta?.variables[varId]?.steps ?? []
  return meta ? steps.map((s) => validMs(meta, s)) : []
}

/** Vereinigung mehrerer Zeitlisten, sortiert und ohne Doppelte. */
export function unionTimes(lists: number[][]): number[] {
  return [...new Set(lists.flat())].sort((a, b) => a - b)
}

/**
 * Nächste Zeit in Richtung `dir` (±1, mit Shift ±n) — ausgehend von der Zeit,
 * die `current` am nächsten liegt. Am Rand bleibt es stehen.
 */
export function stepTime(times: number[], current: number, dir: number): number {
  if (!times.length) return current
  let k = 0
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - current) < Math.abs(times[k] - current)) k = i
  return times[Math.max(0, Math.min(times.length - 1, k + dir))]
}


/**
 * Welcher Termin eines Panels gilt zur gewählten Zeit: der LETZTE vorhandene
 * bis dahin, nie ein späterer (auf Wunsch). Ein 3-h-Modell bleibt um 13 UTC
 * bei 12 UTC STEHEN und wird ausgegraut, während ein stündliches Modell
 * (Varda, ICON-D2) weiterläuft — ein Feld von 15 UTC um 13 UTC zu zeigen,
 * hieße die Zukunft vorwegzunehmen. −1, wenn die gewählte Zeit vor dem
 * ersten Termin liegt. `times` aufsteigend.
 */
export function frozenStepIndex(times: number[], targetMs: number): number {
  let k = -1
  for (let i = 0; i < times.length && times[i] <= targetMs; i++) k = i
  return k
}

/**
 * Wie weit ein Panel hinter der gewählten Zeit stehen bleiben darf, bevor es
 * „reicht nur bis …" sagt: die gröbsten Schritte im Bild sind 6 h (IFS ab
 * +144 h). Weiter dahinter ist es nicht mehr dieselbe Wetterlage.
 */
export const PANEL_FREEZE_MAX_MS = 6 * 3_600_000

/**
 * KANTENLINIEN der Panel-Ansicht (auf Wunsch statt eines Zahlenrasters):
 * ganz dünne, dezent graue Linien auf den Grenzen der Farbstufen, beschriftet
 * mit ihrem Wert — die Fläche bleibt das Bild, die Linie sagt, wo welche Zahl
 * gilt. Abstand je Größe so, dass er auf Stufengrenzen der Skala fällt
 * (Temperatur 2 K bei 1-K-Bändern, jede zweite Grenze). Geglättet wird nur
 * leicht: die Linie soll auf der KANTE der ungeglätteten Fläche liegen, und
 * stärker geglättet liefe sie über 1-km-Gelände sichtbar daneben.
 */
export interface BandLines {
  interval: number
  /** erst ab diesem Wert (darunter ist die Skala durchsichtig) */
  min?: number
  smooth: Partial<Record<GlobeModelId, number>>
}

const SMOOTH_FINE: Partial<Record<GlobeModelId, number>> = { 'ecmwf-hres': 1, 'icon-eu': 1, 'icon-d2': 1, varda: 2 }

export const PANEL_BAND_LINES: Partial<Record<GlobeVarId, BandLines>> = {
  t2m: { interval: 2, smooth: SMOOTH_FINE },
  td2m: { interval: 2, smooth: SMOOTH_FINE },
  t850: { interval: 2, smooth: SMOOTH_FINE },
  t700: { interval: 2, smooth: SMOOTH_FINE },
  sst: { interval: 1, smooth: SMOOTH_FINE },
  reltop: { interval: 4, smooth: SMOOTH_FINE },
  gh500: { interval: 4, smooth: SMOOTH_FINE },
  gh300: { interval: 8, smooth: SMOOTH_FINE },
  msl: { interval: 4, smooth: { 'ecmwf-hres': 2, 'icon-eu': 3, 'icon-d2': 12, varda: 24 } },
  wind10: { interval: 10, min: 10, smooth: SMOOTH_FINE },
  gust: { interval: 20, min: 20, smooth: SMOOTH_FINE },
  wind850: { interval: 10, min: 10, smooth: SMOOTH_FINE },
  wind700: { interval: 10, min: 10, smooth: SMOOTH_FINE },
  wind300: { interval: 20, min: 60, smooth: SMOOTH_FINE },
  tcc: { interval: 20, min: 20, smooth: SMOOTH_FINE },
  rh700: { interval: 10, min: 50, smooth: SMOOTH_FINE },
  tcwv: { interval: 5, min: 5, smooth: SMOOTH_FINE },
  cape: { interval: 250, min: 250, smooth: SMOOTH_FINE },
  hzerocl: { interval: 500, smooth: SMOOTH_FINE },
}

/**
 * Zeitachse des gemeinsamen Reglers: nur Zeiten, zu denen JEDES Modell einen
 * eigenen Termin hat — solange es so weit reicht (auf Wunsch). So folgt der
 * Regler dem GRÖBSTEN Takt der offenen Modelle (IFS 3 h, ab +144 h 6 h) statt
 * in Stundenschritten zu laufen, bei denen IFS nur jeden dritten Schritt
 * mitkam. Ein Modell, dessen Lauf vor `t` beginnt oder vor `t` endet, bremst
 * dort nicht: endet ICON-D2 nach 48 h, geht der Regler mit den übrigen weiter.
 */
export function coarsestTimes(lists: number[][]): number[] {
  const sets = lists.filter((l) => l.length).map((l) => ({ set: new Set(l), first: l[0], last: l[l.length - 1] }))
  return unionTimes(lists).filter((t) => sets.every((s) => t < s.first || t > s.last || s.set.has(t)))
}

// --- Presets der Panel-Ansicht -------------------------------------------------

/**
 * Gespeicherte Einstellung der Panel-Ansicht (auf Wunsch, bewusst simpel):
 * Panels mit Modell, Größe und SYNC, die Kopplung, Panelzahl und Region —
 * unter einem frei gewählten Namen. KEINE Zeit: ein Preset beschreibt, WAS
 * man vergleicht, nicht wann (dieselbe Regel wie die Presets der
 * Punktprognosen). Liegt im Browser (`localStorage`), nicht auf dem Server.
 */
/** Kartenausschnitt eines Panels: Mittelpunkt [Länge, Breite] und Zoom */
export interface PanelView {
  center: [number, number]
  zoom: number
}

export interface MapPanelPreset {
  name: string
  count: PanelCount
  region: PanelRegionId
  coupling: Coupling
  panels: { model: GlobeModelId; varId: GlobeVarId; sync: boolean }[]
  /**
   * Ausschnitt je Panel (null = Standardausschnitt der Region). Seit
   * 2026-11-02 — ältere Presets ohne das Feld fahren die Region an.
   */
  views?: (PanelView | null)[]
}

export const PANEL_PRESET_KEY = 'meteo-workbench:map-panel-presets'

export function makePreset(
  name: string,
  count: PanelCount,
  region: PanelRegionId,
  coupling: Coupling,
  panels: MapPanelConfig[],
  views: (PanelView | null)[] = [],
): MapPanelPreset {
  return {
    name: name.trim(),
    count,
    region,
    coupling,
    panels: panels.map(({ model, varId, sync }) => ({ model, varId, sync })),
    views: panels.map((_, i) => views[i] ?? null),
  }
}

function parseView(v: unknown): PanelView | null {
  if (!v || typeof v !== 'object') return null
  const { center, zoom } = v as { center?: unknown; zoom?: unknown }
  if (!Array.isArray(center) || center.length !== 2) return null
  const [lon, lat] = center
  if (![lon, lat, zoom].every((x) => typeof x === 'number' && Number.isFinite(x))) return null
  if (Math.abs(lat as number) > 85 || (zoom as number) < 0 || (zoom as number) > 12) return null
  return { center: [lon as number, lat as number], zoom: zoom as number }
}

/**
 * Gespeicherte Presets lesen. Was nicht mehr passt (ein Modell oder eine
 * Größe, die es nicht mehr gibt, ein kaputter Eintrag), fällt still heraus
 * bzw. wird auf die Vorgabe zurückgesetzt — ein altes Preset soll die Ansicht
 * nie unbrauchbar machen.
 */
export function parsePresets(raw: string | null, models: readonly string[], vars: readonly string[]): MapPanelPreset[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const defaults = defaultPanels()
  const out: MapPanelPreset[] = []
  for (const p of data) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.panels)) continue
    const count: PanelCount = p.count === 6 ? 6 : 4
    const region: PanelRegionId = PANEL_REGIONS.some((r) => r.id === p.region) ? p.region : 'europe'
    const panels = defaults.map((d, i) => {
      const q = p.panels[i] ?? {}
      return {
        model: models.includes(q.model) ? (q.model as GlobeModelId) : d.model,
        varId: vars.includes(q.varId) ? (q.varId as GlobeVarId) : d.varId,
        sync: q.sync !== false,
      }
    })
    const c = p.coupling
    const coupling: Coupling =
      c && (c.kind === 'var' || c.kind === 'model') && Number.isInteger(c.source) && c.source >= 0 && c.source < count
        ? { kind: c.kind, source: c.source }
        : null
    const views = Array.isArray(p.views) ? defaults.map((_, i) => parseView(p.views[i])) : undefined
    out.push({ name: p.name.trim(), count, region, coupling, panels, ...(views ? { views } : {}) })
  }
  return out
}

/** Speichern: gleicher Name überschreibt, alphabetisch sortiert. */
export function upsertPreset(list: MapPanelPreset[], preset: MapPanelPreset): MapPanelPreset[] {
  return [...list.filter((p) => p.name !== preset.name), preset].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/**
 * Taktgeber-Panel (auf Wunsch): ein Klick in ein Panel mit FEINEREN Schritten
 * als der gemeinsame Regler (Varda, ICON-D2 stündlich) lässt den Regler in
 * DESSEN Schritten laufen. Gröbere Modelle bleiben zwischen ihren Terminen
 * stehen und sind dann grau (`frozenStepIndex`), zu ihren eigenen Terminen
 * erscheinen sie normal — eine erste Fassung graute sie im Taktgeber-Modus
 * DURCHGEHEND aus, auch zu 18 UTC, wo IFS ein eigenes Feld hat (auf Wunsch
 * wieder raus).
 */
/** Schrittweite (ms) einer Zeitliste um `targetMs` — für „ist dieses Panel feiner als der Regler?" */
export function stepAround(times: number[], targetMs: number): number {
  if (times.length < 2) return Infinity
  let k = 0
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - targetMs) < Math.abs(times[k] - targetMs)) k = i
  return k + 1 < times.length ? times[k + 1] - times[k] : times[k] - times[k - 1]
}
