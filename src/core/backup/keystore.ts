// The daily-use backup key: a NON-extractable WebCrypto key kept in IndexedDB (API_CONTRACTS §6, audit A2).
// The raw key bytes are discarded after setup; the recovery code is never stored (audit B7).

const DB_NAME = 'boxtap-keys';
const STORE = 'keys';

export interface StoredKey { keyId: string; cryptoKey: CryptoKey }

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(r.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export const saveBackupKey = (k: StoredKey): Promise<IDBValidKey> => run('readwrite', (s) => s.put(k, 'backup'));
export const loadBackupKey = (): Promise<StoredKey | undefined> => run('readonly', (s) => s.get('backup') as IDBRequest<StoredKey | undefined>);
export const clearBackupKey = (): Promise<undefined> => run('readwrite', (s) => s.delete('backup'));
