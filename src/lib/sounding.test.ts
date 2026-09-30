// Sondierungsspalte: das untere Ende des Profils.
//
// Anlass ist ein gemeldeter Fehler — am Alpenhauptkamm begann das Skew-T bei
// 1000 hPa, was es dort nicht geben kann. Ursache: Open-Meteo besetzt die
// Drucklevel AUCH unterhalb der Modelloberfläche (dort extrapoliert). Die
// Zahlen unten sind live gemessen (2026-09-20, ECMWF IFS, Sonnblick
// 47,054 N / 12,957 O, Modellhöhe 3057 m, Bodendruck 717,4 hPa).

import { describe, expect, it } from 'vitest'
import { moistAdiabatTemp } from './thermo'
import {
  columnFromProfile,
  computeSounding,
  thetaEProfile,
  wetBulbColumn,
  type SoundingColumn,
  type SurfacePoint,
} from './sounding'

/** Gemessenes Sonnblick-Profil: [hPa, T °C, z m] — 1000 und 850 liegen im Berg. */
const LEVELS = [1000, 850, 700, 600, 500]
const T = [25.5, 16.7, 3.5, -2.2, -10.7]
const Z = [217, 1594, 3207, 4445, 5871]

const col2d = (vals: number[]) => vals.map((v) => [v])
const build = (surface?: SurfacePoint | null) =>
  columnFromProfile(
    LEVELS,
    col2d(T),
    col2d(T.map((t) => t - 5)), // Taupunkt, hier nur als gültiger Wert gebraucht
    col2d(LEVELS.map(() => 18)), // km/h
    col2d(LEVELS.map(() => 270)), // aus West
    col2d(Z),
    0,
    surface,
  )

const SONNBLICK: SurfacePoint = {
  pressure: 717.4,
  temperature: 9.4,
  dewpoint: 2.0,
  windSpeed: 25,
  windDirection: 180,
  elevation: 3057,
}

describe('columnFromProfile — Boden', () => {
  it('verwirft Level UNTERHALB des Bodendrucks', () => {
    const c = build(SONNBLICK)!
    // 1000 und 850 hPa liegen bei 217 bzw. 1594 m, also 1,5–2,8 km im Berg.
    expect(c.p).not.toContain(1000)
    expect(c.p).not.toContain(850)
    expect(c.p).toContain(700)
    expect(c.T).not.toContain(25.5)
  })

  it('setzt den Bodenpunkt als unterstes Niveau', () => {
    const c = build(SONNBLICK)!
    expect(c.p[0]).toBe(717.4)
    expect(c.T[0]).toBe(9.4)
    expect(c.z[0]).toBe(3057)
    // Danach geht es mit dem ersten Level darüber weiter.
    expect(c.p[1]).toBe(700)
  })

  it('bleibt nach Druck absteigend sortiert (Boden zuerst)', () => {
    const c = build(SONNBLICK)!
    for (let i = 1; i < c.p.length; i++) expect(c.p[i]).toBeLessThan(c.p[i - 1])
  })

  it('rechnet den Bodenwind in u/v um (Herkunftsrichtung)', () => {
    const c = build(SONNBLICK)!
    // 180° = aus Süden → der Vektor zeigt nach Norden: v > 0, u ≈ 0.
    expect(c.u[0]).toBeCloseTo(0, 6)
    expect(c.v[0]).toBeCloseTo(25 / 3.6, 6)
  })

  it('schneidet auch OHNE vollständigen Bodenpunkt ab', () => {
    // Fehlt die Bodentemperatur, gibt es kein unterstes Niveau — die
    // unterirdischen Level müssen trotzdem draussen bleiben, sonst führte ein
    // fehlendes Feld die Extrapolation wieder ein.
    const c = build({ ...SONNBLICK, temperature: null })!
    expect(c.p[0]).toBe(700)
    expect(c.p).not.toContain(850)
  })

  it('lässt ohne Bodenangabe alles stehen (altes Verhalten)', () => {
    const c = build(null)!
    expect(c.p).toEqual(LEVELS)
  })

  it('trifft auch das Flachland, wo nur 1000 hPa betroffen ist', () => {
    // Salzburg, gemessen: Modellhöhe 442 m, Bodendruck 973,9 hPa — das
    // 1000-hPa-Level liegt auf 209 m und damit ebenfalls unter Gelände.
    const c = build({
      pressure: 973.9,
      temperature: 23.5,
      dewpoint: 14,
      windSpeed: 10,
      windDirection: 270,
      elevation: 442,
    })!
    expect(c.p[0]).toBe(973.9)
    expect(c.p).not.toContain(1000)
    expect(c.p).toContain(850)
  })
})

