// Begrenzte Nebenläufigkeit für Gitter-Requests: statt alle Chunks parallel
// zu feuern, laufen maximal N gleichzeitig — schont das gewichtete
// Open-Meteo-Minutenlimit und lässt dem Backoff (openmeteo.ts) Raum.

export class RequestQueue {
  private active = 0
  private waiting: (() => void)[] = []
  private readonly maxConcurrent: number

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.active++
    try {
      return await task()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}

/** Global über alle Karten-Panels geteilt. */
export const gridRequestQueue = new RequestQueue(2)
