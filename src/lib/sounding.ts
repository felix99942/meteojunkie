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
  /**
   * Konvektionssperre in J/kg (≤ 0) — `null`, wenn es KEIN LFC gibt.
   *
   * CIN ist die Energie, die ein Paket bis zum Niveau des freien Auftriebs
   * braucht. Erreicht es dieses Niveau nie, gibt es nichts zu überwinden und
   * die Grösse ist gegenstandslos; eine Zahl wäre dann die aufsummierte
   * Negativfläche bis zur Gitterspitze — am Sonnblick standen so −21.668 J/kg
   * in der Tabelle (real sind −10 bis −300). Aufgefallen ist das erst, als
   * die Profile am Boden abgeschnitten wurden: vorher fand das Paket vom
   * erfundenen 1000-hPa-Niveau aus fast immer ein LFC.
   */
  cin: number | null
  lclP: number | null
  lfcP: number | null
  elP: number | null
  /** Parzellen-Temperaturkurve auf dem feinen Gitter (zum Zeichnen). */
  fineP: number[]
  parcelT: number[] // °C
  /** Umgebungstemperatur auf demselben Gitter (fürs Schattieren von CAPE/CIN). */
  envT: number[] // °C
}

export interface SoundingParams {
  pwat: number // mm
  sb: ParcelResult
  ml: ParcelResult
  mu: ParcelResult
  /**
   * Lifted Index auf 500 hPa, aus dem ML-PAKET (nicht SB).
   *
   * Dasselbe Bezugspaket wie das im Diagramm gezeichnete — vorher stand hier
   * das SB-Paket, und die Tabelle wies damit zwei Grössen aus, die von
   * verschiedenen Startniveaus stammten. Das ML-Paket mittelt die untersten
   * 100 hPa und ist robuster: das SB-Paket hängt an genau einem Wertepaar
   * (`temperature_2m`/`relative_humidity_2m`) und wird von der bodennahen
   * Schicht dominiert — bei nächtlicher Inversion meldet es eine Stabilität,
   * die nur die untersten Meter betrifft.
   */
  li: number | null
  kIndex: number | null
  totalTotals: number | null
  freezingLevelP: number | null // hPa
  freezingLevelZ: number | null // m
  shear06: number | null // m/s (0–6 km Bulk)
}

/**
 * Sondierungsspalte aus einem Profil zum Zeitindex bauen: nur Level mit gültiger
 * T UND Td, Boden (höchster Druck) zuerst. Wind (km/h, Richtung) → u/v (m/s).
 */
/** Bodenwerte eines Zeitschritts — das untere Ende der Sondierung. */
export interface SurfacePoint {
  /** Bodendruck in hPa (Stationsdruck, NICHT auf Meereshöhe reduziert). */
  pressure: number
  temperature: number | null
  dewpoint: number | null
  /** km/h */
  windSpeed: number | null
  windDirection: number | null
  /** Modell-Geländehöhe in m, falls bekannt. */
  elevation?: number | null
}

/** Wind (km/h, Herkunftsrichtung) → u/v in m/s. */
function windToUV(
  speedKmh: number | null | undefined,
  dirDeg: number | null | undefined,
): [number | null, number | null] {
  if (speedKmh == null || dirDeg == null) return [null, null]
  const spd = speedKmh / 3.6
  const rad = (dirDeg * Math.PI) / 180
  // Wind weht AUS dirDeg → Vektor zeigt dorthin entgegengesetzt
  return [-spd * Math.sin(rad), -spd * Math.cos(rad)]
}

/**
 * Sondierungsspalte aus einem Profil zum Zeitindex bauen: nur Level mit
 * gültiger Temperatur und Taupunkt, Boden zuerst.
 *
 * SCHNEIDET AM BODEN AB, und das ist keine Kosmetik, sondern eine
 * Korrektheitsfrage: Open-Meteo besetzt die Drucklevel-Reihen AUCH unterhalb
 * der Modelloberfläche (dort extrapoliert). Gemessen am Sonnblick
 * (Modellhöhe 3057 m, Bodendruck 717 hPa): 1000 hPa liefert 25,5 °C auf
 * 217 m Höhe, 850 hPa 16,7 °C auf 1594 m — beides tief im Berg. Ungefiltert
 * begann das Skew-T dort bei 1000 hPa, und das SB-Paket („surface based")
 * stieg von einem Niveau auf, das es nicht gibt; CAPE, CIN, LCL und LI waren
 * damit im Gebirge wertlos. Auch im Flachland ist mindestens das
 * 1000-hPa-Level betroffen (Salzburg, 442 m: 1000 hPa auf 209 m).
 *
 * Das Kriterium ist der BODENDRUCK, nicht die Höhe: die Skew-T-Achse ist eine
 * Druckachse, und `surface_pressure` ist genau die Grösse, gegen die sich ein
 * Drucklevel vergleichen lässt — ohne den Umweg über die Geopotentialhöhe,
 * die ihrerseits extrapoliert sein kann.
 *
 * Ist der Bodenpunkt vollständig, wird er als UNTERSTES Niveau eingefügt.
 * Erst damit beginnt das Profil dort, wo das Modell den Boden hat, statt beim
 * ersten Level darüber — am Sonnblick sind das 717 statt 700 hPa.
 */
