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

/**
 * ZWEITER PASS aus dem TAGESdatensatz — die Gegenrichtung der Extremgrößen.
 *
 * Der Monatsdatensatz führt bei Extremgrößen nur EINE Richtung als echtes
 * Tagesextrem: `tlmax` das höchste Tagesmaximum, `tlmin` das tiefste
 * Tagesminimum des Monats. Das Extremum über die Monate in der GEGENrichtung
 * ist deshalb etwas anderes, als eine Frage meint — „wärmste Nacht in
 * Salzburg" kam so auf 13,4 °C (August 2024): den August, dessen kälteste
 * Nacht die wärmste war. Salzburg hat längst Tropennächte über 20 °C gehabt.
 *
 * Das fehlende Gegenstück gibt es im Monatsdatensatz unter keinem Namen
 * (geprüft 2026-09-15, 420 Parameter: es gibt `tlmin`, `tlmax` und die Mittel,
 * aber kein „monatlich höchstes Tagesminimum"). Es muss deshalb aus TAGESwerten
 * gebildet werden — und das ist billiger, als es klingt: das Limit zählt
 * DATENPUNKTE, nicht Stationen, ein Chunk trägt also ~10 Stationen über 126
 * Jahre. Gemessen (2026-09-16): 925.580 Punkte, 5,6 MB, 19,6 s je Chunk →
 * ~52 Requests für 513 Stationen, rund 20 Minuten und 22 % des Stundenbudgets
 * von 240 Requests.
 *
 * Nebengewinn: die Tagesreihe liefert das EXAKTE DATUM mit (`d` als
 * YYYY-MM-DD statt YYYY-MM) — für diese Rekorde braucht das Frontend die
 * nachträgliche Tagesauflösung also nicht mehr.
 */
const DAILY_BASE = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1d'
/**
 * Je Code die Richtung, die der Monatsdatensatz NICHT hergibt.
 *
 * Bei den Temperaturen ist es die GEGENRICHTUNG (siehe oben). Beim
 * Niederschlag ist es eine andere EBENE: `rr` ist im Monatsdatensatz die
 * MONATSSUMME, der nasseste Tag steckt dort gar nicht. „Höchster
 * Tagesniederschlag in Salzburg" antwortete deshalb mit 404 mm (nassester
 * Juli 1954) statt mit dem nassesten Tag — eine Größenordnung daneben. Die
 * TROCKENrichtung fehlt bewusst: der trockenste Tag ist überall 0 mm und
 * damit keine Auskunft.
 */
const DAY_CODES = [
  { code: 'tlmin', dir: 'max' }, // wärmste Nacht = höchstes Tagesminimum
  { code: 'tlmax', dir: 'min' }, // kältester Tag = tiefstes Tagesmaximum
  { code: 'rr', dir: 'max' }, // nassester Tag = höchste Tagessumme
]
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1
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

/**
 * Chunk aus dem TAGESdatensatz holen — eigene Funktion, weil der Basis-URL
 * ein anderer ist. Fehlertoleranz wie beim Monatspass: eine per 403
 * abgelehnte Station fliegt aus dem Chunk und der Rest läuft weiter
 * (Stationen fehlen je Datensatz unterschiedlich).
 */
