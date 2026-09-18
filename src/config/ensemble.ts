// Registry des Ensemble-Modus (SPEC §9 Phase 3).
//
// ALLES HIER IST LIVE GEGEN DIE API GEPRÜFT (SPEC §6), nicht aus der Doku
// übernommen — Stand 2026-07-31, GEFS ergänzt 2026-08-17:
//   ecmwf_ifs025  → 51 Mitglieder (Kontrolllauf + member01…50), 15 Tage
//   ecmwf_aifs025 → 51 Mitglieder, 15 Tage (KI-Modell)
//   gfs_seamless  → 31 Mitglieder (Kontrolllauf + member01…30), Horizont live
//                   819 h ≈ 34 Tage; alle zehn Variablen unten vollständig
//   ecmwf_ifs04   → liefert nur noch EIN Mitglied, deshalb hier nicht geführt
// Die 9-km-Europa-Ensembles der Doku sind über die freie API unter keiner ID
// erreichbar (Professional/self-hosted).
//
// GEFS-Auflösung: `gfs_seamless` ist der Blend und dominiert die Einzeldomains —
// live geprüft ist es in den ersten 240 h Wert für Wert identisch mit `gfs025`
// (0,25°) und wechselt danach auf `gfs05` (0,5°). Deshalb genau EIN GEFS-Eintrag
// statt drei: `gfs025` endet bei 255 h, `gfs05` ist früh gröber.
//
// **Eine KI-Version des GFS gibt es nicht** (Stand 2026-08-17, live geprüft):
// `gfs_graphcast025` wird als ID zwar angenommen, liefert aber sowohl auf der
// Ensemble- als auch auf der Forecast-API durchgehend null — der klassische
// „HTTP 200 mit leeren Arrays"-Fall aus SPEC §6. `gencast025`, `graphcast025`,
// `gfs_aifs025` und `noaa_gefs_ai` sind gar keine gültigen IDs. Die einzige
// verfügbare KI-Ensemble-Alternative bleibt ECMWF AIFS.
//
// KOSTEN (SPEC §5): Die Ensemble-API liefert keine Kosten-Header und die Doku
// sagt zu Mitgliedern nichts Genaues. Wir rechnen konservativ mit „Mitglied =
// Variable" (~10 Variablen ≈ 1 Call), also ~5 Calls je Punktabruf. Punktweise
// ist das billig (0,05 % des Tagesbudgets); ein FELD wäre es nicht: das
// Österreich-Gitter mit 480 Punkten käme auf ~7.200 Calls = 72 % des
// Tagesbudgets — pro Feld. Deshalb ist der Ensemble-Modus punktbasiert und
// bekommt bewusst keine Kartenvariante.


export interface EnsembleModelInfo {
  id: string
  label: string
  /** Mitglieder inkl. Kontrolllauf (live gezählt). */
  members: number
  /** Horizont in Tagen (forecast_days-Maximum der Ensemble-API). */
  forecastDays: number
  /**
   * Horizont des deterministischen Hauptlaufs in Tagen — SEPARAT, weil die
   * normale Forecast-API bei 16 Tagen hart deckelt („Allowed range 0 to 16",
   * live geprüft). GEFS läuft im Ensemble weiter als sein Hauptlauf reichen
   * kann; mit `forecastDays` für beide Abrufe scheitert der Hauptlauf-Request
   * komplett. Kürzere Reihe ist richtig — das Panel lässt sie enden, statt zu
   * extrapolieren (SPEC §8).
   */
  deterministicDays: number
  updateIntervalHours: number
  resolutionKm: number
  /**
   * Modell-ID des zugehörigen DETERMINISTISCHEN Laufs (Hauptlauf) auf der
   * normalen Forecast-API. Das Ensemble liefert ihn nicht mit — seine
   * suffixlose Reihe ist der Kontrolllauf, nicht der Hauptlauf.
   */
  deterministicModel: string
  /**
   * Die Größen, die dieses Ensemble WIRKLICH liefert — alle live gemessen
   * (2026-09-16, Innsbruck, je ein Abruf über alle Kandidaten).
   *
   * Nötig, weil die API fehlende Größen NICHT als Fehler meldet: sie
   * antwortet mit HTTP 200 und lauter `null` (die Falle aus SPEC §6). Ohne
   * diese Liste stand im Dropdown jede Größe für jedes Modell, und die Plume
   * öffnete sich leer — bei AIFS heute schon für Böen und CAPE, bei den
   * ICON-Ensembles für 850 hPa und 500 hPa, also ausgerechnet für den
   * STARTparameter des Bereichs.
   *
   * Gemessen fehlen:
   *   AIFS             wind_gusts_10m, cape (wie beim deterministischen AIFS)
   *   ICON-EU-EPS      dew_point_2m, temperature_850hPa, geopotential_500hPa
   *   ICON Seamless    temperature_850hPa, geopotential_500hPa
   *   ICON-CH1/CH2     temperature_850hPa, geopotential_500hPa
   * Alles andere liefern alle. `dew_point_2m` steht (noch) nicht in
   * ENSEMBLE_VARIABLES, ist hier aber der Vollständigkeit wegen mit erfasst.
   */
  availableVariables: string[]
  note: string
}

