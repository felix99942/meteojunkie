// Atmosphärische Thermodynamik für das Skew-T-Diagramm. Reine Funktionen,
// offline gegen bekannte Werte verifizierbar (kein Netz nötig). Einheiten:
// Temperatur °C (sofern nicht _K), Druck hPa, Mischungsverhältnis g/kg.
//
// Quellen: Bolton (1980) für den Sättigungsdampfdruck, Poisson-Gleichung für
// Trockenadiabaten, pseudoadiabatische ODE für Feuchtadiabaten.

const RD = 287.04 // J/(kg·K) Gaskonstante trockene Luft
const CP = 1005 // J/(kg·K) spez. Wärmekapazität bei konst. Druck
const KAPPA = RD / CP // ≈ 0.2854 (Poisson-Exponent)
const LV = 2.501e6 // J/kg latente Verdampfungswärme
const EPS = 0.622 // Rd/Rv
const P0 = 1000 // hPa Referenzdruck
const T0 = 273.15 // K

export const toK = (tC: number): number => tC + T0
export const toC = (tK: number): number => tK - T0

/** Sättigungsdampfdruck über Wasser (hPa), Bolton 1980. T in °C. */
export function saturationVaporPressure(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5))
}

/** Umkehrung: Temperatur (°C), bei der der Sättigungsdampfdruck e (hPa) herrscht. */
export function dewpointFromVaporPressure(e: number): number {
  const ln = Math.log(e / 6.112)
  return (243.5 * ln) / (17.67 - ln)
}

/** Taupunkt (°C) aus Temperatur (°C) und relativer Feuchte (%). */
export function dewpoint(tC: number, rhPercent: number): number {
  const rh = Math.max(1e-3, Math.min(100, rhPercent)) / 100
  const e = rh * saturationVaporPressure(tC)
  return dewpointFromVaporPressure(e)
}

/** Mischungsverhältnis (g/kg) aus Dampfdruck e (hPa) und Druck p (hPa). */
export function mixingRatio(e: number, p: number): number {
  return (1000 * EPS * e) / (p - e)
}

/** Sättigungsmischungsverhältnis (g/kg) bei T (°C), p (hPa). */
export function saturationMixingRatio(tC: number, p: number): number {
  return mixingRatio(saturationVaporPressure(tC), p)
}

/** Potentielle Temperatur θ (K) aus T (°C), p (hPa). */
export function potentialTemperature(tC: number, p: number): number {
  return toK(tC) * (P0 / p) ** KAPPA
}

/** Trockenadiabate: Temperatur (°C) entlang konstanter θ (K) bei Druck p (hPa). */
export function dryAdiabatTemp(thetaK: number, p: number): number {
  return toC(thetaK * (p / P0) ** KAPPA)
}

/**
 * Temperatur (°C), bei der das Sättigungsmischungsverhältnis genau w (g/kg)
 * bei Druck p (hPa) beträgt — die „Mischungsverhältnis-Linien" im Skew-T.
 */
export function tempFromSaturationMixingRatio(wGkg: number, p: number): number {
  const w = wGkg / 1000 // kg/kg
  const e = (w * p) / (EPS + w) // Dampfdruck aus Mischungsverhältnis
  return dewpointFromVaporPressure(e)
}

/**
 * Pseudoadiabatische Lapse-Rate dT/dp (K/hPa) bei T (°C), p (hPa) — für die
 * numerische Integration der Feuchtadiabaten.
 */
function moistDtDp(tC: number, p: number): number {
  const tK = toK(tC)
  const ws = saturationMixingRatio(tC, p) / 1000 // kg/kg
  const num = RD * tK + LV * ws
  const den = CP + (LV * LV * ws * EPS) / (RD * tK * tK)
  return num / (den * p) // K/hPa
}

/**
 * Feuchtadiabate: Temperatur (°C) bei Zieldruck, ausgehend von (tStartC, pStart),
 * pseudoadiabatisch integriert (RK4, in Druck-Schritten). Für pTarget < pStart
 * (aufsteigend) wie > pStart (absteigend).
 */
export function moistAdiabatTemp(
  tStartC: number,
  pStart: number,
  pTarget: number,
  stepHpa = 5,
): number {
  let t = tStartC
  let p = pStart
  const dir = pTarget < pStart ? -1 : 1
  while ((dir < 0 && p > pTarget + 1e-9) || (dir > 0 && p < pTarget - 1e-9)) {
    const h = dir < 0 ? -Math.min(stepHpa, p - pTarget) : Math.min(stepHpa, pTarget - p)
    const k1 = moistDtDp(t, p)
    const k2 = moistDtDp(t + (k1 * h) / 2, p + h / 2)
    const k3 = moistDtDp(t + (k2 * h) / 2, p + h / 2)
    const k4 = moistDtDp(t + k3 * h, p + h)
    t += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6
    p += h
  }
  return t
}
