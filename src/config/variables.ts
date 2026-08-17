// Stündliche Open-Meteo-Variablen, die in Phase 1 (Meteogramm) angeboten werden.
// Druckflächen-Variablen für Vertikalprofile kommen in Phase 3 dazu.

export interface VariableInfo {
  id: string
  label: string
  /** Einheit der RATE — Open-Meteo liefert stündliche Werte, siehe `accum`. */
  unit: string
  /** true → y-Achse beginnt bei 0 (Niederschlag, Wind, Strahlung, …) */
  nonNegative: boolean
  /**
   * Summengröße: der Stundenwert ist die Menge der vorangegangenen Stunde,
   * nicht ein Momentanwert. Solche Variablen sind im Meteogramm zwischen Rate
   * (mm/h) und kumulierter Summe (mm) umschaltbar — `sumUnit` ist die Einheit
   * der Summenansicht.
   *
   * Wichtig fürs Verständnis der Daten: Modelle mit 3-stündlicher Ausgabe
   * (ECMWF IFS/AIFS) liefern die 3-h-Summe GLEICHMÄSSIG AUF DREI STUNDEN
   * VERTEILT — live geprüft am Abgleich mit `daily=precipitation_sum`, die
   * Tagessumme entspricht der Summe ALLER Stundenwerte. Die drei gleichen
   * Werte sind also je ein Drittel, kein dreifach wiederholter Blockwert.
   * Folge: Mengen sind modellübergreifend vergleichbar, SPITZENINTENSITÄTEN
   * nicht — bei 3-h-Modellen ist der Schauer über drei Stunden verschmiert.
   */
  accum?: true
  sumUnit?: string
}

export const HOURLY_VARIABLES: VariableInfo[] = [
  { id: 'temperature_2m', label: 'Temperatur 2 m', unit: '°C', nonNegative: false },
  { id: 'dew_point_2m', label: 'Taupunkt 2 m', unit: '°C', nonNegative: false },
  { id: 'relative_humidity_2m', label: 'Rel. Feuchte 2 m', unit: '%', nonNegative: true },
  {
    id: 'precipitation',
    label: 'Niederschlag',
    unit: 'mm/h',
    nonNegative: true,
    accum: true,
    sumUnit: 'mm',
  },
  { id: 'snowfall', label: 'Schneefall', unit: 'cm/h', nonNegative: true, accum: true, sumUnit: 'cm' },
  { id: 'cloud_cover', label: 'Bewölkung', unit: '%', nonNegative: true },
  { id: 'pressure_msl', label: 'Luftdruck (MSL)', unit: 'hPa', nonNegative: false },
  { id: 'wind_speed_10m', label: 'Wind 10 m', unit: 'km/h', nonNegative: true },
  { id: 'wind_gusts_10m', label: 'Böen 10 m', unit: 'km/h', nonNegative: true },
  { id: 'wind_direction_10m', label: 'Windrichtung 10 m', unit: '°', nonNegative: true },
  { id: 'cape', label: 'CAPE', unit: 'J/kg', nonNegative: true },
  { id: 'shortwave_radiation', label: 'Globalstrahlung', unit: 'W/m²', nonNegative: true },
]

const byId = new Map(HOURLY_VARIABLES.map((v) => [v.id, v]))

export function getVariable(id: string): VariableInfo {
  const v = byId.get(id)
  if (!v) throw new Error(`Unbekannte Variable: ${id}`)
  return v
}

/** Ansicht für Summengrößen; für alle übrigen Variablen wirkungslos. */
export type AccumView = 'rate' | 'sum'

/** Einheit passend zur Ansicht — in der Summenansicht mm statt mm/h. */
export function unitFor(v: VariableInfo, view: AccumView): string {
  return v.accum && view === 'sum' ? (v.sumUnit ?? v.unit) : v.unit
}

/**
 * Ein Eintrag des Parameter-Dropdowns. Summengrößen erscheinen als MEHRERE
 * Einträge (Rate/Summe) statt als Variable plus separatem Umschalter: die
 * Darstellung ist Teil dessen, was man auswählt, und ein Dropdown ist dafür
 * die eine Stelle, an der man ohnehin schon sucht.
 */
export interface VariableOption {
  /** Zusammengesetzter Wert `id` bzw. `id:view` — nur fürs <select>. */
  value: string
  label: string
  variable: string
  view: AccumView
}

/** Wert eines Dropdown-Eintrags zerlegen; ohne Ansichtsteil gilt 'rate'. */
export function parseVariableValue(value: string): { variable: string; view: AccumView } {
  const [variable, view] = value.split(':')
  return { variable, view: view === 'sum' ? 'sum' : 'rate' }
}

/**
 * Dropdown-Einträge aufbauen. `withViews=false` für die Karte: dort steht EIN
 * Zeitschritt, eine kumulierte Summe hätte keinen Bezugszeitraum.
 */
export function variableOptions(vars: VariableInfo[], withViews: boolean): VariableOption[] {
  const out: VariableOption[] = []
  for (const v of vars) {
    if (!withViews || !v.accum) {
      out.push({ value: v.id, label: `${v.label} (${v.unit})`, variable: v.id, view: 'rate' })
      continue
    }
    out.push({ value: `${v.id}:rate`, label: `${v.label} (${v.unit})`, variable: v.id, view: 'rate' })
    out.push({
      value: `${v.id}:sum`,
      label: `${v.label} Summe (${v.sumUnit ?? v.unit})`,
      variable: v.id,
      view: 'sum',
    })
  }
  return out
}
