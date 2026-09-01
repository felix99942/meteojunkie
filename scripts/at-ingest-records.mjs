// Ingest der Rekorde aus dem Monatsdatensatz klima-v2-1m
// (Österreich-Klimakarte, Schritt 5b, erweitert).
//
// Je Station und Parameter vier Rekord-Ebenen:
//   abs — absoluter Stationsrekord (höchster/niedrigster MONATSwert überhaupt)
//   mon — Monatsrekorde je Kalendermonat (z.B. wärmster Juli, kältester Jänner)
//   sea — Saisonrekorde je Jahreszeit (DJF/MAM/JJA/SON; Winter = Dez+Jän+Feb)
//   ann — JAHRESrekorde (nassestes Jahr, wärmstes Jahr) — etwas anderes als
//         `abs`, und genau daran ging die Frage „höchster Jahresniederschlag"
//         vorbei: `abs` ist der beste EINZELMONAT (404 mm im Juli 1954), der
//         Jahresrekord die beste JAHRESSUMME. Bei Maximum-/Minimum-Größen
//         fallen beide zusammen (das höchste Jahresmaximum IST das absolute
//         Maximum), bei Summen und Mitteln unterscheiden sie sich fundamental.
//         Nur VOLLSTÄNDIGE Jahre (alle 12 Monatswerte vorhanden) zählen —
//         dieselbe Regel wie beim Normal-Ingest; eine Jahressumme aus acht
//         Monaten wäre keine.
// plus österreichweite Rekorde (national) — auf denselben drei Ebenen,
// jeder Eintrag mit der Station, die ihn hält.
//
// Ausgabe:
//   <id>.json      — EINE kleine Datei je Station (nur die angeklickte wird
//                    im Browser geladen), alle drei Ebenen samt Datum
//   _national.json — österreichweite Rekorde, abs/mon/sea wie oben, je
//                    Eintrag zusätzlich `s`/`n` (Station, die ihn hält)
//   _map-<code>.json — Rekord-INDEX über ALLE Stationen für EINEN Parameter,
//                    Grundlage des Karten-Zeitbezugs "Allzeit". Bewusst nur
//                    WERTE, keine Daten: die Karte beschriftet Zahlen, das
//                    Datum steht (tagesgenau aufgelöst) im Stationsdetail,
//                    das ohnehin die Stationsdatei lädt. Mit Datum wäre die
//                    Datei doppelt so groß für eine Angabe, die niemand in
//                    der Karte sieht. Parallel-Arrays statt Objekte je Station
//                    aus demselben Grund (~halbe Größe).
//
// Aus Monatswerten, ab 1900. Keine echten Einzeltag-Rekorde.
//
//   node scripts/at-ingest-records.mjs

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1m'
const META = `${BASE}/metadata`
const START = '1900-01-01'
// Bis zum letzten ABGESCHLOSSENEN Monat: klima-v2-1m aggregiert den laufenden
// Monat noch nicht, ein fixes Enddatum veraltet dagegen bei jedem Lauf.
const END = (() => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
})()
const DELAY_MS = 400

/**
 * GeoSphere deckelt eine Anfrage bei 1.000.000 Datenpunkten
 * (Stationen × Parameter × Zeitschritte) und antwortet sonst mit HTTP 400
 * „data slice too large". Die Stationszahl je Chunk muss deshalb aus der Zahl
 * der Parameter UND der Länge der Reihe folgen — eine feste 80 hielt nur,
 * solange fünf Codes abgefragt wurden, und riss beim elften Code sofort.
 */
const POINT_LIMIT = 1_000_000
const monthsBetween = (a, b) => {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am) + 1
}

// code + Aggregations-/Fehlwert-Semantik: seasonAgg = wie MEHRERE Monatswerte
// zu einem Wert werden — für die Saison (3 Monate) wie fürs Jahr (12), die
// Regel ist dieselbe; nonNeg = negative Werte sind Fehlwerte.
// Die Liste MUSS die Monatscodes der Registry (src/config/atParameters.ts,
// `monthlyCode`) spiegeln — sonst hat ein wählbarer Parameter im Zeitbezug
// "Allzeit" keine Rekorde. Einzige Ausnahme ist die Schneehöhe: der
// Monatsdatensatz führt sie gar nicht.
const CODES = [
  { code: 'tl_mittel', seasonAgg: 'mean', nonNeg: false },
  { code: 'tlmax', seasonAgg: 'max', nonNeg: false },
  { code: 'tlmin', seasonAgg: 'min', nonNeg: false },
  { code: 'rr', seasonAgg: 'sum', nonNeg: true },
  { code: 'so_h', seasonAgg: 'sum', nonNeg: true },
  { code: 'rf_mittel', seasonAgg: 'mean', nonNeg: true },
  // Kenntage: eine Saison ist die SUMME der drei Monatsanzahlen.
  { code: 'tage_sommer', seasonAgg: 'sum', nonNeg: true },
  { code: 'tage_tropen', seasonAgg: 'sum', nonNeg: true },
  { code: 'tage_frost', seasonAgg: 'sum', nonNeg: true },
  { code: 'tage_eis', seasonAgg: 'sum', nonNeg: true },
  { code: 'tage_rr_1', seasonAgg: 'sum', nonNeg: true },
]

