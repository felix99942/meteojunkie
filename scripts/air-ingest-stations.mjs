// Messstellen der Luftgüte in Österreich → public/air/at-stations.json
//
// Wozu: die Messwerte kommen im Browser vom Download-Dienst der Europäischen
// Umweltagentur (siehe `api/airMeasured.ts`), tragen dort aber nur die
// Kennung des Messpunkts („AT/SPO.04.S184.63303.8.1"), keinen Ort. Die Lage
// steht in der Metadatentabelle des EEA-AQViewers — ein ZIP von ~4 MB mit
// einer CSV von ~118 MB für ganz Europa, ohne CORS. Sie ändert sich selten,
// deshalb einmal hier ausgezogen und als kleines Asset abgelegt (wie die
// Stammdaten der Klimakarte unter public/at/).
//
// Aufruf: node scripts/air-ingest-stations.mjs   (npm run ingest:air:stations)
//
// Gemessen (2026-10-18): Österreich führt je Messpunkt mehrere Zeilen
// (Jahre 2014/2025 und ohne Jahr, alte Kennungen „SPO-AT4S184_00008_100"
// neben den neuen „SPO.04.S184.63303.8.1"). Die Messdaten benutzen die
// NEUEN — genommen wird je Messpunkt die Zeile mit dem jüngsten Jahr, und nur
// Messpunkte ohne Betriebsende.

import { mkdirSync, writeFileSync } from 'node:fs'
import { unzipSingle } from './lib/mosmix.mjs'

const URL_META = 'https://discomap.eea.europa.eu/App/AQViewer/download?fqn=Airquality_Dissem.b2g.measurements&f=csv'
const OUT = 'public/air/at-stations.json'
/** Schadstoff in der Metadatentabelle → Code der Messdaten (EEA-Vokabular). */
const POLLUTANTS = { NO2: 8, O3: 7, PM10: 5, 'PM2.5': 6001 }

/** CSV nach RFC 4180 (Anführungszeichen, verdoppelte "" im Feld). */
function* csvRows(text) {
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''))
      yield row
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) yield [...row, field]
}

const res = await fetch(URL_META)
if (!res.ok) throw new Error(`Metadaten: HTTP ${res.status}`)
const csv = unzipSingle(Buffer.from(await res.arrayBuffer()))

let header = null
const best = new Map()
for (const r of csvRows(csv)) {
  if (!header) {
    header = Object.fromEntries(r.map((h, i) => [h, i]))
    continue
  }
  const get = (k) => (r[header[k]] ?? '').replace(/^"+|"+$/g, '').trim()
  if (get('Country') !== 'Austria') continue
  const code = POLLUTANTS[get('Air Pollutant')]
  if (!code) continue
  const sp = get('Sampling Point Id')
  // Nur die neuen Kennungen — die alten tauchen in den Messdaten nicht auf
  if (!sp.startsWith('SPO.')) continue
  const year = Number(get('Year')) || 0
  const prev = best.get(sp)
  if (prev && prev.year >= year) continue
  const lat = Number(get('Latitude'))
  const lon = Number(get('Longitude'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
  best.set(sp, {
    year,
    ended: get('Operational Activity End') !== '',
    entry: {
      id: `AT/${sp}`,
      p: code,
      name: get('Air Quality Station Name'),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      alt: Math.round(Number(get('Altitude')) || 0),
      type: get('Air Quality Station Type'),
      area: get('Air Quality Station Area'),
    },
  })
}

const stations = [...best.values()].filter((b) => !b.ended).map((b) => b.entry)
stations.sort((a, b) => a.id.localeCompare(b.id))
mkdirSync('public/air', { recursive: true })
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), stations }))
const by = Object.entries(POLLUTANTS).map(([k, c]) => `${k} ${stations.filter((s) => s.p === c).length}`)
console.log(`${OUT}: ${stations.length} Messpunkte (${by.join(', ')})`)
