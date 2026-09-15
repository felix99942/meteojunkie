// Canvas-Zeichenroutinen für die klassischen Meteogramm-Symbole der
// Wetterdienste: Wettersymbol (WMO-Code), Bedeckungsgrad in ACHTELN als
// WMO-Stationskreis und Windfiedern (Windbarbs) in Knoten.
//
// Bewusst reine Canvas-Primitive statt Icon-Font/SVG-Sprites: der ganze
// Diagrammstapel ist ein uPlot-Canvas, ein zweiter Renderpfad (DOM-Overlay)
// wäre beim Zoomen/Resizen nie deckungsgleich mit der Zeitachse.

import { wxClass, type WxClass } from '../config/wmo'

const SUN = '#e9b23a'
const MOON = '#c8cedb'
const CLOUD = '#c3c6cc'
const CLOUD_DARK = '#8d9096'
const RAIN = '#4f9ae8'
const SNOW = '#a8dcf0'
const BOLT = '#e9b23a'
const FOG = '#a9adb4'

/** Sonne: Scheibe mit acht Strahlen. */
function sun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = SUN
  ctx.strokeStyle = SUN
  ctx.lineWidth = Math.max(1, r * 0.16)
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2)
  ctx.fill()
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8)
    ctx.lineTo(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12)
    ctx.stroke()
  }
}

/** Mond: Sichel als Differenz zweier Kreise (Nachtstunden). */
function moon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.fillStyle = MOON
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cx + r * 0.34, cy - r * 0.26, r * 0.66, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Wolke: drei Bögen auf flacher Unterkante, mit dunklerer Kontur. */
function cloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, dark: boolean) {
  const r = w * 0.28
  ctx.beginPath()
  ctx.arc(cx - w * 0.26, cy, r * 0.86, Math.PI * 0.9, Math.PI * 2)
  ctx.arc(cx, cy - r * 0.52, r, Math.PI * 1.1, Math.PI * 1.95)
  ctx.arc(cx + w * 0.28, cy, r * 0.8, Math.PI * 1.2, Math.PI * 0.15)
  ctx.lineTo(cx - w * 0.34, cy + r * 0.82)
  ctx.closePath()
  ctx.fillStyle = dark ? CLOUD_DARK : CLOUD
  ctx.fill()
}

function drops(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, n: number) {
  ctx.strokeStyle = RAIN
  ctx.lineWidth = Math.max(1.2, w * 0.075)
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * w * 0.26
    ctx.beginPath()
    ctx.moveTo(x + w * 0.06, cy)
    ctx.lineTo(x - w * 0.04, cy + w * 0.24)
    ctx.stroke()
  }
}

function flakes(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, n: number) {
  ctx.strokeStyle = SNOW
  ctx.lineWidth = Math.max(1, w * 0.055)
  const r = w * 0.09
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * w * 0.28
    const y = cy + w * 0.12
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3
      ctx.beginPath()
      ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r)
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      ctx.stroke()
    }
  }
}

function bolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number) {
  ctx.fillStyle = BOLT
  ctx.beginPath()
  ctx.moveTo(cx + w * 0.08, cy - w * 0.02)
  ctx.lineTo(cx - w * 0.12, cy + w * 0.16)
  ctx.lineTo(cx - w * 0.01, cy + w * 0.16)
  ctx.lineTo(cx - w * 0.1, cy + w * 0.36)
  ctx.lineTo(cx + w * 0.15, cy + w * 0.11)
  ctx.lineTo(cx + w * 0.03, cy + w * 0.11)
  ctx.closePath()
  ctx.fill()
}

function fogBars(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number) {
  ctx.strokeStyle = FOG
  ctx.lineWidth = Math.max(1.2, w * 0.08)
  ctx.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const y = cy - w * 0.18 + i * w * 0.16
    const half = w * (i % 2 === 0 ? 0.4 : 0.32)
    ctx.beginPath()
    ctx.moveTo(cx - half, y)
    ctx.lineTo(cx + half, y)
    ctx.stroke()
  }
}

/**
 * Ein Wettersymbol, zentriert um (cx, cy), Kantenlänge ~`size`.
 * `day=false` ersetzt die Sonne durch den Mond — dieselbe Unterscheidung, die
 * jeder Wetterdienst in seinen Symbolsätzen macht.
 */
