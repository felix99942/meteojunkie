// Modell-Registry (SPEC §7). Die UI filtert Parameter-Dropdowns anhand dieser
// Metadaten und warnt, wenn Location/Domain außerhalb der Modellabdeckung liegt.
//
// Hinweis: resolutionKm / updateIntervalHours / coverage sind Näherungswerte
// aus der Open-Meteo-Doku (Stand Juli 2026) — bei Bedarf gegen
// https://open-meteo.com/en/docs abgleichen. resolutionKm = 0 bedeutet
// "variabel" (best_match / seamless).
//
// `forecastHours` dagegen ist LIVE GEMESSEN (2026-07-31, letzter nicht-null
// Zeitschritt je Modell, umgerechnet auf die Init-Zeit des Laufs). Zwei Werte
// waren deutlich zu klein und haben vorhandene Vorhersage abgeschnitten:
//   best_match    168 → 384 h (der Blend reicht so weit wie GFS)
//   ecmwf_ifs025  240 → 360 h (ECMWF liefert 15 Tage, nicht 10)
// Die übrigen Werte stimmten, sobald die Laufstunde berücksichtigt wird
// (siehe modelHorizonEnd).

import { latestRun } from './runs'
import { STEP_MS, TIME_RANGE } from './time'

export interface BBox {
  latMin: number
  lonMin: number
  latMax: number
  lonMax: number
}

export interface ModelInfo {
  id: string
  label: string
  provider: string
  resolutionKm: number
  updateIntervalHours: number
  forecastHours: number
  coverage: BBox | 'global'
  /** false für best_match / Seamless — die Single-Runs-BBox-API kann nur konkrete Domains. */
  supportsBoundingBox: boolean
  availableVariables: string[]
  /**
   * false → taucht in KEINER Modellauswahl auf (Meteogramm, Punktprognosen,
   * Karte). Der Eintrag bleibt in der Registry, damit gespeicherte Presets ihn
   * weiter auflösen können und das Wiedereinschalten ein Wort ist.
   *
   * `meteoswiss_icon_ch1`/`_ch2` waren hier, solange nur die Föhn-Größen
   * geprüft waren. Inzwischen live verifiziert (2026-09-16, Innsbruck): BEIDE
   * liefern alle 19 Größen des klassischen Meteogramms vollständig — auch
   * `weather_code`, `is_day`, die vier Bewölkungsschichten,
   * `precipitation_probability`, `cape` und `shortwave_radiation`. Deshalb
   * freigeschaltet. Drucklevel haben sie weiter nicht; das gatet
   * `PRESSURE_LEVEL_MODELS` in `config/levels.ts` unabhängig hiervon.
   *
   * Aktuell abgeschaltet: `ukmo_uk_deterministic_2km`. Es LIEFERT Daten (live
   * geprüft 2026-08-31: London 73 h), scheitert außerhalb Großbritanniens aber
   * komplett — in Österreich antwortet der Request nicht einmal mit JSON, und
   * für diese Workbench liegt jeder interessante Punkt dort.
   *
   * `geosphere_arome_austria` ist bewusst NICHT abgeschaltet: es ist das
   * einzige 2,5-km-Modell über Österreich. Sein kurzer Horizont ist kein
   * Grund mehr, es zu verstecken, seit die Zeitachse des klassischen
   * Meteogramms dem Horizont des gewählten Modells folgt.
   */
  selectable?: false
}

/**
 * SKALENKLASSE eines Modells — die Ordnung, in der man Modelle vergleicht.
 *
 * Eine rein alphabetische Liste stellt AROME Austria neben ARPEGE und IFS
 * neben GFS; interessant ist die Gegenüberstellung nach SKALA: das
 * 1–2,5-km-Lokalmodell gegen das 25-km-Globalmodell — das ist der Vergleich,
 * der in der Verifikation etwas aussagt. INNERHALB einer Gruppe stehen dann
 * die Modellfamilien zusammen (`compareModelsByScale`).
 *
 * `resolutionKm === 0` heißt „variabel" (Blend/Seamless): diese Einträge sind
 * keine Modelle, sondern Mischungen mehrerer, und gehören deshalb in eine
 * eigene Gruppe statt an irgendeine Stelle der Auflösungsskala.
 */
