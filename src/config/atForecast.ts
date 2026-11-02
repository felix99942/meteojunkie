// Registry der MOS-Vorhersageparameter (Vorhersage-Modus der Klimakarte).
// Schlüssel = Dateiname unter public/mos/forecast/. Farbskalen aus dem
// validierten Bestand wiederverwendet; Sonnenschein (min/h) neu.

import { COLOR_SCALES, type ColorScale } from './colorscales'

export interface ForecastSpec {
  key: string
  label: string
  unit: string
  /** hourly → Zeitschieber; daily → Tageswahl (Tmin/Tmax). */
  kind: 'hourly' | 'daily'
  scale: ColorScale
}

// Sonnenscheindauer je Stunde (0–60 min): sequenziell dunkel→hellgelb.
const SUN_MIN_SCALE: ColorScale = {
  kind: 'stepped',
  stops: [
    { value: 1, color: '#5a4a00' },
    { value: 10, color: '#8a6f00' },
    { value: 20, color: '#b38a00' },
    { value: 30, color: '#d6a300' },
    { value: 40, color: '#efc23a' },
    { value: 50, color: '#f5d670' },
    { value: 60, color: '#f8e59a' },
  ],
}

export const FORECAST_PARAMS: ForecastSpec[] = [
  { key: 't2m', label: 'Temperatur 2 m', unit: '°C', kind: 'hourly', scale: COLOR_SCALES.temperature_2m },
  {
    key: 'feels',
    label: 'Gefühlte Temperatur',
    unit: '°C',
    kind: 'hourly',
    scale: COLOR_SCALES.temperature_2m,
  },
  { key: 'tmax', label: 'Tagesmaximum', unit: '°C', kind: 'daily', scale: COLOR_SCALES.temperature_2m },
  { key: 'tmin', label: 'Tagesminimum', unit: '°C', kind: 'daily', scale: COLOR_SCALES.temperature_2m },
  { key: 'precip', label: 'Niederschlag (1 h)', unit: 'mm', kind: 'hourly', scale: COLOR_SCALES.precipitation },
  { key: 'sun', label: 'Sonnenschein (1 h)', unit: 'min', kind: 'hourly', scale: SUN_MIN_SCALE },
  { key: 'cloud', label: 'Bewölkung', unit: '%', kind: 'hourly', scale: COLOR_SCALES.cloud_cover },
  { key: 'wind', label: 'Wind', unit: 'km/h', kind: 'hourly', scale: COLOR_SCALES.wind_speed_10m },
]

/**
 * WIE ALT IST DIE VORHERSAGE?
 *
 * Die Vorhersage-JSONs liegen NICHT im Repo (siehe CLAUDE.md, MOS-Abschnitt),
 * sie entstehen beim Bauen — auf der ausgelieferten Seite alle drei Stunden
 * per Cron, lokal nur, wenn jemand `ingest:mos:forecast` laufen lässt.
 * Lokal stand deshalb wochenlang ein Lauf vom 18.08. im Bild, und **man sah
 * es nicht**: die Laufangabe war auf die reine Uhrzeit formatiert, ein sechs
 * Wochen alter Lauf sah aus wie der von heute. Aufgefallen ist es nur, weil
 * Tmin/Tmax Datumsangaben tragen.
 *
 * Auf der Seite kann derselbe Fall auftreten: `deploy.yml` lässt den Ingest
 * mit `continue-on-error` laufen — fällt DWD aus, deployt der Build ohne
 * frische Daten weiter.
 *
 * `expired` = der letzte Zeitschritt liegt in der Vergangenheit, die
 * Vorhersage ist verbraucht. `old` = der Lauf ist älter als
 * `STALE_RUN_HOURS`, reicht aber noch in die Zukunft.
 */
export type ForecastFreshness = 'fresh' | 'old' | 'expired'

/**
 * Ab wann ein Lauf als alt gilt. MOSMIX rechnet ~4×/Tag, der Deploy-Cron
 * läuft alle 3 h — zwölf Stunden sind damit zwei verpasste Zyklen und kein
 * Zufallsschwanken.
 */
export const STALE_RUN_HOURS = 12

export function forecastFreshness(runMs: number, lastStepMs: number, now: number): ForecastFreshness {
  if (Number.isFinite(lastStepMs) && lastStepMs < now) return 'expired'
  if (Number.isFinite(runMs) && now - runMs > STALE_RUN_HOURS * 3_600_000) return 'old'
  return 'fresh'
}

export function getForecastSpec(key: string): ForecastSpec {
  const s = FORECAST_PARAMS.find((p) => p.key === key)
  if (!s) throw new Error(`Unbekannter Vorhersageparameter: ${key}`)
  return s
}

// --- Ausdünnung der Stationen nach Zoom ----------------------------------------
//
// In DEUTSCHLAND sind die Stationen für die ÜBERSICHT zu dicht (auf Wunsch,
// 2026-11-02): 2.614 der 3.060 MOSMIX-Punkte liegen dort. In der Übersicht
// steht deshalb das STATIONSNETZ (WMO-Synopstationen, fünfstellige Kennung),
// die deutschen Zusatzpunkte kommen erst beim Hineinzoomen. ÖSTERREICH, die
// Schweiz und alle übrigen Länder zeigen IMMER alle Stationen — dort ist das
// Netz nicht zu dicht. Das Land steht im Katalog (`country`, im Ingest aus den
// Natural-Earth-Grenzen); Punkte auf See (null) zählen zu Deutschland, es
// sind die Seewetterpunkte in Nord- und Ostsee.
//
// Eine erste Fassung zeigte in der Übersicht nur Flughäfen und Bergstationen
// (195) — eine „komische Vorauswahl", Städte wie Würzburg fehlten.

export type MosTier = 0 | 1

/** Ab welchem Zoomfaktor der Karte eine Stufe erscheint */
export const MOS_TIER_ZOOM: Record<MosTier, number> = { 0: 1, 1: 3 }

export function mosStationTier(s: { id: string; country?: string | null }): MosTier {
  if (/^\d{5}$/.test(s.id)) return 0
  return s.country === 'DEU' || s.country == null ? 1 : 0
}
