// Abgeleitete Sondierungs-Kennzahlen fürs Skew-T (SPEC §13): Parzellenaufstieg
// (SB/ML/MU), CAPE/CIN, LCL/LFC/EL, PWAT, LI/K-Index/Total Totals,
// Nullgradgrenze, 0–6-km-Bulk-Shear. Baut auf dem verifizierten thermo.ts auf.
//
// Alle Rechnungen auf einem FEINEN Druckgitter (5 hPa): das native Modellgitter
// (~19 Level) ist für CAPE zu grob, deshalb T/Td linear in ln(p) interpolieren
// und darauf integrieren. CAPE über die Virtualtemperatur (Auftrieb).

import {
  dewpointFromVaporPressure,
  dryAdiabatTemp,
  lcl,
  mixingRatioFromDewpoint,
  moistAdiabatTemp,
  potentialTemperature,
  saturationMixingRatio,
  virtualTemperature,
} from './thermo'

const RD = 287.04 // J/(kg·K)
const G = 9.80665 // m/s²

/** Umgebungssondierung an einem Zeitpunkt: Boden (höchster Druck) zuerst. */
export interface SoundingColumn {
  p: number[] // hPa, absteigend (Boden zuerst)
  T: number[] // °C
  Td: number[] // °C
  z: (number | null)[] // geopotentielle Höhe (m)
  u: (number | null)[] // m/s (Ost)
  v: (number | null)[] // m/s (Nord)
}

export interface ParcelResult {
  cape: number // J/kg
  cin: number // J/kg (≤ 0)
  lclP: number | null
  lfcP: number | null
  elP: number | null
  /** Parzellen-Temperaturkurve auf dem feinen Gitter (zum Zeichnen). */
  fineP: number[]
  parcelT: number[] // °C
}

export interface SoundingParams {
  pwat: number // mm
  sb: ParcelResult
  ml: ParcelResult
  mu: ParcelResult
  li: number | null // SB-Paket, auf 500 hPa
  kIndex: number | null
  totalTotals: number | null
  freezingLevelP: number | null // hPa
  freezingLevelZ: number | null // m
  shear06: number | null // m/s (0–6 km Bulk)
}

/** Lineare Interpolation von y(x) an xq; x streng monoton fallend (p von unten). */
function interpDesc(x: number[], y: number[], xq: number): number {
  if (xq >= x[0]) return y[0]
  if (xq <= x[x.length - 1]) return y[y.length - 1]
  for (let i = 0; i < x.length - 1; i++) {
    if (xq <= x[i] && xq >= x[i + 1]) {
      const f = (xq - x[i]) / (x[i + 1] - x[i])
      return y[i] + f * (y[i + 1] - y[i])
    }
  }
  return y[y.length - 1]
}

/** T/Td linear in ln(p) auf ein feines Druckgitter interpolieren. */
function fineGrid(col: SoundingColumn, stepHpa = 5): { p: number[]; T: number[]; Td: number[] } {
  const pSurf = col.p[0]
  const pTop = col.p[col.p.length - 1]
  const lnP = col.p.map((p) => Math.log(p))
  const p: number[] = []
  const T: number[] = []
  const Td: number[] = []
  for (let pp = pSurf; pp >= pTop; pp -= stepHpa) {
    const lq = Math.log(pp)
    p.push(pp)
    T.push(interpDesc(lnP, col.T, lq))
    Td.push(interpDesc(lnP, col.Td, lq))
  }
  return { p, T, Td }
}

/**
 * Paket von (pStart, tStart, tdStart) heben und CAPE/CIN gegen das feine
 * Umgebungsgitter integrieren. Auftrieb über Virtualtemperatur.
 */
