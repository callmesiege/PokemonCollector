// Tiny IndexedDB wrapper. Stores:
//   collection: { id, setId, localId, name, image, qty, dexIds, rarity, category, price, addedAt }
//   wishlist:   { id, setId, localId, name, image, dexIds }
//   sets:       cached set detail JSON from TCGdex, keyed by set id
//   cache:      generic key/value cache { key, value, savedAt }
//   meta:       key/value settings { key, value }
const DB_NAME = 'pokecollector';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('collection')) {
        const s = db.createObjectStore('collection', { keyPath: 'id' });
        s.createIndex('setId', 'setId');
        s.createIndex('dexIds', 'dexIds', { multiEntry: true });
      }
      if (!db.objectStoreNames.contains('wishlist')) {
        const w = db.createObjectStore('wishlist', { keyPath: 'id' });
        w.createIndex('setId', 'setId');
      }
      if (!db.objectStoreNames.contains('sets')) db.createObjectStore('sets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  getAll: (store) => tx(store, 'readonly', s => s.getAll()),
  getAllByIndex: (store, index, value) => tx(store, 'readonly', s => s.index(index).getAll(value)),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  putMany: (store, values) => tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); }),
  delete: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  count: (store) => tx(store, 'readonly', s => s.count()),

  async getMeta(key, fallback = null) {
    const row = await this.get('meta', key);
    return row ? row.value : fallback;
  },
  setMeta(key, value) { return this.put('meta', { key, value }); },

  async getCached(key, maxAgeMs) {
    const row = await this.get('cache', key);
    if (!row) return null;
    if (maxAgeMs != null && Date.now() - row.savedAt > maxAgeMs) return null;
    return row.value;
  },
  setCached(key, value) { return this.put('cache', { key, value, savedAt: Date.now() }); },
};
