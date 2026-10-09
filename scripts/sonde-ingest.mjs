// Ingest GEMESSENER Radiosondenaufstiege → statische JSONs unter public/sondes/
// (Soundings-Bereich, Vergleich Modell ↔ Messung im Skew-T).
//
// QUELLE: University of Wyoming, `weather.uwyo.edu/wsgi/sounding` mit
// `type=TEXT:CSV` — für die meisten europäischen Stationen die HOCHAUFGELÖSTEN
// BUFR-Aufstiege (Messpunkt alle 1–2 s, ~3.000 Zeilen), für einige (Budapest,
// Cuneo, Poprad, Legionowo) nur die klassischen TEMP-Hauptflächen und
// signifikanten Punkte (~100 Zeilen). Live geprüft 2026-10-02.
//
// WARUM EIN INGEST UND KEIN ABRUF IM BROWSER: UWyo sendet KEINE
// `Access-Control-*`-Header (gemessen), dasselbe gilt für opendata.dwd.de.
// Also wie bei MOSMIX: im Deploy-Workflow holen (Cron alle 3 h), Ergebnis
// gitignored, Browser lädt same-origin. Aufstiege gibt es zweimal am Tag
// (Termine 00/12 UTC), der 3-h-Takt reicht also; ein 12-UTC-Aufstieg steht
// spätestens mit dem 15:15-Lauf auf der Seite.
//
// DER TERMIN IST NICHT DIE STARTZEIT: gestartet wird ~45–75 min VOR dem
// Termin (Deutschland 10:45 für 12 UTC), Innsbruck führt seinen
// 03-UTC-Aufstieg sogar unter 00 UTC (Start 02:15). Beide Zeiten gehen
// deshalb getrennt in die Daten (`term`, `launch`).
//
//   node scripts/sonde-ingest.mjs
//   SONDE_TERMS=1 node scripts/sonde-ingest.mjs   # nur den letzten Termin

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stationsliste — GEMESSEN, nicht aus einem Katalog: jede liefert bei UWyo
 * (2026-10-02, 00 und/oder 12 UTC). Bewusst NICHT dabei, weil dort nichts
 * kommt: Graz (11240), Linz (11010), Udine (16044), Mailand (16080),
 * Ljubljana (14015), De Bilt (06260), Uccle (06447), Nancy (07180), Lyon
 * (07481), Kempten (10954), Beograd (13275), Zadar (14430). Innsbruck liefert
 * nur zum 00-UTC-Termin.
 */
const STATIONS = [
  { id: '11035', name: 'Wien Hohe Warte', country: 'AT' },
  { id: '11120', name: 'Innsbruck', country: 'AT' },
  { id: '10868', name: 'München', country: 'DE' },
  { id: '10739', name: 'Stuttgart', country: 'DE' },
  { id: '10771', name: 'Kümmersbruck', country: 'DE' },
  { id: '10548', name: 'Meiningen', country: 'DE' },
  { id: '10618', name: 'Idar-Oberstein', country: 'DE' },
  { id: '10410', name: 'Essen', country: 'DE' },
  { id: '10393', name: 'Lindenberg', country: 'DE' },
  { id: '10238', name: 'Bergen', country: 'DE' },
  { id: '10184', name: 'Greifswald', country: 'DE' },
  { id: '10035', name: 'Schleswig', country: 'DE' },
  { id: '10113', name: 'Norderney', country: 'DE' },
  { id: '06610', name: 'Payerne', country: 'CH' },
  { id: '11520', name: 'Praha-Libuš', country: 'CZ' },
  { id: '14240', name: 'Zagreb', country: 'HR' },
  { id: '12843', name: 'Budapest', country: 'HU' },
  { id: '11952', name: 'Poprad', country: 'SK' },
  { id: '12374', name: 'Legionowo', country: 'PL' },
  { id: '07145', name: 'Trappes', country: 'FR' },
  { id: '16113', name: 'Cuneo', country: 'IT' },
]

/** Wie viele Termine (00/12 UTC) rückwärts: die letzten anderthalb Tage. */
const TERMS = Number(process.env.SONDE_TERMS ?? 3)
/**
 * Ein Termin gilt erst so lange nach seiner Nennzeit als abrufbar. Der Aufstieg
 * dauert ~1,5–2 h ab Start (~1 h vor dem Termin); früher gefragt bekäme man
 * einen halben Aufstieg und hielte ihn für einen geplatzten Ballon.
 */
const READY_AFTER_H = 2
const CONCURRENCY = 3
/** Oberes Ende der Skew-T-Achse — darüber wird nichts gezeichnet. */
const TOP_HPA = 100

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sondes')

const url = (id, term) =>
  `https://weather.uwyo.edu/wsgi/sounding?datetime=${encodeURIComponent(
    term.toISOString().slice(0, 13).replace('T', ' ') + ':00:00',
  )}&id=${id}&type=TEXT:CSV`

/** Die letzten `n` Termine (00/12 UTC), die schon fertig sein sollten. */
function recentTerms(now, n) {
  const t = new Date(now - READY_AFTER_H * 3600e3)
  t.setUTCMinutes(0, 0, 0)
  t.setUTCHours(t.getUTCHours() < 12 ? 0 : 12)
  const out = []
  for (let i = 0; i < n; i++) out.push(new Date(t.getTime() - i * 12 * 3600e3))
  return out
}

const num = (s) => {
  const v = Number(s)
  return s == null || s.trim() === '' || !Number.isFinite(v) ? null : v
}
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

