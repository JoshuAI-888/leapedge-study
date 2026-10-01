/**
 * The last workspace this browser loaded, kept in IndexedDB so a reload or a
 * fresh login paints at once from it while the live read runs behind. It is a
 * display cache only: every value is replaced by the next successful refresh,
 * and any failure (private mode, blocked storage, a schema change) reads as
 * "nothing cached". The version key drops a cache written by older code.
 */
const DB = "yti-workspace",
  STORE = "cache",
  KEY = "workspace",
  VERSION = 1;
type Entry<T> = { version: number; savedAt: number; value: T };
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
export async function readWorkspaceCache<T>(): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => {
        const entry = request.result as Entry<T> | undefined;
        resolve(entry?.version === VERSION ? entry.value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}
export async function writeWorkspaceCache<T>(value: T): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const entry: Entry<T> = { version: VERSION, savedAt: Date.now(), value };
    db.transaction(STORE, "readwrite").objectStore(STORE).put(entry, KEY);
  } catch {
    /* A full or blocked store only costs the next instant paint. */
  } finally {
    db.close();
  }
}
