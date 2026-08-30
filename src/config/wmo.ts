// WMO-Wettercodes (Open-Meteo `weather_code`, WW-Schlüssel 4677 in der von
// Open-Meteo verwendeten reduzierten Form) → Symbolklasse und deutscher
// Klartext. Die Klassen sind bewusst gröber als die Codes: ein Meteogramm-
// Symbol muss auf ~20 px erkennbar bleiben, „mäßiger" vs. „starker" Regen ist
// darin keine unterscheidbare Information mehr (die steht in der
// Niederschlagszeile darunter).

export type WxClass =
  | 'clear'
  | 'fewclouds'
  | 'partly'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezing'
  | 'rain'
  | 'showers'
  | 'snow'
  | 'snowshowers'
  | 'sleet'
  | 'thunder'

export function wxClass(code: number): WxClass {
  if (code <= 0) return 'clear'
  if (code === 1) return 'fewclouds'
  if (code === 2) return 'partly'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 55) return 'drizzle'
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing'
  if (code >= 61 && code <= 65) return 'rain'
  if (code >= 71 && code <= 77) return 'snow'
  if (code >= 80 && code <= 82) return 'showers'
  if (code === 85 || code === 86) return 'snowshowers'
  if (code >= 95) return 'thunder'
  return 'sleet'
}

const LABELS: Record<number, string> = {
  0: 'wolkenlos',
  1: 'heiter',
  2: 'wechselnd bewölkt',
  3: 'bedeckt',
  45: 'Nebel',
  48: 'gefrierender Nebel',
  51: 'leichter Sprühregen',
  53: 'Sprühregen',
  55: 'starker Sprühregen',
  56: 'gefrierender Sprühregen',
  57: 'starker gefrierender Sprühregen',
  61: 'leichter Regen',
  63: 'Regen',
  65: 'starker Regen',
  66: 'gefrierender Regen',
  67: 'starker gefrierender Regen',
  71: 'leichter Schneefall',
  73: 'Schneefall',
  75: 'starker Schneefall',
  77: 'Schneegriesel',
  80: 'leichte Regenschauer',
  81: 'Regenschauer',
  82: 'starke Regenschauer',
  85: 'leichte Schneeschauer',
  86: 'Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit Hagel',
  99: 'schweres Gewitter mit Hagel',
}

export function wxLabel(code: number): string {
  return LABELS[code] ?? `Code ${code}`
}

/** Bewölkung in Prozent → Achtel (0–8), die klassische Einheit der Wetterdienste. */
export function toOcta(percent: number): number {
  return Math.max(0, Math.min(8, Math.round((percent / 100) * 8)))
}
