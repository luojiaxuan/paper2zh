// IndexedDB cache of translations and summaries, so reopening a paper is instant
// and does not spend tokens again. Every call degrades to a no-op when storage
// is unavailable (private windows, blocked site data).

const DB = 'paper2zh';
const STORE = 'kv';
let dbPromise = null;

function open() {
  dbPromise ||= new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    let result;
    try {
      const t = db.transaction(STORE, mode);
      result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : undefined);
      t.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function getMany(keys) {
  const db = await open();
  const out = new Map();
  if (!db || !keys.length) return out;
  return new Promise((resolve) => {
    try {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      let left = keys.length;
      for (const k of keys) {
        const r = store.get(k);
        r.onsuccess = () => {
          if (r.result !== undefined) out.set(k, r.result);
          if (--left === 0) resolve(out);
        };
        r.onerror = () => {
          if (--left === 0) resolve(out);
        };
      }
    } catch {
      resolve(out);
    }
  });
}

export function putMany(entries) {
  return tx('readwrite', (store) => {
    for (const [k, v] of entries) store.put(v, k);
  });
}

export function get(key) {
  return tx('readonly', (store) => store.get(key));
}

export function put(key, value) {
  return tx('readwrite', (store) => store.put(value, key));
}

// 53-bit string hash (cyrb53), enough to key cached translations by text.
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
