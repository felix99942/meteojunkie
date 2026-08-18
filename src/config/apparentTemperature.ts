// „Gefühlte Temperatur" — GeoSphere liefert dafür kein eigenes Feld, das
// Projekt berechnet sie selbst. Formel: die „Apparent Temperature" (AT) des
// australischen Bureau of Meteorology nach Steadman (1994) — EINE Formel über
// den gesamten Wertebereich, kein Umschalten zwischen Windchill (kalt) und
// Hitzeindex (warm) wie bei den NWS-Formeln. Open-Meteo nutzt dieselbe Formel
// für sein `apparent_temperature` — die Klimastationen sind damit methodisch
// konsistent zur Vorhersage in der Workbench.
//
//   AT = T + 0,33·e − 0,70·v − 4,00
//
// T = Lufttemperatur (°C), v = Windgeschwindigkeit in 10 m Höhe (m/s),
// e = Wasserdampfdruck (hPa). Reine Rechenkerne, ohne Datenzugriff — mit
// Vitest getestet (`apparentTemperature.test.ts`).

/** Sättigungsdampfdruck (hPa) bei Temperatur `tempC` (°C) — Magnus-Formel. */
function saturationVaporPressure(tempC: number): number {
  return 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC))
}

/**
 * Wasserdampfdruck (hPa) aus Temperatur + relativer Feuchte (%) — der Weg, den
 * die GeoSphere-Klimastationen liefern (`tl`/`rf` im 10-Minuten-Datensatz).
 */
export function vaporPressureFromRH(tempC: number, rhPercent: number): number {
  return (rhPercent / 100) * saturationVaporPressure(tempC)
}

/**
 * Wasserdampfdruck (hPa) direkt aus dem Taupunkt (°C) — der Weg, den DWD
 * MOSMIX liefert (Taupunkt `TD`, keine relative Feuchte).
 */
export function vaporPressureFromDewPoint(dewPointC: number): number {
  return saturationVaporPressure(dewPointC)
}

/** „Gefühlte Temperatur" (°C) nach der AU-BOM/Steadman-Formel. */
export function apparentTemperature(tempC: number, vaporPressureHpa: number, windSpeedMs: number): number {
  return tempC + 0.33 * vaporPressureHpa - 0.7 * windSpeedMs - 4.0
}
