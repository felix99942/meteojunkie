// Zeichen-/Projektions-Helfer der statischen Österreich-Klimakarte (Schritt 2).
//
// Bewusst leichtgewichtig und Canvas-basiert (kein MapLibre/Slippy-Map): eine
// feste WEB-MERCATOR-Projektion auf den Kartenausschnitt. Reicht für eine
// Übersichtskarte und rendert 1000+ Stationspunkte plus die Grenzlinien
// mühelos. Gleiche Idiome wie render/skewt.ts (Geometrie-Objekt + reine
// Zeichenfunktionen, DPR-Handling im Komponenten-Layer).
//
// MERCATOR, weil darunter Kartenkacheln (CARTO/OpenStreetMap) liegen, und die sind in
// EPSG:3857 gerechnet. Die frühere equirectangulare Projektion (mit fester
// cos(φ)-Korrektur der Mitte) hätte die Stationen gegen die Kacheln
// verschoben: im DACH-Ausschnitt ändert sich der Mercator-Massstab zwischen
// 45,6 und 55,2 °N um ein Viertel, am Kartenrand lägen die Punkte sichtbar
// neben ihrem Ort. Über der Österreich-Box sehen beide praktisch gleich aus.

/** Minimale Stationsform fürs Zeichnen — TAWES (AtStation) wie MOS erfüllen sie. */
export interface MapStation {
  name: string
  lat: number
  lon: number
  altitude?: number | null
  state?: string | null
}

/** Kartenausschnitt (Österreich mit etwas Rand). */
export const AT_VIEW = { latMin: 46.3, latMax: 49.1, lonMin: 9.4, lonMax: 17.2 }

/** Kartenausschnitt DACH (für den Vorhersage-Modus). */
export const DACH_VIEW = { latMin: 45.6, latMax: 55.2, lonMin: 5.6, lonMax: 17.3 }

export interface MapGeometry {
  left: number
  top: number
  width: number
  height: number
  /** Projektionsparameter (intern). */
  lonMin: number
  /** Mercator-y der Oberkante, in Grad-Äquivalent (siehe `mercY`). */
  yMax: number
  /** CSS-Pixel je Grad Länge (= je Grad Mercator-y). */
  scale: number
}

/**
 * Mercator-Ordinate in GRAD-Äquivalent: gleiche Einheit wie die Länge, damit
 * ein Massstab für beide Achsen gilt (die Projektion ist winkeltreu).
 */
export function mercY(lat: number): number {
  const phi = (lat * Math.PI) / 180
  return (Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180) / Math.PI
}

/** Projektionsgeometrie in ein Rechteck (CSS-Pixel) einpassen, Form erhalten. */
export function makeMapGeometry(
  left: number,
  top: number,
  width: number,
  height: number,
  view = AT_VIEW,
): MapGeometry {
  const yMax = mercY(view.latMax)
  const geoW = view.lonMax - view.lonMin
  const geoH = yMax - mercY(view.latMin)
  const scale = Math.min(width / geoW, height / geoH)
  // zentriert einpassen: verbleibenden Rand gleichmäßig verteilen
  const usedW = geoW * scale
  const usedH = geoH * scale
  return {
    left: left + (width - usedW) / 2,
    top: top + (height - usedH) / 2,
    width: usedW,
    height: usedH,
    lonMin: view.lonMin,
    yMax,
    scale,
  }
}

/** Geo-Koordinate → Canvas-Pixel. */
export function project(g: MapGeometry, lon: number, lat: number): { x: number; y: number } {
  return {
    x: g.left + (lon - g.lonMin) * g.scale,
    y: g.top + (g.yMax - mercY(lat)) * g.scale,
  }
}

// --- Kacheln (XYZ-Schema, wie OpenStreetMap und CARTO) -------------------

/** Höchste genutzte Zoomstufe (CARTO reicht bis 20, feiner braucht die Karte nie). */
export const TILE_MAX_ZOOM = 19
const TILE_PX = 256

/**
 * Zoomstufe, deren Kacheln bei diesem Massstab etwa 1:1 in GERÄTEpixeln
 * stehen. Gerundet statt aufgerundet: die Kacheln werden damit um höchstens
 * √2 gestreckt oder gestaucht — aufgerundet hiesse das bis zu viermal so
 * viele Abrufe für ein Bild, das man kaum schärfer sieht.
 */
