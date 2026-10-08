// Laden der Modellkarten-Daten (ECMWF IFS, ICON-EU, ICON-D2), erzeugt von
// `scripts/ecmwf-ingest.py` bzw. `scripts/icon-ingest.py`.
//
// Alles same-origin unter `public/nwp/<modell>/`, kein Fremddienst, kein
// Open-Meteo-Budget. Die Wertebilder tragen den Lauf im PFAD und ändern sich
// nie mehr — der HTTP-Cache des Browsers ist damit die richtige Ablage, ein
// eigener IndexedDB-Cache brächte nichts dazu. Begrenzt werden muss nur der
// ARBEITSSPEICHER: ein dekodiertes Feld sind 1,8–2 MB Codes, ein Lauf über
// alle Größen wären Hunderte MB. Deshalb ein kleiner LRU über die Felder.

import type { GlobeField, GlobeMeta, GlobeModelId, GlobeVarId } from '../config/globe'
import { requestField, warmField, type FieldSource } from '../render/globePool'

const BASE = `${import.meta.env.BASE_URL}nwp/`

/**
 * Höchstzahl Felder auf dem HAUPTTHREAD (~2 MB je Feld). Klein: hier liegen
 * nur noch Werteanzeige und Windpartikel, die Kachelfelder liegen im Worker.
 */
const FIELD_LRU = 6

export async function loadGlobeMeta(model: GlobeModelId): Promise<GlobeMeta> {
  // `no-cache`: die Datei wechselt mit jedem Lauf unter derselben URL —
  // revalidieren, sonst zeigt der Browser bis zu zehn Minuten den alten Lauf
  // (GitHub Pages schickt max-age=600).
  const r = await fetch(`${BASE}${model}/meta.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as GlobeMeta
}

const metas = new Map<GlobeModelId, GlobeMeta>()
const fields = new Map<string, Promise<GlobeField>>()

/** Der Lader braucht `lo`/`step`/Raster aus der Meta — der Bereich setzt sie nach dem Laden. */
export function setGlobeMeta(meta: GlobeMeta): void {
  const old = metas.get(meta.model)
  if (old && old.runId !== meta.runId) {
    for (const k of [...fields.keys()]) if (k.startsWith(`${meta.model}/`)) fields.delete(k)
  }
  metas.set(meta.model, meta)
}

export function globeFieldUrl(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): string {
  return `${BASE}${model}/${runId}/${varId}/${String(step).padStart(3, '0')}.webp`
}

/**
 * Was ein Worker zum Laden braucht (URL, Raster, Kodierung), oder null, wenn
 * Meta, Lauf oder Größe nicht passen. Die URL ist ABSOLUT: der Worker löst
 * relative Pfade gegen SEINE Skript-Adresse auf, nicht gegen die Seite.
 */
export function globeFieldSource(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): FieldSource | null {
  const meta = metas.get(model)
  const vm = meta?.variables[varId]
  if (!meta || meta.runId !== runId || !vm) return null
  return {
    url: new URL(globeFieldUrl(model, runId, varId, step), location.href).href,
    grid: meta.grid,
    lo: vm.lo,
    step: vm.step,
    encoding: vm.encoding,
  }
}

/**
 * Feld auf dem HAUPTTHREAD — nur für Werteanzeige und Windpartikel. Dekodiert
 * wird im Worker (`globePool.ts`), hierher kommt eine Kopie. Für die Kacheln
 * wird das Feld hier gar nicht gebraucht; zum Vorladen `prefetchGlobeField`.
 */
export function loadGlobeField(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): Promise<GlobeField> {
  const src = globeFieldSource(model, runId, varId, step)
  if (!src) return Promise.reject(new Error(`kein Feld ${model}/${runId}/${varId}/${step}`))
  const key = `${model}/${runId}/${varId}/${step}`
  const hit = fields.get(key)
  if (hit) {
    // LRU: Zugriff ans Ende
    fields.delete(key)
    fields.set(key, hit)
    return hit
  }
  const p = requestField(src)
  // Ein gescheiterter Abruf darf nicht für die Sitzung im Cache kleben
  p.catch(() => fields.get(key) === p && fields.delete(key))
  fields.set(key, p)
  while (fields.size > FIELD_LRU) fields.delete(fields.keys().next().value!)
  return p
}

/** Feld im Worker vorladen (nächste Zeitschritte), ohne es auf den Hauptthread zu holen. */
export function prefetchGlobeField(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): void {
  const src = globeFieldSource(model, runId, varId, step)
  if (src) warmField(src).catch(() => {})
}
