// Persistenter Kartenfeld-Cache in IndexedDB: ein Hot Reload während der
// Entwicklung darf keine API-Calls kosten. Key = Domain + Gitter + Modell +
// Variable + Horizont; Invalidierung über den Modelllauf-Bucket, abgeleitet
// aus updateIntervalHours der Modell-Registry (neuer Lauf → neuer Bucket →
// Cache-Miss). Der Cache ist best effort — Fehler (z.B. Private Mode)
// degradieren still zum Netz-Fetch.

import type { GridField } from './openmeteo'

const DB_NAME = 'meteo-workbench'
const DB_VERSION = 1
const STORE = 'gridfields'

interface CachedGrid {
  runBucket: number
  fetchedAt: number
  field: GridField
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB nicht verfügbar'))
    })
  }
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'))
  })
}

/** Gültigen Cache-Eintrag holen; veraltete Läufe werden dabei aufgeräumt. */
export async function getCachedGrid(key: string, runBucket: number): Promise<GridField | null> {
  try {
    const db = await openDb()
    const entry = await requestToPromise<CachedGrid | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(key),
    )
    if (!entry) return null
    if (entry.runBucket !== runBucket) {
      void deleteCachedGrid(key)
      return null
    }
    return entry.field
  } catch {
    return null
  }
}

export async function putCachedGrid(
  key: string,
  runBucket: number,
  field: GridField,
): Promise<void> {
  try {
    const db = await openDb()
    const entry: CachedGrid = { runBucket, fetchedAt: Date.now(), field }
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key))
  } catch {
    // best effort
  }
}

async function deleteCachedGrid(key: string): Promise<void> {
  try {
    const db = await openDb()
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key))
  } catch {
    // best effort
  }
}
