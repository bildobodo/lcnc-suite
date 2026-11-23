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
  fetchCompGrid, fetchSurfacePoints, gcodeContent, gcodeRevision, gcodeTextRevision, gcodeTextSource, previewDecoding,
  handleToolTableChanged, handleViewerGcode, handleViewerGcodeReady, handleViewerInit,
  previewLoadError, resetBulkVersionsOnClose, toolTableVersion, viewerGcode, viewerInit,
  previewSchemaMismatch, EXPECTED_PREVIEW_SCHEMA, parseTloMismatch, previewRefusal, previewParseError, gcodeTextState,
} = await import("./bulkData");
const { status } = await import("./statusStore");

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

describe("previewRefusal (remap refusal in preview, 2026-09-05)", () => {
  it("derives from parse_refused and clears on a clean payload", () => {
    viewerGcode.value = { file: "/a.ngc", parse_refused: {
      line: 3, message: "G68.2 ERROR: Must be in G54 to define TWP." } } as any;
    expect(previewRefusal.value).toEqual({
      line: 3, sub: null, message: "G68.2 ERROR: Must be in G54 to define TWP.",
      text: "G68.2 ERROR: Must be in G54 to define TWP. (line 3)" });
    viewerGcode.value = { file: "/a.ngc", parse_refused: {
      line: null, sub: "g533remap", sub_line: 26, message: "No TWP defined" } } as any;
    expect(previewRefusal.value?.text).toBe("No TWP defined (inside g533remap.ngc line 26)");
    viewerGcode.value = { file: "/a.ngc", parse_refused: { line: null, message: "x" } } as any;
    expect(previewRefusal.value?.text).toBe("x (an unknown line)");
    viewerGcode.value = { file: "/a.ngc" } as any;
    expect(previewRefusal.value).toBeNull();
    viewerGcode.value = null;
    expect(previewRefusal.value).toBeNull();
  });
});

describe("previewSchemaMismatch (P1)", () => {
  it("null / missing payload → nothing to judge", () => {
    expect(previewSchemaMismatch(null)).toBeNull();
    expect(previewSchemaMismatch(undefined)).toBeNull();
    expect(previewSchemaMismatch({} as any)).toBeNull();          // no file
    expect(previewSchemaMismatch({ file: null } as any)).toBeNull();
  });

  it("matching stamp → no mismatch", () => {
    expect(previewSchemaMismatch(
      { file: "/a.ngc", preview_schema: EXPECTED_PREVIEW_SCHEMA } as any,
    )).toBeNull();
  });

  it("legacy unstamped payload → { got: null } (bannered, never silently accepted)", () => {
    expect(previewSchemaMismatch({ file: "/a.ngc" } as any)).toEqual({ got: null });
  });

  it("different stamp → { got: n } in both directions", () => {
    expect(previewSchemaMismatch(
      { file: "/a.ngc", preview_schema: EXPECTED_PREVIEW_SCHEMA + 1 } as any,
    )).toEqual({ got: EXPECTED_PREVIEW_SCHEMA + 1 });
    expect(previewSchemaMismatch(
      { file: "/a.ngc", preview_schema: -1 } as any,
    )).toEqual({ got: -1 });
  });

  it("non-numeric stamp is treated as absent", () => {
    expect(previewSchemaMismatch(
      { file: "/a.ngc", preview_schema: "1" } as any,
    )).toEqual({ got: null });
  });
});

