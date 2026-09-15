// Mock-Szenario „Föhnorkan" (?mock=foehn) — reiner Rechenkern, kein `window`,
// kein Netz, deshalb aus `mock.ts` herausgezogen und mit Vitest geprüft
// (`mockFoehn.test.ts` rechnet die echten Föhnkriterien darauf).
//
// WARUM es das braucht: das Grundfeld des Mocks ist eine glatte Funktion von
// Länge und Breite. Der Druckunterschied zwischen Bozen und Innsbruck (0,76°
// Breite) kommt darin auf ~0,2 hPa — der Föhn-Bereich zeigt mit ?mock=1 also
// nie Föhn, und weder Kriterienleiste noch Wahrscheinlichkeit noch die
// Farbgebung der Plume lassen sich ansehen. Dieses Szenario legt eine
// zeitlich begrenzte EPISODE über das Grundfeld.
//
// Aufgebaut wird sie GEOGRAFISCH, nicht pro Punkt: alles hängt an der Lage
// relativ zum Alpenhauptkamm (`crestLat`, aus den Kammpunkten der echten
// Achsen interpoliert). Damit gilt das Szenario für BEIDE Föhnachsen
// (Bozen–Innsbruck und Lugano–Zürich) und für jeden weiteren Punkt, ohne
// Sonderfälle — und die Lee-Größen stimmen automatisch mit dem Lee-Punkt
// zusammen, den die Registry für die Richtung vorsieht.
//
// Gebaut ist SÜDföhn: Hochdruck südlich des Kamms, Nordseite trocken, warm und
// stürmisch. Nordföhn zeigt damit korrekt KEINEN Föhn (das Vorzeichen von ΔP
// dreht) — auch das ist ein Testfall, kein Mangel.

import { FOEHN_AXES } from '../config/foehn'

/**
 * Zeitfenster der Episode in Stunden ab Rasterbeginn (heute 00 UTC).
 *
 * Bewusst NICHT bei 0 beginnend: die Kriterienleiste, die Phasen im Überblick
 * und der Sprung „kein Föhn → Föhn → kein Föhn" sind nur zu sehen, wenn es
 * davor und danach ruhig ist. Das Ende liegt hinter dem Horizont der kurzen
 * Lokalmodelle (ICON-CH1: 33 h), damit auch der ausgegraute Außenbereich in
 * die Episode fällt.
 */
export const FOEHN_EPISODE = { startH: 14, peakH: 30, endH: 50 }

/** Spitzenwert des Druckgradienten-Parameters — ergibt ΔP ~16 hPa auf der Tiroler Achse. */
const DP_AMPLITUDE = 21

/**
 * Breite des Übergangs am Kamm in Grad. Klein genug, dass Bozen und Innsbruck
 * (je ~0,3–0,5° vom Kamm) schon deutlich im jeweiligen Vorzeichen liegen —
 * mit einem weichen Übergang bliebe von 21 hPa an den Achsenpunkten kaum die
 * Hälfte übrig.
 */
const CREST_WIDTH_DEG = 0.35

/** Region, in der das Szenario überhaupt greift — der Alpenraum der Achsen. */
const REGION = { latMin: 44.5, latMax: 49.5, lonMin: 6, lonMax: 14 }

/**
 * Breite des Alpenhauptkamms auf diesem Längengrad, linear durch die
 * Kammpunkte der echten Achsen (Gotthard 46,56°/8,56° → Brenner
 * 47,00°/11,51°). Der Kamm steigt nach Osten — eine Konstante hätte Lugano und
 * Bozen auf verschiedenen Seiten derselben Linie liegen lassen.
 */
export function crestLat(lon: number): number {
  const crests = FOEHN_AXES.map((a) => a.crest).sort((a, b) => a.lon - b.lon)
  const a = crests[0]
  const b = crests[crests.length - 1]
  const slope = (b.lat - a.lat) / (b.lon - a.lon)
  return a.lat + (lon - a.lon) * slope
}

/**
 * Stärke der Episode zum Zeitpunkt `t` (Stunden ab Rasterbeginn), 0…1.
 * Angehobene Kosinuskurve statt Rechteck: ein harter Ein-/Ausschalter machte
 * aus dem Druckverlauf eine Stufe, und die Phasenerkennung im Überblick soll
 * an einem realistischen An- und Abschwellen geprüft werden.
 */
