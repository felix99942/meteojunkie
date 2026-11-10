// Kacheln für den Globus, im Browser aus dem geladenen Feld gerechnet.
//
// WARUM KACHELN und kein einzelnes Bild über die Erde (wie das Feld der
// Punktprognosen-Karte): MapLibre zieht im Globus nur KACHELquellen bis an die
// Pole (`extendToNorthPole` in `create_tile_mesh`, gesetzt für raster-Kacheln
// mit y = 0 bzw. am Südrand) — eine image-/canvas-Source endet an der
// Mercator-Grenze von 85,05°, und im Prototyp standen an beiden Polen schwarze
// Löcher. Der Streifen jenseits 85,05° zeigt dabei die Randzeile der Kachel
// gestreckt, sie trägt deshalb das Ringmittel (`poleSide`); die Werteanzeige am
// Zeiger liest dort trotzdem das echte Feld.
//
// Zweiter Gewinn: die Kachel wird je Zoomstufe NEU abgetastet, interpoliert
// wird also der WERT, nicht die Farbe. Ein hochgezogenes Farbbild zeigt beim
// Hineinzoomen 28-km-Treppen an jeder Bandgrenze (im Prototyp über den Alpen
// gesehen); so laufen die Bandgrenzen als glatte Isolinien durch.
//
// Die Kacheln kommen über ein EIGENES Protokoll (`globe://run/var/step/z/x/y`,
// registriert in `globeProtocol.ts` — getrennt, damit dieser Rechenkern ohne
// MapLibre testbar bleibt).

import { buildLut, LUT_SIZE } from './fieldImage'
import {
  gridX,
  gridY,
  phaseLineM,
  POLE_RING_LAT,
  poleSide,
  tilePixelLat,
  tilePixelLon,
  type GlobeField,
  type GlobeModelId,
  type GlobeVarId,
} from '../config/globe'
import type { ColorScale } from '../config/colorscales'

export const GLOBE_TILE_SIZE = 256

/** Breite, auf die die Kachelstufe im Polarblick höchstens abgestimmt wird (rad). */
const TILE_REF_LAT = (55 * Math.PI) / 180

/**
 * Angegebene Kachelgröße einer Quelle im Globus — kleiner als die echte, damit
 * MapLibre eine feinere Kachelstufe wählt, sobald der Blick zum Pol geht.
 *
 * MapLibre hält die Kugel beim Drehen gleich groß, indem es den Zoom um
 * log2(1/cos(Breite)) senkt, am Pol um rund 3,5 Stufen. Die Kachelstufe hängt an
 * diesem Zoom und gilt für das ganze Bild, abgestimmt auf die Bildmitte. Von
 * weitem auf den Pol geschaut kamen so Kacheln der Stufe 0 auf die ganze Kugel:
 * ein Mercator-Pixel ist dort am Pol passend klein, am Äquator aber rund
 * 8 Bildschirmpixel breit — die Isolinien standen fett und unscharf da.
 *
 * Abgestimmt wird deshalb auf eine Breite ein Drittel des Wegs von der Mitte zum
 * Bildrand, aber nicht südlich von `TILE_REF_LAT`. Auf den Bildrand oder gar den
 * Äquator abgestimmt gab es das umgekehrte Bild (im Browser gesehen): in hohen
 * Breiten sind Mercator-Pixel auf der Kugel gestaucht, Linien und Zahlen wurden
 * dort winzig und blass. Gemessen ist von weitem am Pol jetzt Stufe 3 mit 32 Kacheln
 * wie in der Startansicht (Stufe 3, 34 Kacheln). Bis 55° in der Mitte bleibt es bei
 * der Vorgabe, die Ansichten rund um Europa ändern sich also nicht. Die Quelle wird nicht neu angelegt, weil MapLibre `tileSize` je
 * Aktualisierung frisch liest; `calculateTileZoom` ginge nicht: unterhalb von
 * Stufe 5 fragt MapLibre die Funktion gar nicht.
 */
