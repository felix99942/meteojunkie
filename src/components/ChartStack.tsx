// Gemeinsamer Baustein für „Stapel aus kleinen Zeitreihen-Diagrammen mit
// gemeinsamer Zeitachse" — ursprünglich für die MOS-Punktvorhersage gebaut
// (AtForecastDetail), jetzt auch vom klassischen Meteogramm genutzt
// (ClassicMeteogram). EIN Ort für uPlot-Setup, Cursor-Sync über `uPlot.sync`
// (gemeinsamer Fadenkreuz-Cursor über alle Reihen eines Stapels) und die
// Zeichen-Plugins, die ein Meteogramm nach dem Vorbild der Wetterdienste
// ausmachen: Wettersymbolzeile, Bedeckung in Achteln, Windfiedern,
// Tag/Nacht-Schattierung, Bezugslinien.
//
// WICHTIG — Spaltenausrichtung: alle Zeilen eines Stapels müssen dieselbe
// Zeitachse an derselben x-Position haben, sonst kann man senkrecht nicht
// mehr ablesen. Deshalb reserviert JEDE Zeile links und rechts dieselbe
// Achsenbreite (`Y_AXIS_SIZE`/`RIGHT_AXIS_SIZE`), auch wenn sie dort nichts
// beschriftet (Wettersymbol- und Bewölkungszeile). Achsen einfach
// auszublenden hätte die Zeilen gegeneinander verschoben.

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import {
  RIGHT_AXIS_SIZE,
  Y_AXIS_SIZE,
  type ChartDef,
  type Curve,
  type FlagRows,
  type OctaRows,
  type Symbols,
} from '../config/chartDef'
import { drawOctaSymbol, drawWindBarb, drawWxSymbol } from '../render/wxsymbols'
import { toOcta, wxLabel } from '../config/wmo'

const INK_MUTED = '#898781'
const INK = '#e8e6df'
/** Seitenhintergrund — als Tinte auf hellen Flächen (siehe octaInk). */
const PAGE_BG = '#101113'
const GRIDLINE = '#2c2c2a'
// Tagesgrenze: deutlich heller als das Stundenraster — sie trennt die Tage,
// nicht nur zwei Stunden.
const GRIDLINE_DAY = '#5f5f57'
/** Datumskennzeichnung: das Auffälligste an der Zeitachse, deshalb hell und fett. */
const DAY_FONT = '600 13px system-ui, sans-serif'
/** Höhe des Datumsstreifens unter jedem Diagramm. Knapp über der 13-px-Schrift. */
const DAY_STRIP_H = 16
/**
 * Höhe der Stundenachse. uPlots Vorgabe ist 30 px und auf eine Achse mit
 * Datumsbeschriftung ausgelegt — hier stehen nur zwei Ziffern in 10-px-Schrift.
 * In einem STAPEL zahlt man das je Zeile: sechs Zeilen × 10 px sind eine halbe
 * Diagrammhöhe, die zwischen den Kurven leer stand.
 */
const X_AXIS_SIZE = 20
const AXIS_FONT = '10px system-ui, sans-serif'
/* Jenseits des Modellhorizonts: Schleier, Schraffur und Kante. Der Schleier
   liegt ÜBER dem Inhalt, deshalb halbdeckend in der Seitenfarbe — er soll
   dämpfen, nicht ausradieren. */
const VEIL_FILL = 'rgba(16,17,19,0.62)'
const VEIL_HATCH = 'rgba(137,135,129,0.16)'
const VEIL_EDGE = 'rgba(137,135,129,0.45)'
const VEIL_HATCH_STEP = 7
/** Werteanzeige beim Überfahren: klar lesbar, deutlich über der Achsenschrift. */
const READOUT_FONT = '600 12px system-ui, sans-serif'
const READOUT_LINE = '#f0c04a'
const CHIP_BG = 'rgba(18,19,21,0.95)'
// Tagesmaxima/-minima sind die Zahlen, die man aus zwei Metern Abstand lesen
// können soll — deutlich größer als die Achsenbeschriftung.
const EXTREME_FONT = '700 13px system-ui, sans-serif'
const MARK = '#e8b23a'
// Deckt Streifen ab, damit Kurven nie hindurchlaufen — dieselbe Fläche wie der
// Rest der Chart-Canvas (siehe --bg-panel in index.css).
const BG_PANEL = '#18191b'
/**
 * Nachtschattierung: deutlich dunkler als die Panelfläche und leicht ins
 * Blaue gezogen — der Farbstich macht den Unterschied bei gleicher Helligkeit
 * schneller erkennbar als reines Abdunkeln. Kurven bleiben darüber lesbar.
 * Die Kante bekommt zusätzlich eine feine Linie: der Übergang liegt sonst
 * unscharf im Verlauf und man sucht, wo genau die Nacht anfängt.
 */
const NIGHT_FILL = 'rgba(3,9,26,0.55)'
const NIGHT_EDGE = 'rgba(150,180,225,0.30)'

/** uPlot-Scale-Schlüssel der rechten y-Achse. */
const RIGHT_SCALE = 'yr'

/** #rrggbb + Deckkraft → rgba() für Flächenfüllungen. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/**
 * Abstand zwischen gezeichneten Symbolen in DATENPUNKTEN (= Stunden), auf ein
 * „rundes" Vielfaches gerastert: 1, 2, 3, 6, 12 oder 24 Stunden. Ein aus der
 * Breite gerechneter krummer Schritt (13 h, 11 h …) setzte die Symbole auf
 * wandernde Uhrzeiten und ließ Wettersymbole, Achtel-Kreise und Windfiedern
 * senkrecht gegeneinander versetzt stehen.
 */
const NICE_STEPS = [1, 2, 3, 6, 12, 24]
/** Kleinster sinnvoller Fiedern-Abstand in px — darunter trägt das Symbol nichts mehr. */
const MIN_BARB_GAP = 9
function symbolStep(u: uPlot, count: number, minPxGap: number): number {
  const pxPerPoint = u.bbox.width / Math.max(count - 1, 1)
  for (const step of NICE_STEPS) if (step * pxPerPoint >= minPxGap) return step
  return NICE_STEPS[NICE_STEPS.length - 1]
}

/** Pixelbreite einer Stunde (für Rasterflächen und Symbolabstände). */
function slotWidth(u: uPlot, i: number): number {
  const xs = u.data[0]
  const x0 = u.valToPos(xs[i], 'x', true)
  const next = i + 1 < xs.length ? u.valToPos(xs[i + 1], 'x', true) : x0 + (x0 - u.valToPos(xs[i - 1] ?? xs[i], 'x', true))
  return Math.max(1, next - x0)
}

/**
 * Tag/Nacht-Schattierung: Nachtstunden (`is_day == 0`) bekommen eine dunklere
 * Fläche. Läuft im `drawClear`-Hook, also UNTER Gitter und Kurven.
 */
