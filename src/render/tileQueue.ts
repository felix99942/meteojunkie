// Warteschlange für `setTiles` der Modellkarten.
//
// DER WETTLAUF: MapLibre lädt nach `setTiles` die Kacheln neu, bricht laufende
// Abrufe derselben Kachel aber nicht ab, und was zuletzt fertig wird, bleibt stehen.
// Rechnet eine Kachel der alten Größe länger als die neue, überschreibt sie die neue
// — und zwar dauerhaft, bis zum nächsten `setTiles`. Gesehen beim Wechsel von 6 auf
// 4 Panels: „Niederschlag" stand darüber, gezeigt wurde Temperatur 850 hPa, teils
// nur auf einzelnen Kacheln. Beim schnellen Blättern ergäbe es Kacheln vom falschen
// Termin, die man nicht bemerkt.
//
// ZWEITER FALL DERSELBEN ART, und der war es beim Panel-Wechsel: `setTiles`
// übernimmt die Adresse erst verzögert (gemessen über 200 ms). Fordert die Karte in
// dieser Lücke neue Kacheln an, etwa nach einem Ausschnittwechsel, gehen sie noch an
// die ALTE Adresse, gleich darauf läuft die neue daneben. Deshalb setzt die Schlange
// `tiles` an der Quelle selbst, bevor sie `setTiles` ruft.
//
// DESHALB `setTiles` erst, wenn die Quelle nichts mehr lädt; bis dahin zählt nur der
// jüngste Wunsch („neuester Stand gewinnt"). Mehrere Quellen einer Karte wechseln
// gemeinsam, damit Fläche und Linien denselben Termin zeigen. Das Relief steht nicht
// in der Schlange und hält deshalb nichts auf.

/** Was die Schlange von der Karte braucht — so bleibt sie ohne Browser testbar. */
export interface TileQueueMap {
  getSource(id: string): unknown
  isSourceLoaded(id: string): boolean
  on(type: 'sourcedata' | 'idle', fn: () => void): unknown
  off(type: 'sourcedata' | 'idle', fn: () => void): unknown
}

interface TileSource {
  tiles: string[]
  setTiles(t: string[]): unknown
}

export interface TileQueue {
  /** Neuen Stand wünschen: sofort, wenn die Quelle frei ist, sonst sobald sie es wird. */
  queue(id: string, url: string): void
  /** Quelle wurde gerade mit dieser URL angelegt. */
  init(id: string, url: string): void
  /** Quelle wurde entfernt. */
  forget(id: string): void
  destroy(): void
}

export function createTileQueue(map: TileQueueMap): TileQueue {
  const want = new Map<string, string>()
  const shown = new Map<string, string>()
  let scheduled = false
  let destroyed = false

  const flush = () => {
    const pending: [string, string, TileSource][] = []
    for (const [id, url] of want) {
      if (shown.get(id) === url) continue
      const src = map.getSource(id) as TileSource | undefined
      if (src) pending.push([id, url, src])
    }
    if (!pending.length) return
    if (!pending.every(([id]) => map.isSourceLoaded(id))) return
    for (const [id, url, src] of pending) {
      src.tiles = [url]
      src.setTiles([url])
      shown.set(id, url)
    }
  }

  // `sourcedata` je fertiger Kachel; `idle` fängt den Fall, dass die letzte offene
  // Kachel abgebrochen wurde und deshalb nichts mehr gemeldet wird
  map.on('sourcedata', flush)
  map.on('idle', flush)
  return {
    queue(id, url) {
      want.set(id, url)
      // Alle Wünsche derselben Renderrunde zusammen prüfen, sonst liefe die zuerst
      // gemeldete Quelle den anderen schon davon
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          if (!destroyed) flush()
        })
      }
    },
    init(id, url) {
      want.set(id, url)
      shown.set(id, url)
    },
    forget(id) {
      want.delete(id)
      shown.delete(id)
    },
    destroy() {
      map.off('sourcedata', flush)
      map.off('idle', flush)
      destroyed = true
    },
  }
}