/** Die neun Größen, die IFS, GEFS und ICON-D2-EPS vollständig liefern. */
const ENS_ALL = [
  'temperature_2m',
  'precipitation',
  'snowfall',
  'wind_speed_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'pressure_msl',
  'cape',
  'temperature_850hPa',
  'geopotential_height_500hPa',
]
/** Ohne Drucklevel — alle ICON-Ensembles ausser D2 (live gemessen). */
const ENS_NO_LEVELS = ENS_ALL.filter(
  (v) => v !== 'temperature_850hPa' && v !== 'geopotential_height_500hPa',
)

export const ENSEMBLE_MODELS: EnsembleModelInfo[] = [
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS ENS',
    members: 51,
    forecastDays: 15,
    deterministicDays: 15,
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'ecmwf_ifs025',
    availableVariables: ENS_ALL,
    note: 'Physikalisches ECMWF-Ensemble, 0,25°. Nativ 3-stündlich (ab +144 h 6-stündlich), von Open-Meteo auf 1 h interpoliert.',
  },
  {
    id: 'ecmwf_aifs025',
    label: 'ECMWF AIFS ENS (KI)',
    members: 51,
    forecastDays: 15,
    deterministicDays: 15,
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'ecmwf_aifs025_single',
    // Gemessen: Böen und CAPE durchgehend null — genau wie beim
    // deterministischen AIFS (siehe config/models.ts).
    availableVariables: ENS_ALL.filter((v) => v !== 'wind_gusts_10m' && v !== 'cape'),
    note: 'KI-Ensemble von ECMWF, 0,25°. Nativ 6-stündlich. Interessant als zweite Meinung zum IFS — nicht als Ersatz.',
  },
  {
    id: 'gfs_seamless',
    label: 'NOAA GEFS',
    members: 31,
    // Ensemble-API akzeptiert 35; der Blend endet live bei 819 h (~34 Tage).
    // Die volle Länge erreicht nur der 00-UTC-Lauf, die übrigen enden bei
    // ~384 h — das Panel lässt die Reihen dann enden (SPEC §8).
    forecastDays: 35,
    deterministicDays: 16, // Maximum der Forecast-API, siehe deterministicDays
    updateIntervalHours: 6,
    resolutionKm: 25,
    deterministicModel: 'gfs_seamless',
    availableVariables: ENS_ALL,
    note: 'NOAA GEFS, 31 Mitglieder. Seamless: bis +240 h 0,25°, danach 0,5° bis ~34 Tage. Deutlich weniger Mitglieder als ECMWF, dafür der einzige Weg über 15 Tage hinaus. Der deterministische Hauptlauf endet bei 16 Tagen (API-Grenze).',
  },
  /**
   * Das erste LOKALensemble hier — 2,2 km gegen 25 km der drei Globalen.
   *
   * Steht ANS ENDE, weil `DEFAULT_ENSEMBLE_MODEL` = `ENSEMBLE_MODELS[0]` ist:
   * als Voreinstellung wäre ein 48-h-Ensemble falsch, eine Plume lebt von der
   * Auffächerung über Tage. Als WAHL ist es dafür das Interessanteste, was die
   * Liste hat — Streuung auf der Skala, die Täler auflöst.
   *
   * Live geprüft (2026-09-16, Innsbruck): 20 Reihen, ALLE neun
   * Ensemble-Größen vorhanden, auch `temperature_850hPa` und
   * `geopotential_height_500hPa`. Damit braucht es keine Größen-Beschränkung
   * je Modell — anders als ICON-CH1-EPS/CH2-EPS, die beide Drucklevel
   * durchgehend `null` liefern (HTTP 200, die Falle aus SPEC §6) und deshalb
   * weiterhin nur im Föhn-Bereich stehen, wo `pressure_msl` genügt.
   *
   * Horizont gemessen: letzter Wert bei +61 h ab Rasterbeginn, vom
   * 12-UTC-Lauf also die ~48 h des deterministischen ICON-D2.
   */
  {
    id: 'icon_d2_eps',
    label: 'ICON-D2-EPS',
    members: 20,
    forecastDays: 3,
    deterministicDays: 3,
    updateIntervalHours: 3,
    resolutionKm: 2.2,
    deterministicModel: 'icon_d2',
    // Das EINZIGE ICON-Ensemble mit Druckleveln (live gemessen).
    availableVariables: ENS_ALL,
    note: 'DWD ICON-D2-EPS, 20 Mitglieder auf 2,2 km — das einzige Lokalensemble hier. Reicht nur ~48 h, löst dafür Täler und Konvektion auf: brauchbar für die Frage, wie sicher ein Gewittertag oder ein Föhndurchbruch ist, nicht für die Wochentendenz. Alle Größen inklusive 850 hPa live geprüft.',
  },
  /**
   * ICON-EU-EPS — mit 40 Mitgliedern das mitgliederstärkste Ensemble hier
   * nach den beiden ECMWF-Läufen, und das einzige REGIONALE.
   *
   * ACHTUNG bei der ID: auf dem Ensemble-Endpunkt heißt es `icon_eu`, also
   * wie das deterministische Modell — und `icon_eu_eps` ist ein ALIAS darauf
   * (live geprüft: Wert für Wert identisch). Dieselbe Sorte Falle wie bei
   * AIFS, nur umgekehrt: dort sind zwei IDs NICHT austauschbar, hier sind
   * zwei Namen dasselbe.
   *
   * Horizont gemessen: letzter Wert bei +133 h ab Rasterbeginn, vom
   * geschätzten 09-UTC-Lauf also die ~120 h des deterministischen ICON-EU.
   */
  {
    id: 'icon_eu',
    label: 'ICON-EU-EPS',
    members: 40,
    forecastDays: 6,
    deterministicDays: 6,
    updateIntervalHours: 6,
    resolutionKm: 7,
    deterministicModel: 'icon_eu',
    availableVariables: ENS_NO_LEVELS,
    note: 'DWD ICON-EU-EPS, 40 Mitglieder auf 7 km, ~120 h. Das mitgliederstärkste Ensemble nach den ECMWF-Läufen und das einzige regionale: feiner als die Globalen, deutlich länger als ICON-D2-EPS. KEINE Drucklevel — 850 hPa und 500 hPa liefert es durchgehend null (live geprüft).',
  },
  /**
   * ICON Seamless EPS — der Blend: startet Wert für Wert wie ICON-EU-EPS und
   * läuft bis ~192 h weiter (live geprüft, dieselbe Bauart wie GFS Seamless).
   * Deshalb genau EIN Eintrag dafür und NICHT zusätzlich `icon_global`: das
   * liefert bei gleichem Horizont weder Böen noch Drucklevel und brächte
   * nichts Eigenes.
   */
  {
    id: 'icon_seamless',
    label: 'ICON Seamless EPS',
    members: 40,
    forecastDays: 8,
    deterministicDays: 8,
    updateIntervalHours: 6,
    resolutionKm: 0,
    deterministicModel: 'icon_seamless',
    availableVariables: ENS_NO_LEVELS,
    note: 'DWD ICON Seamless EPS, 40 Mitglieder, ~192 h. Blend: früh ICON-EU (7 km), später ICON Global (13 km) — die Auflösung ist deshalb variabel. KEINE Drucklevel (live geprüft).',
  },
  /**
   * Die beiden MeteoSchweiz-Lokalensembles. Der Föhn-Bereich benutzt sie über
   * seine eigene Registry (`config/foehn.ts`); hier stehen sie für die
   * allgemeine Plume. Feinste Gitter der Liste, dafür die kürzesten Reihen
   * und die wenigsten Mitglieder.
   */
  {
    id: 'meteoswiss_icon_ch2_ensemble',
    label: 'ICON-CH2-EPS',
    members: 21,
    forecastDays: 6,
    deterministicDays: 6,
    updateIntervalHours: 6,
    resolutionKm: 2.1,
    deterministicModel: 'meteoswiss_icon_ch2',
    availableVariables: ENS_NO_LEVELS,
    note: 'MeteoSchweiz ICON-CH2-EPS, 21 Mitglieder auf 2,1 km, ~120 h. KEINE Drucklevel (live geprüft). Im Föhn-Bereich die Voreinstellung für die ΔP-Plume.',
  },
  {
    id: 'meteoswiss_icon_ch1_ensemble',
    label: 'ICON-CH1-EPS',
    members: 11,
    forecastDays: 3,
    deterministicDays: 3,
    updateIntervalHours: 3,
    resolutionKm: 1,
    deterministicModel: 'meteoswiss_icon_ch1',
    availableVariables: ENS_NO_LEVELS,
    note: 'MeteoSchweiz ICON-CH1-EPS, 11 Mitglieder auf 1 km — das feinste Gitter hier, dafür die wenigsten Mitglieder und nur ~33 h. Mit 11 Mitgliedern ist eine Wahrscheinlichkeit grob gestuft: ein Mitglied sind 9 Prozentpunkte. KEINE Drucklevel (live geprüft).',
  },
]

