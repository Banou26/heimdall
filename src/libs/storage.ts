// heimdall keeps its own data on its own origin. The FKN extension only lends
// us networking, so app persistence (the API key, response caches) lives in a
// small IndexedDB key-value store here rather than in extension storage.

const DATABASE = 'heimdall'
const STORE = 'kv'

let connection: Promise<IDBDatabase> | undefined
const connect = () =>
  (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    // Don't cache a failed open (e.g. private browsing) - let the next call retry.
    connection = undefined
    throw error
  }))

// Resolve on the transaction (not the request): a write is only durable once the
// transaction commits, and the request result is already populated by then.
const transact = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> => {
  const db = await connect()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result as T)
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

export const storage = {
  get: <T>(key: string) => transact<T | undefined>('readonly', (store) => store.get(key)),
  set: (key: string, value: unknown) => transact<void>('readwrite', (store) => store.put(value, key)),
  delete: (key: string) => transact<void>('readwrite', (store) => store.delete(key)),
}