export function columnFromProfile(
  levels: number[],
  temperature: (number | null)[][],
  dewpoint: (number | null)[][],
  windSpeed: (number | null)[][],
  windDirection: (number | null)[][],
  height: (number | null)[][],
  timeIdx: number,
  surface?: SurfacePoint | null,
): SoundingColumn | null {
  const col: SoundingColumn = { p: [], T: [], Td: [], z: [], u: [], v: [] }

  // Bodenpunkt zuerst — nur wenn er vollständig ist; ein halber Bodenpunkt
  // (Druck ohne Temperatur) wäre als Stützstelle schlechter als keiner.
  const sfc =
    surface && surface.temperature != null && surface.dewpoint != null ? surface : null
  if (sfc) {
    const [u, v] = windToUV(sfc.windSpeed, sfc.windDirection)
    col.p.push(sfc.pressure)
    col.T.push(sfc.temperature as number)
    col.Td.push(sfc.dewpoint as number)
    col.z.push(sfc.elevation ?? null)
    col.u.push(u)
    col.v.push(v)
  }

  for (let i = 0; i < levels.length; i++) {
    const t = temperature[i]?.[timeIdx]
    const td = dewpoint[i]?.[timeIdx]
    if (t == null || td == null) continue
    // Unterhalb des Bodens: extrapoliert, gehört nicht ins Profil.
    if (surface?.pressure != null && levels[i] >= surface.pressure) continue
    col.p.push(levels[i])
    col.T.push(t)
    col.Td.push(td)
    col.z.push(height[i]?.[timeIdx] ?? null)
    const [u, v] = windToUV(windSpeed[i]?.[timeIdx], windDirection[i]?.[timeIdx])
    col.u.push(u)
    col.v.push(v)
  }
  // absteigend nach Druck (Boden zuerst) — Profillevel sind bereits so sortiert
  return col.p.length >= 3 ? col : null
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
  const envT: number[] = []
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
    envT.push(fine.T[i])
    buoy.push(RD * (tvP - tvE)) // ΔTv in °C == ΔTv in K
  }

  // Segmentflächen in −ln(p); LFC = erster Vorzeichenwechsel −→+ oberhalb LCL,
  // EL = letzter +→− darüber. CAPE = positive Fläche LFC…EL, CIN = negative
  // Fläche vom Start bis LFC.
  let lfcIdx = -1
  let elIdx = -1
  for (let i = 1; i < fineP.length; i++) {
    if (fineP[i] > lclP) continue // erst ab LCL nach Auftrieb suchen
    // FREIE KONVEKTION: ist das Paket schon am LCL wärmer als die Umgebung,
    // gibt es keinen Vorzeichenwechsel — das LFC liegt dann AUF dem LCL und
    // CIN ist 0. Ohne diesen Fall blieb `lfcIdx` bei −1 und die Sondierung
    // wies CAPE = 0 aus, obwohl das Paket von unten weg auftreibt; genau die
    // Lage, in der es gewittert.
    if (lfcIdx < 0 && buoy[i - 1] > 0 && fineP[i - 1] <= lclP) lfcIdx = i - 1
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
    } else if (i <= lfcIdx) {
      // Nur BIS zum LFC — ohne LFC gibt es keine Sperre zu überwinden, und
      // die Schleife summierte sonst bis zur Gitterspitze weiter.
      if (seg < 0) cin += seg
    }
  }

  return {
    cape,
    cin: lfcIdx >= 0 ? cin : null,
    lclP,
    lfcP: lfcIdx >= 0 ? fineP[lfcIdx] : null,
    elP: elIdx >= 0 ? fineP[elIdx] : null,
    fineP,
    parcelT,
    envT,
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

  // LI: ML-Paket-Temperatur bei 500 hPa vs. Umgebung (siehe SoundingParams.li)
  const lnP = col.p.map((p) => Math.log(p))
  const t500 = col.p.some((p) => p <= 500) ? interpDesc(lnP, col.T, Math.log(500)) : null
  let li: number | null = null
  if (t500 != null) {
    const iP500 = ml.fineP.findIndex((p) => p <= 500)
    if (iP500 >= 0) li = t500 - ml.parcelT[iP500]
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

  // Nullgradgrenze. Die HÖHE ist hier die gebrauchte Grösse (Schneefall- und
  // Vereisungsgrenze liest man in Metern), der Druck bleibt als Rückfall.
  //
  // Interpoliert wird über die Level MIT gültiger Höhe statt über alle: vorher
  // verlangte die Rechnung, dass JEDER Eintrag eine Höhe trägt, und ein
  // einziger fehlender Wert unterdrückte die Angabe still. Seit der Bodenpunkt
  // vorangestellt wird, genügte dafür ein fehlendes `elevation` — also genau
  // der Fall, in dem die Höhe am interessantesten ist.
  const freezingLevelP = crossingP(col, 0)
  let freezingLevelZ: number | null = null
  if (freezingLevelP != null) {
    const lnPz: number[] = []
    const zVals: number[] = []
    for (let i = 0; i < col.z.length; i++) {
      const z = col.z[i]
      if (z == null || !Number.isFinite(z)) continue
      lnPz.push(lnP[i])
      zVals.push(z)
    }
    // Zwei Stützstellen sind das Minimum für eine Interpolation.
    if (zVals.length >= 2) {
      freezingLevelZ = interpDesc(lnPz, zVals, Math.log(freezingLevelP))
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
