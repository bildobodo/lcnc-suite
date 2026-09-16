// Unit tests for viewer/machineAssetCache.ts (A3.1). The IndexedDB layer
// (geometryCache) is mocked so the cache logic runs headless: loadGeometryFromIDB
// returns a fresh BufferGeometry per part (an L2 cache hit), so the STL
// fetch/parse path is exercised only in the failure test (fetch rejected).
//
// NOTE: module-level caches persist across tests in one file — each test uses
// distinct part ids / base urls so state can't bleed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const idb = vi.hoisted(() => ({
  loadGeometryFromIDB: vi.fn<(url: string) => Promise<THREE.BufferGeometry | null>>(
    async () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed()),
  storeGeometryInIDB: vi.fn(async () => {}),
  pruneStaleVersions: vi.fn(async () => {}),
}));
vi.mock("../geometryCache", () => idb);
const normals = vi.hoisted(() => ({
  process: vi.fn(async (geom: THREE.BufferGeometry) => {
    geom.userData.machineNormalsVersion = 1;
    return geom;
  }),
  dispose: vi.fn(),
}));
vi.mock("./machineNormals", () => ({
  MACHINE_NORMALS_VERSION: 1,
  createMachineNormalProcessor: () => normals,
}));

const {
  loadMachineAssets, getCachedGeometry, getCollisionGeometry, machineReady, failedParts,
  getToolMeta, setToolMeta,
} = await import("./machineAssetCache");