export function globeTileSize(centerLat: number, zoom: number, width: number, height: number): number {
  const lat = (Math.min(Math.abs(centerLat), 89) * Math.PI) / 180
  const radiusPx = (512 * 2 ** zoom) / (2 * Math.PI * Math.cos(lat))
  const reach = Math.min(Math.PI / 2, Math.hypot(width, height) / 2 / radiusPx)
  const ref = Math.min(lat, Math.max(TILE_REF_LAT, lat - reach / 3))
  return GLOBE_TILE_SIZE * (Math.cos(lat) / Math.cos(ref))
}

/**
 * Teilpunkte je Pixel und Achse für die Kantenglättung (siehe
 * `colorizeTile`): 2 × 2 — ein Box-Filter über genau EIN Pixel. Mehr würde
 * die Kante nicht weicher machen, nur teurer.
 */
const SUPERSAMPLE = 2
export const GLOBE_PROTOCOL = 'globe'

/**
 * Feld → RGBA einer Kachel. Bilinear über die CODES (der Wert ist linear im
 * Code, die Umrechnung also erst nach der Interpolation nötig); global über
 * die Datumsgrenze gewickelt, regional außerhalb durchsichtig; ein fehlender
 * Nachbar macht das Pixel durchsichtig — dieselbe Regel wie `sampleField`,
 * hier nur auf ganze Zeilen/Spalten vorberechnet.
 */