describe('CIN ohne LFC', () => {
  it('ist null statt einer aufsummierten Riesenzahl', () => {
    // Durchgehend stabile, trockene Schichtung: ein Bodenpaket wird nie
    // wärmer als die Umgebung, es gibt also kein LFC. Vorher summierte die
    // Schleife die Negativfläche bis zur Gitterspitze — am Sonnblick kamen so
    // −21.668 J/kg heraus.
    const p = [700, 600, 500, 400, 300, 200]
    const t = [0, -8, -18, -30, -45, -56]
    const col = columnFromProfile(
      p,
      p.map((_, i) => [t[i]]),
      p.map((_, i) => [t[i] - 25]), // sehr trocken
      p.map(() => [10]),
      p.map(() => [270]),
      p.map((_, i) => [i * 1200]),
      0,
      null,
    )!
    const s = computeSounding(col)
    expect(s.ml.lfcP).toBeNull()
    expect(s.ml.cape).toBe(0)
    expect(s.ml.cin).toBeNull()
  })

  it('bleibt eine Zahl, wenn es ein LFC gibt', () => {
    // Feuchtes, labiles Profil: Paket findet freien Auftrieb.
    const p = [1000, 900, 800, 700, 600, 500, 400, 300]
    const t = [28, 20, 13, 6, -3, -13, -26, -42]
    const col = columnFromProfile(
      p,
      p.map((_, i) => [t[i]]),
      p.map((_, i) => [t[i] - 2]),
      p.map(() => [15]),
      p.map(() => [230]),
      p.map((_, i) => [i * 1000]),
      0,
      null,
    )!
    const s = computeSounding(col)
    expect(s.ml.lfcP).not.toBeNull()
    expect(s.ml.cin).not.toBeNull()
    expect(s.ml.cin!).toBeLessThanOrEqual(0)
    expect(s.ml.cin!).toBeGreaterThan(-2000)
  })
})

describe('Freie Konvektion (Paket ab LCL sofort im Auftrieb)', () => {
  it('erkennt ein LFC auf dem LCL statt CAPE = 0 auszuweisen', () => {
    // Heisser, feuchter Nachmittag mit steilem Gradienten: das Paket ist ab
    // dem Kondensationsniveau durchgehend wärmer als die Umgebung, es gibt
    // also keinen Vorzeichenwechsel. Die LFC-Suche verlangte einen solchen
    // und meldete deshalb „kein LFC" — mitsamt CAPE = 0 in genau der Lage,
    // in der es gewittert.
    const p = [1000, 900, 800, 700, 600, 500, 400, 300]
    const t = [30, 21, 13, 5, -4, -15, -29, -45]
    const col = columnFromProfile(
      p,
      p.map((_, i) => [t[i]]),
      p.map((_, i) => [t[i] - 1]), // nahezu gesättigt
      p.map(() => [15]),
      p.map(() => [230]),
      p.map((_, i) => [i * 1000]),
      0,
      null,
    )!
    const s = computeSounding(col)
    expect(s.sb.lfcP).not.toBeNull()
    expect(s.sb.cape).toBeGreaterThan(0)
    // Bei freier Konvektion gibt es nichts zu überwinden.
    expect(s.sb.cin).toBe(0)
  })
})

describe('Lifted Index', () => {
  it('kommt aus dem ML-Paket, nicht aus dem SB-Paket', () => {
    // Bodennahe Inversion: die untersten Meter sind kalt, darüber liegt eine
    // warme Schicht. Das SB-Paket startet in der kalten Luft und meldet eine
    // Stabilität, die nur die Grenzschicht betrifft; das ML-Paket mittelt die
    // untersten 100 hPa und sieht die Lage, um die es geht. Beide LI müssen
    // sich deshalb unterscheiden — und der ausgewiesene muss der ML-Wert sein.
    const p = [1000, 950, 900, 850, 800, 700, 600, 500, 400, 300]
    const t = [4, 16, 17, 15, 12, 6, -2, -13, -27, -44]
    const col = columnFromProfile(
      p,
      p.map((_, i) => [t[i]]),
      p.map((_, i) => [t[i] - 3]),
      p.map(() => [12]),
      p.map(() => [250]),
      p.map((_, i) => [i * 900]),
      0,
      null,
    )!
    const s = computeSounding(col)
    const iSb = s.sb.fineP.findIndex((pp) => pp <= 500)
    const iMl = s.ml.fineP.findIndex((pp) => pp <= 500)
    const t500 = -13
    const liSb = t500 - s.sb.parcelT[iSb]
    const liMl = t500 - s.ml.parcelT[iMl]
    expect(liSb).not.toBeCloseTo(liMl, 1)
    expect(s.li).toBeCloseTo(liMl, 6)
  })
})