describe("parseTloMismatch (W2 P4)", () => {
  const G = { file: "/a.ngc", parse_tlos: [[3, 0, 0, 156.5596], [7, 0, 0, -80]] } as any;

  it("null on missing payload / rows / tool / live length", () => {
    expect(parseTloMismatch(null, 3, 100)).toBeNull();
    expect(parseTloMismatch({ file: "/a.ngc" } as any, 3, 100)).toBeNull();
    expect(parseTloMismatch(G, 0, 100)).toBeNull();
    expect(parseTloMismatch(G, null, 100)).toBeNull();
    expect(parseTloMismatch(G, 3, null)).toBeNull();
    expect(parseTloMismatch(G, 5, 100)).toBeNull();   // tool not in snapshot
  });

  it("matching length within eps → null", () => {
    expect(parseTloMismatch(G, 3, 156.5596)).toBeNull();
    expect(parseTloMismatch(G, 3, 156.5599)).toBeNull();  // sub-eps
  });

  it("re-measured length → mismatch with the live-defect numbers", () => {
    expect(parseTloMismatch(G, 3, 56.6346))
      .toEqual({ tool: 3, parsed: 156.5596, live: 56.6346 });
  });

  it("compares magnitudes (status ships |zoffset|)", () => {
    expect(parseTloMismatch(G, 7, 80)).toBeNull();
    expect(parseTloMismatch(G, 7, 81)).toEqual({ tool: 7, parsed: 80, live: 81 });
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

  it("resetBulkVersionsOnClose lets a re-ping of the same version refetch", async () => {
    fetchImpl = () => okBuffer([[1]]);
    const first = vi.fn();
    fetchSurfacePoints(40, first);
    await flush();
    expect(first).toHaveBeenCalled();

    const before = fetchCalls.length;
    fetchSurfacePoints(40, vi.fn());          // still deduped while connected
    await flush();
    expect(fetchCalls.length).toBe(before);

    resetBulkVersionsOnClose();               // socket closed
    const apply = vi.fn();
    fetchSurfacePoints(40, apply);            // gateway re-pings on reconnect
    await flush();
    expect(fetchCalls.length).toBe(before + 1);
    expect(apply).toHaveBeenCalledWith([[1]]);
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
  // The active program's identity (status data program_id) and its
  // publications: the gate shows only what is this program's (P2b-F1-2).
  const PID = "E.1", SRC = "s1";
  const setActive = (id: string | null) => {
    status.value = { ...(status.value ?? {}), data: { ...((status.value as any)?.data ?? {}), program_id: id } } as any;
  };
  const ready = (version: number, file: string | null, src: string | null = SRC, id: string | null = PID) =>
    handleViewerGcodeReady({ version, file, program_id: id, origin: { source: src } });
  const text = (body: string, src: string = SRC) =>
    Promise.resolve(new Response(body, { status: 200, headers: { "X-Program-Source": src } }));
  beforeEach(() => setActive(PID));
  it("viewer_gcode_ready posts to the worker once per version and fetches gcode text", async () => {
    fetchImpl = () => Promise.resolve(text("G0 X0"));
    ready(5, "/nc/part.ngc");
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    expect(String(w.url)).toContain("previewWorker");
    expect(w.posted).toEqual([{ version: 5, programId: PID, url: "/preview?v=5&p=E.1", basis: null, basisKey: "E.1|/nc/part.ngc#5:start" }]);

    ready(5, "/nc/part.ngc");  // dedupe both channels
    expect(w.posted).toHaveLength(1);

    await flush();
    expect(gcodeContent.value).toBe("G0 X0");
    expect(fetchCalls.filter(c => c.url.startsWith("/gcode")).length).toBe(1);
  });

  it("a payload being decoded is said from the post to its reply — a superseded reply keeps it (plan „Prüfung im Lauf“ 4)", async () => {
    fetchImpl = () => Promise.resolve(text("G0 X0"));
    ready(70, "/nc/d.ngc");
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    expect(previewDecoding.value).toBe(true);
    ready(71, "/nc/d.ngc");
    // the reply for 70 is superseded: 71 is still being decoded
    w.onmessage?.({ data: { programId: PID, version: 70, basisKey: "E.1|/nc/d.ngc#70:start", gcode: { file: "/nc/d.ngc" } } } as any);
    expect(previewDecoding.value).toBe(true);
    w.onmessage?.({ data: { programId: PID, version: 71, basisKey: "E.1|/nc/d.ngc#71:start", gcode: { file: "/nc/d.ngc" } } } as any);
    expect(previewDecoding.value).toBe(false);
    // a failed decode ends it too
    ready(72, "/nc/d.ngc");
    expect(previewDecoding.value).toBe(true);
    w.onmessage?.({ data: { programId: PID, version: 72, basisKey: "E.1|/nc/d.ngc#72:start", error: "bad bytes" } } as any);
    expect(previewDecoding.value).toBe(false);
  });

  it("THIS decode's failure is said with its file and version — never another channel's (VP188-02 E2, R191 rest B)", async () => {
    const { previewDecodeFailure } = await import("./bulkData");
    fetchImpl = () => Promise.resolve(text("G0 X0"));
    ready(80, "/nc/e.ngc");
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    const before = previewDecodeFailure.value;
    // a surface-points failure is the mixed previewLoadError, never this
    fetchImpl = () => httpError(503);
    fetchSurfacePoints(9001, () => {});
    await flush();
    expect(fetchCalls.some(c => c.url.startsWith("/surface_points"))).toBe(true);   // it failed (503)
    expect(previewDecodeFailure.value).toBe(before);
    // a superseded version's error reply is dropped like its success
    ready(81, "/nc/e.ngc");
    w.onmessage?.({ data: { programId: PID, version: 80, basisKey: "E.1|/nc/e.ngc#80:start", error: "old" } } as any);
    expect(previewDecodeFailure.value).toBe(before);
    w.onmessage?.({ data: { programId: PID, version: 81, basisKey: "E.1|/nc/e.ngc#81:start", error: "bad bytes" } } as any);
    expect(previewDecodeFailure.value).toMatchObject({ file: "/nc/e.ngc", version: 81 });
    const n81 = previewDecodeFailure.value!.n;
    // the worker's own error while a version is out names that version
    ready(82, "/nc/e.ngc");
    w.onerror?.({ message: "worker died" });
    expect(previewDecodeFailure.value).toMatchObject({ file: "/nc/e.ngc", version: 82 });
    expect(previewDecodeFailure.value!.n).toBeGreaterThan(n81);
  });

  it("a verified tool basis re-decodes the payload on screen — this file AND version only (VP-I20, R58 VP-I24)", async () => {
    const { previewToolBasis, previewBasisPending } = await import("./statusStore");
    const { nextTick } = await import("vue");
    fetchImpl = () => Promise.resolve(text("G0 X0"));
    ready(60, "/nc/part.ngc");
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    const n0 = w.posted.length;
    expect(w.posted[n0 - 1]).toEqual({ version: 60, programId: PID, url: "/preview?v=60&p=E.1", basis: null, basisKey: "E.1|/nc/part.ngc#60:start" });
    w.onmessage?.({ data: { programId: PID, version: 60, basisKey: "E.1|/nc/part.ngc#60:start", gcode: { file: "/nc/part.ngc", toolBasis: [0, 0, 65.0512] } } } as any);
    // another file with the same version number, the right file with
    // another version: nothing re-decoded, nothing pending
    for (const b of [{ file: "/nc/other.ngc", version: 60, xyz: [0, 0, 30] },
                     { file: "/nc/part.ngc", version: 59, xyz: [0, 0, 30] }]) {
      previewToolBasis.value = b;
      previewBasisPending.value = true;      // statusStore sets it on any change
      await nextTick();
      expect(w.posted.length).toBe(n0);
      expect(previewBasisPending.value).toBe(false);
    }
    // this file and version: the same bytes re-decoded at it, no new revision
    previewToolBasis.value = { file: "/nc/part.ngc", version: 60, xyz: [0, 0, 65.0562] };
    previewBasisPending.value = true;
    await nextTick();
    expect(w.posted.slice(n0)).toEqual([{ version: 60, programId: PID, url: "/preview?v=60&p=E.1", basis: [0, 0, 65.0562],
                                          basisKey: "E.1|/nc/part.ngc#60:0,0,65.0562" }]);
    expect(gcodeRevision.value).toBe("/nc/part.ngc#60");
    expect(previewBasisPending.value).toBe(true);
    // R58 VP-I23: an older reply and a worker error keep it pending …
    w.onmessage?.({ data: { programId: PID, version: 60, basisKey: "E.1|/nc/part.ngc#60:start", gcode: { file: "/nc/part.ngc", toolBasis: [0, 0, 1] } } } as any);
    expect(viewerGcode.value?.toolBasis).toEqual([0, 0, 65.0512]);
    expect(previewBasisPending.value).toBe(true);
    w.onmessage?.({ data: { programId: PID, version: 60, basisKey: "E.1|/nc/part.ngc#60:0,0,65.0562", error: "boom" } } as any);
    expect(previewBasisPending.value, "a failed decode leaves the old basis on screen").toBe(true);
    // … a retry (the next ready for this version) that lands ends it
    ready(60, "/nc/part.ngc");
    const key = "E.1|/nc/part.ngc#60:0,0,65.0562";
    expect(w.posted[w.posted.length - 1]).toMatchObject({ basisKey: key });
    w.onmessage?.({ data: { programId: PID, version: 60, basisKey: key, gcode: { file: "/nc/part.ngc", toolBasis: [0, 0, 65.0562] } } } as any);
    expect(viewerGcode.value?.toolBasis).toEqual([0, 0, 65.0562]);
    expect(previewBasisPending.value).toBe(false);
    // the same basis again: nothing to do, nothing pending
    previewToolBasis.value = { file: "/nc/part.ngc", version: 60, xyz: [0, 0, 65.0562] };
    previewBasisPending.value = true;
    await nextTick();
    expect(previewBasisPending.value).toBe(false);
  });

  // Codex R59 (VP-I23 rest): A on screen → B asked for → the gateway goes
  // back to A before B's reply lands. Pending ends at once (A is on screen),
  // and B's late reply must not replace it — the reply is checked against
  // the decode WANTED now, not the one sent last. Asked for again, B is
  // decoded again.
  for (const [name, a] of [["the payload's own start", null], ["a verified basis already applied", [0, 0, 20]]] as const) {
    it(`a return to the basis on screen drops the late reply of the other — A = ${name} (Codex R59 VP-I23)`, async () => {
      const { previewToolBasis, previewBasisPending } = await import("./statusStore");
      const { nextTick } = await import("vue");
      fetchImpl = () => Promise.resolve(text("G0 X0"));
      const file = "/nc/return.ngc", version = a ? 81 : 80;
      const keyOf = (xyz: readonly number[] | null) => `${PID}|${file}#${version}:${xyz ? xyz.join(",") : "start"}`;
      const reply = (xyz: readonly number[] | null) =>
        w.onmessage?.({ data: { programId: PID, version, basisKey: keyOf(xyz), gcode: { file, toolBasis: xyz ?? [0, 0, 10] } } } as any);
      const want = async (xyz: readonly number[] | null) => {
        previewToolBasis.value = xyz ? { file, version, xyz: [...xyz] } : null;
        previewBasisPending.value = true;      // statusStore sets it on any change
        await nextTick();
      };
      previewToolBasis.value = null;
      await nextTick();
      ready(version, file);
      const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
      reply(null);
      if (a) { await want(a); reply(a); }
      expect(viewerGcode.value?.toolBasis).toEqual(a ?? [0, 0, 10]);
      const b = [0, 0, 30];
      await want(b);
      expect(w.posted[w.posted.length - 1]).toMatchObject({ basisKey: keyOf(b) });
      expect(previewBasisPending.value).toBe(true);
      const n = w.posted.length;
      await want(a);                            // back to what is on screen
      expect(w.posted.length, "A is on screen: nothing to decode").toBe(n);
      expect(previewBasisPending.value).toBe(false);
      reply(b);                                 // B's late reply
      expect(viewerGcode.value?.toolBasis, "the late reply of B never replaces A").toEqual(a ?? [0, 0, 10]);
      await want(a);                            // the next unchanged status
      expect(viewerGcode.value?.toolBasis).toEqual(a ?? [0, 0, 10]);
      await want(b);                            // B wanted again: decoded again
      expect(w.posted.slice(n)).toEqual([{ version, programId: PID, url: `/preview?v=${version}&p=${PID}`, basis: b, basisKey: keyOf(b) }]);
      reply(b);
      expect(viewerGcode.value?.toolBasis).toEqual(b);
      expect(previewBasisPending.value).toBe(false);
      previewToolBasis.value = null;
    });
  }

  it("the published revision moves on ARRIVAL; the text revision follows when the text lands (UI-DI05)", async () => {
    let release!: (r: Response) => void;
    fetchImpl = () => new Promise<Response>(r => { release = r; });
    ready(40, "/nc/part.ngc");
    // A hold bound to the revision is cancelled now — the text is still out.
    expect(gcodeRevision.value).toBe("/nc/part.ngc#40");
    expect(gcodeTextRevision.value).not.toBe("/nc/part.ngc#40");
    release(new Response("G0 X20", { status: 200, headers: { "X-Program-Source": SRC } }));
    await flush();
    expect(gcodeContent.value).toBe("G0 X20");
    expect(gcodeTextRevision.value).toBe("/nc/part.ngc#40");
    // A failed fetch settles too (no text, but no longer loading).
    fetchImpl = () => httpError(503);
    ready(41, "/nc/part.ngc");
    expect(gcodeRevision.value).toBe("/nc/part.ngc#41");
    await flush();
    expect(gcodeContent.value).toBeNull();
    expect(gcodeTextRevision.value).toBe("/nc/part.ngc#41");
  });

  it("the displayed text carries the fingerprint GET /gcode named for it (Codex R17 XZ-07)", async () => {
    fetchImpl = () => text("G0 X30", "ab12");
    ready(50, "/nc/part.ngc", "ab12");
    await flush();
    expect([gcodeContent.value, gcodeTextSource.value, gcodeTextRevision.value]).toEqual(["G0 X30", "ab12", "/nc/part.ngc#50"]);
    // No text, no fingerprint: a failed fetch, a response without one, no program.
    fetchImpl = () => httpError(503);
    ready(51, "/nc/part.ngc", "ab12");
    await flush();
    expect(gcodeTextSource.value).toBe("");
    fetchImpl = () => Promise.resolve(new Response("G0 X31", { status: 200 }));
    ready(52, "/nc/part.ngc", "ab12");
    await flush();
    expect(gcodeTextSource.value).toBe("");
    fetchImpl = () => text("G0 X30", "ab12");
    ready(53, "/nc/part.ngc", "ab12");
    await flush();
    handleViewerGcodeReady({ version: 54, file: null });
    expect(gcodeTextSource.value).toBe("");
  });

  it("stale worker reply is dropped; current version applies with markRaw", () => {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    ready(6, "/nc/stale.ngc");
    w.onmessage!({ data: { programId: PID, version: 5, gcode: { file: "old" } } });   // stale
    expect(viewerGcode.value?.file).not.toBe("old");
    w.onmessage!({ data: { programId: PID, version: 6, gcode: { file: "new" } } });
    expect(viewerGcode.value?.file).toBe("new");
  });

  it("worker error sets the preview channel error and allows retry of the version", () => {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    ready(7, "/nc/w.ngc");
    w.onmessage!({ data: { programId: PID, version: 7, error: "decode blew up" } });
    expect(previewLoadError.value).toContain("decode blew up");
    ready(7, "/nc/w.ngc");  // sentinel was reset
    expect(w.posted.filter((p: any) => p.version === 7)).toHaveLength(2);
  });
});

// P2b-F1-2 (Codex R449 MT449-02, R450 MT450-02/03, R451): the identity gate.
// Nothing of another program is shown — null never matches; the text needs
// its identity AND the proof that its bytes are its publication's text.
describe("the program identity gate (P2b-F1-2)", () => {
  const setActive = (id: string | null) => {
    status.value = { ...(status.value ?? {}), data: { ...((status.value as any)?.data ?? {}), program_id: id } } as any;
  };
  const ready = (version: number, file: string, id: string | null, src: string | null) =>
    handleViewerGcodeReady({ version, file, program_id: id, origin: { source: src } });
  const text = (body: string, src: string | null) =>
    Promise.resolve(new Response(body, { status: 200, headers: src ? { "X-Program-Source": src } : {} }));
  const worker = () => FakeWorker.instances[FakeWorker.instances.length - 1]!;
  const land = (id: string | null, version: number, file: string) =>
    worker().onmessage?.({ data: { programId: id, version, basisKey: `${id ?? ""}|${file}#${version}:start`, gcode: { file } } } as any);

  it("another program's payload is held, never shown; its own shows; null never matches", async () => {
    const { nextTick } = await import("vue");
    fetchImpl = () => text("(A2)\n", "a2");
    setActive("G.1");
    ready(900, "/a2.ngc", "G.1", "a2");
    land("G.1", 900, "/a2.ngc");
    await flush();
    expect(viewerGcode.value?.file).toBe("/a2.ngc");
    expect(gcodeContent.value).toBe("(A2)\n");
    // C is loaded (case c): the status names it before any publication of it
    setActive("G.2");
    await nextTick();
    expect(viewerGcode.value, "A2's path is not C's").toBeNull();
    expect(gcodeContent.value, "A2's text is not C's").toBeNull();
    expect([gcodeRevision.value, gcodeTextRevision.value], "hidden is no load in flight: no start lock").toEqual(["", ""]);
    // no program proven: nothing, also against a payload without identity
    setActive(null);
    ready(901, "/x.ngc", null, null);
    land(null, 901, "/x.ngc");
    await nextTick();
    expect(viewerGcode.value).toBeNull();
    // C's own publication arrives: shown
    setActive("G.2");
    fetchImpl = () => text("(C)\n", "c1");
    ready(902, "/c.ngc", "G.2", "c1");
    land("G.2", 902, "/c.ngc");
    await flush();
    expect(viewerGcode.value?.file).toBe("/c.ngc");
    expect(gcodeContent.value).toBe("(C)\n");
  });

  it("a publication announced before the status names its load waits for the status", async () => {
    const { nextTick } = await import("vue");
    setActive("H.1");
    fetchImpl = () => text("(B)\n", "b1");
    ready(910, "/b.ngc", "H.2", "b1");      // the next load's publication, ahead of its status
    land("H.2", 910, "/b.ngc");
    await flush();
    expect(viewerGcode.value).toBeNull();
    expect(gcodeContent.value).toBeNull();
    setActive("H.2");
    await nextTick();
    expect(viewerGcode.value?.file).toBe("/b.ngc");
    expect(gcodeContent.value).toBe("(B)\n");
  });

  it("text without its proof is never its publication's — named, no lasting lock", async () => {
    setActive("T.1");
    // the file changed between the announcement and GET /gcode: another fingerprint
    fetchImpl = () => text("(edited)\n", "other");
    ready(920, "/t.ngc", "T.1", "t1");
    await flush();
    expect(gcodeContent.value).toBeNull();
    expect(gcodeTextState.value).toBe("differs");
    expect(gcodeRevision.value).toBe(gcodeTextRevision.value);
    // no proof at all: neither side names one
    fetchImpl = () => text("(x)\n", null);
    ready(921, "/t.ngc", "T.1", null);
    await flush();
    expect([gcodeContent.value, gcodeTextState.value]).toEqual([null, "differs"]);
    // a failed fetch: named, the revisions equal again
    fetchImpl = () => httpError(503);
    ready(922, "/t.ngc", "T.1", "t1");
    await flush();
    expect([gcodeContent.value, gcodeTextState.value]).toEqual([null, "failed"]);
    expect(gcodeRevision.value).toBe(gcodeTextRevision.value);
    // in flight: the ACTIVE program's own text keeps them apart, and only then
    let release!: (r: Response) => void;
    fetchImpl = () => new Promise<Response>(r => { release = r; });
    ready(923, "/t.ngc", "T.1", "t1");
    expect(gcodeTextState.value).toBe("loading");
    expect(gcodeRevision.value).not.toBe(gcodeTextRevision.value);
    release(new Response("(t)\n", { status: 200, headers: { "X-Program-Source": "t1" } }));
    await flush();
    expect([gcodeContent.value, gcodeTextState.value]).toEqual(["(t)\n", "ok"]);
    expect(gcodeRevision.value).toBe(gcodeTextRevision.value);
  });

  it("late answers of another load are dropped at their arrival", async () => {
    setActive("L.1");
    let releaseOld!: (r: Response) => void;
    fetchImpl = () => new Promise<Response>(r => { releaseOld = r; });
    ready(930, "/l.ngc", "L.1", "l1");
    // the same path loaded again before the text landed: L.2
    setActive("L.2");
    fetchImpl = () => text("(L2)\n", "l2");
    ready(931, "/l.ngc", "L.2", "l2");
    await flush();
    releaseOld(new Response("(L1)\n", { status: 200, headers: { "X-Program-Source": "l1" } }));
    await flush();
    expect(gcodeContent.value, "the old load's late text").toBe("(L2)\n");
    // a late decode of the old load
    land("L.1", 930, "/l.ngc");
    expect(viewerGcode.value?.file ?? null).not.toBe("/l.ngc#old");
    land("L.2", 931, "/l.ngc");
    expect(viewerGcode.value?.programId).toBe("L.2");
    land("L.1", 931, "/l.ngc");          // the right version, another load: dropped
    expect(viewerGcode.value?.programId).toBe("L.2");
  });

  it("the lines are bound only while the text and the payload are ONE publication", async () => {
    const { gcodeLinesBound } = await import("./bulkData");
    setActive("M.1");
    fetchImpl = () => text("(m)\n", "m1");
    ready(940, "/m.ngc", "M.1", "m1");
    land("M.1", 940, "/m.ngc");
    await flush();
    expect(gcodeLinesBound.value).toBe(true);
    let release!: (r: Response) => void;
    fetchImpl = () => new Promise<Response>(r => { release = r; });
    ready(941, "/m.ngc", "M.1", "m1");      // a re-parse of the same load: its text loads
    land("M.1", 941, "/m.ngc");
    expect(gcodeContent.value, "the same load's text stays while its successor loads").toBe("(m)\n");
    expect(gcodeLinesBound.value, "940's lines under 941's payload: no marks").toBe(false);
    release(new Response("(m)\n", { status: 200, headers: { "X-Program-Source": "m1" } }));
    await flush();
    expect(gcodeLinesBound.value).toBe(true);
  });

  it("an unchanged reconnect fetches nothing; a new version or another load does", async () => {
    const { nextTick } = await import("vue");
    setActive("R.1");
    fetchImpl = () => text("(r)\n", "r1");
    ready(950, "/r.ngc", "R.1", "r1");
    land("R.1", 950, "/r.ngc");
    await flush();
    const posted = worker().posted.length, texts = fetchCalls.filter(c => c.url.startsWith("/gcode")).length;
    resetBulkVersionsOnClose();
    ready(950, "/r.ngc", "R.1", "r1");      // the new connection's re-ping
    await flush();
    expect(worker().posted.length).toBe(posted);
    expect(fetchCalls.filter(c => c.url.startsWith("/gcode")).length).toBe(texts);
    expect(viewerGcode.value?.programId).toBe("R.1");
    ready(951, "/r.ngc", "R.1", "r1");      // a new publication of the same load meanwhile
    expect(worker().posted.length).toBe(posted + 1);
    setActive("R.2");                        // a second client reloaded the same path meanwhile
    await nextTick();
    expect(viewerGcode.value).toBeNull();
  });

  it("a 409 ends the load as superseded; a payload that names another pair is a protocol error", async () => {
    const { previewDecoding } = await import("./bulkData");
    setActive("S.1");
    fetchImpl = () => text("(s)\n", "s1");
    ready(960, "/s.ngc", "S.1", "s1");
    expect(previewDecoding.value).toBe(true);
    worker().onmessage?.({ data: { programId: "S.1", version: 960, basisKey: "S.1|/s.ngc#960:start", superseded: true } } as any);
    expect(previewDecoding.value, "never a lasting loading state").toBe(false);
    expect(previewLoadError.value ?? "").not.toContain("superseded");
    ready(961, "/s.ngc", "S.1", "s1");
    worker().onmessage?.({ data: { programId: "S.1", version: 961, basisKey: "S.1|/s.ngc#961:start",
                                   error: "protocol: preview named 962 / S.1, asked 961 / S.1" } } as any);
    expect(previewLoadError.value).toContain("protocol");
  });

  // Codex R452 MT-I31: a preview job's failure is held with ITS load and
  // shown only while that load is active — late or already set alike; the
  // worker's own failure and the surface / grid channels belong to no load.
  it("a preview load failure is its own load's: late or already set, never under another", async () => {
    const { nextTick } = await import("vue");
    // an earlier test's surface failure ends first (another channel)
    fetchImpl = () => okBuffer([[1]]);
    fetchSurfacePoints(9200, () => {});
    await flush();
    fetchImpl = () => new Promise<Response>(() => {});
    // Codex's probe: A asked, B loaded (its status first), A's late failure
    setActive("F.1");
    await nextTick();
    ready(970, "/fa.ngc", "F.1", "fa");
    const req = worker().posted[worker().posted.length - 1];
    setActive("F.2");
    await nextTick();
    worker().onmessage?.({ data: { ...req, error: "old A response failed" } } as any);
    await nextTick();
    expect(previewLoadError.value, "an old load's late failure is not the active program's").toBeNull();
    expect(viewerGcode.value).toBeNull();
    // a failure already set ends with the identity change
    ready(971, "/fb.ngc", "F.2", "fb");
    worker().onmessage?.({ data: { programId: "F.2", version: 971, basisKey: "F.2|/fb.ngc#971:start",
                                   error: "B bytes" } } as any);
    expect(previewLoadError.value).toContain("B bytes");
    setActive("F.3");
    await nextTick();
    expect(previewLoadError.value, "an earlier load's failure ends with the identity change").toBeNull();
    // a failure announced ahead of its status shows once the status names its load
    ready(972, "/fc.ngc", "F.4", "fc");
    worker().onmessage?.({ data: { programId: "F.4", version: 972, basisKey: "F.4|/fc.ngc#972:start",
                                   error: "C bytes" } } as any);
    expect(previewLoadError.value).toBeNull();
    setActive("F.4");
    await nextTick();
    expect(previewLoadError.value, "its own load's failure").toContain("C bytes");
    // the worker's own failure belongs to no load: shown under any identity,
    // ended by its next good answer
    setActive("F.5");
    await nextTick();
    ready(973, "/fd.ngc", "F.5", "fd");
    worker().onerror?.({ message: "worker died" });
    expect(previewLoadError.value, "the worker's own failure under any load").toContain("worker died");
    setActive("F.6");
    await nextTick();
    expect(previewLoadError.value, "the worker's own failure under any load").toContain("worker died");
    ready(974, "/fe.ngc", "F.6", "fe");
    land("F.6", 974, "/fe.ngc");
    expect(previewLoadError.value).toBeNull();
    // a surface channel's failure belongs to no load either
    fetchImpl = () => httpError(503);
    fetchSurfacePoints(9201, () => {});
    await flush();
    setActive("F.7");
    await nextTick();
    expect(previewLoadError.value, "the surface channel under any load").toContain("/surface_points failed");
    fetchImpl = () => okBuffer([[1]]);
    fetchSurfacePoints(9202, () => {});
    await flush();
    expect(previewLoadError.value).toBeNull();
  });
});

// P4-7 (machine day F29): the banner names a parse error's line only where
// the worker proved it — a positive integer; 0 ("(LINE 0)" on the machine),
// a negative or a missing line is left out.
describe("previewParseError's line", () => {
  const at = (error_line: unknown) => {
    viewerGcode.value = { parse_error: "Requested tool 14 not found in the tool table", error_line } as never;
    return previewParseError.value;
  };
  it("names a proven line", () => {
    expect(at(8)).toBe("Requested tool 14 not found in the tool table (line 8)");
  });
  it("leaves out a line that is no line", () => {
    for (const v of [0, -1, null, undefined, 2.5, "8"]) {
      expect(at(v), String(v)).toBe("Requested tool 14 not found in the tool table");
    }
    viewerGcode.value = null;
  });
});
