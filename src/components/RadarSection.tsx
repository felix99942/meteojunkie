// Senkrechter Querschnitt durch den Höhenstapel des 3D-Radars: Entfernung
// von A nach B waagrecht, Höhe über NN senkrecht, je Zelle die Farbe der
// Reflektivität. Daran liest man, was die Karte nicht zeigt — wie hoch eine
// Zelle reicht, ob der stärkste Kern in der Höhe hängt (Hagelkern, Überhang),
// wo die Schmelzschicht als helles Band liegt.

import { useEffect, useRef, useState } from 'react'
import { R3D_LUT, R3D_NODATA, r3dDbz, r3dLevelLabel, sectionStats, type R3dSection } from '../config/radar3d'

const M = { left: 44, right: 10, top: 6, bottom: 22 }
/** Halbe Schichtdicke — die Schichten liegen 500 m auseinander */
const HALF_M = 250

function niceStep(lengthKm: number, px: number): number {
  const want = (lengthKm / px) * 80
  for (const s of [5, 10, 20, 25, 50, 100, 200]) if (s >= want) return s
  return 500
}

export function RadarSection({ section, title, onClose }: { section: R3dSection; title: string; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { levels, distKm, values, lengthKm } = section
  const nL = levels.length
  const cols = distKm.length
  const zTop = levels[nL - 1] + HALF_M
  const zBot = levels[0] - HALF_M
  const plotW = Math.max(1, size.w - M.left - M.right)
  const plotH = Math.max(1, size.h - M.top - M.bottom)

  useEffect(() => {
    const c = canvasRef.current
    if (!c || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    c.style.width = `${size.w}px`
    c.style.height = `${size.h}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.fillStyle = '#17181b'
    ctx.fillRect(M.left, M.top, plotW, plotH)
    const yOf = (z: number) => M.top + ((zTop - z) / (zTop - zBot)) * plotH
    const colW = plotW / cols
    for (let col = 0; col < cols; col++) {
      const x = M.left + col * colW
      for (let L = 0; L < nL; L++) {
        const q = values[col * nL + L]
        const c4 = R3D_LUT[q]
        if (c4[3] === 0) continue
        // „keine Daten" etwas dunkler als in der Karte — hier liegt es auf
        // der dunklen Fläche, nicht auf dem Kartengrund
        ctx.fillStyle = q === R3D_NODATA ? 'rgba(125,125,125,0.28)' : `rgb(${c4[0]},${c4[1]},${c4[2]})`
        const y0 = yOf(levels[L] + HALF_M)
        ctx.fillRect(x, y0, colW + 0.6, yOf(levels[L] - HALF_M) - y0 + 0.6)
      }
    }
    // Achsen
    ctx.fillStyle = '#c4c7cc'
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let km = 2; km * 1000 <= zTop; km += 2) {
      const y = yOf(km * 1000)
      ctx.beginPath()
      ctx.moveTo(M.left, y)
      ctx.lineTo(M.left + plotW, y)
      ctx.stroke()
      ctx.fillText(`${km} km`, M.left - 5, y)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const step = niceStep(lengthKm, plotW)
    for (let d = 0; d <= lengthKm; d += step) {
      const x = M.left + (d / lengthKm) * plotW
      // Platz für die Endbeschriftung „B · … km" lassen
      if (d > 0 && x > M.left + plotW - 70) break
      ctx.fillText(d === 0 ? 'A' : `${d}`, x, M.top + plotH + 5)
    }
    ctx.textAlign = 'right'
    ctx.fillText(`B · ${Math.round(lengthKm)} km`, M.left + plotW, M.top + plotH + 5)
  }, [size, values, levels, distKm, nL, cols, lengthKm, plotW, plotH, zTop, zBot])

  // Wert am Zeiger
  let readout: string | null = null
  if (hover) {
    const col = Math.floor(((hover.x - M.left) / plotW) * cols)
    const z = zTop - ((hover.y - M.top) / plotH) * (zTop - zBot)
    const L = Math.round((z - levels[0]) / 500)
    if (col >= 0 && col < cols && L >= 0 && L < nL) {
      const q = values[col * nL + L]
      readout = `${Math.round(distKm[col])} km · ${r3dLevelLabel(levels[L])}: ${
        q === R3D_NODATA ? 'keine Radardaten' : q === 0 || r3dDbz(q) < 7 ? 'kein Echo' : `${r3dDbz(q).toLocaleString('de-DE')} dBZ`
      }`
    }
  }
  const st = sectionStats(section)

  return (
    <div className="radar-section">
      <div className="radar-section-head">
        <strong>Querschnitt A–B</strong>
        <span>{title}</span>
        <span>
          {st.maxDbz != null ? `höchstens ${st.maxDbz.toLocaleString('de-DE')} dBZ` : 'kein Echo'}
          {st.topM != null && ` · Echotop (18 dBZ) ${r3dLevelLabel(st.topM)}`}
        </span>
        {readout && <span className="radar-section-readout">{readout}</span>}
        <button type="button" onClick={onClose} title="Querschnitt schließen">
          ✕
        </button>
      </div>
      <div
        className="radar-section-plot"
        ref={wrapRef}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover({ x: e.clientX - r.left, y: e.clientY - r.top })
        }}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