export function colorizeTile(
  f: GlobeField,
  scale: ColorScale,
  z: number,
  x: number,
  y: number,
  size = GLOBE_TILE_SIZE,
): Uint8ClampedArray {
  const { ni, nj } = f.grid
  const lut = buildLut(scale)
  const sMin = scale.stops[0].value
  const sMax = scale.stops[scale.stops.length - 1].value
  const transparentBelow = scale.belowMin ? scale.belowMin === 'transparent' : scale.kind === 'stepped'
  const lutK = (LUT_SIZE - 1) / (sMax - sMin)

  // KANTENGLÄTTUNG durch ÜBERABTASTEN (auf Wunsch: „das Pixelige weg, aber
  // nicht überglätten"): je Pixel vier Teilpunkte (2 × 2, Mitten bei ±¼ px),
  // jeder aus dem Gitter interpoliert und eingefärbt, die Farben gemittelt —
  // ein Box-Filter über GENAU die Pixelfläche. Mitten in einer Fläche bleibt
  // die Farbe unverändert, nur wo eine Bandgrenze durch das Pixel läuft,
  // entsteht die Mischfarbe. Ohne das bekam jedes Pixel EINE Bandfarbe, und
  // an jeder Grenze stand eine Treppe, die bei Zwischenzoomstufen und hoher
  // Pixeldichte noch vergrößert wurde.
  //
  // Bewusst KEINE Schätzung über das Gefälle zu den Nachbarpixeln (die erste
  // Fassung): das bilinear interpolierte Feld KNICKT an jeder Gitterzelle,
  // dort fiel die Schätzung zu groß aus, und knapp über der Darstellungs-
  // schwelle (Niederschlag 0,1 mm/h) wurden Pixel entlang der Zellgrenzen
  // halb durchsichtig — dunkle gerade Linien quer durch Regenflächen (im
  // Bild gesehen). Überabtasten misst statt zu schätzen.
  //
  // Teilspalten und -zeilen einmal je Kachel; −1 = außerhalb eines
  // regionalen Gitters (Teilpunkt bleibt durchsichtig). `gridX`/`gridY` sind
  // dieselben Regeln wie in `sampleField` — die Werteanzeige liest genau
  // das, was gezeichnet wird.
  const sub = size * SUPERSAMPLE
  const ix0 = new Int32Array(sub)
  const ix1 = new Int32Array(sub)
  const fxs = new Float32Array(sub)
  for (let sx = 0; sx < sub; sx++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, sx, sub))
    if (gx == null) {
      ix0[sx] = -1
      continue
    }
    const i0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
    ix0[sx] = i0
    ix1[sx] = i0 + 1 === ni ? 0 : i0 + 1
    fxs[sx] = gx - i0
  }
  const iy0s = new Int32Array(sub)
  const fys = new Float32Array(sub)
  for (let sy = 0; sy < sub; sy++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, sy, sub))
    if (gy == null) {
      iy0s[sy] = -1
      continue
    }
    const j0 = Math.min(nj - 2, Math.floor(gy))
    iy0s[sy] = j0
    fys[sy] = gy - j0
  }

  /** LUT-Index eines (interpolierten) Codes, −1 = durchsichtig. */
  const lutIndex = (code: number): number => {
    const v = f.lo + (code - 1) * f.step
    if (transparentBelow && v < sMin) return -1
    const li = Math.round((v - sMin) * lutK)
    return li < 0 ? 0 : li > LUT_SIZE - 1 ? LUT_SIZE - 1 : li
  }

  const c = f.codes
  /** LUT-Index des Teilpunkts (sx, sy), −1 = durchsichtig. */
  const sample = (sx: number, sy: number): number => {
    const iy0 = iy0s[sy]
    const a = ix0[sx]
    if (iy0 < 0 || a < 0) return -1
    const b = ix1[sx]
    const r0 = iy0 * ni
    const r1 = r0 + ni
    const c00 = c[r0 + a]
    const c01 = c[r0 + b]
    const c10 = c[r1 + a]
    const c11 = c[r1 + b]
    if (c00 === 0 || c01 === 0 || c10 === 0 || c11 === 0) return -1
    const fx = fxs[sx]
    const fy = fys[sy]
    return lutIndex((c00 * (1 - fx) + c01 * fx) * (1 - fy) + (c10 * (1 - fx) + c11 * fx) * fy)
  }

  // Gemittelt VORMULTIPLIZIERT, sonst färbte ein durchsichtiger Teilpunkt
  // (Niederschlag unter der Schwelle, kein Wert) die Kante dunkel
  const n = SUPERSAMPLE * SUPERSAMPLE
  const out = new Uint8ClampedArray(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let dy = 0; dy < SUPERSAMPLE; dy++)
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const li = sample(px * SUPERSAMPLE + dx, py * SUPERSAMPLE + dy)
          if (li < 0) continue
          const q = li * 4
          const al = lut[q + 3]
          sr += lut[q] * al
          sg += lut[q + 1] * al
          sb += lut[q + 2] * al
          sa += al
        }
      if (sa === 0) continue
      const o = (py * size + px) * 4
      out[o] = sr / sa
      out[o + 1] = sg / sa
      out[o + 2] = sb / sa
      out[o + 3] = sa / n
    }
  }

  // Polrand: EINE Farbe aus dem Mittel des ganzen Rings, nicht je Kachel — sonst
  // stünden auf der Kappe statt der Strahlen Sektoren in den Kachelgrenzen
  if (f.grid.global) {
    for (const side of [1, -1] as const) {
      const row = side === 1 ? 0 : size - 1
      if (!poleSide(z, y, row, size)) continue
      const j = Math.min(nj - 1, Math.round(gridY(f.grid, side * POLE_RING_LAT) ?? 0))
      let sum = 0
      let k = 0
      for (let i = 0; i < ni; i++) {
        const code = c[j * ni + i]
        if (code !== 0) {
          sum += code
          k++
        }
      }
      const li = k ? lutIndex(sum / k) : -1
      for (let py = 0; py < size; py++) {
        if (poleSide(z, y, py, size) !== side) continue
        for (let px = 0; px < size; px++) {
          const o = (py * size + px) * 4
          out[o] = li < 0 ? 0 : lut[li * 4]
          out[o + 1] = li < 0 ? 0 : lut[li * 4 + 1]
          out[o + 2] = li < 0 ? 0 : lut[li * 4 + 2]
          out[o + 3] = li < 0 ? 0 : lut[li * 4 + 3]
        }
      }
    }
  }
  return out
}