export type ModelScale = 'local' | 'regional' | 'global' | 'blend'

export const SCALE_LABELS: Record<ModelScale, string> = {
  local: 'Lokalmodelle',
  regional: 'Regionalmodelle',
  global: 'Globalmodelle',
  blend: 'Mischungen',
}

/** Kurzer Zusatz für den Tooltip — was die Gruppe bedeutet. */
export const SCALE_HINTS: Record<ModelScale, string> = {
  local:
    'Feines Gitter über einem begrenzten Gebiet: löst Täler und Konvektion auf, reicht dafür ' +
    'nur ein bis drei Tage weit.',
  regional:
    'Mittleres Gitter über einem Kontinent — der Kompromiss zwischen Auflösung und Reichweite.',
  global:
    'Grobes Gitter über die ganze Erde, dafür bis zu 16 Tage. In den Alpen ist ein Talboden ' +
    'damit nicht auflösbar.',
  blend:
    'Keine eigenen Modelle, sondern Mischungen: nach Vorlaufzeit wird zwischen mehreren ' +
    'Modellen umgeschaltet, die Auflösung ist deshalb variabel.',
}

export function modelScale(m: ModelInfo): ModelScale {
  if (m.resolutionKm === 0) return 'blend'
  if (m.coverage === 'global') return 'global'
  return m.resolutionKm <= 4 ? 'local' : 'regional'
}

const SCALE_ORDER: ModelScale[] = ['local', 'regional', 'global', 'blend']

/**
 * MODELLFAMILIE aus dem Etikett: alles bis zum ersten Leerzeichen oder
 * Bindestrich. „ICON-CH1", „ICON-D2", „ICON-EU", „ICON Global" und
 * „ICON Seamless" ergeben damit alle `ICON`, „AROME France"/„AROME Austria"
 * beide `AROME`, die beiden ECMWF-Läufe `ECMWF`.
 *
 * Abgeleitet statt als Registry-Feld gepflegt: die Familie IST der
 * Etikettanfang, ein zusätzliches Feld könnte nur davon abweichen. Ein Test
 * hält die erwartete Reihenfolge fest und fängt damit eine Umbenennung, die
 * die Gruppierung zerreißen würde.
 */
export function modelFamily(m: ModelInfo): string {
  return m.label.split(/[\s-]/)[0]
}

/**
 * Sortierung: erst die Skalenklasse, darin nach FAMILIE, dann nach Auflösung
 * (fein → grob), zuletzt nach Etikett.
 *
 * Die Familie vor der Auflösung, damit verwandte Modelle beieinanderstehen —
 * ICON-CH1/CH2/D2 als Block, AROME France und Austria als Block. Der Preis
 * ist, dass eine Gruppe nicht mehr durchgehend fein → grob läuft (im
 * Regionalblock steht ARPEGE mit 11 km vor ICON-EU mit 7 km). Die Auflösung
 * steht dafür an JEDEM Eintrag sichtbar dabei, die Information geht also
 * nicht verloren.
 *
 * Das Etikett als letzter Stichentscheid ist der Grund, warum
 * `ecmwf_ifs025` und `ecmwf_aifs025_single` (beide 25 km, dieselbe Familie)
 * nebeneinander landen und GFS mit denselben 25 km nicht dazwischenrutscht.
 */
export function compareModelsByScale(a: ModelInfo, b: ModelInfo): number {
  const d = SCALE_ORDER.indexOf(modelScale(a)) - SCALE_ORDER.indexOf(modelScale(b))
  if (d !== 0) return d
  const f = modelFamily(a).localeCompare(modelFamily(b), 'de')
  if (f !== 0) return f
  if (a.resolutionKm !== b.resolutionKm) return a.resolutionKm - b.resolutionKm
  return a.label.localeCompare(b.label, 'de')
}

