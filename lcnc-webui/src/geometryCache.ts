// IndexedDB-backed cache for parsed Three.js BufferGeometry. Keyed on the
// full STL URL (?v=mtime included) so version invalidation is automatic.
//
// Why per-tab IndexedDB instead of a Service Worker (which would share
// across all tabs)? Service Workers require a "secure context" — they
// don't register on plain http://192.168.x.x. The user's deployment is a
// LAN gateway accessed over HTTP; HTTPS would mean cert distribution on
// every device. IndexedDB has no such restriction and gets ~95% of the
// practical win because each tab caches its own parsed geometries
// across reloads + gateway restarts.

import { BufferGeometry, BufferAttribute } from "three";

const DB_NAME = "lcnc-geometry";
const STORE_NAME = "geometries";
const DB_VERSION = 1;

interface StoredGeometry {
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint16Array | Uint32Array;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // safe-silent: retry-reset only — the rejection still propagates to awaiters,
  // who log it; clearing the cached promise lets a later call re-open.
  p.catch(() => { _dbPromise = null; });
  _dbPromise = p;
  return p;
}

export async function loadGeometryFromIDB(key: string): Promise<BufferGeometry | null> {
  try {
    const db = await openDB();
    return await new Promise<BufferGeometry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const data = req.result as StoredGeometry | undefined;
        if (!data) { resolve(null); return; }
        const geom = new BufferGeometry();
        geom.setAttribute("position", new BufferAttribute(data.positions, 3));
        if (data.normals) {
          geom.setAttribute("normal", new BufferAttribute(data.normals, 3));
        }
        if (data.indices) {
          geom.setIndex(new BufferAttribute(data.indices, 1));
        }
        resolve(geom);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("[idb] load failed", e);
    return null;
  }
}

export async function storeGeometryInIDB(key: string, geom: BufferGeometry): Promise<void> {
  const positionAttr = geom.attributes.position as BufferAttribute | undefined;
  if (!positionAttr) {
    throw new Error("BufferGeometry has no position attribute");
  }
  const normalAttr = geom.attributes.normal as BufferAttribute | undefined;
  const indexAttr = geom.index;
  const data: StoredGeometry = {
    positions: positionAttr.array as Float32Array,
    normals: normalAttr ? (normalAttr.array as Float32Array) : undefined,
    indices: indexAttr ? (indexAttr.array as Uint16Array | Uint32Array) : undefined,
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Drop any IDB keys not in the active set. Bounds the cache as users
 * update STLs (?v=mtime changes → new key, old key would otherwise leak
 * forever). Safe to call on every session — it's a single readwrite
 * transaction with O(N) keys where N is small.
 */
export async function pruneStaleVersions(activeKeys: Set<string>): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result as string[];
        for (const k of keys) {
          if (!activeKeys.has(k)) store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("[idb] prune failed", e);
  }
}