type Rgb = readonly [number, number, number]

function ramp(dark: Rgb, bright: Rgb): Rgb[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = i / 7
    return [0, 1, 2].map((k) => Math.round(dark[k] + (bright[k] - dark[k]) * t)) as unknown as Rgb
  })
}

/**
 * Je Schicht EINE Farbe in acht Stufen, 1/8 … 8/8: dunkel und blass bis hell
 * und kräftig, immer im selben Farbton (hoch grün, mittel rot, tief blau).
 * Nur die Deckkraft zu staffeln reichte nicht — auf der dunklen Karte sahen
 * 3/8 und 6/8 fast gleich „rot" aus, die Stärke der Schicht war nicht zu lesen
 * (Rückmeldung). Achtel, weil so Bedeckung gemeldet und gelesen wird.
 */
export const CLOUD_LAYER_RAMPS: Record<'high' | 'mid' | 'low', Rgb[]> = {
  high: ramp([22, 70, 34], [150, 255, 160]),
  mid: ramp([92, 24, 24], [255, 150, 140]),
  low: ramp([24, 44, 104], [150, 185, 255]),
}

/**
 * Deckkraft je Achtel (1/8 … 8/8): ÜBERPROPORTIONAL steigend, erst hohe
 * Achtel decken (auf Wunsch, 2026-11-02) — 1/8 12 %, 4/8 ~39 %, 6/8 ~64 %,
 * 8/8 92 %.
 * Vorher linear von 50 % auf 88 %: schon eine dünne Schicht verdeckte die
 * darunter fast zur Hälfte, und die Karte sah bei wenig Bewölkung zugemalt aus.
 */
export const CLOUD_OCTA_ALPHA = Array.from({ length: 8 }, (_, i) => 0.12 + 0.8 * (i / 7) ** 1.3)

/** Bedeckung in % → Achtel (0…8), wie in der Synop-Meldung gerundet. */
export function toOcta(percent: number): number {
  return Math.max(0, Math.min(8, Math.round(percent / 12.5)))
}

/**
 * Wolkenschichten → RGBA einer Kachel: jede Schicht eine eigene,
 * halbtransparente Fläche in IHREM Farbton, Helligkeit und Deckkraft nach
 * Achteln (`CLOUD_LAYER_RAMPS`). Gestapelt wie von oben gesehen — tief unten,
 * hoch oben — und übereinander normal überblendet („source-over"). Eine
 * frühere Fassung mischte die Kanäle ADDITIV (hoch + mittel = gelb, alle drei
 * = weiß); das waren sieben Farben für drei Größen und ist auf Wunsch raus.
 *
 * BILINEAR je Schicht, Farbe STUFENLOS zwischen den Achtelstufen: mit dem
 * nächsten Gitterpunkt stand jede 2-km-Zelle als Klötzchen da (Rückmeldung
 * „Pixelung"). Der nächste Gitterpunkt war nur nötig, solange die Kanäle
 * additiv gemischt wurden — eine Zwischenfarbe hätte dort wie eine dritte
 * Schicht ausgesehen; bei getrennten Schichten ist Interpolation richtig.
 * Vorher leicht geglättet (`smoothRgb3`), sonst blieben Treppen im Gitter.
 * Unter 1/8 blendet eine Schicht WEICH aus (statt hart bei 0/8 abzubrechen),
 * Küsten und Grenzen bleiben sichtbar. Fehlt an einer Ecke der Wert (Rand des
 * ICON-D2-Gebiets), bleibt das Pixel leer — wie bei den Farbflächen.
 */
const rgbSmoothCache = new WeakMap<GlobeField, Float32Array>()