/** Modelle nach Skalenklasse gruppiert, in der Reihenfolge von SCALE_ORDER. */
export function groupModelsByScale(models: ModelInfo[]): { scale: ModelScale; models: ModelInfo[] }[] {
  return SCALE_ORDER.map((scale) => ({
    scale,
    models: models.filter((m) => modelScale(m) === scale).sort(compareModelsByScale),
  })).filter((g) => g.models.length > 0)
}

/** „2,5 km" bzw. „variabel" — resolutionKm = 0 ist keine Auflösung. */
export function resolutionLabel(m: ModelInfo): string {
  return m.resolutionKm === 0 ? 'variabel' : `${String(m.resolutionKm).replace('.', ',')} km`
}

const BASE_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  // Für die Symbolzeile und die Tag/Nacht-Schattierung des klassischen
  // Meteogramms — live gegen alle Modelle der Registry geprüft, überall
  // vorhanden (2026-08-30).
  'weather_code',
  'is_day',
]

/**
 * Niederschlagswahrscheinlichkeit gibt es NICHT überall: live geprüft
 * (2026-08-30) liefern ARPEGE, AROME (FR/AT), UKMO (global/UK) und
 * ECMWF AIFS durchgehend null — HTTP 200 mit leeren Werten, kein Fehler.
 * Deshalb pro Modell gepflegt und nicht in BASE_VARS.
 */
const PROB_VAR = ['precipitation_probability']

const CONVECTION_VARS = ['cape', 'shortwave_radiation']

