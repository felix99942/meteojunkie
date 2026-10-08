// Gemessene Radiosondenaufstiege für den Soundings-Bereich.
//
// Die Daten sind statische Assets (public/sondes/), erzeugt vom Ingest
// `scripts/sonde-ingest.mjs` im Deploy-Workflow — UWyo und der DWD senden
// keine CORS-Header, der Browser käme nicht heran (Begründung dort). Geladen
// wird same-origin wie die MOS-Vorhersage; kein Open-Meteo-Budget.

import type { SoundingColumn } from '../lib/sounding'
import type { LatLon } from '../state/workbench'

/** Ein Aufstieg im Index — die Werte selbst liegen in `file`. */
export interface SondeEntry {
  /** Nenntermin (00/12 UTC), ISO. */
  term: string
  /** Tatsächlicher Start (erster Messpunkt), ISO — bis zu 2 h neben dem Termin. */
  launch: string
  /** Oberster Messpunkt in hPa (≥ 100). Deutlich darüber = Ballon früh geplatzt. */
  top: number
  file: string
}

export interface SondeStation {
  id: string
  name: string
  country: string
  /** Startort laut Messung (erster Punkt), nicht aus einem Katalog. */
  lat: number
  lon: number
  /** Höhe des ersten Messpunkts (m). */
  elev: number
  /** Neuester Termin zuerst. */
  soundings: SondeEntry[]
}

export interface SondeIndex {
  generated: string
  source: string
  stations: SondeStation[]
}

/** Ein Aufstieg, ausgedünnt auf echte Messpunkte (Boden zuerst). */
export interface SondeData {
  id: string
  term: string
  launch: string
  lat: number
  lon: number
  p: number[]
  z: (number | null)[]
  T: number[]
  Td: (number | null)[]
  /** Herkunftsrichtung in Grad. */
  dir: (number | null)[]
  /** m/s */
  spd: (number | null)[]
}

/**
 * Bis zu dieser Entfernung wird die nächste Station AUTOMATISCH zum gewählten
 * Ort dazugenommen. Darüber nicht: ein Modellprofil in Salzburg gegen den
 * Aufstieg in München (120 km, andere Seite des Alpenrands) sähe wie ein
 * Modellfehler aus und ist keiner. Wählen kann man sie trotzdem.
 */
export const SONDE_AUTO_KM = 60

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

export async function loadSondeIndex(): Promise<SondeIndex | null> {
  const res = await fetch(assetUrl('sondes/index.json'))
  // Lokal ohne Ingest gibt es die Datei nicht — Vite liefert dann index.html
  // aus. Das ist kein Fehler, sondern „keine Messungen vorhanden".
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
  return (await res.json()) as SondeIndex
}

export async function loadSonde(file: string): Promise<SondeData> {
  const res = await fetch(assetUrl(`sondes/${file}`))
  if (!res.ok) throw new Error(`Aufstieg ${file}: HTTP ${res.status}`)
  return (await res.json()) as SondeData
}

/** Großkreisabstand in km. */
export function distanceKm(a: LatLon, b: { lat: number; lon: number }): number {
  const R = 6371
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Nächste Station mit mindestens einem Aufstieg, samt Entfernung. */
export function nearestSonde(
  stations: SondeStation[],
  loc: LatLon,
): { station: SondeStation; km: number } | null {
  let best: { station: SondeStation; km: number } | null = null
  for (const s of stations) {
    if (!s.soundings.length) continue
    const km = distanceKm(loc, s)
    if (!best || km < best.km) best = { station: s, km }
  }
  return best
}

/**
 * Aufstieg → Sondierungsspalte, dieselbe Form wie aus einem Modellprofil.
 * Damit laufen Kurven, Kennzahlen und θe durch DIESELBE Rechnung wie bei den
 * Modellen — ein Vergleich, bei dem die Messung anders gerechnet würde, wäre
 * keiner.
 *
 * Punkte ohne Taupunkt fallen heraus (die Spalte verlangt beides, wie bei den
 * Modellen): in grosser Höhe meldet die Feuchtesonde oft nichts mehr. Der
 * Wind bleibt an den übrigen Punkten erhalten.
 */
export function sondeColumn(d: SondeData): SoundingColumn | null {
  const col: SoundingColumn = { p: [], T: [], Td: [], z: [], u: [], v: [] }
  for (let i = 0; i < d.p.length; i++) {
    const td = d.Td[i]
    if (td == null || d.T[i] == null) continue
    col.p.push(d.p[i])
    col.T.push(d.T[i])
    col.Td.push(td)
    col.z.push(d.z[i] ?? null)
    const spd = d.spd[i]
    const dir = d.dir[i]
    if (spd == null || dir == null) {
      col.u.push(null)
      col.v.push(null)
    } else {
      // Wind weht AUS `dir` — der Vektor zeigt in die Gegenrichtung.
      const rad = (dir * Math.PI) / 180
      col.u.push(-spd * Math.sin(rad))
      col.v.push(-spd * Math.cos(rad))
    }
  }
  return col.p.length >= 3 ? col : null
}

/** „12 UTC" bzw. „gestern 12 UTC"/„02.10. 12 UTC" — Termin mit Tagesbezug. */
export function formatTerm(iso: string, now = Date.now()): string {
  const t = new Date(iso)
  const hh = String(t.getUTCHours()).padStart(2, '0')
  const day = (ms: number) => Math.floor(ms / 86_400_000)
  const diff = day(now) - day(t.getTime())
  const prefix =
    diff === 0
      ? 'heute'
      : diff === 1
        ? 'gestern'
        : `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')}.`
  return `${prefix} ${hh} UTC`
}

/** Startzeit als „11:30 UTC". */
export function formatLaunch(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`
}

/**
 * Spalte auf Punkte im Abstand von mindestens `stepHpa` ausdünnen (Boden
 * bleibt). Für die DARSTELLUNG, nicht die Rechnung: eine hochaufgelöste Sonde
 * hat alle 2 hPa einen Punkt — als Windfiedern ein Klumpen, und die
 * θe-Schichtung würde von Schicht zu Schicht das Vorzeichen wechseln (Messrauschen
 * über 20 m), statt die Schichten zu zeigen, um die es geht.
 */
export function thinColumn(col: SoundingColumn, stepHpa: number): SoundingColumn {
  const out: SoundingColumn = { p: [], T: [], Td: [], z: [], u: [], v: [] }
  let last = Infinity
  for (let i = 0; i < col.p.length; i++) {
    if (out.p.length && col.p[i] > last - stepHpa) continue
    last = col.p[i]
    out.p.push(col.p[i])
    out.T.push(col.T[i])
    out.Td.push(col.Td[i])
    out.z.push(col.z[i])
    out.u.push(col.u[i])
    out.v.push(col.v[i])
  }
  return out
}