/**
 * CSV → Aufstieg, AUSGEDÜNNT. Hochaufgelöst sind das ~3.000 Punkte, für das
 * Diagramm und die Kennzahlen (gerechnet auf 5-hPa-Gitter) reichen weit
 * weniger: behalten wird ein Punkt, sobald der Druck um STEP gefallen ist —
 * 2 hPa unterhalb 300 hPa (≈ 20 m, eine Bodeninversion bleibt scharf), 1 hPa
 * darüber. Bewusst KEIN Mitteln oder Interpolieren auf ein festes Gitter:
 * jeder Punkt bleibt ein echter Messpunkt.
 *
 * Der Druck muss STRENG fallen — pendelt der Ballon (Turbulenz, kurzes
 * Absinken), würde die Kurve sonst zurücklaufen.
 */
export function parseUwyoCsv(text) {
  const lines = text.trim().split('\n')
  if (!lines[0]?.startsWith('time,')) return null
  const out = { launch: null, lat: null, lon: null, p: [], z: [], T: [], Td: [], dir: [], spd: [] }
  let lastP = Infinity
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',')
    const p = num(f[3])
    const T = num(f[5])
    if (p == null || T == null) continue
    if (p < TOP_HPA) break
    if (out.launch == null) {
      out.launch = new Date(f[0].trim().replace(' ', 'T') + 'Z').toISOString()
      out.lat = num(f[2])
      out.lon = num(f[1])
    }
    const step = p > 300 ? 2 : 1
    if (out.p.length > 0 && p > lastP - step) continue
    lastP = p
    out.p.push(r1(p))
    out.z.push(num(f[4]) == null ? null : Math.round(num(f[4])))
    out.T.push(r1(T))
    out.Td.push(r1(num(f[6])))
    out.dir.push(num(f[11]) == null ? null : Math.round(num(f[11])))
    out.spd.push(r1(num(f[12])))
  }
  return out.p.length >= 5 ? out : null
}

/**
 * Was UWyo geantwortet hat, je Ausgang gezählt. Im Deploy kamen über Stunden
 * NULL Aufstiege, während derselbe Ingest lokal 21/21 Stationen lieferte —
 * ohne diese Zählung sagt das Log nicht, ob abgelehnt (403/429), nichts
 * gefunden (400) oder gar nicht geantwortet wurde (Zeitüberschreitung).
 */
const outcomes = new Map()
const note = (key) => outcomes.set(key, (outcomes.get(key) ?? 0) + 1)

async function fetchSounding(id, term) {
  // Eine LEERE Antwort kam bei der Messung vereinzelt statt „Unable to
  // retrieve" — einmal nachfragen, dann gilt der Termin als nicht vorhanden.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url(id, term), { signal: AbortSignal.timeout(60_000) })
      const text = await res.text()
      if (res.ok && text.trim()) {
        const parsed = parseUwyoCsv(text)
        if (!parsed) note(`200 unlesbar: ${JSON.stringify(text.slice(0, 80))}`)
        else note('200 ok')
        return parsed
      }
      if (!res.ok) {
        // 400 = kein Aufstieg zu diesem Termin
        note(`HTTP ${res.status}: ${JSON.stringify(text.slice(0, 80))}`)
        return null
      }
      note('200 leer')
    } catch (e) {
      // Zeitüberschreitung/Netz: nochmal
      note(`Fehler ${e?.name ?? ''} ${e?.cause?.code ?? e?.message ?? ''}`.trim())
    }
  }
  return null
}

async function main() {
  const terms = recentTerms(Date.now(), TERMS)
  const jobs = STATIONS.flatMap((s) => terms.map((term) => ({ s, term })))
  const results = new Map()
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]
        const data = await fetchSounding(job.s.id, job.term)
        results.set(`${job.s.id}|${job.term.toISOString()}`, data)
      }
    }),
  )

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const index = {
    generated: new Date().toISOString(),
    source: 'University of Wyoming, weather.uwyo.edu',
    stations: [],
  }
  let files = 0
  for (const s of STATIONS) {
    const soundings = []
    let pos = null
    for (const term of terms) {
      const d = results.get(`${s.id}|${term.toISOString()}`)
      if (!d) continue
      const stamp = term.toISOString().slice(0, 13).replace(/[-T]/g, '')
      const file = `${s.id}-${stamp}.json`
      await writeFile(
        join(outDir, file),
        JSON.stringify({ id: s.id, term: term.toISOString(), ...d }),
      )
      files++
      pos ??= { lat: d.lat, lon: d.lon, elev: d.z[0] }
      soundings.push({
        term: term.toISOString(),
        launch: d.launch,
        top: d.p[d.p.length - 1],
        file,
      })
    }
    // Ohne einen einzigen Aufstieg kennt der Index die Station nicht — die
    // Lage käme sonst aus einem Katalog statt aus der Messung.
    if (pos) index.stations.push({ ...s, ...pos, soundings })
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index))
  console.log(
    `Radiosonden: ${files} Aufstiege von ${index.stations.length}/${STATIONS.length} Stationen, Termine ${terms
      .map((t) => t.toISOString().slice(5, 13).replace('T', ' '))
      .join(', ')} UTC`,
  )
  for (const [k, n] of [...outcomes].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`)
  // Keine einzige Station ist ein Ausfall der Quelle, kein Normalzustand:
  // sichtbar scheitern (der Deploy läuft dank continue-on-error weiter),
  // statt mit „success" einen leeren Index auszuliefern.
  if (index.stations.length === 0) {
    console.error('Radiosonden: KEINE Station geliefert — Quelle prüfen (Zählung oben).')
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
