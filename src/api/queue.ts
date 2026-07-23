// Rate-aware Scheduler für Gitter-Requests. Open-Meteo gewichtet das
// Minutenlimit nach Anzahl Locations, NICHT nach HTTP-Requests — ein volles
// Gitter (480–625 Punkte) kostet in einem Zug fast das ganze 600/min-Budget
// (SPEC §6). Reine Nebenläufigkeitsbegrenzung reicht deshalb nicht: zwei
// 250-Punkt-Chunks parallel sind schon ~500 gewichtete Locations quasi
// gleichzeitig, ein dritter Chunk kippt über 600 → 429.
//
// Darum pacet die Queue die pro Minute verbrauchten gewichteten Locations über
// ein Token-Bucket: jeder Request kostet sein geschätztes Gewicht, Tokens
// fließen mit `locationsPerMinute` nach. Ist zu wenig Budget da, wartet der
// Request, bis genug nachgeflossen ist, statt in ein 429 zu laufen. Der
// Kaltstart einer großen Karte wird dadurch langsamer, aber nie rate-limited;
// der IndexedDB-Cache (gridcache.ts) trägt Wiederholungen ohne Kosten.
//
// Das Bucket ist modulweit geteilt — alle Panels/Domains rechnen gegen
// dasselbe Minutenbudget, wie es das echte Limit auch tut.

export interface RateAwareQueueOptions {
  /**
   * Gewichtete Locations pro Minute, bewusst UNTER dem echten 600/min-Limit:
   * Meteogramm-Punktserien (kind 'point') laufen NICHT durch diese Queue,
   * zählen aber gegen dasselbe Limit — die Marge lässt ihnen Luft.
   */
  locationsPerMinute: number
  /** Harte Obergrenze gleichzeitiger Requests (Socket-/Backoff-Schonung). */
  maxConcurrent: number
}

interface Waiter {
  cost: number
  resolve: () => void
}

export class RateAwareQueue {
  private active = 0
  private tokens: number
  private lastRefill: number
  private refillTimer: ReturnType<typeof setTimeout> | null = null
  private readonly capacity: number
  private readonly refillPerMs: number
  private readonly maxConcurrent: number
  private readonly waiting: Waiter[] = []

  constructor(opts: RateAwareQueueOptions) {
    this.capacity = opts.locationsPerMinute
    this.tokens = opts.locationsPerMinute
    this.refillPerMs = opts.locationsPerMinute / 60_000
    this.maxConcurrent = opts.maxConcurrent
    this.lastRefill = Date.now()
  }

  /**
   * `task` ausführen, sobald ein Nebenläufigkeits-Slot frei ist UND `cost`
   * gewichtete Locations im Budget sind. `cost` = geschätztes Location-Gewicht
   * dieses Requests (estimateWeight in openmeteo.ts).
   */
  async run<T>(cost: number, task: () => Promise<T>): Promise<T> {
    await this.acquire(cost)
    try {
      return await task()
    } finally {
      this.active--
      this.pump()
    }
  }

  private acquire(cost: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push({ cost: Math.max(0, cost), resolve })
      this.pump()
    })
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
      this.lastRefill = now
    }
  }

  private pump(): void {
    this.refill()
    while (this.waiting.length > 0 && this.active < this.maxConcurrent) {
      const next = this.waiting[0]
      // Ein Request, der teurer als die gesamte Kapazität ist, würde sonst ewig
      // warten (Deadlock): auf volles Bucket deckeln, dann durchlassen.
      const need = Math.min(next.cost, this.capacity)
      if (this.tokens < need) break
      this.tokens -= need
      this.active++
      this.waiting.shift()
      next.resolve()
    }
    // Kopf der Queue wartet nur noch auf Budget (nicht auf einen freien Slot):
    // gezielt aufwecken, wenn genug Tokens nachgeflossen sind.
    if (this.waiting.length > 0 && this.active < this.maxConcurrent) {
      this.scheduleRefillPump()
    }
  }

  private scheduleRefillPump(): void {
    if (this.refillTimer !== null) return
    const next = this.waiting[0]
    if (!next) return
    const need = Math.min(next.cost, this.capacity)
    const deficit = need - this.tokens
    const delay = deficit > 0 ? Math.ceil(deficit / this.refillPerMs) : 0
    this.refillTimer = setTimeout(
      () => {
        this.refillTimer = null
        this.pump()
      },
      Math.max(50, delay),
    )
  }
}

/**
 * Global über alle Karten-Panels geteilt. 500/min lässt ~100/min Marge unter
 * dem echten 600/min-Limit für Meteogramm-Punktserien.
 */
export const gridRequestQueue = new RateAwareQueue({
  locationsPerMinute: 500,
  maxConcurrent: 2,
})