beforeEach(() => {
  idb.loadGeometryFromIDB.mockImplementation(async () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
  idb.storeGeometryInIDB.mockClear();
  normals.process.mockClear();
  normals.dispose.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tool meta accessors", () => {
  it("round-trips per tool number; missing is undefined", () => {
    expect(getToolMeta(42)).toBeUndefined();
    const meta = { diameter: 6.35 } as any;
    setToolMeta(42, meta);
    expect(getToolMeta(42)).toBe(meta);
  });
});

describe("loadMachineAssets", () => {
  it("keeps display meshes and collision proxies separate through normal-cache migration", async () => {
    const display = new THREE.BoxGeometry(10, 20, 30).toNonIndexed();
    const proxy = new THREE.BoxGeometry(8, 18, 28).toNonIndexed();
    const displayPositions = display.getAttribute("position").array.slice();
    const proxyPositions = proxy.getAttribute("position").array.slice();
    idb.loadGeometryFromIDB.mockResolvedValueOnce(display).mockResolvedValueOnce(proxy);
    const part = { id: "gantry-proxy", file: "guide.stl", collision: "collision/guide.stl" };
    await loadMachineAssets({ stl_base_url: "/gantry/", parts: [part] });
    expect(getCachedGeometry(part.id)).toBe(display);
    expect(getCollisionGeometry(part.id)).toBe(proxy);
    expect(display.getAttribute("position").array).toEqual(displayPositions);
    expect(proxy.getAttribute("position").array).toEqual(proxyPositions);
    expect(idb.storeGeometryInIDB).toHaveBeenCalledWith("/gantry/guide.stl", display);
    expect(idb.storeGeometryInIDB).toHaveBeenCalledWith("/gantry/collision/guide.stl", proxy);
    expect(normals.process).toHaveBeenCalledTimes(2);
    expect(failedParts.value).toEqual([]);
  });

  it("upgrades faceted IDB entries without fetching the STL again", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await loadMachineAssets({ stl_base_url: "/old-normals/", parts: [{ id: "old-normals", file: "head.stl" }] });
    const geometry = getCachedGeometry("old-normals")!;
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(normals.process).toHaveBeenCalledOnce();
    expect(geometry.userData.machineNormalsVersion).toBe(1);
    expect(idb.storeGeometryInIDB).toHaveBeenCalledWith("/old-normals/head.stl", geometry);
    expect(normals.dispose).toHaveBeenCalledOnce();
  });

  it("reuses already-smoothed IDB entries without processing or writing", async () => {
    const geometry = new THREE.BoxGeometry().toNonIndexed();
    geometry.userData.machineNormalsVersion = 1;
    idb.loadGeometryFromIDB.mockResolvedValueOnce(geometry);
    await loadMachineAssets({ stl_base_url: "/new-normals/", parts: [{ id: "new-normals", file: "head.stl" }] });
    expect(normals.process).not.toHaveBeenCalled();
    expect(idb.storeGeometryInIDB).not.toHaveBeenCalled();
    expect(getCachedGeometry("new-normals")).toBe(geometry);
  });

  it("caches geometry, tags it _shared, sets machineReady, no failures", async () => {
    const init = { stl_base_url: "/m1/", parts: [{ id: "m1-x", file: "x.stl" }] };
    await loadMachineAssets(init);
    const geom = getCachedGeometry("m1-x");
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);
    expect(geom!.userData._shared).toBe(true);   // disposal.ts must never free cache geoms
    expect(machineReady.value).toBe(true);
    expect(failedParts.value).toEqual([]);
  });

  it("deduplicates: same init returns the very same in-flight promise", () => {
    const init = { stl_base_url: "/m2/", parts: [{ id: "m2-y", file: "y.stl" }] };
    const p1 = loadMachineAssets(init);
    const p2 = loadMachineAssets(init);
    expect(p2).toBe(p1);   // true single-flight, not just equal
    return p1;
  });

  it("a different init is a fresh load (not deduped)", async () => {
    const a = loadMachineAssets({ stl_base_url: "/m3/", parts: [{ id: "m3-a", file: "a.stl" }] });
    const b = loadMachineAssets({ stl_base_url: "/m3/", parts: [{ id: "m3-b", file: "b.stl" }] });
    expect(b).not.toBe(a);
    await Promise.all([a, b]);
    expect(getCachedGeometry("m3-a")).toBeDefined();
    expect(getCachedGeometry("m3-b")).toBeDefined();
  });

  it("a SUPERSEDED load does not publish its results over the newer one (F4)", async () => {
    // The dedup slot is keyed by the init json, so a different init starts a
    // second load — but nothing cancels the first, and it used to publish its
    // failedParts and machineReady when it finally finished. On a slow link
    // that meant the newer model's failure list was replaced by the older
    // model's, and the scene was declared ready while still loading.
    let releaseOld!: () => void;
    const oldDone = new Promise<void>(res => { releaseOld = res; });
    idb.loadGeometryFromIDB.mockImplementation(async (url: string) => {
      if (url.includes("/old/")) { await oldDone; throw new Error("old part failed"); }
      return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    });
    vi.stubGlobal("fetch", async () => { throw new Error("no network in test"); });

    const slow = loadMachineAssets({ stl_base_url: "/old/", parts: [{ id: "f4-old", file: "o.stl" }] });
    const fresh = loadMachineAssets({ stl_base_url: "/new/", parts: [{ id: "f4-new", file: "n.stl" }] });
    await fresh;
    expect(failedParts.value).toEqual([]);       // the winner loaded cleanly
    expect(machineReady.value).toBe(true);

    releaseOld();                                 // superseded load finishes LAST
    await slow;
    expect(failedParts.value, "superseded load clobbered the winner's failures")
      .toEqual([]);
    expect(machineReady.value).toBe(true);
  });

  it("records a part in failedParts when its IDB miss + fetch both fail", async () => {
    idb.loadGeometryFromIDB.mockResolvedValue(null);        // force the fetch path
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await loadMachineAssets({ stl_base_url: "/m4/", parts: [{ id: "m4-bad", file: "bad.stl" }] });
    expect(failedParts.value).toContain("m4-bad");
    expect(getCachedGeometry("m4-bad")).toBeUndefined();
    expect(machineReady.value).toBe(true);   // a failed part doesn't block readiness
  });

  it("retries after a PARTIAL failure (allSettled fulfils, but the dedup slot is cleared)", async () => {
    // First load: the part's IDB miss + fetch both fail → failedParts.
    idb.loadGeometryFromIDB.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network blip"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const init = { stl_base_url: "/m6/", parts: [{ id: "m6-flaky", file: "flaky.stl" }] };
    await loadMachineAssets(init);
    expect(failedParts.value).toContain("m6-flaky");
    expect(getCachedGeometry("m6-flaky")).toBeUndefined();

    // Second load with the SAME init must NOT return the pinned failed
    // promise — the network is back (IDB hit) and the part loads.
    idb.loadGeometryFromIDB.mockImplementation(async () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
    await loadMachineAssets(init);
    expect(getCachedGeometry("m6-flaky")).toBeInstanceOf(THREE.BufferGeometry);
    expect(failedParts.value).toEqual([]);
  });

  it("retries after a fully-rejected load (the _loadPromise=null path)", async () => {
    // Make the load throw synchronously inside the async IIFE by handing it a
    // parts value that isn't array-like; the outer try rethrows + clears
    // _loadPromise so the next call starts fresh rather than returning the
    // poisoned promise.
    const bad: any = { stl_base_url: "/m5/", parts: { not: "an array, .filter throws" } };
    await expect(loadMachineAssets(bad)).rejects.toBeTruthy();
    // A subsequent valid load is NOT deduped to the rejected promise.
    idb.loadGeometryFromIDB.mockImplementation(async () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
    await loadMachineAssets({ stl_base_url: "/m5b/", parts: [{ id: "m5-ok", file: "ok.stl" }] });
    expect(getCachedGeometry("m5-ok")).toBeDefined();
  });
});