export function drawWxSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  code: number,
  day: boolean,
) {
  const kind: WxClass = wxClass(code)
  const w = size
  const luminary = (dx: number, dy: number, r: number) =>
    day ? sun(ctx, cx + dx, cy + dy, r) : moon(ctx, cx + dx, cy + dy, r)

  ctx.save()
  // Wie bei den Fiedern: ein von uPlot hinterlassenes Strichmuster würde sonst
  // die Symbolkonturen zerreißen.
  ctx.setLineDash([])
  switch (kind) {
    case 'clear':
      luminary(0, 0, w * 0.34)
      break
    case 'fewclouds':
      luminary(-w * 0.1, -w * 0.08, w * 0.3)
      cloud(ctx, cx + w * 0.12, cy + w * 0.14, w * 0.62, false)
      break
    case 'partly':
      luminary(-w * 0.2, -w * 0.16, w * 0.26)
      cloud(ctx, cx + w * 0.06, cy + w * 0.1, w * 0.78, false)
      break
    case 'overcast':
      cloud(ctx, cx - w * 0.08, cy - w * 0.02, w * 0.62, false)
      cloud(ctx, cx + w * 0.08, cy + w * 0.12, w * 0.78, true)
      break
    case 'fog':
      cloud(ctx, cx, cy - w * 0.16, w * 0.74, false)
      fogBars(ctx, cx, cy + w * 0.16, w * 0.7)
      break
    case 'drizzle':
      cloud(ctx, cx, cy - w * 0.14, w * 0.78, false)
      drops(ctx, cx, cy + w * 0.14, w * 0.6, 2)
      break
    case 'rain':
      cloud(ctx, cx, cy - w * 0.14, w * 0.78, true)
      drops(ctx, cx, cy + w * 0.12, w * 0.72, 3)
      break
    case 'showers':
      luminary(-w * 0.24, -w * 0.24, w * 0.22)
      cloud(ctx, cx + w * 0.04, cy - w * 0.1, w * 0.72, false)
      drops(ctx, cx + w * 0.04, cy + w * 0.16, w * 0.6, 2)
      break
    case 'snow':
      cloud(ctx, cx, cy - w * 0.14, w * 0.78, false)
      flakes(ctx, cx, cy + w * 0.08, w * 0.72, 3)
      break
    case 'snowshowers':
      luminary(-w * 0.24, -w * 0.24, w * 0.22)
      cloud(ctx, cx + w * 0.04, cy - w * 0.1, w * 0.72, false)
      flakes(ctx, cx + w * 0.04, cy + w * 0.1, w * 0.6, 2)
      break
    case 'freezing':
    case 'sleet':
      cloud(ctx, cx, cy - w * 0.14, w * 0.78, true)
      drops(ctx, cx - w * 0.14, cy + w * 0.12, w * 0.4, 1)
      flakes(ctx, cx + w * 0.14, cy + w * 0.08, w * 0.4, 1)
      break
    case 'thunder':
      cloud(ctx, cx, cy - w * 0.16, w * 0.8, true)
      bolt(ctx, cx, cy + w * 0.04, w)
      drops(ctx, cx - w * 0.2, cy + w * 0.14, w * 0.34, 1)
      break
  }
  ctx.restore()
}

/**
 * WMO-Stationskreis für den Bedeckungsgrad in ACHTELN, im Uhrzeigersinn ab
 * 12 Uhr gefüllt. Für 1/8 zeichnet der Schlüssel klassisch einen senkrechten
 * Strich statt eines (kaum sichtbaren) Achtelsektors — das ist hier
 * übernommen; die Zwischenstufen sind bewusst als monotoner Sektor gefüllt und
 * nicht in der historischen Quadranten-Notation, weil der Füllgrad so ohne
 * Schlüsseltabelle direkt als Anteil gelesen werden kann.
 *
 * ZWEI Farben, und das ist der Punkt: `cloudInk` füllt den BEWÖLKTEN Sektor
 * (dunkel), `clearInk` den Rest der Scheibe (hell) — bei 6/8 sind also drei
 * Viertel dunkel und ein Viertel hell. Mit einer Farbe stünde „hell" je nach
 * Stufe einmal für Wolke und einmal für freien Himmel, und das Symbol
 * widerspräche der Fläche, auf der es liegt.
 *
 * Damit trägt das Symbol seinen Kontrast selbst und bleibt auf jeder
 * Untergrundhelligkeit lesbar: ein heller Ring (`clearInk`) unter der Scheibe
 * sichert die Silhouette auf DUNKLEM Grund (8/8 auf bedeckter Fläche), die
 * Umrandung in `cloudInk` die Kante auf HELLEM Grund (0/8 auf sonniger
 * Fläche). Ohne den Ring verschwand die bedeckte Scheibe im bedeckten
 * Hintergrund.
 */