function liftParcel(
  pStart: number,
  tStart: number,
  tdStart: number,
  fine: { p: number[]; T: number[]; Td: number[] },
): ParcelResult {
  const { pressure: lclP, temperature: tLcl } = lcl(pStart, tStart, tdStart)
  const theta0 = potentialTemperature(tStart, pStart)
  const w0 = mixingRatioFromDewpoint(tdStart, pStart) // g/kg (unterhalb LCL konstant)

  const idxStart = fine.p.findIndex((p) => p <= pStart)
  const start = idxStart < 0 ? 0 : idxStart

  const fineP: number[] = []
  const parcelT: number[] = []
  const buoy: number[] = [] // Rd·(Tv_p − Tv_e) je Level (J/kg pro Einheit −ln p)

  for (let i = start; i < fine.p.length; i++) {
    const p = fine.p[i]
    let tParcel: number
    let wParcel: number // g/kg
    if (p >= lclP) {
      tParcel = dryAdiabatTemp(theta0, p)
      wParcel = w0
    } else {
      tParcel = moistAdiabatTemp(tLcl, lclP, p)
      wParcel = saturationMixingRatio(tParcel, p)
    }
    const tvP = virtualTemperature(tParcel, wParcel)
    const tvE = virtualTemperature(fine.T[i], mixingRatioFromDewpoint(fine.Td[i], p))
    fineP.push(p)
    parcelT.push(tParcel)
    buoy.push(RD * (tvP - tvE)) // ΔTv in °C == ΔTv in K
  }

  // Segmentflächen in −ln(p); LFC = erster Vorzeichenwechsel −→+ oberhalb LCL,
  // EL = letzter +→− darüber. CAPE = positive Fläche LFC…EL, CIN = negative
  // Fläche vom Start bis LFC.
  let lfcIdx = -1
  let elIdx = -1
  for (let i = 1; i < fineP.length; i++) {
    if (fineP[i] > lclP) continue // erst ab LCL nach Auftrieb suchen
    if (lfcIdx < 0 && buoy[i - 1] <= 0 && buoy[i] > 0) lfcIdx = i
    if (lfcIdx >= 0 && buoy[i - 1] > 0 && buoy[i] <= 0) elIdx = i
  }
  // durchgehend positiv bis oben → EL = Gitterspitze
  if (lfcIdx >= 0 && elIdx < 0) elIdx = fineP.length - 1

  let cape = 0
  let cin = 0
  for (let i = 1; i < fineP.length; i++) {
    const dlnp = Math.log(fineP[i - 1]) - Math.log(fineP[i]) // > 0 (aufwärts)
    const seg = 0.5 * (buoy[i - 1] + buoy[i]) * dlnp
    if (lfcIdx >= 0 && i > lfcIdx && i <= elIdx) {
      if (seg > 0) cape += seg
    } else if (lfcIdx < 0 || i <= lfcIdx) {
      if (seg < 0) cin += seg
    }
  }

  return {
    cape,
    cin,
    lclP,
    lfcP: lfcIdx >= 0 ? fineP[lfcIdx] : null,
    elP: elIdx >= 0 ? fineP[elIdx] : null,
    fineP,
    parcelT,
  }
}

/** Mischschicht-Paket: θ und w gemittelt über die unteren `depth` hPa. */
function mixedLayerStart(
  col: SoundingColumn,
  depth = 100,
): { p: number; t: number; td: number } {
  const pSurf = col.p[0]
  let thetaSum = 0
  let wSum = 0
  let n = 0
  for (let i = 0; i < col.p.length && col.p[i] >= pSurf - depth; i++) {
    thetaSum += potentialTemperature(col.T[i], col.p[i])
    wSum += mixingRatioFromDewpoint(col.Td[i], col.p[i])
    n++
  }
  if (n === 0) return { p: pSurf, t: col.T[0], td: col.Td[0] }
  const thetaMean = thetaSum / n
  const wMean = wSum / n
  const t = dryAdiabatTemp(thetaMean, pSurf) // mittlere θ auf Boden gebracht
  // Td aus mittlerem w am Boden: e = w·p/(eps+w), dann inverse Magnus
  const w = wMean / 1000
  const e = (w * pSurf) / (0.622 + w)
  return { p: pSurf, t, td: dewpointFromVaporPressure(e) }
}

function pwat(fine: { p: number[]; Td: number[] }): number {
  let sum = 0
  for (let i = 1; i < fine.p.length; i++) {
    const w0 = mixingRatioFromDewpoint(fine.Td[i - 1], fine.p[i - 1]) / 1000
    const w1 = mixingRatioFromDewpoint(fine.Td[i], fine.p[i]) / 1000
    const dp = (fine.p[i - 1] - fine.p[i]) * 100 // Pa
    sum += 0.5 * (w0 + w1) * dp
  }
  return sum / G // kg/m² == mm
}

