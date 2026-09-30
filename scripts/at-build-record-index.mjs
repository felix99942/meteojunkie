// Baut die KARTEN-INDIZES `public/at/records/_map-<code>.json` neu.
//
// Aufruf: `node scripts/at-build-record-index.mjs` (npm `ingest:at:recidx`)
//
// **OHNE EINEN EINZIGEN API-ABRUF**: der Index ist nichts als eine andere
// SICHT auf die Stationsdateien, die daneben liegen — dort alle Parameter
// EINER Station, hier eine Größe über ALLE Stationen. Genau die Richtung, die
// eine Karte und ein gefilterter Landesrekord brauchen. Er lässt sich deshalb
// jederzeit aus den vorhandenen Dateien neu erzeugen, statt den vollen
// Rekord-Ingest zu fahren (der kostet 20 Minuten, 290 MB und 22 % des
// GeoSphere-Stundenbudgets).
//
// **Neu gegenüber der früheren, im Ingest eingebauten Fassung ist der
// TAGESBLOCK.** Er fehlte, und das hatte Folgen: der Höhenfilter des
// Klimaarchivs bestimmt seinen Gewinner aus diesem Index, konnte die
// Tagesebene mangels Daten nicht rechnen — und „kältester Tag in Österreich
// ohne Bergstationen" antwortete mit −33,2 °C vom Sonnblick, also der
// UNGEFILTERTEN Zahl. Die Tageswerte lagen die ganze Zeit in den
// Stationsdateien; sie waren nur nie in die Karten-Sicht übernommen worden.
//
// Der Ingest ruft dieselbe Funktion am Ende auf, damit es nicht zwei
// Fassungen derselben Umformung gibt.

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEASONS = ['DJF', 'MAM', 'JJA', 'SON']

/** Eine Ebene (`abs`/`ann`/ein Monat/eine Saison) als Parallel-Array. */
function level(ids, entries, pick) {
  return { v: ids.map((id) => pick(entries.get(id))) }
}

/** `abs`/`ann`/`mon`/`sea` eines Blocks — für den Monats- wie den Tagesblock. */
function block(ids, entries, get) {
  const at = (pick) => level(ids, entries, (e) => {
    const b = get(e)
    return b ? (pick(b) ?? null) : null
  })
  return {
    abs: { max: at((b) => b.abs?.max?.v), min: at((b) => b.abs?.min?.v) },
    ann: { max: at((b) => b.ann?.max?.v), min: at((b) => b.ann?.min?.v) },
    mon: Array.from({ length: 12 }, (_, m) => ({
      max: at((b) => b.mon?.[m]?.max?.v),
      min: at((b) => b.mon?.[m]?.min?.v),
    })),
    sea: Object.fromEntries(
      SEASONS.map((s) => [s, { max: at((b) => b.sea?.[s]?.max?.v), min: at((b) => b.sea?.[s]?.min?.v) }]),
    ),
  }
}

/**
 * Liest alle Stationsdateien in `outDir` und schreibt je Parameter einen
 * Index. `meta` wird durchgereicht; fehlt sie, bleibt die des vorhandenen
 * Index stehen (der Index soll nicht behaupten, frischer zu sein als die
 * Daten, aus denen er stammt).
 */
export async function buildRecordIndexes(outDir, meta) {
  const files = (await readdir(outDir)).filter((f) => /^\d+\.json$/.test(f))
  /** code → Map(stationId → ParamRecords) */
  const byCode = new Map()
  for (const f of files) {
    const id = Number(f.slice(0, -5))
    const rec = JSON.parse(await readFile(join(outDir, f), 'utf8'))
    for (const [code, entry] of Object.entries(rec)) {
      if (!byCode.has(code)) byCode.set(code, new Map())
      byCode.get(code).set(id, entry)
    }
  }

  const written = []
  for (const [code, entries] of byCode) {
    const ids = [...entries.keys()].sort((a, b) => a - b)
    let keepMeta = meta
    if (!keepMeta) {
      try {
        keepMeta = JSON.parse(await readFile(join(outDir, `_map-${code}.json`), 'utf8')).meta
      } catch {
        keepMeta = undefined
      }
    }
    const out = { meta: keepMeta, code, ids, ...block(ids, entries, (e) => e) }
    // Der Tagesblock nur, wo es ihn WIRKLICH gibt (tlmax/tlmin/rr). Ein
    // leerer Block sähe nach „vorhanden, aber ohne Wert" aus und verdeckte
    // die Erklärung, die das Klimaarchiv sonst gibt.
    if (ids.some((id) => entries.get(id).day)) {
      out.day = block(ids, entries, (e) => e.day)
    }
    await writeFile(join(outDir, `_map-${code}.json`), JSON.stringify(out))
    written.push(`${code}${out.day ? ' (+Tag)' : ''}`)
  }
  return written
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'at', 'records')
  const written = await buildRecordIndexes(dir)
  process.stdout.write(`Karten-Index neu gebaut: ${written.join(', ')}\n`)
}
