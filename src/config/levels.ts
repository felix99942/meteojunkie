// Drucklevel für Vertikalprofile / Skew-T.
//
// Open-Meteo liefert Grössen pro Drucklevel als eigene Hourly-Variablen, z. B.
// `temperature_850hPa`, `relative_humidity_850hPa`, `wind_speed_850hPa`,
// `wind_direction_850hPa`, `geopotential_height_850hPa`.
//
// ALLES HIER IST LIVE GEMESSEN (2026-09-20, Innsbruck 47,26 N / 11,39 O, je
// Modell alle 19 Level abgefragt und die nicht-leeren gezählt) — vorher stand
// hier ein Arbeitsstand aus der Doku, der in BEIDE Richtungen falsch war:
// fünf Modelle mit Druckleveln fehlten, und von den eingetragenen liefert
// keines alle 19 Level.

/** Drucklevel in hPa, absteigend (Boden → Höhe) — Reihenfolge = Plotreihenfolge. */
export const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30,
] as const

export type PressureLevel = (typeof PRESSURE_LEVELS)[number]

/** Drucklevel-Grössen, die ein Skew-T braucht. */
export const PROFILE_VARIABLES = [
  'temperature',
  'relative_humidity',
  'wind_speed',
  'wind_direction',
  'geopotential_height',
] as const

export type ProfileVariable = (typeof PROFILE_VARIABLES)[number]

/** Open-Meteo-Variablenname für Grösse × Level, z. B. temperature_850hPa. */
export function levelVar(variable: ProfileVariable, level: number): string {
  return `${variable}_${level}hPa`
}

export interface PressureLevelSupport {
  /** Zahl der gelieferten Level aus PRESSURE_LEVELS (von 19). */
  levels: number
  /** Oberstes geliefertes Level in hPa — DARÜBER endet das Profil. */
  topHpa: number
}

/**
 * Modelle mit Druckleveln, je mit dem GEMESSENEN Umfang.
 *
 * DIE LEVELLISTE IST MODELLABHÄNGIG, und das ist keine Feinheit: ECMWF
 * IFS/AIFS liefern nur 13 der 19 Level — es fehlen 975, 950, 900, 800, 70 und
 * 30 hPa, also gerade die untere Feinstruktur, auf die es bei einer Inversion
 * ankommt. ICON-D2 endet bei 200 hPa, hat dafür unten alle Level. Der Parser
 * in `fetchProfile` wirft leere Level ohnehin weg, die Angabe dient der
 * Einordnung: ein Profil, das bei 200 hPa aufhört, ist kein Fehler.
 *
 * NICHT DRUCKLEVELFÄHIG, ebenfalls gemessen (alle 19 Level durchgehend null,
 * HTTP 200 — die Falle aus SPEC §6): `geosphere_arome_austria`,
 * `meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`. Bei den beiden ICON-CH deckt
 * sich das mit dem Befund im Ensemble-Bereich; nicht erneut aus der Doku
 * ergänzen.
 *
 * DASS AROME FRANCE UND ICON-D2 DABEI SIND, IST DER GEWINN: mit 1,5 bzw.
 * 2,2 km stehen damit erstmals LOKALmodelle im Skew-T, und nur bei ihnen ist
 * die Abdeckungsgrenze auf der Ortswahl-Karte überhaupt eine Einschränkung —
 * die übrigen decken halb Europa ab.
 */
const PRESSURE_LEVEL_MODELS = new Map<string, PressureLevelSupport>([
  ['best_match', { levels: 19, topHpa: 30 }],
  ['icon_seamless', { levels: 19, topHpa: 30 }],
  ['icon_global', { levels: 19, topHpa: 30 }],
  ['icon_eu', { levels: 18, topHpa: 50 }],
  // Konvektionsmodell: unten vollständig, oben bei 200 hPa zu Ende.
  ['icon_d2', { levels: 14, topHpa: 200 }],
  ['gfs_seamless', { levels: 19, topHpa: 30 }],
  ['gfs_global', { levels: 19, topHpa: 30 }],
  ['ecmwf_ifs025', { levels: 13, topHpa: 50 }],
  ['ecmwf_aifs025_single', { levels: 13, topHpa: 50 }],
  ['meteofrance_arpege_europe', { levels: 15, topHpa: 100 }],
  ['meteofrance_arome_france', { levels: 15, topHpa: 100 }],
  ['ukmo_global_deterministic_10km', { levels: 19, topHpa: 30 }],
])

export function supportsPressureLevels(modelId: string): boolean {
  return PRESSURE_LEVEL_MODELS.has(modelId)
}

/** Gemessener Levelumfang eines Modells, oder null wenn es keine liefert. */
export function pressureLevelSupport(modelId: string): PressureLevelSupport | null {
  return PRESSURE_LEVEL_MODELS.get(modelId) ?? null
}

/** Alle Modell-IDs mit Druckleveln (Reihenfolge der Registry oben). */
export function pressureLevelModelIds(): string[] {
  return [...PRESSURE_LEVEL_MODELS.keys()]
}
