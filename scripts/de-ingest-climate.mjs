// Klimamonitor Deutschland: Stationswerte des DWD Climate Data Center
// (opendata.dwd.de/climate_environment/CDC) → fertige JSONs unter public/de/.
//
// WARUM ein Ingest und kein Abruf im Browser wie bei GeoSphere: der DWD
// schickt KEINE CORS-Header (gemessen 2026-10-08, CDC wie Radar). Die Werte
// werden deshalb im Deploy geholt und same-origin ausgeliefert — dieselbe
// Mechanik wie die MOSMIX-Vorhersage. Der Preis: der Stand ist so alt wie der
// letzte Deploy, und Zeiträume gibt es nur, soweit sie hier erzeugt werden.
//
// DIE GRÖSSEN TRAGEN DIE CODES DER ÖSTERREICH-REGISTRY (`config/atParameters.ts`):
// `tl_mittel`, `tlmax`, `rr` … Damit laufen Karte, Farbskalen, Abweichung,
// Rangliste und die Teilzeitraum-Logik unverändert für beide Länder. Die
// Zuordnung (DWD-Spalte → Code) steht in MONTHLY_MAP/DAILY_MAP.
//
// KENNTAGE rechnet dieser Ingest SELBST aus den Tageswerten: GeoSphere führt
// sie fertig im Monatsdatensatz, der DWD nicht. Gezählt wird nur ein
// VOLLSTÄNDIGER Monat der Quellgröße — ein Monat mit Lücken ergäbe zu wenige
// Frosttage, und das sähe aus wie ein milder Winter.
//
// Ausgabe (gitignored, im Deploy erzeugt):
//   public/de/meta.json                 Stand, Zeitfenster
//   public/de/stations.json             Stationen in der Form von `AtStation`
//   public/de/monthly/<jahr>.json       Monatswerte je Code und Station
//   public/de/daily/<YYYY-MM-DD>.json   Tageswerte (nur das „recent"-Fenster)
//   public/de/running.json              laufender Monat aus Tageswerten
//   public/de/normals-<periode>.json    DWD-Normale 1991–2020 und 1961–1990
//
// Die HISTORISCHEN Archive (Monat 35 MB, Tag 360 MB) liegen in
// `.cache/de-climate/` und werden nur nachgeladen, wenn der DWD sie ersetzt
// (der Dateiname trägt das Datum des Reihenendes). Im Deploy hält der
// Actions-Cache dieses Verzeichnis.
//
// Aufruf: node scripts/de-ingest-climate.mjs [--no-historical]

import { mkdir, readdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unzipEntries } from './lib/zip.mjs'

const CDC = 'https://opendata.dwd.de/climate_environment/CDC'
const OBS = `${CDC}/observations_germany/climate`
const OUT = 'public/de'
const CACHE = '.cache/de-climate'
const NO_HIST = process.argv.includes('--no-historical')
/** Monatskarten ab hier; davor sind es nur eine Handvoll Stationen. */
const FIRST_YEAR = 1881
const CONCURRENCY = 8