function crossingP(col: SoundingColumn, targetT: number): number | null {
  for (let i = 0; i < col.T.length - 1; i++) {
    const a = col.T[i] - targetT
    const b = col.T[i + 1] - targetT
    if (a === 0) return col.p[i]
    if (a > 0 !== b > 0) {
      const f = a / (a - b)
      return col.p[i] + f * (col.p[i + 1] - col.p[i])
    }
  }
  return null
}

export function computeSounding(col: SoundingColumn): SoundingParams {
  const fine = fineGrid(col)
  const sb = liftParcel(col.p[0], col.T[0], col.Td[0], fine)
  const ml0 = mixedLayerStart(col)
  const ml = liftParcel(ml0.p, ml0.t, ml0.td, fine)

  // MU: Paket mit maximalem CAPE aus den untersten ~300 hPa
  let mu = sb
  for (let i = 0; i < col.p.length && col.p[i] >= col.p[0] - 300; i++) {
    const r = liftParcel(col.p[i], col.T[i], col.Td[i], fine)
    if (r.cape > mu.cape) mu = r
  }

  // LI: SB-Paket-Temperatur bei 500 hPa vs. Umgebung
  const lnP = col.p.map((p) => Math.log(p))
  const t500 = col.p.some((p) => p <= 500) ? interpDesc(lnP, col.T, Math.log(500)) : null
  let li: number | null = null
  if (t500 != null) {
    const iP500 = sb.fineP.findIndex((p) => p <= 500)
    if (iP500 >= 0) li = t500 - sb.parcelT[iP500]
  }

  // K-Index / Total Totals aus festen Leveln
  const at = (p: number, arr: number[]) => interpDesc(lnP, arr, Math.log(p))
  const has = (p: number) => col.p[0] >= p && col.p[col.p.length - 1] <= p
  let kIndex: number | null = null
  let totalTotals: number | null = null
  if (has(850) && has(700) && has(500)) {
    const t850 = at(850, col.T)
    const td850 = at(850, col.Td)
    const t700 = at(700, col.T)
    const td700 = at(700, col.Td)
    const t500v = at(500, col.T)
    kIndex = t850 - t500v + td850 - (t700 - td700)
    totalTotals = t850 - t500v + (td850 - t500v)
  }

  // Nullgradgrenze
  const freezingLevelP = crossingP(col, 0)
  let freezingLevelZ: number | null = null
  if (freezingLevelP != null) {
    const zVals = col.z.map((z) => (z == null ? NaN : z))
    if (zVals.every((z) => !Number.isNaN(z))) {
      freezingLevelZ = interpDesc(lnP, zVals as number[], Math.log(freezingLevelP))
    }
  }

  // 0–6 km Bulk-Shear (Vektor bei 6 km AGL minus Boden)
  let shear06: number | null = null
  const zs = col.z
  if (zs[0] != null && col.u[0] != null && col.v[0] != null) {
    const zSurf = zs[0]
    const zTarget = zSurf + 6000
    // an 6 km AGL interpolieren (in z)
    let uTop: number | null = null
    let vTop: number | null = null
    for (let i = 0; i < col.p.length - 1; i++) {
      const za = zs[i]
      const zb = zs[i + 1]
      if (za == null || zb == null || col.u[i] == null || col.u[i + 1] == null) continue
      if (zTarget >= za && zTarget <= zb) {
        const f = (zTarget - za) / (zb - za)
        uTop = (col.u[i] as number) + f * ((col.u[i + 1] as number) - (col.u[i] as number))
        vTop = (col.v[i] as number) + f * ((col.v[i + 1] as number) - (col.v[i] as number))
        break
      }
    }
    if (uTop != null && vTop != null) {
      shear06 = Math.hypot(uTop - (col.u[0] as number), vTop - (col.v[0] as number))
    }
  }

  return {
    pwat: pwat(fine),
    sb,
    ml,
    mu,
    li,
    kIndex,
    totalTotals,
    freezingLevelP,
    freezingLevelZ,
    shear06,
  }
}