export function tileZoom(scale: number, dpr = 1): number {
  const z = Math.round(Math.log2((scale * dpr * 360) / TILE_PX))
  return Math.max(0, Math.min(TILE_MAX_ZOOM, z))
}

export interface TileRect {
  z: number
  x: number
  y: number
  /** Linke obere Ecke und Kantenlänge in CSS-Pixeln (Kacheln sind quadratisch). */
  px: number
  py: number
  size: number
}

/** Bildschirmlage einer Kachel. */
export function tileRect(g: MapGeometry, z: number, x: number, y: number): TileRect {
  const n = 2 ** z
  const size = (360 / n) * g.scale
  const lon = (x / n) * 360 - 180
  const my = (1 - (2 * y) / n) * 180 // Mercator-y der Oberkante, Grad-Äquivalent
  return { z, x, y, px: g.left + (lon - g.lonMin) * g.scale, py: g.top + (g.yMax - my) * g.scale, size }
}

/** Alle Kacheln der Stufe z, die das Rechteck 0…w × 0…h (CSS-Pixel) berühren. */
export function visibleTiles(g: MapGeometry, z: number, w: number, h: number): TileRect[] {
  const n = 2 ** z
  const step = (360 / n) * g.scale
  const lonAt = (px: number) => g.lonMin + (px - g.left) / g.scale
  const myAt = (py: number) => g.yMax - (py - g.top) / g.scale
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v))
  const x0 = clamp(Math.floor(((lonAt(0) + 180) / 360) * n))
  const x1 = clamp(Math.floor(((lonAt(w) + 180) / 360) * n))
  const y0 = clamp(Math.floor(((1 - myAt(0) / 180) / 2) * n))
  const y1 = clamp(Math.floor(((1 - myAt(h) / 180) / 2) * n))
  const out: TileRect[] = []
  if (!(step > 0)) return out
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(tileRect(g, z, x, y))
  return out
}