describe('Nullgradgrenze', () => {
  // Profil mit linearem Gradienten: 0 °C liegt rechnerisch bei 2000 m.
  const p = [900, 800, 700, 600, 500, 400]
  const t = [13, 6.5, 0, -7, -16, -30]
  const z = [1000, 1500, 2000, 2600, 3500, 4600]
  const make = (zVals: (number | null)[]) =>
    columnFromProfile(
      p,
      p.map((_, i) => [t[i]]),
      p.map((_, i) => [t[i] - 4]),
      p.map(() => [10]),
      p.map(() => [270]),
      zVals.map((v) => [v]),
      0,
      null,
    )!

  it('liefert die HÖHE, nicht nur den Druck', () => {
    const s = computeSounding(make(z))
    expect(s.freezingLevelZ).not.toBeNull()
    expect(s.freezingLevelZ!).toBeCloseTo(2000, -1)
    expect(s.freezingLevelP).toBeCloseTo(700, 0)
  })

  it('kommt auch mit EINZELNEN fehlenden Höhen aus', () => {
    // Vorher verlangte die Rechnung, dass jeder Eintrag eine Höhe trägt —
    // ein fehlender Wert (etwa `elevation` am Bodenpunkt) unterdrückte die
    // Angabe still, also gerade dort, wo die Höhe am meisten interessiert.
    const withGap = [...z]
    const s = computeSounding(make([null, withGap[1], withGap[2], null, withGap[4], withGap[5]]))
    expect(s.freezingLevelZ).not.toBeNull()
    expect(s.freezingLevelZ!).toBeCloseTo(2000, -1)
  })

  it('bleibt ohne jede Höhenangabe beim Druck', () => {
    const s = computeSounding(make(p.map(() => null)))
    expect(s.freezingLevelZ).toBeNull()
    expect(s.freezingLevelP).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// θe-PROFIL UND SCHICHTUNG. Die Klassen sind ein Vorzeichentest auf dθe/dz —
// und genau der ist die Aussage: nimmt θe mit der Höhe ab, labilisiert sich
// die Schicht beim Heben von selbst.
// ---------------------------------------------------------------------------

describe('thetaEProfile', () => {
  const col = (
    p: number[],
    T: number[],
    Td: number[],
    z: (number | null)[],
  ): SoundingColumn => ({ p, T, Td, z, u: p.map(() => 0), v: p.map(() => 0) })

  // Feuchter, warmer Fuß unter trockener Mitte — die klassische Lage vor
  // einem Gewitter, und der Fall, für den die Spalte gebaut ist.
  it('erkennt eine potentiell instabile Schicht', () => {
    const r = thetaEProfile(col([1000, 900, 800], [25, 15, 8], [20, 0, -5], [0, 1000, 2000]))
    expect(r?.layers[0].kind).toBe('unstable')
    expect(r?.layers[0].gradient).toBeLessThan(-5)
  })

  it('nennt eine Inversion stabil', () => {
    const r = thetaEProfile(col([1000, 900, 800], [0, 5, 5], [-20, -22, -25], [0, 1000, 2000]))
    expect(r?.layers.map((l) => l.kind)).toEqual(['stable', 'stable'])
  })

  /**
   * Eine feuchtadiabatisch geschichtete Luftmasse hat definitionsgemäß
   * konstantes θe — sie MUSS neutral herauskommen. Das prüft zugleich, dass
   * die Totzone weit genug ist, um numerisches Rauschen zu schlucken, und
   * eng genug, um nicht alles zu neutralisieren (der Test daneben verlangt
   * „stabil" bei 10 K/km).
   */
  it('nennt eine feuchtadiabatische Schichtung neutral', () => {
    const t900 = moistAdiabatTemp(20, 1000, 900)
    const t800 = moistAdiabatTemp(20, 1000, 800)
    const r = thetaEProfile(
      col([1000, 900, 800], [20, t900, t800], [20, t900, t800], [0, 1000, 2000]),
    )
    expect(r?.layers.map((l) => l.kind)).toEqual(['neutral', 'neutral'])
  })

  /**
   * OHNE GEOPOTENTIALHÖHEN muss es trotzdem gehen: einzelne Level liefern
   * keine, und die Klassifikation darf deswegen nicht für die ganze Schicht
   * ausfallen. Die hypsometrische Näherung kommt hier auf −34,9 statt
   * −31,7 K/km — dieselbe Klasse, und der Unterschied ist die Dicke, die das
   * Modell meldet, gegen die, die aus T und p folgt.
   */
  it('kommt ohne Geopotentialhöhen aus', () => {
    const r = thetaEProfile(col([1000, 900, 800], [25, 15, 8], [20, 0, -5], [null, null, null]))
    expect(r?.layers[0].kind).toBe('unstable')
  })

  it('liefert null, wenn es keine zwei Level gibt', () => {
    expect(thetaEProfile(col([1000], [20], [10], [0]))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// FEUCHTKUGEL UND DCAPE. Beide leben von derselben Größe — davon, wie weit
// Verdunstung die Luft abkühlen kann. Geprüft wird deshalb gegen den
// KONTRAST zweier Profile, die sich NUR in der Feuchte der Mittelschicht
// unterscheiden: gleiche Temperaturen, gleiche Höhen, anderer Taupunkt.
// ---------------------------------------------------------------------------

describe('Feuchtkugel und DCAPE', () => {
  const PP = [1000, 925, 850, 700, 600, 500, 400, 300]
  const ZZ = [110, 780, 1500, 3100, 4300, 5700, 7300, 9400]
  const TT = [28, 22, 18, 8, 0, -9, -22, -40]
  const two = (v: number[]) => v.map((x) => [x])
  const build2 = (Td: number[]) =>
    computeSounding(
      columnFromProfile(
        PP,
        two(TT),
        two(Td),
        two(PP.map(() => 10)),
        two(PP.map(() => 270)),
        two(ZZ),
        0,
        null,
      ) as SoundingColumn,
    )
  const trocken = build2([22, 17, 8, -12, -20, -28, -40, -55])
  const feucht = build2([24, 21, 17, 7, -1, -10, -23, -41])

  /**
   * DER GRUND FÜR DIE ZAHL: trockene Mittelschicht heißt kräftige
   * Verdunstungskühlung heißt schwerer Abwind — das Kennzeichen für
   * Fallböen. Gemessen 1004 gegen 544 J/kg bei IDENTISCHEM Temperaturprofil;
   * der Unterschied ist allein die Feuchte.
   */
  it('gibt der trockenen Mittelschicht die höhere DCAPE', () => {
    expect(trocken.dcape).toBeGreaterThan(900)
    expect(feucht.dcape).toBeLessThan(700)
    expect(trocken.dcape as number).toBeGreaterThan((feucht.dcape as number) * 1.5)
  })

  // Das Startniveau ist das θe-Minimum und muss in den untersten 400 hPa
  // liegen — höher gesucht fände man irgendwann die Stratosphäre.
  it('startet den Abwind innerhalb der untersten 400 hPa', () => {
    expect(trocken.dcapeSourceP).not.toBeNull()
    expect(trocken.dcapeSourceP as number).toBeGreaterThanOrEqual(1000 - 400)
    expect(trocken.dcapeSourceP as number).toBeLessThan(1000)
  })

  /**
   * Die FEUCHTKUGEL-Nullgradgrenze liegt immer TIEFER als die trockene, und
   * der Abstand ist die Feuchte: bei trockener Mitte 1230 m, bei feuchter
   * keine 90 m. Genau dieser Unterschied entscheidet, ob es im Tal regnet
   * oder schneit.
   */
  it('setzt die feuchte Nullgradgrenze unter die trockene', () => {
    for (const s of [trocken, feucht]) {
      expect(s.wetBulbZeroZ as number).toBeLessThan(s.freezingLevelZ as number)
    }
    const dTrocken = (trocken.freezingLevelZ as number) - (trocken.wetBulbZeroZ as number)
    const dFeucht = (feucht.freezingLevelZ as number) - (feucht.wetBulbZeroZ as number)
    expect(dTrocken).toBeGreaterThan(500)
    expect(dFeucht).toBeLessThan(200)
  })

  it('liefert für jedes Level eine Feuchtkugel zwischen Td und T', () => {
    const col = columnFromProfile(
      PP,
      two(TT),
      two([22, 17, 8, -12, -20, -28, -40, -55]),
      two(PP.map(() => 10)),
      two(PP.map(() => 270)),
      two(ZZ),
      0,
      null,
    ) as SoundingColumn
    const tw = wetBulbColumn(col)
    expect(tw).toHaveLength(col.p.length)
    for (let i = 0; i < tw.length; i++) {
      expect(tw[i], `${col.p[i]} hPa`).toBeLessThanOrEqual(col.T[i])
      expect(tw[i], `${col.p[i]} hPa`).toBeGreaterThanOrEqual(col.Td[i])
    }
  })
})