export const MODELS: ModelInfo[] = [
  {
    id: 'best_match',
    label: 'Best Match',
    provider: 'Open-Meteo',
    resolutionKm: 0,
    updateIntervalHours: 1,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'icon_seamless',
    label: 'ICON Seamless',
    provider: 'DWD',
    resolutionKm: 0,
    updateIntervalHours: 3,
    forecastHours: 180,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'icon_d2',
    label: 'ICON-D2',
    provider: 'DWD',
    resolutionKm: 2.2,
    updateIntervalHours: 3,
    forecastHours: 48,
    coverage: { latMin: 43.18, lonMin: -3.94, latMax: 58.08, lonMax: 20.34 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'icon_eu',
    label: 'ICON-EU',
    provider: 'DWD',
    resolutionKm: 7,
    updateIntervalHours: 3,
    // 120 h live verifiziert (Juli 2026): Lauf 06 UTC lieferte Daten bis +126 h
    // ab Forecast-Start — nicht die ~78 h, die teils kursieren
    forecastHours: 120,
    coverage: { latMin: 29.5, lonMin: -23.5, latMax: 70.5, lonMax: 45.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'icon_global',
    label: 'ICON Global',
    provider: 'DWD',
    resolutionKm: 13,
    updateIntervalHours: 6,
    forecastHours: 180,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS 0.25°',
    provider: 'ECMWF',
    resolutionKm: 25,
    updateIntervalHours: 6,
    forecastHours: 360,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape', ...PROB_VAR],
  },
  {
    // ECMWFs KI-Modell als deterministischer Einzellauf — das Gegenstück zum
    // IFS im direkten Vergleich, und das EINZIGE KI-Modell, das die Forecast-API
    // wirklich liefert (siehe Prüfprotokoll in config/ensemble.ts: GraphCast ist
    // eine gültige ID mit ausschließlich null, Pangu/FuXi/Aurora/GenCast/
    // FourCastNet existieren gar nicht). Als Ensemble läuft dasselbe Modell
    // unter `ecmwf_aifs025` — auf der Forecast-API ist DIESE ID durchgehend
    // null, die beiden sind nicht austauschbar.
    id: 'ecmwf_aifs025_single',
    label: 'ECMWF AIFS 0.25° (KI)',
    provider: 'ECMWF',
    resolutionKm: 25,
    updateIntervalHours: 6,
    // Wie beim IFS angesetzt: live gemessen (2026-08-17, 19:15 UTC) reichte
    // AIFS 15 h WEITER als ecmwf_ifs025 im selben Moment (+365 h vs. +350 h ab
    // Rasterbeginn), also sicher nicht kürzer. Die Init-Zeit ist über die freie
    // API nicht beobachtbar; beide Werte gemeinsam nachschärfen, wenn die
    // Laufauswahl über die Single-Runs-API kommt (SPEC §13).
    forecastHours: 360,
    coverage: 'global',
    supportsBoundingBox: true, // live geprüft
    // Live geprüft: Böen und CAPE liefert AIFS durchgehend null — NICHT aus der
    // Doku ergänzen. Strahlung endet 2 h, Niederschlag/Schnee 5 h vor den
    // übrigen Größen; das fängt die normale Horizontbehandlung ab.
    availableVariables: [
      ...BASE_VARS.filter((v) => v !== 'wind_gusts_10m'),
      'shortwave_radiation',
    ],
  },
  {
    id: 'gfs_seamless',
    label: 'GFS Seamless',
    provider: 'NOAA',
    resolutionKm: 0,
    updateIntervalHours: 6,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'gfs_global',
    label: 'GFS Global',
    provider: 'NOAA',
    resolutionKm: 25,
    updateIntervalHours: 6,
    forecastHours: 384,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'meteofrance_arpege_europe',
    label: 'ARPEGE Europe',
    provider: 'Météo-France',
    resolutionKm: 11,
    updateIntervalHours: 6,
    forecastHours: 102,
    coverage: { latMin: 20.0, lonMin: -32.0, latMax: 72.0, lonMax: 42.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape'],
  },
  {
    id: 'meteofrance_arome_france',
    label: 'AROME France',
    provider: 'Météo-France',
    resolutionKm: 1.5,
    updateIntervalHours: 3,
    forecastHours: 51,
    coverage: { latMin: 37.5, lonMin: -12.0, latMax: 55.4, lonMax: 16.0 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, 'cape', 'shortwave_radiation'],
  },
  {
    // Live verifiziert (Juli 2026): Modell-ID, alle Basis+Konvektions-Variablen,
    // Horizont 60 h / Update alle 3 h laut Doku. Native Auflösung 2,5 km
    // (GeoSphere-Dataset nwp-v1-1h-2500m). Coverage = Alpenraum-Domain,
    // per Stichproben geprüft: München/Mailand/Prag/Zagreb ✓, Berlin ✗.
    id: 'geosphere_arome_austria',
    label: 'AROME Austria',
    provider: 'GeoSphere Austria',
    resolutionKm: 2.5,
    updateIntervalHours: 3,
    forecastHours: 60,
    coverage: { latMin: 43.0, lonMin: 5.5, latMax: 51.8, lonMax: 22.1 },
    supportsBoundingBox: true,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS],
  },
  {
    id: 'ukmo_global_deterministic_10km',
    // Auflösung NICHT im Etikett: sie steht seit der Umstellung an jedem
    // Eintrag automatisch dabei (`resolutionLabel`), sonst stünde „UKMO
    // Global 10 km — 10 km".
    label: 'UKMO Global',
    provider: 'UK Met Office',
    resolutionKm: 10,
    updateIntervalHours: 6,
    forecastHours: 168,
    coverage: 'global',
    supportsBoundingBox: true,
    availableVariables: BASE_VARS,
  },
  {
    id: 'ukmo_uk_deterministic_2km',
    label: 'UKMO UK 2 km',
    provider: 'UK Met Office',
    resolutionKm: 2,
    updateIntervalHours: 1,
    forecastHours: 54,
    coverage: { latMin: 44.9, lonMin: -13.9, latMax: 60.9, lonMax: 6.6 },
    supportsBoundingBox: true,
    availableVariables: BASE_VARS,
    selectable: false,
  },
  {
    // MeteoSwiss ICON-CH1 / ICON-CH2 — NUR im Föhn-Bereich angeboten
    // (`selectable: false`, dort über FOEHN_MODELS direkt referenziert). Live
    // geprüft (2026-09-14) sind ausschließlich die Größen unten, und nur an den
    // sieben Punkten der Föhnachsen (Bozen … Altdorf). KEINE Drucklevel
    // (`temperature_700hPa`/`wind_*_700hPa` durchgehend null). Für Meteogramm,
    // Karte und Verifikation fehlen weather_code, Bewölkung, is_day usw. — erst
    // live prüfen, dann `selectable` entfernen. Horizonte gemessen am letzten
    // Wert: CH1 Lauf 18 UTC → +33 h, CH2 Lauf 12 UTC → +120 h. Die Coverage ist
    // eine Näherung der ICON-CH-Domain (Alpenraum), nicht vermessen.
    id: 'meteoswiss_icon_ch1',
    label: 'ICON-CH1',
    provider: 'MeteoSchweiz',
    resolutionKm: 1,
    updateIntervalHours: 3,
    forecastHours: 33,
    coverage: { latMin: 42.5, lonMin: 0.5, latMax: 50.5, lonMax: 17.5 },
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
  {
    id: 'meteoswiss_icon_ch2',
    label: 'ICON-CH2',
    provider: 'MeteoSchweiz',
    resolutionKm: 2.1,
    updateIntervalHours: 6,
    forecastHours: 120,
    coverage: { latMin: 42.5, lonMin: 0.5, latMax: 50.5, lonMax: 17.5 },
    supportsBoundingBox: false,
    availableVariables: [...BASE_VARS, ...CONVECTION_VARS, ...PROB_VAR],
  },
]

/** Modelle, die in Auswahlen angeboten werden (siehe `selectable`). */
export const SELECTABLE_MODELS = MODELS.filter((m) => m.selectable !== false)

const byId = new Map(MODELS.map((m) => [m.id, m]))

export function getModel(id: string): ModelInfo {
  const m = byId.get(id)
  if (!m) throw new Error(`Unbekanntes Modell: ${id}`)
  return m
}

export function isInCoverage(model: ModelInfo, lat: number, lon: number): boolean {
  if (model.coverage === 'global') return true
  const c = model.coverage
  return lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
}

/**
 * Ende des Modellhorizonts als Epoch-ms. `forecastHours` zählt ab der INIT-Zeit
 * des Laufs, nicht ab Mitternacht — deshalb wird der geschätzte Lauf
 * (config/runs.ts) als Bezugspunkt genommen.
 *
 * Das war vorher der Session-Start, was den Horizont systematisch um die
 * Laufstunde zu früh ansetzte: live gemessen liefert ICON Global aus dem
 * 12-UTC-Lauf Daten bis +193 h ab Mitternacht, die alte Rechnung schnitt bei
 * +180 h ab — 13 Stunden vorhandener Vorhersage wurden weggeworfen.
 * Jenseits des Horizonts wird nicht extrapoliert (Karte: Meldung,
 * Meteogramm: Serienende).
 */
export function modelHorizonEnd(model: ModelInfo, now: number = Date.now()): number {
  // Auf das Zeitraster deckeln: die API liefert höchstens forecast_days=16 ab
  // Rasterbeginn, egal wie weit das Modell rechnet. Ohne den Deckel läge der
  // Horizont von GFS/best_match rechnerisch HINTER dem letzten Zeitschritt —
  // die Schraffur im Scrubber verspräche dann Daten, die es nicht gibt.
  return Math.min(TIME_RANGE.end, latestRun(model, now).initTime + model.forecastHours * STEP_MS)
}

/** Liegt die Domain vollständig in der Modellabdeckung? (Teilweise außerhalb → Multi-Location-Request schlägt fehl.) */
export function isDomainInCoverage(model: ModelInfo, bbox: BBox): boolean {
  if (model.coverage === 'global') return true
  const c = model.coverage
  return (
    bbox.latMin >= c.latMin &&
    bbox.latMax <= c.latMax &&
    bbox.lonMin >= c.lonMin &&
    bbox.lonMax <= c.lonMax
  )
}