export function drawOctaSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  octa: number,
  cloudInk: string,
  clearInk: string,
) {
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = 1.3

  // Heller Ring als Silhouette (wie der Halo der Stadt-Labels).
  ctx.strokeStyle = clearInk
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r + 0.7, 0, Math.PI * 2)
  ctx.stroke()

  // Freier Himmel = die ganze Scheibe, davon wird der bewölkte Teil überdeckt.
  ctx.fillStyle = clearInk
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = cloudInk
  ctx.strokeStyle = cloudInk
  ctx.lineWidth = 1.3
  if (octa >= 8) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (octa === 1) {
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx, cy + r)
    ctx.stroke()
  } else if (octa > 0) {
    const start = -Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, start, start + (octa / 8) * Math.PI * 2)
    ctx.closePath()
    ctx.fill()
  }

  // Umrandung zuletzt, damit sie über der Sektorkante liegt.
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/**
 * Windfieder (Windbarb) nach WMO-Konvention: der Schaft zeigt in die Richtung,
 * AUS der der Wind kommt; die Fahnen sitzen am äußeren Ende. Ein Wimpel
 * (gefülltes Dreieck) = 50 kt, eine ganze Fieder = 10 kt, eine halbe = 5 kt,
 * gerundet auf 5 kt. Windstille (< 2,5 kt) ist der leere Kreis.
 *
 * Das ist die etablierte Darstellung der Wetterdienste — anders als ein
 * Richtungspfeil trägt sie Richtung UND Stärke in einem Symbol, weshalb sie
 * hier den früheren Pfeil ersetzt.
 *
 * Seitenwahl: auf der Nordhalbkugel sitzen die Fahnen im Uhrzeigersinn zum
 * Schaft (bei Nordwind, Schaft nach oben, also rechts).
 */
export function drawWindBarb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  speedKmh: number,
  dirDeg: number,
  len: number,
  color: string,
) {
  const kt = speedKmh / 1.852
  ctx.save()
  // ACHTUNG: uPlot lässt das Strichmuster der zuletzt gezeichneten Serie im
  // Kontext stehen (die gestrichelten Böen im Wind-Diagramm). Ohne dieses
  // Zurücksetzen kämen die Fiedern gestrichelt heraus.
  ctx.setLineDash([])
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.6
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  if (kt < 2.5) {
    ctx.beginPath()
    ctx.arc(cx, cy, len * 0.16, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.translate(cx, cy)
  // Canvas dreht bei positivem Winkel im Uhrzeigersinn (y nach unten), ein
  // nach oben gezeichneter Schaft entspricht damit direkt der Kompassrichtung.
  ctx.rotate((dirDeg * Math.PI) / 180)

  const tip = -len / 2
  const base = len / 2
  // Fahnen sitzen am äußeren Ende (Spitze) und laufen zum Schaftende hin.
  const spacing = len * 0.16
  const featherW = len * 0.4
  const featherDrop = spacing * 0.62

  let rest = Math.round(kt / 5) * 5
  let y = tip
  const pennants = Math.floor(rest / 50)
  rest -= pennants * 50
  const fulls = Math.floor(rest / 10)
  rest -= fulls * 10
  const half = rest >= 5

  // Schaft erst so lang zeichnen, wie die Fahnen brauchen — mindestens aber
  // die volle Länge, damit alle Fiedern gleich lang aussehen.
  ctx.beginPath()
  ctx.moveTo(0, base)
  ctx.lineTo(0, tip)
  ctx.stroke()

  for (let i = 0; i < pennants; i++) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(featherW, y + featherDrop)
    ctx.lineTo(0, y + spacing * 0.92)
    ctx.closePath()
    ctx.fill()
    // Nach einem Wimpel ein kleiner Abstand, sonst verschmelzen zwei Wimpel.
    y += spacing * 1.12
  }
  for (let i = 0; i < fulls; i++) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(featherW, y + featherDrop)
    ctx.stroke()
    y += spacing
  }
  if (half) {
    // Halbe Fieder nie direkt am Schaftende: dort läse sie sich als ganze.
    if (y === tip) y += spacing
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(featherW * 0.5, y + featherDrop * 0.5)
    ctx.stroke()
  }
  ctx.restore()
}