// --- Abruf ----------------------------------------------------------------

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`)
      await new Promise((res) => setTimeout(res, 1000 * i * i))
    }
  }
}

const text = async (url) => (await get(url)).toString('latin1')

/** Dateinamen eines Verzeichnislistings, gefiltert. */
async function listing(url, re) {
  const html = await text(url)
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((n) => re.test(n))
}

async function pool(items, n, fn) {
  let i = 0
  let done = 0
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++
      await fn(items[k], k)
      done++
      if (done % 200 === 0) console.log(`  … ${done}/${items.length}`)
    }
  })
  await Promise.all(workers)
}

/**
 * Archive eines Verzeichnisses holen; mit `cacheDir` auf der Platte gehalten
 * (historische Archive ändern sich nur, wenn der DWD sie mit neuem Namen
 * ersetzt — veraltete werden dabei gelöscht).
 */
async function fetchZips(url, re, cacheDir) {
  const names = await listing(url, re)
  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true })
    const keep = new Set(names)
    for (const f of await readdir(cacheDir)) if (!keep.has(f)) await rm(join(cacheDir, f))
  }
  const out = new Map()
  let fetched = 0
  await pool(names, CONCURRENCY, async (name) => {
    const local = cacheDir ? join(cacheDir, name) : null
    let buf
    if (local && existsSync(local)) buf = await readFile(local)
    else {
      buf = await get(url + name)
      fetched++
      if (local) await writeFile(local, buf)
    }
    out.set(name, buf)
  })
  console.log(`  ${names.length} Archive (${fetched} neu geholt)`)
  return out
}

// --- Parsen ---------------------------------------------------------------

/** produkt_*.txt → Zeilen als Objekte; −999 = fehlt. */
function parseProduct(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  const head = lines[0].split(';').map((h) => h.trim())
  return lines.slice(1).map((l) => {
    const cols = l.split(';')
    const row = {}
    for (let i = 0; i < head.length; i++) {
      const v = cols[i]?.trim()
      row[head[i]] = v
    }
    return row
  })
}

function num(v) {
  if (v == null || v === '' || v === 'eor') return null
  const x = Number(v)
  return Number.isFinite(x) && x > -998 ? x : null
}

function productOf(zipBuf) {
  const files = unzipEntries(zipBuf, (n) => n.startsWith('produkt_'))
  const [buf] = files.values()
  return buf ? parseProduct(buf.toString('latin1')) : []
}

const STATES = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen',
  'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz',
  'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
].sort((a, b) => b.length - a.length) // längste zuerst: „Sachsen-Anhalt" vor „Sachsen"

/**
 * Stationsbeschreibung. Sieht aus wie Festbreiten-Text, ist es aber nicht:
 * die Strichzeile unter dem Kopf ist breiter als die Werte darunter (die
 * Kennung hat 5 Ziffern unter 11 Strichen). Deshalb: die ersten sechs
 * Felder über ein Muster, der Rest ist „Name  Bundesland  Abgabe" — das
 * Bundesland wird an der festen Liste erkannt, weil Namen Leerzeichen und
 * Länder Bindestriche enthalten.
 */
function parseStationList(raw) {
  const out = []
  for (const l of raw.split(/\r?\n/)) {
    const m = /^(\d{5}) (\d{8}) (\d{8}) +(-?\d+) +(-?[\d.]+) +(-?[\d.]+) +(.*?)\s*$/.exec(l)
    if (!m) continue
    const [, id, from, to, alt, lat, lon, rest0] = m
    let rest = rest0
    const access = /\s(\S+)$/.exec(rest)?.[1]
    if (access && access !== 'Frei') continue
    if (access) rest = rest.slice(0, -access.length).trimEnd()
    const state = STATES.find((st) => rest.endsWith(st)) ?? null
    const name = (state ? rest.slice(0, -state.length) : rest).trim()
    out.push({
      id: Number(id),
      name,
      state,
      lat: Number(lat),
      lon: Number(lon),
      altitude: Number(alt),
      validFrom: `${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}`,
      validTo: `${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}`,
    })
  }
  return out
}

// --- Zuordnung DWD → Registry ---------------------------------------------

/** Monatsdatensatz (monthly/kl). MX_* sind die Extremwerte des Monats. */
const MONTHLY_MAP = {
  tl_mittel: 'MO_TT',
  tlmax_mittel: 'MO_TX',
  tlmin_mittel: 'MO_TN',
  tlmax: 'MX_TX',
  tlmin: 'MX_TN',
  rr: 'MO_RR',
  so_h: 'MO_SD_S',
}

/** Tagesdatensatz (daily/kl). */
const DAILY_MAP = {
  tl_mittel: 'TMK',
  tlmax: 'TXK',
  tlmin: 'TNK',
  rr: 'RSK',
  so_h: 'SDK',
  sh: 'SHK_TAG',
  rfb_mittel: 'UPM',
}

/** Monatswert aus Tageswerten: Aggregat je Code (dieselbe Lesart wie `agg` der Registry). */
const FROM_DAILY = {
  tl_mittel: ['tl_mittel', 'mean'],
  tlmax_mittel: ['tlmax', 'mean'],
  tlmin_mittel: ['tlmin', 'mean'],
  tlmax: ['tlmax', 'max'],
  tlmin: ['tlmin', 'min'],
  rr: ['rr', 'sum'],
  so_h: ['so_h', 'sum'],
}

/** Kenntage: Quelle, Vergleich, Schwelle — wie `countRule` in der Registry. */
const COUNTS = {
  tage_sommer: ['tlmax', (v) => v >= 25],
  tage_tropen: ['tlmax', (v) => v >= 30],
  tage_frost: ['tlmin', (v) => v < 0],
  tage_eis: ['tlmax', (v) => v < 0],
  tage_rr_1: ['rr', (v) => v >= 1],
}

const MONTHLY_CODES = [...Object.keys(MONTHLY_MAP), ...Object.keys(COUNTS)]

function reduce(vals, how) {
  if (vals.length === 0) return null
  if (how === 'sum') return vals.reduce((a, b) => a + b, 0)
  if (how === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length
  if (how === 'max') return Math.max(...vals)
  return Math.min(...vals)
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const pad2 = (n) => String(n).padStart(2, '0')

// --- Ablauf ---------------------------------------------------------------

async function main() {
  const t0 = Date.now()
  await mkdir(OUT, { recursive: true })
  const tmp = `${OUT}.tmp`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(join(tmp, 'monthly'), { recursive: true })
  await mkdir(join(tmp, 'daily'), { recursive: true })

  // 1) Stationen: Beschreibung des Tages- UND des Monatsdatensatzes
  console.log('Stationen …')
  const stationMap = new Map()
  for (const url of [
    `${OBS}/daily/kl/recent/KL_Tageswerte_Beschreibung_Stationen.txt`,
    `${OBS}/monthly/kl/recent/KL_Monatswerte_Beschreibung_Stationen.txt`,
  ]) {
    for (const s of parseStationList(await text(url))) {
      const old = stationMap.get(s.id)
      // Längste bekannte Reihe gewinnt (die beiden Listen weichen am Rand ab)
      if (!old) stationMap.set(s.id, s)
      else {
        if (s.validFrom < old.validFrom) old.validFrom = s.validFrom
        if (s.validTo > old.validTo) old.validTo = s.validTo
      }
    }
  }

  // monthly[id][year][code] = Array(12)
  const monthly = new Map()
  const setMonthly = (id, y, m, code, v) => {
    if (v == null || y < FIRST_YEAR) return
    let st = monthly.get(id)
    if (!st) monthly.set(id, (st = new Map()))
    let yr = st.get(y)
    if (!yr) st.set(y, (yr = {}))
    ;(yr[code] ??= new Array(12).fill(null))[m - 1] = round1(v)
  }

  // 2) Monatswerte: historisch (Cache) + recent; recent überschreibt
  const monthlyZips = []
  if (!NO_HIST) {
    console.log('Monatswerte historisch …')
    monthlyZips.push(...(await fetchZips(`${OBS}/monthly/kl/historical/`, /\.zip$/, join(CACHE, 'monthly-hist'))).values())
  }
  console.log('Monatswerte recent …')
  monthlyZips.push(...(await fetchZips(`${OBS}/monthly/kl/recent/`, /\.zip$/)).values())
  for (const buf of monthlyZips) {
    for (const row of productOf(buf)) {
      const id = Number(row.STATIONS_ID)
      const d = row.MESS_DATUM_BEGINN
      const y = Number(d.slice(0, 4))
      const m = Number(d.slice(4, 6))
      for (const [code, col] of Object.entries(MONTHLY_MAP)) setMonthly(id, y, m, code, num(row[col]))
    }
  }

  // 3) Tageswerte: historisch nur für Kenntage/abgeleitete Monate, recent
  //    zusätzlich für die Tageskarten. Station für Station verarbeitet — die
  //    historischen Tagesreihen sind zusammen über eine Milliarde Zeichen.
  // daily[day][code][id] für das recent-Fenster
  const daily = new Map()
  let lastDay = ''
  let firstRecentDay = '9999'

  /** Tagesreihe einer Station → Monatswerte (Kenntage, fehlende Monate). */
  function digestDaily(id, rows, isRecent) {
    // byMonth[YYYYMM][code] = Werte je Tag
    const byMonth = new Map()
    for (const row of rows) {
      const d = row.MESS_DATUM
      const ym = d.slice(0, 6)
      let mo = byMonth.get(ym)
      if (!mo) byMonth.set(ym, (mo = {}))
      const dayIdx = Number(d.slice(6, 8)) - 1
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      for (const [code, col] of Object.entries(DAILY_MAP)) {
        const v = num(row[col])
        ;(mo[code] ??= [])[dayIdx] = v
        if (isRecent && v != null) {
          let dd = daily.get(iso)
          if (!dd) daily.set(iso, (dd = {}))
          ;(dd[code] ??= {})[id] = round1(v)
          if (iso > lastDay) lastDay = iso
          if (iso < firstRecentDay) firstRecentDay = iso
        }
      }
    }
    for (const [ym, mo] of byMonth) {
      const y = Number(ym.slice(0, 4))
      const m = Number(ym.slice(4, 6))
      const n = daysIn(y, m)
      const full = (code) => {
        const a = mo[code]
        if (!a) return null
        const vals = []
        for (let i = 0; i < n; i++) {
          if (a[i] == null) return null
          vals.push(a[i])
        }
        return vals
      }
      for (const [code, [src, test]] of Object.entries(COUNTS)) {
        const vals = full(src)
        if (vals) setMonthly(id, y, m, code, vals.filter(test).length)
      }
      // Monat fehlt im Monatsdatensatz (gerade abgeschlossen, noch nicht
      // aggregiert)? Dann aus vollständigen Tageswerten bilden.
      const have = monthly.get(id)?.get(y)
      for (const [code, [src, how]] of Object.entries(FROM_DAILY)) {
        if (have?.[code]?.[m - 1] != null) continue
        const vals = full(src)
        if (vals) setMonthly(id, y, m, code, reduce(vals, how))
      }
    }
    return byMonth
  }

  if (!NO_HIST) {
    console.log('Tageswerte historisch …')
    const hist = await fetchZips(`${OBS}/daily/kl/historical/`, /\.zip$/, join(CACHE, 'daily-hist'))
    for (const [name, buf] of hist) {
      const id = Number(/_(\d{5})_/.exec(name)?.[1])
      digestDaily(id, productOf(buf), false)
      hist.delete(name) // Speicher sofort freigeben
    }
  }
  console.log('Tageswerte recent …')
  const recent = await fetchZips(`${OBS}/daily/kl/recent/`, /\.zip$/)
  // Laufender Monat: Teilwerte über die vorhandenen Tage
  const today = new Date().toISOString().slice(0, 10)
  const runY = Number(today.slice(0, 4))
  const runM = Number(today.slice(5, 7))
  const running = { year: runY, month: runM, days: 0, daysInMonth: daysIn(runY, runM), codes: {} }
  const runningIds = new Set()
  for (const [name, buf] of recent) {
    const id = Number(/_(\d{5})_/.exec(name)?.[1])
    runningIds.add(id)
    const byMonth = digestDaily(id, productOf(buf), true)
    const mo = byMonth.get(`${runY}${pad2(runM)}`)
    if (!mo) continue
    for (const code of MONTHLY_CODES) {
      let vals
      if (COUNTS[code]) {
        const [src, test] = COUNTS[code]
        const a = (mo[src] ?? []).filter((v) => v != null)
        if (a.length) vals = [a.filter(test).length]
      } else {
        const [src, how] = FROM_DAILY[code]
        const a = (mo[src] ?? []).filter((v) => v != null)
        if (a.length) vals = [reduce(a, how)]
      }
      if (vals) (running.codes[code] ??= {})[id] = round1(vals[0])
    }
    const n = (mo.tl_mittel ?? []).filter((v) => v != null).length
    if (n > running.days) running.days = n
  }

  // 4) Ausgabe: Monatsdateien je Jahr
  const years = new Map()
  for (const [id, st] of monthly) {
    for (const [y, codes] of st) {
      let yr = years.get(y)
      if (!yr) years.set(y, (yr = {}))
      for (const [code, arr] of Object.entries(codes)) (yr[code] ??= {})[id] = arr
    }
  }
  const yearList = [...years.keys()].sort((a, b) => a - b)
  for (const y of yearList) {
    await writeFile(join(tmp, 'monthly', `${y}.json`), JSON.stringify({ year: y, codes: years.get(y) }))
  }
  // Tagesdateien
  for (const [iso, codes] of daily) {
    await writeFile(join(tmp, 'daily', `${iso}.json`), JSON.stringify({ day: iso, codes }))
  }
  await writeFile(join(tmp, 'running.json'), JSON.stringify(running))

  // 5) Normale — vom DWD fertig berechnet (multi_annual), je Größe eine Tabelle
  const NORMAL_FILES = {
    tl_mittel: 'Temperatur',
    rr: 'Niederschlag',
    so_h: 'Sonnenscheindauer',
    tage_sommer: 'Sommertage',
    tage_tropen: 'Heissetage',
    tage_frost: 'Frosttage',
    tage_eis: 'Eistage',
  }
  const SUM_CODES = new Set(['rr', 'so_h', 'tage_sommer', 'tage_tropen', 'tage_frost', 'tage_eis'])
  const SEASON_IDX = [[11, 0, 1], [2, 3, 4], [5, 6, 7], [8, 9, 10]] // DJF MAM JJA SON
  for (const [periodId, dir, suffix] of [
    ['1991-2020', 'mean_91-20', '1991-2020'],
    ['1961-1990', 'mean_61-90', '1961-1990'],
  ]) {
    const normals = {}
    for (const [code, file] of Object.entries(NORMAL_FILES)) {
      let raw
      try {
        raw = await text(`${OBS}/multi_annual/${dir}/${file}_${suffix}.txt`)
      } catch (e) {
        console.warn(`  Normal ${file} ${suffix} fehlt: ${e.message}`)
        continue
      }
      for (const row of parseProduct(raw)) {
        const id = Number(row.Stations_id)
        if (!Number.isFinite(id)) continue
        const months = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'].map((k) => num(row[k]))
        const annual = num(row.Jahr)
        const seasonal = SEASON_IDX.map((ix) => {
          const v = ix.map((i) => months[i])
          if (v.some((x) => x == null)) return null
          return round1(SUM_CODES.has(code) ? v.reduce((a, b) => a + b, 0) : v.reduce((a, b) => a + b, 0) / 3)
        })
        ;(normals[id] ??= {})[code] = { monthly: months, seasonal, annual }
      }
    }
    await writeFile(join(tmp, `normals-${periodId}.json`), JSON.stringify({ period: periodId, normals }))
    console.log(`  Normale ${periodId}: ${Object.keys(normals).length} Stationen`)
  }

  // 6) Stationen: nur die mit Werten; aktiv = im laufenden Tagesdatensatz
  const withData = new Set([...monthly.keys(), ...runningIds])
  const stations = [...stationMap.values()]
    .filter((s) => withData.has(s.id))
    .map((s) => ({
      ...s,
      isActive: runningIds.has(s.id),
      hasSunshine: false,
      hasRadiation: false,
      has10min: false,
      hasMonthly: monthly.has(s.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  await writeFile(join(tmp, 'stations.json'), JSON.stringify({ stations }))

  const lastMonth = (() => {
    // jüngster Monat mit Werten in mehr als der Hälfte der aktiven Stationen
    const ly = yearList[yearList.length - 1]
    const yr = years.get(ly)?.tl_mittel ?? {}
    for (let m = 12; m >= 1; m--) {
      const n = Object.values(yr).filter((a) => a[m - 1] != null).length
      if (n > runningIds.size / 2) return `${ly}-${pad2(m)}`
    }
    return null
  })()
  const meta = {
    generated: new Date().toISOString(),
    lastDay,
    dailyFrom: firstRecentDay,
    monthlyFrom: yearList[0],
    lastMonth,
    stations: stations.length,
    active: stations.filter((s) => s.isActive).length,
  }
  await writeFile(join(tmp, 'meta.json'), JSON.stringify(meta, null, 1))

  // Atomar austauschen: eine halb geschriebene Ablage nie ausliefern
  await rm(`${OUT}.old`, { recursive: true, force: true })
  if (existsSync(OUT)) await rename(OUT, `${OUT}.old`)
  await rename(tmp, OUT)
  await rm(`${OUT}.old`, { recursive: true, force: true })
  console.log(
    `Fertig in ${Math.round((Date.now() - t0) / 1000)} s: ${stations.length} Stationen (${meta.active} aktiv), ` +
      `Monate ${yearList[0]}–${lastMonth}, Tage ${firstRecentDay}–${lastDay}, laufend ${running.days} Tage`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