async function fetchDailyChunk(codes, ids, start, end) {
  let current = [...ids]
  for (let attempt = 0; attempt < 12 && current.length; attempt++) {
    const url =
      `${DAILY_BASE}?parameters=${codes}&start=${start}T00:00&end=${end}T00:00` +
      `&station_ids=${current.join(',')}&output_format=geojson`
    const res = await fetch(url)
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
    throw new Error(`Tages-Abruf HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  return { features: [], timestamps: [] }
}

/**
 * Zweiter Pass: die Gegenrichtung der Extremgrößen aus Tageswerten, je Station
 * in ihre schon geschriebene Datei nachgetragen (`day`-Block je Code).
 *
 * Die Form spiegelt absichtlich die des Monatsblocks (`abs`/`ann`/`mon`/`sea`
 * mit `max`/`min`), obwohl nur EINE Richtung besetzt ist: so liest der
 * bestehende Zugriff im Frontend sie ohne neue Sonderlogik. `ann` ist bei
 * einem Tagesextrem dasselbe wie `abs` (das höchste Jahresminimum IST das
 * höchste Minimum überhaupt) und wird mitgeschrieben, damit eine Jahresfrage
 * nicht ins Leere greift.
 */
async function dailyPass(ids, nameById) {
  const codesStr = DAY_CODES.map((c) => c.code).join(',')
  const chunk = Math.max(
    1,
    Math.floor((POINT_LIMIT * 0.95) / (DAY_CODES.length * daysBetween(START, END))),
  )
  const total = Math.ceil(ids.length / chunk)
  const nationalDay = {}
  /** Verworfene Tage (Minimum über Maximum) — wird am Ende berichtet. */
  const dropped = []
  /** Tagesrekord über Monatsrekord — nur Hinweis, siehe unten. */
  const inconsistent = []
  let touched = 0

  for (let i = 0; i < ids.length; i += chunk) {
    const geo = await fetchDailyChunk(codesStr, ids.slice(i, i + chunk), START, END)
    const ts = geo.timestamps ?? []
    // Datum als YYYY-MM-DD; Monat und Saison daraus, Dezember zählt zum
    // Winter des FOLGEjahrs (dieselbe Zuordnung wie im Monatspass).
    const day = ts.map((t) => t.slice(0, 10))
    const mo = ts.map((t) => Number(t.slice(5, 7)))

    for (const f of geo.features ?? []) {
      const id = f.properties.station
      const file = join(outDir, `${id}.json`)
      let perCode
      try {
        perCode = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        continue // keine Monatsdatei → keine Station in den Assets
      }
      let changed = false

      /**
       * PLAUSIBILITÄT: ein Tag, an dem das Minimum ÜBER dem Maximum liegt, ist
       * in sich widersprüchlich und darf in keinen Rekord.
       *
       * Das ist kein theoretischer Fall. Gefunden beim ersten Lauf
       * (2026-09-16): Ybbs Persenbeug meldet am 09.05.1968 `tlmin` = 37,8 °C
       * bei `tlmax` = 20,5 °C desselben Tages — Nachbartage 3,8 und 6,5 °C.
       * Damit wäre das die „wärmste Nacht Österreichs" gewesen, über dem
       * Allzeit-HÖCHSTWERT des Landes (41,2 °C) und im Mai. Das
       * Qualitätsflag ist dabei LEER, GeoSpheres QC fängt es also nicht.
       *
       * Bewusst diese Regel und keine absolute Schwelle: sie braucht kein
       * geratenes Limit, gilt an jeder Station und in jeder Jahreszeit, und
       * sie prüft die Daten gegen sich selbst. Greifen kann sie nur, wenn
       * BEIDE Werte vorliegen — fehlt einer, bleibt der Tag drin (die Zahl
       * der Fälle wird am Ende ausgegeben, damit das nicht unbemerkt bleibt).
       */
      const tmin = f.properties.parameters?.tlmin?.data
      const tmax = f.properties.parameters?.tlmax?.data
      const broken = new Set()
      if (tmin && tmax) {
        for (let k = 0; k < tmin.length; k++) {
          const lo = tmin[k]
          const hi = tmax[k]
          if (lo != null && hi != null && lo > hi) {
            broken.add(k)
            dropped.push({ id, d: day[k], tlmin: lo, tlmax: hi })
          }
        }
      }

      for (const c of DAY_CODES) {
        const data = f.properties.parameters?.[c.code]?.data
        if (!data) continue
        const better = (a, b) => (c.dir === 'max' ? b.v > a.v : b.v < a.v)
        const empty = () => ({ max: null, min: null })
        const abs = empty()
        const mon = Array.from({ length: 12 }, empty)
        const sea = { DJF: empty(), MAM: empty(), JJA: empty(), SON: empty() }
        const put = (slot, cand) => {
          if (!slot[c.dir] || better(slot[c.dir], cand)) slot[c.dir] = cand
        }
        for (let k = 0; k < data.length; k++) {
          const v = data[k]
          if (v == null || !Number.isFinite(v)) continue
          // Ein Tag mit Minimum über Maximum ist als ganzer Datensatz
          // verdächtig — deshalb fliegt er auch für den Niederschlag heraus,
          // nicht nur für die Temperatur, aus der die Prüfung stammt.
          if (broken.has(k)) continue
          const cand = { v: r2(v), d: day[k] }
          put(abs, cand)
          put(mon[mo[k] - 1], cand)
          put(sea[SEASON[mo[k]][0]], cand)
        }
        if (!abs[c.dir]) continue
        const entry = (perCode[c.code] ??= {})
        // `ann` = `abs`: bei einem Tagesextrem sind beide dasselbe.
        entry.day = { abs, ann: abs, mon, sea }
        changed = true

        // Selbstkonsistenz nur bei SUMMEN prüfbar: ein Tag kann nicht mehr
        // bringen als sein Monat. Bei Extremgrößen sagt der Vergleich nichts
        // (dort ist der Monatswert die Gegenrichtung).
        if (c.code === 'rr') {
          const monMax = entry.abs?.max
          const dayMax = abs.max
          if (monMax && dayMax && dayMax.v > monMax.v + 0.05) {
            inconsistent.push({ id, code: c.code, day: dayMax.v, d: dayMax.d, mon: monMax.v })
          }
        }

        const nat = (nationalDay[c.code] ??= { abs: empty(), ann: empty(), mon: Array.from({ length: 12 }, empty), sea: { DJF: empty(), MAM: empty(), JJA: empty(), SON: empty() } })
        const who = { s: id, n: nameById.get(id) ?? String(id) }
        const lift = (target, src) => {
          const cand = src[c.dir]
          if (cand && (!target[c.dir] || better(target[c.dir], cand))) {
            target[c.dir] = { ...cand, ...who }
          }
        }
        lift(nat.abs, abs)
        lift(nat.ann, abs)
        for (let m = 0; m < 12; m++) lift(nat.mon[m], mon[m])
        for (const sid of ['DJF', 'MAM', 'JJA', 'SON']) lift(nat.sea[sid], sea[sid])
      }

      if (changed) {
        await writeFile(file, JSON.stringify(perCode))
        touched++
      }
    }
    process.stdout.write(
      `Tages-Chunk ${Math.floor(i / chunk) + 1}/${total}: ${touched} Stationsdateien ergänzt\n`,
    )
    await sleep(DELAY_MS)
  }

  /**
   * HINWEIS, keine Filterung: wo der Tagesrekord den Monatsrekord übersteigt,
   * stimmt etwas nicht zusammen — ein einzelner Tag kann nicht mehr bringen
   * als der Monat, in dem er liegt.
   *
   * Nicht aussortiert, weil dasselbe Signal von einer LÜCKE in der
   * Monatsreihe kommt und beides nicht unterscheidbar ist. Gemessen
   * (2026-09-16): genau eine von 494 Stationen, Podersdorf Strandbad — dort
   * beginnt die Messung am 22.07.2014 und der Tagesrekord fällt auf den
   * 30.07.2014; der Juli ist ein Teilmonat und fehlt im Monatsdatensatz,
   * deshalb kommt der Monatsrekord aus dem September. Ein Filter hätte da
   * einen echten Rekord weggeworfen.
   */
  if (inconsistent.length) {
    process.stdout.write(
      `\nHinweis: Tagesrekord über Monatsrekord bei ${inconsistent.length} Station(en) — ` +
        `meist ein Teilmonat am Reihenbeginn, NICHT gefiltert:\n`,
    )
    for (const x of inconsistent.slice(0, 10)) {
      process.stdout.write(
        `   Station ${x.id} (${x.code}): Tag ${x.day} mm am ${x.d} > Monat ${x.mon} mm\n`,
      )
    }
  }

  // Die verworfenen Tage NAMENTLICH ausgeben: es sind Archivfehler, keine
  // Programmfehler, und sie gehören sichtbar — wächst die Zahl, hat sich am
  // Datensatz etwas geändert.
  if (dropped.length) {
    process.stdout.write(
      `\nVerworfen (Minimum über Maximum, in sich widersprüchlich): ${dropped.length} Tage\n`,
    )
    for (const x of dropped.slice(0, 20)) {
      process.stdout.write(`   Station ${x.id}  ${x.d}  tlmin ${x.tlmin} > tlmax ${x.tlmax}\n`)
    }
    if (dropped.length > 20) process.stdout.write(`   … und ${dropped.length - 20} weitere\n`)
  }
  return nationalDay
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

  // ZWEITER PASS: Gegenrichtung der Extremgrößen aus TAGESwerten (siehe
  // DAY_CODES). Läuft nach dem Monatspass, weil er die Stationsdateien
  // ergänzt, die dort entstanden sind.
  process.stdout.write(`\nTagespass für ${DAY_CODES.map((c) => c.code).join(', ')} …\n`)
  const nationalDay = await dailyPass(ids, nameById)
  for (const [code, block] of Object.entries(nationalDay)) {
    const nat = (national[code] ??= {})
    nat.day = block
  }

  await writeFile(
    join(outDir, '_national.json'),
    JSON.stringify({
      meta: {
        source: BASE,
        since: START,
        note:
          'Monatsextreme, keine Einzeltag-Rekorde — AUSSER im `day`-Block: ' +
          'der traegt die Gegenrichtung der Extremgroessen aus Tageswerten, ' +
          'mit exaktem Datum (YYYY-MM-DD).',
        dailySource: DAILY_BASE,
      },
      national,
    }),
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