export const DEFAULT_ENSEMBLE_MODEL = ENSEMBLE_MODELS[0].id

export function getEnsembleModel(id: string): EnsembleModelInfo {
  return ENSEMBLE_MODELS.find((m) => m.id === id) ?? ENSEMBLE_MODELS[0]
}

export interface EnsembleVariableInfo {
  id: string
  label: string
  unit: string
  /**
   * `accum` = Größe, die über die Vorhersagezeit aufsummiert dargestellt wird
   * (Niederschlag/Schneefall). Stundenwerte als Spaghetti sind hier unlesbar;
   * die Summenkurve ist die Größe, um die es geht.
   */
  kind: 'instant' | 'accum'
  /** y-Achse bei 0 verankern. */
  zeroBased?: boolean
}

// Eigene Variablenliste statt HOURLY_VARIABLES: das Ensemble liefert andere
// Größen (u.a. Höhenwetter), und die deterministischen Registries sollen davon
// unberührt bleiben. Alle Einträge live geprüft.
export const ENSEMBLE_VARIABLES: EnsembleVariableInfo[] = [
  { id: 'temperature_2m', label: 'Temperatur 2 m', unit: '°C', kind: 'instant' },
  // Label ohne „(Summe)": die Darstellung ist umschaltbar (Summe ↔ 6 h)
  { id: 'precipitation', label: 'Niederschlag', unit: 'mm', kind: 'accum', zeroBased: true },
  { id: 'snowfall', label: 'Schneefall', unit: 'cm', kind: 'accum', zeroBased: true },
  { id: 'wind_speed_10m', label: 'Wind 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'wind_gusts_10m', label: 'Böen 10 m', unit: 'km/h', kind: 'instant', zeroBased: true },
  { id: 'cloud_cover', label: 'Bewölkung', unit: '%', kind: 'instant', zeroBased: true },
  { id: 'pressure_msl', label: 'Luftdruck (MSL)', unit: 'hPa', kind: 'instant' },
  { id: 'cape', label: 'CAPE', unit: 'J/kg', kind: 'instant', zeroBased: true },
  { id: 'temperature_850hPa', label: 'Temperatur 850 hPa', unit: '°C', kind: 'instant' },
  { id: 'geopotential_height_500hPa', label: 'Geopotential 500 hPa', unit: 'gpm', kind: 'instant' },
]

/**
 * Startparameter des Ensemble-Bereichs: **850 hPa**, nicht 2 m. Die
 * Plume-Darstellung ist ein synoptisches Werkzeug — auf 850 hPa liegt das
 * Signal des Luftmassenwechsels, während T2m stark von der bodennahen
 * Grenzschicht (Inversion, Schneedecke, Modellorografie) überlagert wird und
 * die Streuung dort eher Modellrauschen als Wetterlage zeigt. T2m bleibt
 * einen Klick entfernt im Parameter-Dropdown.
 */
export const DEFAULT_ENSEMBLE_VARIABLE = 'temperature_850hPa'

/**
 * Darstellung von Summengrößen im Ensemble. `sum` = kumuliert ab Rasterbeginn,
 * `6h` = 6-Stunden-Mengen je Mitglied (Wetterzentrale-Manier) — die zeigt, WANN
 * der Niederschlag fällt, was die Summenkurve nicht hergibt.
 */
export type EnsembleAccumView = 'sum' | '6h'

/** Intervalllänge der 6-h-Ansicht in Stunden. */
export const ENSEMBLE_BUCKET_HOURS = 6

export interface EnsembleVariableOption {
  /** Zusammengesetzter Wert `id` bzw. `id:view` — nur fürs <select>. */
  value: string
  label: string
  variable: string
  view: EnsembleAccumView
}

/** Wert eines Dropdown-Eintrags zerlegen; ohne Ansichtsteil gilt 'sum'. */
export function parseEnsembleVariableValue(value: string): {
  variable: string
  view: EnsembleAccumView
} {
  const [variable, view] = value.split(':')
  return { variable, view: view === '6h' ? '6h' : 'sum' }
}

/**
 * Liefert das Modell diese Größe? Grundlage des Rückfalls beim Modellwechsel.
 */
export function ensembleHasVariable(modelId: string, variable: string): boolean {
  return getEnsembleModel(modelId).availableVariables.includes(variable)
}

/**
 * Größe, die nach einem Modellwechsel gelten soll: die bisherige, wenn das
 * neue Modell sie liefert — sonst der Startparameter, und wenn auch der fehlt,
 * die erste verfügbare Größe.
 *
 * Gebraucht, weil der STARTparameter `temperature_850hPa` ist und die
 * ICON-Ensembles genau den nicht haben. Ohne Rückfall wechselt man auf
 * ICON-EU-EPS und sieht ein leeres Diagramm, ohne zu erfahren warum.
 */
export function ensembleVariableFor(modelId: string, wanted: string): string {
  if (ensembleHasVariable(modelId, wanted)) return wanted
  if (ensembleHasVariable(modelId, DEFAULT_ENSEMBLE_VARIABLE)) return DEFAULT_ENSEMBLE_VARIABLE
  const first = ENSEMBLE_VARIABLES.find((v) =>
    getEnsembleModel(modelId).availableVariables.includes(v.id),
  )
  return first?.id ?? DEFAULT_ENSEMBLE_VARIABLE
}

/**
 * Dropdown-Einträge des Ensembles. Summengrößen stehen zweimal drin — als
 * kumulierte Summe und als 6-h-Mengen je Mitglied. Die Ansicht ist Teil der
 * Auswahl, nicht ein separater Umschalter daneben.
 */
export function ensembleVariableOptions(modelId?: string): EnsembleVariableOption[] {
  // Nur Größen, die das MODELL liefert. Ohne diesen Filter stand jede Größe
  // für jedes Modell im Dropdown und die Plume öffnete sich leer — die API
  // meldet Fehlendes nicht, sie antwortet mit HTTP 200 und lauter null
  // (SPEC §6). Ohne Modell-Angabe bleibt alles drin (Aufrufer ohne Kontext).
  const allowed = modelId ? new Set(getEnsembleModel(modelId).availableVariables) : null
  const out: EnsembleVariableOption[] = []
  for (const v of ENSEMBLE_VARIABLES) {
    if (allowed && !allowed.has(v.id)) continue
    if (v.kind !== 'accum') {
      out.push({ value: v.id, label: `${v.label} (${v.unit})`, variable: v.id, view: 'sum' })
      continue
    }
    out.push({
      value: `${v.id}:sum`,
      label: `${v.label} Summe (${v.unit})`,
      variable: v.id,
      view: 'sum',
    })
    out.push({
      value: `${v.id}:6h`,
      label: `${v.label} ${ENSEMBLE_BUCKET_HOURS} h (${v.unit}/${ENSEMBLE_BUCKET_HOURS} h)`,
      variable: v.id,
      view: '6h',
    })
  }
  return out
}

export function getEnsembleVariable(id: string): EnsembleVariableInfo {
  return ENSEMBLE_VARIABLES.find((v) => v.id === id) ?? ENSEMBLE_VARIABLES[0]
}

/**
 * Die Schnellwahl-Punkte standen früher HIER; sie setzen `lockedLocation` und
 * gelten damit für alle punktbasierten Bereiche — deshalb jetzt in
 * `config/quickPoints.ts`, gerendert von `components/QuickPoints.tsx`.
 */
