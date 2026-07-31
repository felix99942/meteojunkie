// Persistenter Cache für GeoSphere-Stationswerte (Österreich-Klimakarte).
// Historische Klimadaten sind statisch — einmal geholt, für immer gültig; ein
// wiederholter Aufruf derselben Auswahl darf keine API-Kosten verursachen
// (Abnahmekriterium Schritt 6). Muster aus api/gridcache.ts übernommen und auf
// einen generischen String-Key vereinfacht; Fehler degradieren still zum Netz.

const DB_NAME = 'meteo-at'
const DB_VERSION = 1
const STORE = 'station-values'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB nicht verfügbar'))
    })
  }
  return dbPromise
}

function toPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'))
  })
}

/** Ablaufbehafteter Eintrag — nur für tagesaktuelle (noch veränderliche) Werte. */
interface Expiring<T> {
  __exp: number
  v: T
}

function isExpiring<T>(raw: unknown): raw is Expiring<T> {
  return typeof raw === 'object' && raw !== null && '__exp' in raw
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const raw = await toPromise(tx.objectStore(STORE).get(key))
    if (isExpiring<T>(raw)) return raw.__exp > Date.now() ? raw.v : undefined
    return raw as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Schreiben. `ttlMs` gesetzt → Eintrag verfällt (für Werte des laufenden Tages,
 * die sich noch ändern); ohne TTL gilt der Eintrag für immer (historisch = statisch).
 */
export async function cacheSet<T>(key: string, value: T, ttlMs?: number): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(
      ttlMs != null ? ({ __exp: Date.now() + ttlMs, v: value } satisfies Expiring<T>) : value,
      key,
    )
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Schreibfehler'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'))
    })
  } catch {
    // still ignorieren — Cache ist best effort
  }
}
