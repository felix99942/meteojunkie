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

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    return (await toPromise(tx.objectStore(STORE).get(key))) as T | undefined
  } catch {
    return undefined
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Schreibfehler'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'))
    })
  } catch {
    // still ignorieren — Cache ist best effort
  }
}
