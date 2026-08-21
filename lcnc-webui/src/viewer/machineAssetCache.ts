// Machine STL asset cache (frontend split, A3 — extracted from ThreeViewer.vue's
// first <script> block).
//
// Central, cross-instance caches: parsed STL geometries (keyed by part id) and
// per-tool ToolMeta. Shared across ALL ThreeViewer instances and persisted for
// the page lifetime, so a reconnect / tab re-mount reuses already-parsed
// geometry instead of re-fetching. loadMachineAssets is single-flight
// (deduplicates concurrent + repeat calls for the same init) — but a load
// that threw, or fulfilled with failedParts (Promise.allSettled means part
// failures still FULFIL the outer promise), clears the dedup slot so the
// next call retries the missing parts instead of pinning the failure for
// the whole page session.
//
// The geometries are tagged userData._shared so viewer/disposal.ts never frees
// them on a scene teardown — they outlive any single viewer.
import { ref } from "vue";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { loadGeometryFromIDB, storeGeometryInIDB, pruneStaleVersions } from "../geometryCache";
import { type ToolMeta } from "../toolGeometry";

// ---- Central caches (shared across ALL ThreeViewer instances) ----
//
// Keyed by PART ID, which assumes an id always means the same geometry. That
// holds for every supported case today: the model directory is fixed per
// config, and a re-load of the same model hits the id it already has. It would
// NOT hold if one page session swapped to a different machine model that
// reused a part id for different geometry — the in-memory entry would win and
// the wrong mesh would draw (IndexedDB is keyed by URL including ?v=mtime, so
// only this layer is affected). Not built for: keying by URL, or clearing on
// model change. Reopen if machine-model switching without a page reload ships.
const _geometryCache = new Map<string, THREE.BufferGeometry>();
const _toolMetaCache = new Map<number, ToolMeta>();  // tool_number → ToolMeta, populated on first sight
let _loadPromise: Promise<void> | null = null;
let _loadedInitJson: string | null = null;
//: Monotonic load generation — see the comment in loadMachineAssets (F4).
let _loadGeneration = 0;
export const machineReady = ref(false);
export const failedParts = ref<string[]>([]);

async function fetchAndParseStl(url: string, signal?: AbortSignal): Promise<THREE.BufferGeometry> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200)).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) throw new Error(`Not an STL from ${url}`);
  const loader = new STLLoader();
  const looksAscii = head.startsWith("solid") && head.includes("facet");
  if (looksAscii) return loader.parse(new TextDecoder().decode(bytes));
  if (buf.byteLength >= 84) {
    const dv = new DataView(buf);
    const triCount = dv.getUint32(80, true);
    if (84 + triCount * 50 <= buf.byteLength && triCount < 50_000_000) return loader.parse(buf);
    return loader.parse(new TextDecoder().decode(bytes));
  }
  throw new Error(`STL too small / invalid: ${url}`);
}

export function loadMachineAssets(init: any, onProgress?: (msg: string) => void): Promise<void> {
  const json = JSON.stringify({ base: init.stl_base_url, parts: init.parts });
  // Return in-progress OR completed promise (true deduplication). Loads that
  // threw OR completed with failedParts clear _loadPromise below, so the next
  // call retries the missing parts (cached successes skip straight through).
  if (_loadPromise && json === _loadedInitJson) return _loadPromise;

  // Load generation (F4). The dedup slot is keyed by `json`, which protects
  // _loadPromise — but a SUPERSEDED load keeps running (nothing cancels its
  // fetches) and used to publish its results anyway: its failedParts would
  // overwrite the newer load's, its machineReady would declare a scene ready
  // that is still loading, and its geometry could land in the cache under a
  // part id the new model maps to a different file. Every publish below is
  // gated on still being the current generation.
  const gen = ++_loadGeneration;
  const current = () => gen === _loadGeneration;

  _loadedInitJson = json;
  machineReady.value = false;
  failedParts.value = [];

  _loadPromise = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new DOMException("STL fetch timed out after 120s", "TimeoutError")), 120_000);
    try {
      const base = init.stl_base_url;
      const parts = init.parts ?? [];
      const urlFor = (file: string) => base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
      const toFetch = parts.filter((p: any) => !_geometryCache.has(p.id));

      // Drop IndexedDB entries whose ?v= no longer matches the active set.
      // Bounds the cache as users update STLs (?v=mtime changes → new key).
      // safe-silent: best-effort cache GC; pruneStaleVersions warns internally
      pruneStaleVersions(new Set(parts.map((p: any) => urlFor(p.file)))).catch(() => {});

      if (toFetch.length === 0) {
        onProgress?.("All STLs already cached");
      }

      const results = await Promise.allSettled(toFetch.map(async (p: any) => {
        const url = urlFor(p.file);
        const t0 = performance.now();
        // L2: parsed geometry from IndexedDB. Same-version key (?v=mtime)
        // means no re-fetch + no re-parse on reconnect / reload.
        let geom = await loadGeometryFromIDB(url);
        if (geom) {
          onProgress?.(`✓ ${p.id} (cache, ${((performance.now() - t0) / 1000).toFixed(2)}s)`);
        } else {
          onProgress?.(`Fetching ${p.id}…`);
          geom = await fetchAndParseStl(url, abort.signal);
          geom.computeVertexNormals();
          // Fire-and-forget: don't block first paint on the IDB write.
          storeGeometryInIDB(url, geom).catch(e => console.warn("[idb] store", e));
          onProgress?.(`✓ ${p.id} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
        }
        geom.userData._shared = true;
        // Deliberately NOT generation-gated: a superseded load's geometry is
        // still valid for its own part ids, and discarding it would re-fetch
        // work already paid for. See the id-collision note on _geometryCache.
        _geometryCache.set(p.id, geom);
      }));

      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          const id = toFetch[i].id;
          failed.push(id);
          console.error(`[STL] failed to load ${id}:`, r.reason);
        }
      });
      if (!current()) return;   // superseded — publish nothing

      failedParts.value = failed;
      if (failed.length > 0 && _loadedInitJson === json) {
        // Partial failure still FULFILS (allSettled) — without this the dedup
        // guard would return the failed load for the whole page session.
        // Guarded on _loadedInitJson so a newer, different load that started
        // meanwhile keeps its own dedup slot.
        _loadPromise = null;
      }

      machineReady.value = true;
    } catch (err) {
      // Clear so the next buildFromInit call retries fresh — but only if no
      // newer load superseded this one (don't clobber its dedup slot).
      if (_loadedInitJson === json) _loadPromise = null;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();

  return _loadPromise;
}

export function getCachedGeometry(id: string): THREE.BufferGeometry | undefined {
  return _geometryCache.get(id);
}

// ToolMeta cache accessors (replace the former direct _toolMetaCache access from
// ThreeViewer's <script setup>): a tool's geometry params are cached on first
// sight so a later status carrying only tool_number can rebuild the marker.
export function getToolMeta(num: number): ToolMeta | undefined {
  return _toolMetaCache.get(num);
}

export function setToolMeta(num: number, meta: ToolMeta): void {
  _toolMetaCache.set(num, meta);
}