/**
 * Halbmesser der Glättung in Gitterzellen: ~2 km auf jeder Seite — also nur
 * bei ICON-D2 (0,02°) eine Zelle, bei allen gröberen Gittern KEINE.
 * Bilinear allein ließ bei ICON-D2 beim Hineinzoomen Treppen stehen (es
 * springt von Zelle zu Zelle oft von 0 auf 100 %). Bei groben Gittern war
 * die Glättung dagegen falsch: früher mindestens EINE Zelle, bei IFS 0,25°
 * also zwei Durchgänge à ±25 km — wolkenfreie Becken und Täler in Österreich
 * verschwammen in der Fläche (gemeldet, GeoSphere zeigt dort im selben IFS
 * sogar Hochnebel in den Tälern). Dort genügt die bilineare Interpolation.
 */
export function cloudSmoothRadius(dlon: number): number {
  return Math.round(0.02 / dlon)
}

/**
 * Die drei Schichten als Fließkomma-Bedeckung, geglättet (zweimal
 * Kastenfilter ±r, getrennt in x und y = Dreiecksfilter); fehlend (255) zählt
 * nicht mit und bleibt fehlend. Einmal je Feld gerechnet.
 */
export function smoothRgb3(f: GlobeField): Float32Array {
  const hit = rgbSmoothCache.get(f)
  if (hit) return hit
  const rgb = f.rgb!
  const { ni, nj, global } = f.grid
  const r = cloudSmoothRadius(f.grid.dlon)
  const n = ni * nj
  let cur: Float32Array = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const c = 3 * i
    if (rgb[c] === 255) cur[c] = cur[c + 1] = cur[c + 2] = NaN
    else {
      cur[c] = rgb[c]
      cur[c + 1] = rgb[c + 1]
      cur[c + 2] = rgb[c + 2]
    }
  }
  // Ein Durchgang = Kastenfilter in x, dann in y. ZWEI Durchgänge ergeben
  // einen Dreiecksfilter: ein einzelner Kasten ließ beim Hineinzoomen
  // Kästchen in den Flächen stehen (im Browser gesehen).
  const pass = (src: Float32Array, dx: number, dy: number): Float32Array => {
    const dst = new Float32Array(n * 3)
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const c = 3 * (j * ni + i)
        if (src[c] !== src[c]) {
          dst[c] = dst[c + 1] = dst[c + 2] = NaN
          continue
        }
        let s0 = 0
        let s1 = 0
        let s2 = 0
        let k = 0
        for (let d = -r; d <= r; d++) {
          let ii = i + d * dx
          const jj = j + d * dy
          if (jj < 0 || jj >= nj) continue
          if (ii < 0 || ii >= ni) {
            if (!global) continue
            ii = (ii + ni) % ni
          }
          const q = 3 * (jj * ni + ii)
          if (src[q] !== src[q]) continue
          s0 += src[q]
          s1 += src[q + 1]
          s2 += src[q + 2]
          k++
        }
        dst[c] = s0 / k
        dst[c + 1] = s1 / k
        dst[c + 2] = s2 / k
      }
    }
    return dst
  }
  if (r > 0) for (let p = 0; p < 2; p++) cur = pass(pass(cur, 1, 0), 0, 1)
  rgbSmoothCache.set(f, cur)
  return cur
}