// Monat (1..12) → Saison + Saison-Jahr-Versatz (Dez zählt zum Winter des Folgejahrs).
const SEASON = {
  12: ['DJF', 1], 1: ['DJF', 0], 2: ['DJF', 0],
  3: ['MAM', 0], 4: ['MAM', 0], 5: ['MAM', 0],
  6: ['JJA', 0], 7: ['JJA', 0], 8: ['JJA', 0],
  9: ['SON', 0], 10: ['SON', 0], 11: ['SON', 0],
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at')
const outDir = join(dir, 'records')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const reduce = (vals, mode) => {
  if (!vals.length) return null
  if (mode === 'sum') return vals.reduce((a, b) => a + b, 0)
  if (mode === 'max') return Math.max(...vals)
  if (mode === 'min') return Math.min(...vals)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
const r2 = (v) => Math.round(v * 100) / 100

function urlFor(codes, ids) {
  return `${BASE}?parameters=${codes}&start=${START}&end=${END}&station_ids=${ids.join(',')}&output_format=geojson`
}

async function fetchChunk(codes, ids) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const res = await fetch(urlFor(codes, current))
    if (res.ok) return res.json()
    const body = await res.text()
    const bad = body.match(/station_ids:\s*'(\d+)'/)
    if (res.status === 403 && bad) {
      current = current.filter((id) => id !== Number(bad[1]))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(DELAY_MS * (attempt + 1) * 4)
      continue
    }
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  return { features: [], timestamps: [] }
}

/** Extrem aktualisieren: {v, ...tag} bei max bzw. min. */
function bump(rec, value, tag) {
  if (!rec.max || value > rec.max.v) rec.max = { v: r2(value), ...tag }
  if (!rec.min || value < rec.min.v) rec.min = { v: r2(value), ...tag }
}

async function main() {
  const stationsRaw = JSON.parse(await readFile(join(dir, 'stations.json'), 'utf8'))
  const nameById = new Map(stationsRaw.stations.map((s) => [s.id, s.name]))
  const metaRes = await fetch(META)
  if (!metaRes.ok) throw new Error(`Metadaten HTTP ${metaRes.status}`)
  const monthlyIds = new Set((await metaRes.json()).stations.map((s) => s.id))
  const ids = stationsRaw.stations.map((s) => s.id).filter((id) => monthlyIds.has(id))

  const codesStr = CODES.map((c) => c.code).join(',')
  // 5 % Marge, damit ein zusätzlicher Monat nicht sofort ins Limit läuft.
  const CHUNK = Math.max(1, Math.floor((POINT_LIMIT * 0.95) / (CODES.length * monthsBetween(START, END))))
  const national = {}
  // Rekord-Index für die Karte: code → stationId → { abs, mon, sea } (nur Werte).
  // Wird am Ende zu Parallel-Arrays je Code umgeschrieben.
  const mapIdx = new Map(CODES.map((c) => [c.code, new Map()]))
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  let written = 0

  for (let i = 0; i < ids.length; i += CHUNK) {
    const geo = await fetchChunk(codesStr, ids.slice(i, i + CHUNK))
    const ts = geo.timestamps ?? []
    const yr = ts.map((t) => Number(t.slice(0, 4)))
    const mo = ts.map((t) => Number(t.slice(5, 7)))

    for (const f of geo.features ?? []) {
      const id = f.properties.station
      const perCode = {}
      for (const c of CODES) {
        const data = f.properties.parameters?.[c.code]?.data
        if (!data) continue
        const abs = { max: null, min: null }
        const mon = Array.from({ length: 12 }, () => ({ max: null, min: null }))
        const seasonBuckets = new Map() // "SEASON|year" → [values]
        const yearBuckets = new Map() // year → [values]

        for (let k = 0; k < data.length; k++) {
          const v = data[k]
          if (v == null || !Number.isFinite(v) || (c.nonNeg && v < 0)) continue
          const m = mo[k]
          const y = yr[k]
          bump(abs, v, { d: ts[k].slice(0, 7) })
          bump(mon[m - 1], v, { y })
          const [season, off] = SEASON[m]
          const skey = `${season}|${y + off}`
          if (!seasonBuckets.has(skey)) seasonBuckets.set(skey, [])
          seasonBuckets.get(skey).push(v)
          if (!yearBuckets.has(y)) yearBuckets.set(y, [])
          yearBuckets.get(y).push(v)
        }

        // Saisonwerte je Jahr aggregieren (nur vollständige Saisons mit 3 Monaten)
        const sea = { DJF: { max: null, min: null }, MAM: { max: null, min: null }, JJA: { max: null, min: null }, SON: { max: null, min: null } }
        for (const [skey, vals] of seasonBuckets) {
          if (vals.length !== 3) continue
          const [season, y] = skey.split('|')
          bump(sea[season], reduce(vals, c.seasonAgg), { y: Number(y) })
        }

        // Jahreswerte — nur aus VOLLSTÄNDIGEN Jahren (12 Monatswerte).
        const ann = { max: null, min: null }
        for (const [y, vals] of yearBuckets) {
          if (vals.length !== 12) continue
          bump(ann, reduce(vals, c.seasonAgg), { y })
        }

        if (abs.max && abs.min) {
          perCode[c.code] = { abs, mon, sea, ann }
          mapIdx.get(c.code).set(id, { abs, mon, sea, ann })
          // Nationale Rekorde auf ALLEN drei Ebenen — nicht nur absolut.
          // „Wärmster Juli, den Österreich je hatte" ist die häufigere Frage
          // als der Allzeit-Rekord, und ohne mon/sea könnte das Klimaarchiv
          // sie nicht beantworten, obwohl die Zahl hier ohnehin durchläuft.
          const nat = (national[c.code] ??= {
            abs: { max: null, min: null },
            mon: Array.from({ length: 12 }, () => ({ max: null, min: null })),
            sea: { DJF: { max: null, min: null }, MAM: { max: null, min: null }, JJA: { max: null, min: null }, SON: { max: null, min: null } },
            ann: { max: null, min: null },
          })
          const who = { s: id, n: nameById.get(id) ?? String(id) }
          const lift = (target, src) => {
            if (src.max && (!target.max || src.max.v > target.max.v)) target.max = { ...src.max, ...who }
            if (src.min && (!target.min || src.min.v < target.min.v)) target.min = { ...src.min, ...who }
          }
          lift(nat.abs, abs)
          lift(nat.ann, ann)
          for (let m = 0; m < 12; m++) lift(nat.mon[m], mon[m])
          for (const sid of ['DJF', 'MAM', 'JJA', 'SON']) lift(nat.sea[sid], sea[sid])
        }
      }
      if (Object.keys(perCode).length) {
        await writeFile(join(outDir, `${id}.json`), JSON.stringify(perCode))
        written++
      }
    }
    process.stdout.write(`Chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)}: ${written} Stationsdateien\n`)
    await sleep(DELAY_MS)
  }

  await writeFile(
    join(outDir, '_national.json'),
    JSON.stringify({ meta: { source: BASE, since: START, note: 'Monatsextreme, keine Einzeltag-Rekorde' }, national }),
  )

  // --- Karten-Index je Parameter --------------------------------------------
  // EINE Datei je Parameter, damit die Karte nur den GEWÄHLTEN lädt. Aufbau als
  // Parallel-Arrays über `ids`: dieselbe Information wie die Stationsdateien,
  // aber ohne 34-mal wiederholte Schlüsselnamen je Station.
  for (const c of CODES) {
    const entries = mapIdx.get(c.code)
    if (!entries.size) continue
    const idList = [...entries.keys()].sort((a, b) => a - b)
    const level = (pick) => ({ v: idList.map((id) => pick(entries.get(id))) })
    const out = {
      meta: { source: BASE, since: START, until: END, note: 'Monatsextreme, keine Einzeltag-Rekorde' },
      code: c.code,
      ids: idList,
      abs: {
        max: level((e) => e.abs.max?.v ?? null),
        min: level((e) => e.abs.min?.v ?? null),
      },
      ann: {
        max: level((e) => e.ann.max?.v ?? null),
        min: level((e) => e.ann.min?.v ?? null),
      },
      mon: Array.from({ length: 12 }, (_, m) => ({
        max: level((e) => e.mon[m].max?.v ?? null),
        min: level((e) => e.mon[m].min?.v ?? null),
      })),
      sea: Object.fromEntries(
        ['DJF', 'MAM', 'JJA', 'SON'].map((sid) => [
          sid,
          { max: level((e) => e.sea[sid].max?.v ?? null), min: level((e) => e.sea[sid].min?.v ?? null) },
        ]),
      ),
    }
    await writeFile(join(outDir, `_map-${c.code}.json`), JSON.stringify(out))
  }

  process.stdout.write(
    `Geschrieben: public/at/records/*.json (${written} Stationen) + _national.json + ${CODES.length} Karten-Indizes\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`Fehler: ${err?.message ?? err}\n`)
  process.exit(1)
})