/** Grenz-/Küstenlinien (GeoJSON-LineStrings, [lon,lat]) zeichnen. */
export function drawBorderLines(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  features: { geometry: { type: string; coordinates: number[][] } }[],
  color: string,
  lineWidth: number,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (const f of features) {
    const coords = f.geometry?.coordinates
    if (!coords || f.geometry.type !== 'LineString') continue
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = coords[i]
      const { x, y } = project(g, lon, lat)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Stationspunkte als Kreise zeichnen; optionaler Index wird hervorgehoben.
 * `colors` (parallel zu stations) färbt je Station ein; null/fehlt → `noDataFill`
 * (kleiner, gedämpft = „kein Wert"). Ohne `colors` bekommen alle `fill`.
 */
export function drawStationPoints(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  stations: MapStation[],
  opts: {
    radius: number
    fill: string
    stroke: string
    highlightIdx?: number
    highlightFill?: string
    /**
     * STARK markierte Station — die geöffnete bzw. die, auf die „In der Karte
     * zeigen" gesprungen ist. Sie behält ihre WERTFARBE und bekommt einen
     * Ring: die Farbe zu ersetzen (wie beim Hover) nähme ihr genau die
     * Information, wegen der man hingesprungen ist.
     */
    markedIdx?: number
    markStroke?: string
    colors?: (string | null)[]
    noDataFill?: string
  },
): void {
  ctx.save()
  ctx.lineWidth = 1
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]
    const { x, y } = project(g, s.lon, s.lat)
    const hl = i === opts.highlightIdx
    const mk = i === opts.markedIdx
    const perStation = opts.colors ? opts.colors[i] : opts.fill
    const noData = opts.colors && perStation == null
    const r = noData ? opts.radius - 0.8 : hl || mk ? opts.radius + 2 : opts.radius
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2)
    ctx.fillStyle =
      hl && !mk && opts.highlightFill
        ? opts.highlightFill
        : (perStation ?? opts.noDataFill ?? opts.fill)
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = opts.stroke
    ctx.stroke()
    if (mk && opts.markStroke) {
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.8, r) + 4, 0, Math.PI * 2)
      ctx.lineWidth = 2
      ctx.strokeStyle = opts.markStroke
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Rechteck mit runden Ecken als Pfad — `ctx.roundRect` ist jung (Safari 16.4). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Werte als Text direkt an die Stationen zeichnen (gut sichtbar: weiße Schrift
 * mit dunklem Halo). Überlappung wird bewusst in Kauf genommen. Stationen ohne
 * Wert bekommen kein Label. `format` wandelt den Zahlenwert in den Anzeigetext.
 */
export function drawStationLabels(
  ctx: CanvasRenderingContext2D,
  g: MapGeometry,
  stations: MapStation[],
  values: (number | null)[],
  format: (v: number) => string,
  opts: {
    colors?: (string | null)[]
    /** Leicht hervorgehoben (Hover): gelbe Schrift, gleiche Größe. */
    highlightIdx?: number
    /**
     * STARK markiert: größere Zahl in einem Kästchen, ZULETZT gezeichnet.
     *
     * Das ist die Station, die eine Frage ans Klimaarchiv beantwortet hat
     * („In der Karte zeigen") bzw. deren Detail offen ist. In einem Netz aus
     * bis zu 500 gleich aussehenden Zahlen war sie vorher nur an der
     * Schriftfarbe zu erkennen — zu wenig, um sie auf Anhieb zu finden.
     */
    markedIdx?: number
    markColor?: string
    /** Mindestabstand (px) zwischen Labels; >0 dünnt bei dichten Netzen aus. 0 = alle. */
    minGap?: number
  } = {},
): void {
  const { colors, highlightIdx, markedIdx, minGap = 0 } = opts
  const markColor = opts.markColor ?? '#ffd24a'
  ctx.save()
  ctx.font = '700 16px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  // Belegte Zellen (Raster in minGap-Auflösung) — schnelle Ausdünnung dichter Netze.
  const occupied = minGap > 0 ? new Set<string>() : null
  for (let i = 0; i < stations.length; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    // Die markierte Station kommt ZULETZT — ihr Kästchen soll über den
    // Nachbarlabels liegen, nicht unter ihnen.
    if (i === markedIdx) continue
    const { x, y } = project(g, stations[i].lon, stations[i].lat)
    if (occupied && i !== highlightIdx) {
      const cx = Math.floor(x / minGap)
      const cy = Math.floor(y / minGap)
      const key = `${cx},${cy}`
      if (occupied.has(key)) continue
      occupied.add(key)
    }
    const text = format(v)
    // Label über den Punkt setzen, damit der farbige Punkt sichtbar bleibt.
    const ty = y - 13
    // Kräftiger dunkler Halo, damit die farbige (auch mal dunkle) Schrift lesbar bleibt.
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.strokeText(text, x, ty)
    // Schrift in der Wertfarbe; hervorgehobene Station gelb, ohne Farbe hell.
    ctx.fillStyle = i === highlightIdx ? '#ffd24a' : (colors?.[i] ?? '#f4f2ee')
    ctx.fillText(text, x, ty)
  }

  const mv = markedIdx != null ? values[markedIdx] : null
  if (markedIdx != null && mv != null && Number.isFinite(mv)) {
    const { x, y } = project(g, stations[markedIdx].lon, stations[markedIdx].lat)
    const text = format(mv)
    ctx.font = '700 22px system-ui, sans-serif'
    const w = ctx.measureText(text).width + 16
    const h = 30
    // Über den Punkt, damit er frei bleibt — nach unten gespiegelt, wenn oben
    // kein Platz ist (Station am oberen Kartenrand).
    const above = y - h - 11 >= g.top
    const by = above ? y - h - 11 : y + 11
    roundRectPath(ctx, x - w / 2, by, w, h, 5)
    ctx.fillStyle = 'rgba(10,11,13,0.92)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = markColor
    ctx.stroke()
    ctx.fillStyle = markColor
    ctx.fillText(text, x, by + h / 2 + 1)
  }
  ctx.restore()
}

/**
 * Nächste Station zu einem Pixelpunkt finden (Hit-Test für Hover), oder -1.
 * `maxDist` in CSS-Pixeln.
 */
export function nearestStation(
  g: MapGeometry,
  stations: MapStation[],
  px: number,
  py: number,
  maxDist: number,
): number {
  let best = -1
  let bestD2 = maxDist * maxDist
  for (let i = 0; i < stations.length; i++) {
    const { x, y } = project(g, stations[i].lon, stations[i].lat)
    const d2 = (x - px) ** 2 + (y - py) ** 2
    if (d2 <= bestD2) {
      bestD2 = d2
      best = i
    }
  }
  return best
}
