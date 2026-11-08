import type {
  LiveSearchResponse,
  PlatformType,
  SavedSoftwareRecord,
  SearchHistoryRecord,
} from '../types.ts';

const DB_NAME = 'vanguard_index_local_db';
const DB_VERSION = 1;
const STORE_SAVED = 'saved_apps';
const STORE_HISTORY = 'search_history';
const STORE_CACHE = 'search_cache';

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAVED)) {
        db.createObjectStore(STORE_SAVED, { keyPath: 'appKey' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'cacheKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalSavedApps(): Promise<SavedSoftwareRecord[]> {
  try {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SAVED, 'readonly');
      const store = tx.objectStore(STORE_SAVED);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as SavedSoftwareRecord[]) || [];
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function putLocalSavedApp(item: SavedSoftwareRecord): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAVED, 'readwrite');
      tx.objectStore(STORE_SAVED).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB putLocalSavedApp error:', err);
  }
}

export async function removeLocalSavedApp(appKey: string): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAVED, 'readwrite');
      tx.objectStore(STORE_SAVED).delete(appKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB removeLocalSavedApp error:', err);
  }
}

export async function getLocalSearchHistory(): Promise<SearchHistoryRecord[]> {
  try {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as SearchHistoryRecord[]) || [];
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(list.slice(0, 30));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function putLocalSearchHistory(item: SearchHistoryRecord): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB putLocalSearchHistory error:', err);
  }
}

export async function deleteLocalSearchHistory(id: string): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB deleteLocalSearchHistory error:', err);
  }
}

export async function getCachedSearchResult(
  platform: PlatformType,
  query: string
): Promise<LiveSearchResponse | null> {
  try {
    const cacheKey = `${platform}:${query.trim().toLowerCase()}`;
    const db = await openLocalDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const req = tx.objectStore(STORE_CACHE).get(cacheKey);
      req.onsuccess = () => {
        const record = req.result as { cacheKey: string; expiresAt: number; payload: LiveSearchResponse } | undefined;
        if (record && record.expiresAt > Date.now()) {
          resolve(record.payload);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedSearchResult(
  platform: PlatformType,
  query: string,
  payload: LiveSearchResponse
): Promise<void> {
  try {
    const cacheKey = `${platform}:${query.trim().toLowerCase()}`;
    const db = await openLocalDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      tx.objectStore(STORE_CACHE).put({
        cacheKey,
        expiresAt: Date.now() + 1000 * 60 * 15, // 15 minute fresh cache
        payload,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore cache error
  }
}