export function episodeStrength(t: number): number {
  const { startH, peakH, endH } = FOEHN_EPISODE
  if (t <= startH || t >= endH) return 0
  const half = t < peakH ? (t - startH) / (peakH - startH) : (endH - t) / (endH - peakH)
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, half)))
}

/** −1 (weit nördlich des Kamms) … +1 (weit südlich). */
function southness(lat: number, lon: number): number {
  return Math.tanh((crestLat(lon) - lat) / CREST_WIDTH_DEG)
}

/** 0…1, nur nördlich des Kamms — die Lee-Seite bei Südföhn. */
function leeWeight(lat: number, lon: number): number {
  return Math.max(0, Math.min(1, (lat - crestLat(lon) + 0.15) / 0.3))
}

/** 0…1, nur südlich des Kamms — die Stauseite bei Südföhn. */
function stauWeight(lat: number, lon: number): number {
  return Math.max(0, Math.min(1, (crestLat(lon) - lat + 0.15) / 0.4))
}

const mix = (base: number, target: number, w: number) => base * (1 - w) + target * w

/**
 * Szenario-Wert für eine Variable, oder `null` wenn das Szenario sie nicht
 * anfasst (dann gilt das Grundfeld des Mocks).
 *
 * `base` ist der Grundfeldwert: die meisten Größen werden ÜBERBLENDET, nicht
 * ersetzt — außerhalb der Episode und außerhalb der Region kommt exakt das
 * Grundfeld heraus, der Rest des Mocks bleibt also unverändert.
 */
export function foehnOverride(
  variable: string,
  lat: number,
  lon: number,
  t: number,
  base: number,
): number | null {
  if (lat < REGION.latMin || lat > REGION.latMax) return null
  if (lon < REGION.lonMin || lon > REGION.lonMax) return null
  const env = episodeStrength(t)
  if (env <= 0) return null

  const lee = leeWeight(lat, lon) * env
  const stau = stauWeight(lat, lon) * env

  switch (variable) {
    // Der Kern: Hochdruck südlich, Tief nördlich des Kamms. Als ANOMALIE auf
    // das Grundfeld, damit der Verlauf nicht künstlich glatt wird.
    case 'pressure_msl':
      return base + 0.5 * DP_AMPLITUDE * env * southness(lat, lon)

    // Der Mock hat kein Geländemodell; im Alpenraum sind die Achsenpunkte
    // Talstationen um 300–600 m. Fester Abzug, damit θ überhaupt rechenbar
    // ist (ohne diesen Fall lieferte der Mock hier ±10 hPa, und Δθ war Unsinn).
    case 'surface_pressure':
      return base + 0.5 * DP_AMPLITUDE * env * southness(lat, lon) - 60

    // Lee: Föhnluft ist warm und trocken, Stauseite bleibt kühl und feucht.
    case 'temperature_2m':
      return base + 9 * lee - 2 * stau
    case 'relative_humidity_2m':
      return mix(base, 16, lee) + 30 * stau

    // Lee: Orkanböen. 140 km/h sind Orkanstärke (≥ 118 km/h) und damit über
    // jeder Skalenobergrenze, die die Kachel voreinstellt — genau das soll
    // prüfbar sein.
    case 'wind_speed_10m':
      return mix(base, 78, lee)
    case 'wind_gusts_10m':
      return mix(base, 142, lee)
    // Südwind im Lee (Talauswind aus dem Wipptal/Reusstal).
    case 'wind_direction_10m':
      return lee > 0.5 ? 195 : null

    // Kamm: kräftige Südwest-Anströmung auf 700 hPa. Die Richtung MUSS im
    // Sektor SO–WSW liegen, sonst ist das Kammkriterium nicht erfüllt.
    case 'wind_speed_700hPa':
      return mix(base, 115, env)
    case 'wind_direction_700hPa':
      return env > 0.25 ? 205 : null
    // Etwas milder als das Grundprofil — sonst bleibt Δθ Tal − 700 hPa
    // negativ und das Durchmischungskriterium meldet „nicht erfüllt",
    // obwohl der Rest Orkan zeigt.
    case 'temperature_700hPa':
      return base + 3 * env

    // Stau auf der Südseite: der Niederschlag in der Kamm-Kachel ist genau
    // das, was man bei Föhn dort sehen will.
    case 'precipitation':
      return base + 4.5 * stau
    case 'cloud_cover':
      return mix(base, 95, stau * 0.9) * (1 - 0.75 * lee)

    default:
      return null
  }
}