export function colorizeRgbTile(f: GlobeField, z: number, x: number, y: number, size = GLOBE_TILE_SIZE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  if (!f.rgb) return out
  const rgb = smoothRgb3(f)
  const { ni, nj } = f.grid
  const ix0 = new Int32Array(size)
  const ix1 = new Int32Array(size)
  const fxs = new Float32Array(size)
  for (let px = 0; px < size; px++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, px, size))
    if (gx == null) {
      ix0[px] = -1
      continue
    }
    const i0 = Math.min(f.grid.global ? ni - 1 : ni - 2, Math.floor(gx))
    ix0[px] = i0
    ix1[px] = i0 + 1 === ni ? 0 : i0 + 1
    fxs[px] = gx - i0
  }
  // Reihenfolge des Übermalens: tief → mittel → hoch; Kanal im Bild: R mittel, G hoch, B tief
  const order: { ch: number; ramp: Rgb[] }[] = [
    { ch: 2, ramp: CLOUD_LAYER_RAMPS.low },
    { ch: 0, ramp: CLOUD_LAYER_RAMPS.mid },
    { ch: 1, ramp: CLOUD_LAYER_RAMPS.high },
  ]
  // Polrand wie in `colorizeTile`: eine Bedeckung je Schicht aus dem Ringmittel
  const ringCover = (side: 1 | -1): number[] => {
    const j = Math.min(nj - 1, Math.round(gridY(f.grid, side * POLE_RING_LAT) ?? 0))
    return [0, 1, 2].map((ch) => {
      let sum = 0
      let k = 0
      for (let i = 0; i < ni; i++) {
        const v = rgb[3 * (j * ni + i) + ch]
        if (v === v) {
          sum += v
          k++
        }
      }
      return k ? sum / k : NaN
    })
  }
  for (let py = 0; py < size; py++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, py, size))
    if (gy == null) continue
    const side = f.grid.global ? poleSide(z, y, py, size) : 0
    const ring = side ? ringCover(side) : null
    const j0 = Math.min(nj - 2, Math.floor(gy))
    const fy = gy - j0
    const r0 = j0 * ni
    const r1 = r0 + ni
    let o = py * size * 4
    for (let px = 0; px < size; px++, o += 4) {
      if (ix0[px] < 0) continue
      const a00 = 3 * (r0 + ix0[px])
      const a01 = 3 * (r0 + ix1[px])
      const a10 = 3 * (r1 + ix0[px])
      const a11 = 3 * (r1 + ix1[px])
      // NaN = kein Wert (gilt für alle drei Kanäle gemeinsam)
      const m = rgb[a00] + rgb[a01] + rgb[a10] + rgb[a11]
      if (m !== m) continue
      const fx = fxs[px]
      const w00 = (1 - fx) * (1 - fy)
      const w01 = fx * (1 - fy)
      const w10 = (1 - fx) * fy
      const w11 = fx * fy
      // vormultipliziert übermalen
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const { ch, ramp } of order) {
        const cover = ring ? ring[ch] : rgb[a00 + ch] * w00 + rgb[a01 + ch] * w01 + rgb[a10 + ch] * w10 + rgb[a11 + ch] * w11
        const oct = cover / 12.5
        // weich ausblenden: 0 bei 0,3/8, voll ab 0,9/8
        const fade = Math.min(1, Math.max(0, (oct - 0.3) / 0.6))
        if (fade === 0) continue
        const t = Math.min(7, Math.max(0, oct - 1))
        const k = Math.min(6, Math.floor(t))
        const u = t - k
        const c0 = ramp[k]
        const c1 = ramp[k + 1]
        const al = (CLOUD_OCTA_ALPHA[k] + (CLOUD_OCTA_ALPHA[k + 1] - CLOUD_OCTA_ALPHA[k]) * u) * fade
        r = (c0[0] + (c1[0] - c0[0]) * u) * al + r * (1 - al)
        g = (c0[1] + (c1[1] - c0[1]) * u) * al + g * (1 - al)
        b = (c0[2] + (c1[2] - c0[2]) * u) * al + b * (1 - al)
        a = al + a * (1 - al)
      }
      if (a === 0) continue
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = a * 255
    }
  }
  return out
}

export function globeTileUrl(model: GlobeModelId, runId: string, varId: GlobeVarId, step: number): string {
  return `${GLOBE_PROTOCOL}://${model}/${runId}/${varId}/${step}/{z}/{x}/{y}`
}

/**
 * Phasen-Summe einfärben (`kind: 'phase'`): je Teilpunkt Summe UND Schnee-Höhe aus dem
 * Gitter interpoliert, und die Rampe wählt das ECHTE Gelände unter dem Pixel
 * (`heights`, size × size in m) — liegt es über der Höhe, war die Summe dort
 * überwiegend Schnee. So läuft die Schneegrenze am Hang entlang, auch quer durch eine
 * 2,2-km-Zelle des Modells. Überabtastung und vormultiplizierte Mittelung wie bei
 * `colorizeTile`; nur regionale Gitter (ICON-D2), deshalb ohne Polrand.
 */