function nightPlugin(night: (number | null)[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const xs = u.data[0]
        const ctx = u.ctx
        ctx.save()
        ctx.setLineDash([])
        ctx.fillStyle = NIGHT_FILL
        for (let i = 0; i < xs.length; i++) {
          if (night[i] !== 0) continue
          const x = u.valToPos(xs[i], 'x', true)
          ctx.fillRect(x, u.bbox.top, slotWidth(u, i) + 0.5, u.bbox.height)
        }
        // Kanten: dort, wo der Tag/Nacht-Zustand wechselt (Sonnenauf- und
        // -untergang laut Modell).
        ctx.strokeStyle = NIGHT_EDGE
        ctx.lineWidth = 1
        for (let i = 1; i < xs.length; i++) {
          const a = night[i - 1]
          const b = night[i]
          if (a == null || b == null || a === b) continue
          const x = Math.round(u.valToPos(xs[i], 'x', true)) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, u.bbox.top)
          ctx.lineTo(x, u.bbox.top + u.bbox.height)
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Flächen zwischen zwei Kurven (`Curve.fillTo`): gefüllt wird der Streifen
 * von der Kurve hinunter zu einer anderen, statt bis zur Nulllinie.
 *
 * Muss ein eigener Zeichner sein: uPlots `fillTo` nimmt nur EINEN Skalarwert
 * als Boden, hier ist der Boden eine Kurve. Im `drawAxes`-Hook, also über dem
 * Gitter und den Bezugslinien, aber UNTER den Linien — beide Kanten des
 * Streifens bleiben so sichtbar.
 */
function bandPlugin(curves: Curve[]): uPlot.Plugin {
  return {
    hooks: {
      drawAxes: (u) => {
        const xs = u.data[0]
        const ctx = u.ctx
        ctx.save()
        // Strichmuster einer vorher gezeichneten Serie würde die Kanten
        // gestrichelt einfärben (siehe die übrigen Zeichner hier).
        ctx.setLineDash([])
        for (const c of curves) {
          if (c.fillTo == null || c.fill == null) continue
          const floor = curves[c.fillTo]?.values
          if (!floor) continue
          const scale = c.rightAxis ? RIGHT_SCALE : 'y'
          ctx.fillStyle = withAlpha(c.color, c.fill)
          // Zusammenhängende Läufe einzeln füllen: über eine Lücke hinweg
          // (Modellhorizont, fehlender Member) darf keine Fläche gezogen
          // werden — sie behauptete sonst Werte, die es nicht gibt.
          let i = 0
          while (i < xs.length) {
            if (c.values[i] == null || floor[i] == null) {
              i++
              continue
            }
            let j = i
            while (j + 1 < xs.length && c.values[j + 1] != null && floor[j + 1] != null) j++
            if (j > i) {
              ctx.beginPath()
              for (let m = i; m <= j; m++) {
                const x = u.valToPos(xs[m], 'x', true)
                const y = u.valToPos(c.values[m]!, scale, true)
                if (m === i) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              for (let m = j; m >= i; m--) {
                ctx.lineTo(u.valToPos(xs[m], 'x', true), u.valToPos(floor[m]!, scale, true))
              }
              ctx.closePath()
              ctx.fill()
            }
            i = j + 1
          }
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Bereich jenseits des Modellhorizonts ausgrauen (`ChartDef.veil`).
 *
 * Im `draw`-Hook, also ÜBER Gitter, Bezugslinien und Kurven: der Schleier soll
 * alles dämpfen, was dort noch hineinragt. In der Fläche stehen ohnehin keine
 * Werte — gedämpft werden Gitterlinien und die durchlaufenden Bezugslinien,
 * die sonst eine leere Fläche wie eine gefüllte aussehen lassen.
 *
 * Drei Teile, und jeder trägt etwas: der Schleier nimmt dem Bereich das
 * Gewicht, die feine Schraffur unterscheidet „keine Daten" von „Wert null"
 * (ein flacher Nullverlauf sähe sonst genauso leer aus), die Kante sagt genau,
 * wo der Horizont liegt.
 */
function veilPlugin(veil: NonNullable<ChartDef['veil']>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const x0 = u.valToPos(veil.from / 1000, 'x', true)
        const right = u.bbox.left + u.bbox.width
        if (!Number.isFinite(x0) || x0 >= right) return
        const x = Math.max(x0, u.bbox.left)
        const w = right - x
        if (w < 2) return
        const top = u.bbox.top
        const h = u.bbox.height

        const ctx = u.ctx
        ctx.save()
        // Jeder eigene Zeichner muss das Strichmuster der zuletzt gezeichneten
        // Serie zurücksetzen, sonst wird die Kante gestrichelt.
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.rect(x, top, w, h)
        ctx.fillStyle = VEIL_FILL
        ctx.fill()

        // Schraffur nur innerhalb der Fläche.
        ctx.clip()
        ctx.strokeStyle = VEIL_HATCH
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let d = -h; d < w; d += VEIL_HATCH_STEP) {
          ctx.moveTo(x + d, top + h)
          ctx.lineTo(x + d + h, top)
        }
        ctx.stroke()

        // Kante am Horizont — nur wenn er wirklich im Bild liegt.
        if (x0 > u.bbox.left) {
          ctx.strokeStyle = VEIL_EDGE
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(Math.round(x0) + 0.5, top)
          ctx.lineTo(Math.round(x0) + 0.5, top + h)
          ctx.stroke()
        }

        // Beschriftung nur, wenn sie ganz hineinpasst — ein abgeschnittenes
        // Wort ist schlechter als keines. Bei den schmalen Föhn-Kacheln und
        // bei der Kriterienleiste (wenige Pixel hoch) fällt sie deshalb weg.
        if (veil.label && h >= 34) {
          ctx.font = AXIS_FONT
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          const tw = ctx.measureText(veil.label).width
          if (tw + 16 <= w) {
            ctx.fillStyle = INK_MUTED
            ctx.fillText(veil.label, x + w / 2, top + h / 2)
          }
        }
        ctx.restore()
      },
    },
  }
}

/** Waagrechte Bezugslinie (0 °C) — über dem Gitter, unter den Kurven. */
function refLinePlugin(lines: NonNullable<ChartDef['refLines']>): uPlot.Plugin {
  return {
    hooks: {
      drawAxes: (u) => {
        const ctx = u.ctx
        ctx.save()
        for (const l of lines) {
          const y = u.valToPos(l.value, 'y', true)
          if (!Number.isFinite(y) || y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue
          ctx.strokeStyle = l.color
          ctx.lineWidth = 1
          ctx.setLineDash(l.dash ?? [])
          ctx.beginPath()
          ctx.moveTo(u.bbox.left, Math.round(y) + 0.5)
          ctx.lineTo(u.bbox.left + u.bbox.width, Math.round(y) + 0.5)
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Windfiedern-Streifen am oberen Rand des Wind-Diagramms — die etablierte
 * Darstellung der Wetterdienste (Richtung UND Stärke in einem Symbol, in
 * Knoten). Bewusst ein eigener Streifen und NICHT entlang der schwankenden
 * Geschwindigkeitslinie: dort wäre er bei Flaute unlesbar und bei Sturm von
 * der Linie überdeckt. Der Streifen deckt sich dafür selbst ab, damit die
 * Kurve nie hindurchläuft.
 */
function windBarbStripPlugin(
  curve: Curve,
  color: string,
  reserve: number,
  gap: number,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const dir = curve.direction
        if (!dir) return
        const xs = u.data[0]
        // Der Streifen bleibt INNERHALB des oben reservierten Anteils
        // (`ChartDef.topReserve`, dieselbe Zahl streckt die y-Skala) — etwas
        // niedriger, damit zwischen Kurvenspitze und Fiedern Luft bleibt.
        // Eine feste Pixelhöhe hätte sich bei anderer Zeilenhöhe von der
        // Skalenstreckung gelöst und die Kurve wieder verdeckt.
        const stripH = u.bbox.height * reserve * 0.84
        const ctx = u.ctx
        ctx.save()
        // Die Böen-Serie hinterlässt ihr Strichmuster im Kontext — sonst wäre
        // die Trennlinie des Streifens gestrichelt.
        ctx.setLineDash([])
        ctx.strokeStyle = GRIDLINE
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(u.bbox.left, u.bbox.top + stripH + 0.5)
        ctx.lineTo(u.bbox.left + u.bbox.width, u.bbox.top + stripH + 0.5)
        ctx.stroke()

        const y = u.bbox.top + stripH / 2
        // Unter ~9 px ist eine Fieder nur noch ein Strich — Boden, auch wenn
        // die Kachel einen kleineren Abstand anfordert.
        const step = symbolStep(u, xs.length, Math.max(gap, MIN_BARB_GAP))
        // Die Länge folgt dem TATSÄCHLICHEN Abstand, nicht einer festen Zahl:
        // bei dichter Reihung würden 30-px-Fiedern ineinanderlaufen, und die
        // Fahnen stehen quer zum Schaft, brauchen also rundum Platz. 0,95 ×
        // Abstand lässt eine Haarlinie Luft zwischen zwei Symbolen.
        const pxStep = step * (u.bbox.width / Math.max(xs.length - 1, 1))
        const len = Math.min(stripH * 0.86, 30, pxStep * 0.95)
        for (let i = 0; i < xs.length; i += step) {
          const d = dir[i]
          const v = curve.values[i]
          if (d == null || v == null) continue
          const x = u.valToPos(xs[i], 'x', true)
          if (!Number.isFinite(x)) continue
          drawWindBarb(ctx, x, y, v, d, len, color)
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Bewölkung im klassischen Meteogramm-Schema, zwei Ebenen übereinander:
 *
 *  1. FLÄCHE — je Zeile (Höhenniveau) und STUNDE eine Schattierung nach dem
 *     Bedeckungsgrad. Sie zeigt den Verlauf lückenlos, auch zwischen den
 *     Symbolen, und macht auf einen Blick sichtbar, in welchem Niveau die
 *     Bewölkung sitzt.
 *  2. SYMBOL — darüber, in gröberem Abstand, der WMO-Stationskreis mit dem
 *     Bedeckungsgrad in ACHTELN. Er sagt „5 von 8" genau, wo die Fläche nur
 *     „ungefähr" sagt.
 *
 * Helligkeitsrichtung: SONNIG = HELL, BEDECKT = DUNKEL — wie der Himmel
 * aussieht, nicht wie das gedruckte Meteogramm auf weißem Papier. Die Fläche
 * ist damit eine Helligkeitsskala und muss nicht übersetzt werden.
 *
 * Preis dafür: das Symbol kann nicht in einer festen Farbe gezeichnet werden.
 * Ein helles Symbol verschwindet über „sonnig", ein dunkles über „bedeckt" —
 * `octaInk()` dreht es deshalb am Grauwert der Fläche unter ihm. Dieselbe
 * Regel gilt für die Achtel-ZAHL daneben.
 *
 * Die Zeilenbeschriftung kommt aus der linken y-Achse (Splits auf den
 * Zeilenmitten), nicht aus dem Plugin: sie steht damit außerhalb der Fläche
 * und verdeckt keine Symbole.
 */
/**
 * Grauwert der Bedeckungsfläche: wolkenlos = hell, bedeckt = dunkel.
 *
 * Das dunkle Ende bleibt bewusst ÜBER der Panelfläche (~25): läge „bedeckt"
 * genau darauf, wäre es von „kein Wert" nicht zu unterscheiden — und das sind
 * zwei sehr verschiedene Aussagen.
 */
const CLOUD_SHADE_CLEAR = 128
const CLOUD_SHADE_OVERCAST = 42

/** Lesbare Symbolfarbe auf einer Fläche dieses Grauwerts. */
function octaInk(shade: number): string {
  return shade > 96 ? PAGE_BG : INK
}

/** Bedeckungsanteil 0…1 → Grauwert der Fläche. */
function cloudShade(t: number): number {
  return Math.round(CLOUD_SHADE_CLEAR + t * (CLOUD_SHADE_OVERCAST - CLOUD_SHADE_CLEAR))
}

function octaRowsPlugin(octaRows: OctaRows): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const xs = u.data[0]
        const rows = octaRows.rows
        const n = rows.length
        if (n === 0 || xs.length === 0) return
        const ctx = u.ctx
        ctx.save()
        ctx.setLineDash([])
        const rowH = u.bbox.height / n

        // 1. Fläche: jede Stunde, volle Zeilenhöhe.
        for (let ri = 0; ri < n; ri++) {
          const vals = rows[ri].values
          const top = u.bbox.top + ri * rowH
          for (let i = 0; i < xs.length; i++) {
            const v = vals[i]
            if (v == null) continue
            const t = Math.max(0, Math.min(1, v / 100))
            const shade = cloudShade(t)
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`
            ctx.fillRect(u.valToPos(xs[i], 'x', true), top, slotWidth(u, i), rowH)
          }
        }

        // 2. Symbole darüber — so dicht, wie die Breite es hergibt; jede
        // Stunde wäre ein unlesbarer Kreisteppich.
        const step = symbolStep(u, xs.length, 26)
        const gapPx = (u.bbox.width / Math.max(xs.length - 1, 1)) * step
        const r = Math.max(3, Math.min(6.5, rowH * 0.3, gapPx * 0.26))
        ctx.font = AXIS_FONT
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        for (let ri = 0; ri < n; ri++) {
          const row = rows[ri]
          const cy = u.bbox.top + rowH * (ri + 0.5)
          for (let i = 0; i < xs.length; i += step) {
            const v = row.values[i]
            if (v == null) continue
            const x = u.valToPos(xs[i], 'x', true)
            if (!Number.isFinite(x)) continue
            const octa = toOcta(v)
            // Farbe folgt der Fläche UNTER dem Symbol, nicht der Zeile: in
            // einer Zeile wechselt die Helligkeit von Stunde zu Stunde.
            const ink = octaInk(cloudShade(Math.max(0, Math.min(1, v / 100))))
            // Symbol mit ZWEI Farben: der bewölkte Sektor dunkel, der freie
            // Himmel hell — dieselbe Leserichtung wie die Fläche darunter.
            // Es trägt seinen Kontrast selbst (heller Ring), braucht also
            // keine Anpassung an den Untergrund; die ZAHL daneben liegt
            // dagegen direkt auf der Fläche und schon.
            drawOctaSymbol(ctx, x, cy, r, octa, PAGE_BG, INK)
            // Die Zahl nur in der Gesamtzeile: viermal beziffert wäre die
            // Fläche wieder zugestellt.
            if (row.withNumber && gapPx > 26) {
              ctx.fillStyle = ink
              ctx.fillText(String(octa), x + r + 2.5, cy + 0.5)
            }
          }
        }

        // Zeilentrenner.
        ctx.strokeStyle = GRIDLINE
        ctx.lineWidth = 1
        for (let ri = 1; ri < n; ri++) {
          const y = Math.round(u.bbox.top + ri * rowH) + 0.5
          ctx.beginPath()
          ctx.moveTo(u.bbox.left, y)
          ctx.lineTo(u.bbox.left + u.bbox.width, y)
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/** Markierung „Modell liefert das nicht" im Kriterien-Streifen. */
const NA_FILL = 'rgba(137,135,129,0.28)'

/**
 * Kriterien-Streifen (Föhn): je Zeile ein Kriterium, je Stunde eine Zelle.
 * Erfüllt = volle Zelle in der Zeilenfarbe (Anteile wie „3 von 4" als
 * Deckkraft), nicht erfüllt = leer, nicht verfügbar = schmaler grauer Balken
 * in der Zeilenmitte. Die Zeilenbeschriftung kommt wie bei den Achtel-Zeilen
 * aus der linken y-Achse.
 */
function flagRowsPlugin(flagRows: FlagRows): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const xs = u.data[0]
        const rows = flagRows.rows
        const n = rows.length
        if (n === 0 || xs.length === 0) return
        const ctx = u.ctx
        ctx.save()
        ctx.setLineDash([])
        const rowH = u.bbox.height / n
        for (let ri = 0; ri < n; ri++) {
          const row = rows[ri]
          const top = u.bbox.top + ri * rowH
          for (let i = 0; i < xs.length; i++) {
            const v = row.values[i]
            const x = u.valToPos(xs[i], 'x', true)
            if (!Number.isFinite(x)) continue
            const w = slotWidth(u, i)
            if (v == null) {
              ctx.fillStyle = NA_FILL
              ctx.fillRect(x, top + rowH * 0.44, w, Math.max(1, rowH * 0.12))
            } else if (v > 0) {
              ctx.fillStyle = withAlpha(row.color, 0.2 + 0.75 * Math.min(1, v))
              ctx.fillRect(x, top + 1.5, w, rowH - 3)
            }
          }
        }
        ctx.strokeStyle = GRIDLINE
        ctx.lineWidth = 1
        for (let ri = 1; ri < n; ri++) {
          const y = Math.round(u.bbox.top + ri * rowH) + 0.5
          ctx.beginPath()
          ctx.moveTo(u.bbox.left, y)
          ctx.lineTo(u.bbox.left + u.bbox.width, y)
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Wettersymbolzeile aus dem WMO-Code — die oberste Zeile jedes klassischen
 * Meteogramms. Dichte an der Breite orientiert; gezeigt wird der Code der
 * jeweils getroffenen Stunde (keine Aggregation über das Intervall, sonst
 * stünde dort ein Wetter, das das Modell so nicht vorhersagt).
 */
function symbolsPlugin(symbols: Symbols): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const xs = u.data[0]
        const ctx = u.ctx
        const step = symbolStep(u, xs.length, 32)
        const gapPx = (u.bbox.width / Math.max(xs.length - 1, 1)) * step
        // Ohne Achsenbeiwerk unter der Zeile darf das Symbol die Höhe fast
        // ganz ausnutzen; die Breite bleibt die zweite Schranke.
        const size = Math.min(u.bbox.height * 0.92, gapPx * 0.8)
        const cy = u.bbox.top + u.bbox.height / 2
        ctx.save()
        for (let i = 0; i < xs.length; i += step) {
          const code = symbols.codes[i]
          if (code == null) continue
          const x = u.valToPos(xs[i], 'x', true)
          if (!Number.isFinite(x)) continue
          drawWxSymbol(ctx, x, cy, size, code, (symbols.isDay?.[i] ?? 1) !== 0)
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Beschriftete Einzelpunkte auf der Kurve — im Meteogramm die TAGESMAXIMA der
 * Temperatur: Punkt auf dem Kurvenwert plus die Zahl darüber. Der Punkt
 * bekommt einen Ring in Panelfarbe und die Schrift einen Halo, damit beides
 * auch über Gitterlinien und Nachtfläche lesbar bleibt.
 */
function pointMarkPlugin(markSets: NonNullable<ChartDef['marks']>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx
        ctx.save()
        // uPlot lässt das Strichmuster der letzten Serie stehen.
        ctx.setLineDash([])
        ctx.font = EXTREME_FONT
        ctx.textAlign = 'center'
        ctx.lineJoin = 'round'
        for (const marks of markSets) {
        for (const m of marks.points) {
          const x = u.valToPos(m.t, 'x', true)
          const y = u.valToPos(m.value, 'y', true)
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          ctx.beginPath()
          ctx.arc(x, y, 5.2, 0, Math.PI * 2)
          ctx.fillStyle = BG_PANEL
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, y, 3.4, 0, Math.PI * 2)
          ctx.fillStyle = marks.color
          ctx.fill()
          // Maxima über den Punkt, Minima darunter — und gespiegelt, wenn auf
          // der bevorzugten Seite kein Platz mehr ist.
          const roomAbove = y - 13 > u.bbox.top
          const roomBelow = y + 13 < u.bbox.top + u.bbox.height
          const above = marks.place === 'below' ? !roomBelow : roomAbove
          ctx.textBaseline = above ? 'bottom' : 'top'
          const ty = above ? y - 8 : y + 9
          // An den Rändern einziehen, sonst wird die Zahl abgeschnitten — und
          // zusätzlich in die eigene Zeitspanne (beim Tagesmaximum der
          // Kalendertag), damit ein Maximum am Tagesrand nicht über der
          // Tagesgrenze beschriftet wird.
          const half = ctx.measureText(m.label).width / 2 + 2
          let lo = u.bbox.left + half
          let hi = u.bbox.left + u.bbox.width - half
          if (m.spanStart != null && m.spanEnd != null) {
            const sx = u.valToPos(m.spanStart, 'x', true)
            const ex = u.valToPos(m.spanEnd, 'x', true)
            if (Number.isFinite(sx) && Number.isFinite(ex) && ex - sx > 2 * half) {
              lo = Math.max(lo, sx + half)
              hi = Math.min(hi, ex - half)
            }
          }
          const tx = Math.min(Math.max(x, lo), Math.max(lo, hi))
          // Halo in Panelfarbe, damit die Zahl über Gitter, Nachtfläche und
          // Kurve lesbar bleibt; die Zahl selbst in der Farbe ihres Punkts.
          ctx.lineWidth = 3.5
          ctx.strokeStyle = BG_PANEL
          ctx.strokeText(m.label, tx, ty)
          ctx.fillStyle = marks.color
          ctx.fillText(m.label, tx, ty)
        }
        }
        ctx.restore()
      },
    },
  }
}

/** Abgerundetes Kästchen — `roundRect` fehlt in älteren Engines. */
function chipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 3)
  else ctx.rect(x, y, w, h)
}

/**
 * WERTEANZEIGE beim Verweilen: senkrechte Linie plus je Kurve ein Kästchen mit
 * Wert und Einheit direkt am Kurvenpunkt. Auch Zeilen ohne Kurven geben
 * Auskunft — die Bewölkung ihre Achtel je Höhenniveau, die Symbolzeile den
 * WMO-Klartext.
 *
 * Sie folgt dem Zeiger unmittelbar. Neu gezeichnet wird aber nur beim WECHSEL
 * der Stunde (Guard in `ClassicMeteogram`), nicht bei jeder Mausbewegung —
 * sonst liefen sechs Redraws pro Pixel. Der Zeitpunkt gilt über den ganzen
 * Stapel.
 */
function readoutPlugin(
  timeRef: { current: number | undefined },
  chart: ChartDef,
  labelRef: { current: string | undefined },
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const t = timeRef.current
        if (t == null) return
        const xs = u.data[0]
        if (xs.length < 2) return
        // Gleichmäßiges Stundenraster → Index direkt rechnen statt suchen.
        const stepSec = xs[1] - xs[0]
        const idx = Math.round((t / 1000 - xs[0]) / stepSec)
        if (idx < 0 || idx >= xs.length) return
        const x = u.valToPos(xs[idx], 'x', true)
        if (!Number.isFinite(x)) return

        const ctx = u.ctx
        ctx.save()
        ctx.setLineDash([])
        ctx.strokeStyle = READOUT_LINE
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, u.bbox.top)
        ctx.lineTo(Math.round(x) + 0.5, u.bbox.top + u.bbox.height)
        ctx.stroke()

        const chipH = 18
        const entries: { y: number; text: string; color: string }[] = []
        for (const c of chart.curves) {
          const v = c.values[idx]
          if (v == null || c.quiet) continue
          const unit = c.rightAxis ? (chart.rightAxis?.unit ?? '') : chart.unit
          const y = u.valToPos(v, c.rightAxis ? RIGHT_SCALE : 'y', true)
          if (!Number.isFinite(y)) continue
          const num = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace('.', ',')
          entries.push({ y, text: unit ? `${num} ${unit}` : num, color: c.color })
        }
        if (chart.octaRows) {
          const rows = chart.octaRows.rows
          const rowH = u.bbox.height / rows.length
          rows.forEach((r, ri) => {
            const v = r.values[idx]
            if (v == null) return
            entries.push({
              y: u.bbox.top + rowH * (ri + 0.5),
              text: `${r.label} ${toOcta(v)}/8`,
              color: INK_MUTED,
            })
          })
        }
        if (chart.flagRows) {
          const rows = chart.flagRows.rows
          const rowH = u.bbox.height / rows.length
          rows.forEach((r, ri) => {
            const v = r.values[idx]
            const text = r.texts?.[idx] ?? (v == null ? 'n. v.' : v >= 1 ? 'ja' : 'nein')
            entries.push({ y: u.bbox.top + rowH * (ri + 0.5), text: `${r.label} ${text}`, color: r.color })
          })
        }
        if (chart.symbols) {
          const code = chart.symbols.codes[idx]
          if (code != null) {
            entries.push({
              y: u.bbox.top + u.bbox.height / 2,
              text: wxLabel(code),
              color: INK_MUTED,
            })
          }
        }
        // Der Zeitpunkt selbst, nur in der Zeile, die ihn angefordert hat.
        if (labelRef.current) {
          entries.unshift({ y: u.bbox.top + chipH / 2, text: labelRef.current, color: READOUT_LINE })
        }

        if (entries.length > 0) {
          // Überlappende Kästchen auseinanderschieben — Temperatur und
          // Taupunkt liegen bei kleiner Spreizung sonst übereinander.
          const gap = chipH + 2
          entries.sort((a, b) => a.y - b.y)
          for (let i = 1; i < entries.length; i++) {
            if (entries[i].y - entries[i - 1].y < gap) entries[i].y = entries[i - 1].y + gap
          }
          const bottom = u.bbox.top + u.bbox.height - chipH / 2
          const overflow = entries[entries.length - 1].y - bottom
          if (overflow > 0) for (const e of entries) e.y -= overflow
          for (const e of entries) e.y = Math.max(e.y, u.bbox.top + chipH / 2)

          ctx.font = READOUT_FONT
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          for (const e of entries) {
            const w = ctx.measureText(e.text).width + 12
            // Rechts vom Strich, am rechten Rand nach links kippen.
            const right = x + 8
            const x0 = right + w > u.bbox.left + u.bbox.width ? x - 8 - w : right
            chipPath(ctx, x0, e.y - chipH / 2, w, chipH)
            ctx.fillStyle = CHIP_BG
            ctx.fill()
            ctx.strokeStyle = e.color
            ctx.lineWidth = 1.2
            ctx.stroke()
            ctx.fillStyle = INK
            ctx.fillText(e.text, x0 + 6, e.y + 0.5)
          }
        }

        // Punkte auf den Kurven zuletzt, damit kein Kästchen sie deckt.
        for (const c of chart.curves) {
          const v = c.values[idx]
          if (v == null || c.quiet) continue
          const y = u.valToPos(v, c.rightAxis ? RIGHT_SCALE : 'y', true)
          if (!Number.isFinite(y)) continue
          ctx.beginPath()
          ctx.arc(x, y, 3.4, 0, Math.PI * 2)
          ctx.fillStyle = c.color
          ctx.fill()
          ctx.strokeStyle = BG_PANEL
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Tagesgrenzen und Datumskennzeichnung — in JEDER Zeile des Stapels.
 *
 * Der Trennstrich läuft bei 00 UTC durch die ganze Diagrammfläche UND weiter
 * bis in den Datumsstreifen darunter; das Datum steht direkt rechts daneben,
 * also am Anfang des Tages, den es benennt. Das Datum nur unter der untersten
 * Zeile zu zeigen war unübersichtlich: wer die Windzeile liest, müsste erst
 * über vier Diagramme hinweg nach unten suchen, welcher Tag gerade gilt.
 *
 * Die Tagesgrenzen kommen als fertige Liste herein (einmal beim Plot-Aufbau
 * aus dem Zeitraster bestimmt) — die Stunde je Punkt über `Intl` zu prüfen
 * würde bei jedem Neuzeichnen tausende Formatierungen kosten.
 *
 * `axisH` ist die Höhe der STUNDENACHSE darüber. Sie muss hereingegeben
 * werden, weil unter der Zeichenfläche ZWEI Achsen liegen (Stunden, darunter
 * der Datumsstreifen) und `u.bbox` nur die Fläche selbst kennt: ohne diesen
 * Versatz landete das Datum im Band der Uhrzeiten und lag bei 00 UTC genau
 * auf der „00" — während der eigens reservierte Streifen darunter leer blieb.
 */
function dayMarkPlugin(
  days: { t: number; label: string; short: string }[],
  showLabels: boolean,
  stripH: number,
  axisH: number,
): uPlot.Plugin {
  return {
    hooks: {
      // Vor den Kurven: der Trennstrich gehört unter die Daten, nicht darüber.
      drawAxes: (u) => {
        if (days.length === 0) return
        const ctx = u.ctx
        ctx.save()
        ctx.setLineDash([])
        const bottom = u.bbox.top + u.bbox.height
        // Oberkante des Datumsstreifens: unter der Stundenachse, nicht in ihr.
        const stripTop = bottom + axisH
        const lineEnd = showLabels ? stripTop + stripH : bottom
        ctx.strokeStyle = GRIDLINE_DAY
        ctx.lineWidth = 1
        for (const d of days) {
          const x = u.valToPos(d.t, 'x', true)
          if (!Number.isFinite(x) || x < u.bbox.left - 1 || x > u.bbox.left + u.bbox.width + 1) continue
          const px = Math.round(x) + 0.5
          ctx.beginPath()
          ctx.moveTo(px, u.bbox.top)
          ctx.lineTo(px, lineEnd)
          ctx.stroke()
        }
        if (!showLabels) {
          ctx.restore()
          return
        }
        // Breite eines Tages entscheidet, ob Wochentag + Datum passen.
        const scale = u.scales.x
        const spanDays = ((scale.max ?? 1) - (scale.min ?? 0)) / 86400
        const pxPerDay = u.bbox.width / Math.max(spanDays, 1)
        ctx.font = DAY_FONT
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillStyle = INK
        const ty = stripTop + stripH / 2 + 1
        for (const d of days) {
          const x = u.valToPos(d.t, 'x', true)
          if (!Number.isFinite(x)) continue
          const text = pxPerDay < 58 ? d.short : d.label
          const w = ctx.measureText(text).width
          if (x + 4 + w > u.bbox.left + u.bbox.width) continue
          ctx.fillText(text, x + 4, ty)
        }
        ctx.restore()
      },
    },
  }
}

/**
 * Senkrechte Markerlinie an einem festen Zeitpunkt (z. B. Kartenschieber der
 * MOS-Vorhersage). Getrennt vom Cursor-Sync — ein von außen vorgegebener
 * Zeitpunkt ist etwas anderes als der Hover-Fadenkreuz-Sync über den Stapel.
 */
function markPlugin(markRef: { current: number | undefined }): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const t = markRef.current
        if (t == null) return
        const x = u.valToPos(t / 1000, 'x', true)
        if (!Number.isFinite(x)) return
        const ctx = u.ctx
        ctx.save()
        ctx.strokeStyle = MARK
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, u.bbox.top)
        ctx.lineTo(x, u.bbox.top + u.bbox.height)
        ctx.stroke()
        ctx.restore()
      },
    },
  }
}

/** Ein Diagramm des Stapels — uPlot-Setup, optional synchronisiertes Fadenkreuz über `syncKey`. */
export function ChartRow({
  xs,
  chart,
  tz = 'Etc/UTC',
  axisFmt,
  formatTick,
  xSpace = 62,
  dayRow = false,
  dayGrid = false,
  markTime,
  readoutTime,
  readoutLabel,
  onHoverTime,
  syncKey,
  height = 88,
}: {
  xs: number[]
  chart: ChartDef
  /** Zeitzone der Achsenbeschriftung — Standard UTC wie im Rest der App. */
  tz?: string
  /** Formatter für die x-Achsen-Ticks; Default: Wochentag + Stunde in `tz`. */
  axisFmt?: Intl.DateTimeFormat
  /**
   * Feinere Alternative zu `axisFmt`: eigene Funktion je Tick (Sekunden-
   * Timestamp). Hat Vorrang vor `axisFmt`, wenn gesetzt.
   */
  formatTick?: (ts: number) => string
  /** Mindestabstand zwischen x-Achsen-Ticks in Pixeln — kleiner = mehr Ticks. */
  xSpace?: number
  /**
   * Zweite Zeile UNTER der Stunden-Achse mit Wochentag+Datum an den
   * Tagesgrenzen (00 Uhr in `tz`). Im Stapel bekommt sie nur die UNTERSTE
   * Zeile — die Beschriftung unter jedem einzelnen Diagramm zu wiederholen
   * kostet Höhe und sagt nichts Neues.
   */
  dayRow?: boolean
  /**
   * Nur die senkrechte Tagesgrenz-Linie, ohne Beschriftung — für alle Zeilen
   * ÜBER der Beschriftungszeile, damit die Tagestrennung durch den ganzen
   * Stapel durchläuft.
   */
  dayGrid?: boolean
  /** Fester Zeitpunkt (ms) als gestrichelte Markerlinie, z. B. vom Kartenschieber. */
  markTime?: number
  /**
   * Zeitpunkt (ms), zu dem die Werteanzeige eingeblendet wird — gedacht als
   * gemeinsamer Zustand über alle Zeilen eines Stapels (siehe `onHoverTime`).
   */
  readoutTime?: number
  /** Beschriftung des Zeitpunkts; nur die Zeile setzen, die sie zeigen soll. */
  readoutLabel?: string
  /** Zeiger steht auf einer neuen Stunde (`null` = Zeiger hat das Diagramm verlassen). */
  onHoverTime?: (ms: number | null) => void
  /** Gemeinsamer Cursor über mehrere ChartRow-Instanzen (uPlot.sync-Key). */
  syncKey?: string
  /**
   * NUR Mindesthöhe für uPlots Erstaufbau, falls `el.clientHeight` beim Mount
   * noch 0 ist (Layout nicht fertig) — die tatsächliche Höhe kommt aus CSS
   * (`.atfc-plot` bzw. der umgebende Flex-Container) und wird per
   * ResizeObserver nachgezogen. KEIN inline `height`/`min-height` mehr auf dem
   * Element selbst, sonst kann CSS die Zeile nicht mehr strecken.
   */
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  // Marker über ein Ref führen: sonst würde jede Schieberbewegung den Plot neu
  // aufbauen, statt ihn nur neu zu zeichnen.
  const markRef = useRef<number | undefined>(markTime)
  // Werteanzeige und Hover-Callback als Ref führen: sonst würde jede
  // Mausbewegung den Plot neu aufbauen, statt ihn nur neu zu zeichnen.
  const readoutRef = useRef<number | undefined>(readoutTime)
  const readoutLabelRef = useRef<string | undefined>(readoutLabel)
  const onHoverRef = useRef(onHoverTime)

  useEffect(() => {
    markRef.current = markTime
    plotRef.current?.redraw()
  }, [markTime])

  useEffect(() => {
    readoutRef.current = readoutTime
    readoutLabelRef.current = readoutLabel
    plotRef.current?.redraw()
  }, [readoutTime, readoutLabel])

  useEffect(() => {
    onHoverRef.current = onHoverTime
  }, [onHoverTime])

  useEffect(() => {
    const el = ref.current
    if (!el || xs.length === 0) return

    const fmt = axisFmt ?? new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short', hour: '2-digit' })
    const tickLabel = formatTick ?? ((ts: number) => fmt.format(new Date(ts * 1000)))
    const bars = uPlot.paths.bars?.({ size: [0.7, 12] })
    const windCurve = chart.curves.find((c) => c.direction)
    const hasBands = chart.curves.some((c) => c.fillTo != null)
    const octaRows = chart.octaRows
    // Zeilen mit SPUREN statt Kurven (Achtel-Kreise): die y-Skala ist reine
    // Geometrie (eine Einheit je Spur), die Achse beschriftet die Spuren.
    const lanes: { label: string }[] | undefined = octaRows?.rows ?? chart.flagRows?.rows
    // Oben freigehaltener Anteil für den Fiedern-Streifen; ohne Streifen 0.
    const topReserve = chart.topReserve ?? 0
    const symbols = chart.symbols
    // Zeilen ohne eigene y-Werte (Symbole/Raster) behalten die Achse als
    // BREITENPLATZHALTER, damit die Zeitachsen aller Zeilen deckungsgleich
    // bleiben — nur ohne Beschriftung und Ticks.
    const blankAxis = lanes != null || symbols != null
    const blankValues = (_u: uPlot, splits: number[]) => splits.map(() => '')
    const rightAxis = chart.rightAxis

    // Für die Tageszeile: Stunde in `tz` je Split ermitteln (h23, damit „0"
    // eindeutig Mitternacht ist) und die Tageslabel-Formatierung.
    const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' })
    const dayLabelFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric' })
    const dayShortFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short' })
    const atHour = (v: number, h: string) => hourOf.format(new Date(v * 1000)) === h
    // Einmal beim Aufbau: die Tagesgrenzen des Rasters mit fertigen Labels.
    const dayMarks = xs
      .filter((v) => atHour(v, '00'))
      .map((v) => ({
        t: v,
        label: dayLabelFmt.format(new Date(v * 1000)),
        short: dayShortFmt.format(new Date(v * 1000)),
      }))

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: Math.max(el.clientHeight, height),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), tz),
      legend: { show: false },
      hooks: {
        // Meldet die überfahrene Stunde nach oben; entprellt wird dort, weil
        // der Zeitpunkt für den ganzen Stapel gilt.
        setCursor: [
          (u: uPlot) => {
            const fn = onHoverRef.current
            if (!fn) return
            const idx = u.cursor.idx
            fn(idx == null ? null : (u.data[0][idx] as number) * 1000)
          },
        ],
      },
      cursor: {
        // Zeilen mit `hideCursor` (Wettersymbole) bekommen keine senkrechte
        // Cursorlinie — sie schnitte durch die Symbole.
        x: chart.hideCursor !== true,
        y: false,
        drag: { x: false, y: false, setScale: false },
        ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
      },
      plugins: [
        ...(chart.night ? [nightPlugin(chart.night)] : []),
        ...(chart.refLines ? [refLinePlugin(chart.refLines)] : []),
        // Nach den Bezugslinien, damit die Fläche über ihnen liegt (beide im
        // drawAxes-Hook — die Reihenfolge hier ist die Zeichenreihenfolge).
        ...(hasBands ? [bandPlugin(chart.curves)] : []),
        ...(dayRow || dayGrid
          ? [
              dayMarkPlugin(
                dayMarks,
                dayRow,
                DAY_STRIP_H,
                // Nur was uPlot wirklich reserviert: eine ausgeblendete
                // Stundenachse (Symbolzeile) belegt keine Höhe.
                chart.hideXAxis !== true ? X_AXIS_SIZE : 0,
              ),
            ]
          : []),
        markPlugin(markRef),
        ...(chart.marks ? [pointMarkPlugin(chart.marks)] : []),
        ...(windCurve
          ? [windBarbStripPlugin(windCurve, windCurve.color, topReserve, chart.barbGap ?? 34)]
          : []),
        ...(octaRows ? [octaRowsPlugin(octaRows)] : []),
        ...(chart.flagRows ? [flagRowsPlugin(chart.flagRows)] : []),
        ...(symbols ? [symbolsPlugin(symbols)] : []),
        // Der Schleier dämpft alles, was in den Bereich jenseits des Horizonts
        // hineinragt — auch Fiedern, Symbole und Kriterienzellen.
        ...(chart.veil ? [veilPlugin(chart.veil)] : []),
        // ZULETZT und damit GANZ OBEN: die Werteanzeige. Alle diese Zeichner
        // laufen im `draw`-Hook, die Reihenfolge HIER ist die
        // Zeichenreihenfolge — stand die Anzeige vorher, verschwanden ihre
        // Kästchen unter den Kriterienzellen und den Achtel-Kreisen, also
        // genau in den Zeilen, deren Werte man nur dort ablesen kann.
        ...(chart.hideCursor ? [] : [readoutPlugin(readoutRef, chart, readoutLabelRef)]),
      ],
      scales: {
        // Bei Achtel-Zeilen ist die y-Skala reine Geometrie: eine Einheit je
        // Zeile, damit die Achsenbeschriftung genau auf den Zeilenmitten sitzt.
        y: lanes
          ? { range: [0, lanes.length] as [number, number] }
          : chart.range
            ? { range: chart.range }
            : chart.symmetricMin != null
              ? {
                  // Symmetrisch um 0 (Differenzen mit Vorzeichen), mindestens
                  // ±symmetricMin, darüber mit 10 % Luft.
                  range: (_u, min, max) => {
                    const lo = Number.isFinite(min) ? Math.abs(min) : 0
                    const hi = Number.isFinite(max) ? Math.abs(max) : 0
                    const top = Math.max(Math.max(lo, hi) * 1.1, chart.symmetricMin ?? 0)
                    return [-top, top]
                  },
                }
            : chart.zeroBased
              ? {
                  // Dynamisch bis zum Datenmaximum — aber nie unter `minTop`,
                  // sonst bläst ein Hauch Nieselregen die Achse auf. Die Skala
                  // so strecken, dass der Höchstwert genau unter dem
                  // reservierten Streifen landet (ohne Streifen: 10 % Luft).
                  range: (_u, _min, max) => {
                    const top = Math.max(max, chart.minTop ?? 0)
                    return [0, top > 0 ? (top / (1 - topReserve)) * (topReserve > 0 ? 1 : 1.1) : 1]
                  },
                }
              : chart.yStep != null
                ? {
                    // Auf Vielfache der Schrittweite aufziehen, damit die Ticks
                    // auf runden Werten liegen (5/10/15 statt 3,7/8,7/13,7).
                    range: (_u, min, max) => {
                      const step = chart.yStep ?? 1
                      return [
                        Math.floor((min - step * 0.3) / step) * step,
                        Math.ceil((max + step * 0.3) / step) * step,
                      ]
                    },
                  }
                : chart.minSpan != null
                  ? {
                      // Um die Datenmitte auf eine Mindestspanne aufziehen,
                      // damit die Achse mehr als einen Wert beschriftet.
                      range: (_u, min, max) => {
                        const mid = (min + max) / 2
                        const span = Math.max((max - min) * 1.25, chart.minSpan ?? 0)
                        let lo = mid - span / 2
                        let hi = mid + span / 2
                        // Bezugswerte (`yInclude`) mit etwas Luft hineinziehen.
                        for (const v of chart.yInclude ?? []) {
                          if (v - 1 < lo) lo = v - 1
                          if (v + 1 > hi) hi = v + 1
                        }
                        return [lo, hi]
                      },
                    }
                  : {},
        ...(rightAxis ? { [RIGHT_SCALE]: { range: rightAxis.range } } : {}),
      },
      series:
        lanes || symbols
          ? [{}, { show: false }]
          : [
              {},
              ...chart.curves.map((s) => ({
                label: s.label,
                stroke: s.color,
                width: s.width ?? 1.5,
                points: { show: false },
                ...(s.rightAxis ? { scale: RIGHT_SCALE } : {}),
                ...(s.dash ? { dash: s.dash } : {}),
                // Streifen zu einer anderen Kurve → die Fläche zeichnet
                // bandPlugin; uPlots `fill` ginge bis zur Nulllinie und
                // überdeckte die Kurve darunter.
                ...(s.fill != null && s.fillTo == null
                  ? { fill: withAlpha(s.color, s.fill) }
                  : {}),
                ...(s.type === 'bars' ? { fill: s.color, paths: bars } : {}),
              })),
            ],
      axes: [
        {
          scale: 'x',
          show: chart.hideXAxis !== true,
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: X_AXIS_SIZE,
          gap: 2,
          grid: { stroke: GRIDLINE, width: 1 },
          ticks: { size: 4, stroke: GRIDLINE, width: 1 },
          space: xSpace,
          values: (_u, ticks) => ticks.map(tickLabel),
        },
        {
          scale: 'y',
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: Y_AXIS_SIZE,
          space: chart.ySpace ?? 30,
          // Erlaubte Schrittweiten: bevorzugt die gewünschte, bei Platzmangel
          // das Doppelte/Vierfache — nie krumme Zwischenwerte.
          ...(chart.yStep ? { incrs: [chart.yStep, chart.yStep * 2, chart.yStep * 4] } : {}),
          grid: { stroke: blankAxis ? 'transparent' : GRIDLINE, width: 1 },
          ticks: { show: !blankAxis, stroke: GRIDLINE, width: 1 },
          // Achtel-Zeilen beschriften ihre Zeilen (Gesamt/Hoch/Mittel/Tief)
          // über die Achse — Splits auf die Zeilenmitten, oberste Zeile oben.
          ...(lanes
            ? {
                splits: () => lanes.map((_, i) => lanes.length - i - 0.5),
                values: () => lanes.map((r) => r.label),
              }
            : blankAxis
              ? { values: blankValues }
              : {}),
        },
        {
          // Immer vorhanden, damit alle Zeilen rechts gleich viel Platz
          // reservieren; beschriftet nur, wenn die Zeile eine zweite Größe hat.
          scale: rightAxis ? RIGHT_SCALE : 'y',
          side: 1 as uPlot.Axis.Side,
          stroke: INK_MUTED,
          font: AXIS_FONT,
          size: RIGHT_AXIS_SIZE,
          space: 30,
          grid: { show: false },
          ticks: { show: rightAxis != null, stroke: GRIDLINE, width: 1 },
          ...(rightAxis ? {} : { values: blankValues }),
        },
        // Platzhalter für den Datumsstreifen — gezeichnet wird er vom
        // `dayMarkPlugin` (die Achsenbeschriftung von uPlot sitzt zentriert
        // auf dem Tick, das Datum soll aber links am Trennstrich anliegen).
        ...(dayRow || dayGrid
          ? [
              {
                scale: 'x',
                side: 2 as uPlot.Axis.Side,
                stroke: INK_MUTED,
                font: AXIS_FONT,
                size: dayRow ? DAY_STRIP_H : 1,
                gap: 0,
                ticks: { show: false },
                grid: { show: false },
                values: blankValues,
              },
            ]
          : []),
      ],
    }
    const placeholder = xs.map(() => null)
    const data =
      lanes || symbols ? [xs, placeholder] : [xs, ...chart.curves.map((s) => s.values)]
    const u = new uPlot(opts, data as uPlot.AlignedData, el)
    plotRef.current = u
    /**
     * Größenänderungen NUR weitergeben, wenn sich die gerundete Größe
     * wirklich geändert hat — und gebündelt im nächsten Frame.
     *
     * Ohne diese Bremse flimmert der Stapel: die Zeilen sind
     * `flex: 1 1 0`, ihre Höhen sind deshalb GEBROCHEN (110,4 px), und
     * `clientHeight` rundet. uPlots `setSize` schreibt die gerundete Höhe in
     * sein eigenes Element, das Layout rundet erneut — der ResizeObserver
     * feuert wieder, und bei sechs Zeilen mit gemeinsamem Cursor sieht das
     * nach heftigem Flackern aus. Chromium meldet Sub-Pixel-Änderungen, Edge
     * und Chrome sind davon gleich betroffen; ein Neuzeichnen je Frame ist
     * die Obergrenze, die hier nötig ist.
     *
     * Der Vergleich mit dem letzten Stand bricht zusätzlich jede Schleife, in
     * der die Größe auf einen schon gesehenen Wert zurückfällt.
     */
    let lastW = -1
    let lastH = -1
    let pending = 0
    const ro = new ResizeObserver(() => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        const w = Math.round(el.clientWidth)
        const h = Math.round(el.clientHeight)
        if (w === lastW && h === lastH) return
        lastW = w
        lastH = h
        u.setSize({ width: w, height: h })
      })
    })
    ro.observe(el)
    return () => {
      if (pending) cancelAnimationFrame(pending)
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xs, chart, tz, syncKey, height, axisFmt, formatTick, xSpace, dayRow, dayGrid])

  return <div className="atfc-plot" ref={ref} />
}
