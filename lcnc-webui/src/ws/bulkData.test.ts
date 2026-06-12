// Unit tests for ws/bulkData.ts (A1.2) — version dedupe, abort-on-newer,
// per-channel error union, retry-after-failure, preview-worker dispatch.
// Behavior pinned at extraction time from the lcncWs.ts monolith.
//
// NOTE: the module keeps private version sentinels across tests (no reset API
// on purpose — production has none). Tests therefore use strictly increasing
// version numbers per channel, mirroring the gateway's monotonic bumps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode as msgpackEncode } from "@msgpack/msgpack";

// Fake Worker BEFORE the module import — bulkData lazily constructs its
// preview worker, and node has no Worker global.
class FakeWorker {
  static instances: FakeWorker[] = [];
  url: URL;
  posted: any[] = [];
  onmessage: ((ev: { data: any }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  constructor(url: URL) {
    this.url = url;
    FakeWorker.instances.push(this);
  }
  postMessage(m: any) { this.posted.push(m); }
  terminate() {}
}
(globalThis as any).Worker = FakeWorker;

const {
  fetchCompGrid, fetchSurfacePoints, gcodeContent,
  handleToolTableChanged, handleViewerGcode, handleViewerGcodeReady, handleViewerInit,
  previewLoadError, toolTableVersion, viewerGcode, viewerInit,
} = await import("./bulkData");

type FetchCall = { url: string; signal: AbortSignal };

let fetchCalls: FetchCall[];
let fetchImpl: (url: string) => Promise<Response>;

function okBuffer(data: unknown): Promise<Response> {
  const buf = msgpackEncode(data);
  return Promise.resolve(new Response(buf.slice().buffer, { status: 200 }));
}

function httpError(status: number): Promise<Response> {
  return Promise.resolve(new Response(null, { status }));
}

async function flush(): Promise<void> {
  // Response.arrayBuffer()/.text() in node (undici) resolve across MACROtask
  // turns, so plain microtask draining never settles the chain.
  for (let i = 0; i < 4; i++) await new Promise<void>(r => setTimeout(r, 0));
}

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = () => httpError(500);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), signal: init?.signal as AbortSignal });
    return fetchImpl(String(url));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bulkData frame handlers", () => {
  it("viewer_init / tool_table_changed set their refs", () => {
    handleViewerInit({ data: { stl_base_url: "/m/", parts: [], kinematics: [], axes: ["X"] } });
    expect(viewerInit.value?.axes).toEqual(["X"]);
    handleToolTableChanged({ version: 7 });
    expect(toolTableVersion.value).toBe(7);
    handleToolTableChanged({});
    expect(toolTableVersion.value).toBe(0);
  });

  it("viewer_gcode empty-state clears preview and gcode text without fetching", () => {
    handleViewerGcode({ data: { file: null } });
    expect(viewerGcode.value).toEqual({ file: null });
    expect(gcodeContent.value).toBeNull();
    expect(fetchCalls.filter(c => c.url.startsWith("/gcode"))).toHaveLength(0);
  });
});

describe("surface/comp-grid channels", () => {
  it("applies decoded data via the sink and dedupes repeat versions", async () => {
    fetchImpl = () => okBuffer([[1, 2, 3]]);
    const apply = vi.fn();
    fetchSurfacePoints(1, apply);
    await flush();
    expect(apply).toHaveBeenCalledWith([[1, 2, 3]]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("/surface_points?v=1");

    fetchSurfacePoints(1, apply);  // same version — deduped
    await flush();
    expect(fetchCalls).toHaveLength(1);
  });

  it("newer version aborts the in-flight older fetch and wins", async () => {
    let resolveV2!: (r: Response) => void;
    const pendingV2 = new Promise<Response>(res => { resolveV2 = res; });
    fetchImpl = (url) => url.endsWith("v=2") ? pendingV2 : new Promise<Response>(() => {});
    const apply = vi.fn();
    fetchSurfacePoints(2, apply);          // stays pending
    fetchSurfacePoints(3, apply);          // newer arrives
    expect(fetchCalls[0]!.signal.aborted).toBe(true);
    // Even if v2's response somehow lands later, the sentinel drops it.
    resolveV2(new Response(msgpackEncode([[9]]).slice().buffer, { status: 200 }));
    await flush();
    expect(apply).not.toHaveBeenCalledWith([[9]]);
  });

  it("per-channel errors: one channel's success cannot clear another's failure", async () => {
    fetchImpl = () => httpError(500);
    fetchSurfacePoints(10, vi.fn());
    await flush();
    expect(previewLoadError.value).toContain("/surface_points failed");

    fetchImpl = () => okBuffer({ rows: 2 });
    fetchCompGrid(10, vi.fn());
    await flush();
    expect(previewLoadError.value).toContain("/surface_points failed"); // union holds

    fetchSurfacePoints(11, vi.fn());  // surface retry succeeds
    await flush();
    expect(previewLoadError.value).toBeNull();
  });

  it("failure resets the sentinel so the SAME version can retry", async () => {
    fetchImpl = () => httpError(500);
    fetchCompGrid(20, vi.fn());
    await flush();
    const callsAfterFail = fetchCalls.length;
    fetchImpl = () => okBuffer({ ok: true });
    const apply = vi.fn();
    fetchCompGrid(20, apply);  // same version retries because last reset to -1
    await flush();
    expect(fetchCalls.length).toBe(callsAfterFail + 1);
    expect(apply).toHaveBeenCalledWith({ ok: true });
  });
});

describe("preview worker channel", () => {
  it("viewer_gcode_ready posts to the worker once per version and fetches gcode text", async () => {
    fetchImpl = () => Promise.resolve(new Response("G0 X0", { status: 200 }));
    handleViewerGcodeReady({ version: 5, file: "/nc/part.ngc" });
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    expect(String(w.url)).toContain("previewWorker");
    expect(w.posted).toEqual([{ version: 5, url: "/preview?v=5" }]);

    handleViewerGcodeReady({ version: 5, file: "/nc/part.ngc" });  // dedupe both channels
    expect(w.posted).toHaveLength(1);

    await flush();
    expect(gcodeContent.value).toBe("G0 X0");
    expect(fetchCalls.filter(c => c.url.startsWith("/gcode")).length).toBe(1);
  });

  it("stale worker reply is dropped; current version applies with markRaw", () => {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    handleViewerGcodeReady({ version: 6, file: null });
    w.onmessage!({ data: { version: 5, gcode: { file: "old" } } });   // stale
    expect(viewerGcode.value?.file).not.toBe("old");
    w.onmessage!({ data: { version: 6, gcode: { file: "new" } } });
    expect(viewerGcode.value?.file).toBe("new");
  });

  it("worker error sets the preview channel error and allows retry of the version", () => {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    handleViewerGcodeReady({ version: 7, file: null });
    w.onmessage!({ data: { version: 7, error: "decode blew up" } });
    expect(previewLoadError.value).toContain("decode blew up");
    handleViewerGcodeReady({ version: 7, file: null });  // sentinel was reset
    expect(w.posted.filter((p: any) => p.version === 7)).toHaveLength(2);
  });
});
