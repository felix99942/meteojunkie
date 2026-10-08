// Eigene, dauerhafte Ablage für Satellitenbilder, deren Dienst das
// Zwischenspeichern VERBIETET — NASA GIBS (Himawari) antwortet mit
// `Cache-Control: no-store` (gemessen 2026-10-08), der Browser holt damit bei
// jedem Besuch jedes Bild neu: 20 Vorschauen dauerten beim zweiten Öffnen
// genauso lange wie beim ersten (13,7 s). Ein Satellitenbild eines
// vergangenen Termins ändert sich aber nie; es einmal zu holen und zu
// behalten ist inhaltlich richtig.
//
// Cache Storage statt IndexedDB: es speichert ganze Antworten (Bild samt
// Typ), braucht kein eigenes Schema und hat dieselbe Quote. EUMETView braucht
// das NICHT — es schickt `max-age=604800`, und der HTTP-Cache des Browsers
// lieferte beim zweiten Besuch 18 von 20 scharfen Bildern von der Platte.
//
// Aufgeräumt wird einmal je Sitzung: Bilder, deren Termin älter als
// `KEEP_MS` ist, fliegen raus — die Ziehleiste reicht 24 Stunden zurück, was
// davor liegt, wird nie wieder angefragt. Fehlt die Cache-API (privater
// Modus, alte Browser) oder wirft sie, geht es ohne Ablage weiter.

const STORE = 'satellite-images-v1'
const KEEP_MS = 48 * 3_600_000

let pruned = false

async function openStore(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    const c = await caches.open(STORE)
    if (!pruned) {
      pruned = true
      void prune(c)
    }
    return c
  } catch {
    return null
  }
}

/** Termin eines Bildes aus seiner URL (`time=…`), oder NaN. */
export function timeOfUrl(url: string): number {
  const m = /[?&]time=([^&]+)/.exec(url)
  return m ? Date.parse(decodeURIComponent(m[1])) : NaN
}

async function prune(c: Cache): Promise<void> {
  try {
    const now = Date.now()
    for (const req of await c.keys()) {
      const t = timeOfUrl(req.url)
      if (!Number.isFinite(t) || now - t > KEEP_MS) await c.delete(req)
    }
  } catch {
    // Aufräumen ist Pflege, kein Muss
  }
}

/**
 * Wie `fetch`, aber aus bzw. in die Ablage. Abgelegt wird nur, was `accept`
 * für gut befindet (ein Bild, nicht leer) — sonst klebte ein leeres oder
 * fehlerhaftes Bild für zwei Tage fest.
 */
export async function storedFetch(
  url: string,
  accept: (blob: Blob) => boolean,
  signal?: AbortSignal,
): Promise<Blob> {
  const c = await openStore()
  const hit = c ? await c.match(url).catch(() => undefined) : undefined
  if (hit) return hit.blob()
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (c && accept(blob)) {
    void c.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } })).catch(() => {})
  }
  return blob
}