export function colorizePhaseTile(
  f: GlobeField,
  rain: ColorScale,
  snow: ColorScale,
  heights: Float32Array,
  z: number,
  x: number,
  y: number,
  size = GLOBE_TILE_SIZE,
): Uint8ClampedArray {
  const { ni, nj } = f.grid
  const zl = f.zline!
  const luts = [buildLut(rain), buildLut(snow)]
  const sMin = rain.stops[0].value
  const sMax = rain.stops[rain.stops.length - 1].value
  const lutK = (LUT_SIZE - 1) / (sMax - sMin)

  const sub = size * SUPERSAMPLE
  const ix0 = new Int32Array(sub)
  const fxs = new Float32Array(sub)
  for (let sx = 0; sx < sub; sx++) {
    const gx = gridX(f.grid, tilePixelLon(z, x, sx, sub))
    if (gx == null || gx > ni - 1) {
      ix0[sx] = -1
      continue
    }
    const i0 = Math.min(ni - 2, Math.floor(gx))
    ix0[sx] = i0
    fxs[sx] = gx - i0
  }
  const iy0s = new Int32Array(sub)
  const fys = new Float32Array(sub)
  for (let sy = 0; sy < sub; sy++) {
    const gy = gridY(f.grid, tilePixelLat(z, y, sy, sub))
    if (gy == null) {
      iy0s[sy] = -1
      continue
    }
    const j0 = Math.min(nj - 2, Math.floor(gy))
    iy0s[sy] = j0
    fys[sy] = gy - j0
  }

  const c = f.codes
  let lut = luts[0]
  /** LUT-Index des Teilpunkts, −1 = durchsichtig; setzt `lut` auf Regen oder Schnee. */
  const sample = (sx: number, sy: number, h: number): number => {
    const iy0 = iy0s[sy]
    const a = ix0[sx]
    if (iy0 < 0 || a < 0) return -1
    const r0 = iy0 * ni + a
    const r1 = r0 + ni
    const c00 = c[r0]
    const c01 = c[r0 + 1]
    const c10 = c[r1]
    const c11 = c[r1 + 1]
    if (c00 === 0 || c01 === 0 || c10 === 0 || c11 === 0) return -1
    const fx = fxs[sx]
    const fy = fys[sy]
    const w00 = (1 - fx) * (1 - fy)
    const w01 = fx * (1 - fy)
    const w10 = (1 - fx) * fy
    const w11 = fx * fy
    const v = f.lo + (c00 * w00 + c01 * w01 + c10 * w10 + c11 * w11 - 1) * f.step
    if (v < sMin) return -1
    const line = phaseLineM(zl[r0] * w00 + zl[r0 + 1] * w01 + zl[r1] * w10 + zl[r1 + 1] * w11)
    lut = luts[h > line ? 1 : 0]
    const li = Math.round((v - sMin) * lutK)
    return li > LUT_SIZE - 1 ? LUT_SIZE - 1 : li
  }

  const n = SUPERSAMPLE * SUPERSAMPLE
  const out = new Uint8ClampedArray(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const h = heights[py * size + px]
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let dy = 0; dy < SUPERSAMPLE; dy++)
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const li = sample(px * SUPERSAMPLE + dx, py * SUPERSAMPLE + dy, h)
          if (li < 0) continue
          const q = li * 4
          const al = lut[q + 3]
          sr += lut[q] * al
          sg += lut[q + 1] * al
          sb += lut[q + 2] * al
          sa += al
        }
      if (sa === 0) continue
      const o = (py * size + px) * 4
      out[o] = sr / sa
      out[o + 1] = sg / sa
      out[o + 2] = sb / sa
      out[o + 3] = sa / n
    }
  }
  return out
}
