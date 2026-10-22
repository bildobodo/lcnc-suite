// viewerPerf — the three probes that say which side of the browser owns a
// hiccup: render-loop cadence (RAF ticks), main-thread lateness (timer
// probe), GPU completion (WebGL2 fences). Pure bookkeeping driven with an
// explicit clock; the module's timers never start under node (no window).
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: Array<{ kind: string; fields: Record<string, unknown> }> = [];
vi.mock("./ws/telemetry", () => ({
  emitTelemetry: (kind: string, fields: Record<string, unknown>) => { emitted.push({ kind, fields }); },
}));

import {
  binOf, flushViewerPerf, noteInput, noteMainThreadProbe, noteRoundTrip, noteSlowInput, noteStatusReceived,
  recordApply, recordRafTick, recordRender, resetViewerPerf, setViewerPerfGl,
  setViewerPerfContext,
} from "./viewerPerf";

function last(): Record<string, unknown> {
  expect(emitted.length).toBeGreaterThan(0);
  return emitted[emitted.length - 1]!.fields;
}

/** A WebGL2 context stand-in: fences signal after `readyAfter` polls each. */
class FakeGl {
  SYNC_GPU_COMMANDS_COMPLETE = 0x9117;
  SYNC_STATUS = 0x9114;
  SIGNALED = 0x9119;
  UNSIGNALED = 0x9118;
  flushes = 0;
  deleted: object[] = [];
  private _polls = new Map<object, number>();
  private readonly readyAfter: number;
  constructor(readyAfter: number) { this.readyAfter = readyAfter; }
  fenceSync(): object { const s = {}; this._polls.set(s, 0); return s; }
  flush(): void { this.flushes++; }
  getSyncParameter(s: object): number {
    const n = (this._polls.get(s) ?? 0) + 1;
    this._polls.set(s, n);
    return n >= this.readyAfter ? this.SIGNALED : this.UNSIGNALED;
  }
  deleteSync(s: object): void { this.deleted.push(s); }
}
// setViewerPerfGl accepts only a WebGL2RenderingContext instance; give the
// node environment a class of that name and make the fake an instance of it.
(globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext = FakeGl;

beforeEach(() => {
  emitted.length = 0;
  resetViewerPerf();
  setViewerPerfGl(null);
});

describe("status cadence and render-loop cadence", () => {
  it("emits nothing for an idle window", () => {
    flushViewerPerf();
    expect(emitted).toHaveLength(0);
  });

  it("keeps status frames and RAF ticks as separate cadences", () => {
    // Status at 5 Hz (the idle poll) while the loop ticks at 60 Hz.
    for (let i = 0; i < 4; i++) recordApply(1, 1000 + i * 200);
    for (let i = 0; i < 30; i++) recordRafTick(1000 + i * 16.7);
    recordRender(0.5, 1490);
    flushViewerPerf();
    const f = last();
    expect(f.frames).toBe(4);
    expect(f.gap_p50_ms).toBe(200);
    expect(f.jank_frames).toBe(3);        // every 200 ms status gap counts — by design, not lag
    expect(f.raf_ticks).toBe(30);
    expect(f.raf_gap_p50_ms).toBe(16.7);
    expect(f.raf_gap_max_ms).toBe(16.7);
    expect(f.renders).toBe(1);
    expect(f.raf_pauses).toBe(0);
    expect(f).not.toHaveProperty("gpu_fences");   // no WebGL2 context registered
  });

  it("books a long RAF gap as a stall but a paused loop as a pause", () => {
    recordRafTick(1000);     // (a first tick at exactly t=0 would read as "no anchor")
    recordRafTick(1120);     // a 120 ms frame: stall
    recordRafTick(10000);    // > RAF_PAUSE_MS: hidden/inactive tab, not a stall
    recordRafTick(10016);
    recordRender(0.2, 10016);
    flushViewerPerf();
    const f = last();
    expect(f.raf_ticks).toBe(4);
    expect(f.raf_gap_max_ms).toBe(120);
    expect(f.raf_pauses).toBe(1);
  });

  it("resets every accumulator after a flush", () => {
    recordApply(2, 100);
    recordApply(2, 133);
    recordRafTick(100);
    recordRafTick(116);
    recordRender(1, 116);
    flushViewerPerf();
    flushViewerPerf();               // nothing new → quiet
    expect(emitted).toHaveLength(1);
    recordRender(3, 200);
    flushViewerPerf();
    const f = last();
    expect(f.frames).toBe(0);
    expect(f.renders).toBe(1);
    expect(f.render_max_ms).toBe(3);
    expect(f.raf_ticks).toBe(0);
  });
});

describe("main-thread probe", () => {
  it("counts lateness past the block threshold and stays quiet on time", () => {
    noteMainThreadProbe(1000, false);    // arms the first due time (1008); no sample yet
    noteMainThreadProbe(1009, false);    // 1 ms late: jitter, not a block
    noteMainThreadProbe(1017, false);    // on time (due 1017)
    noteMainThreadProbe(1109, false);    // due 1025 → 84 ms late: a block
    recordRender(0.1, 1109);             // something to flush
    flushViewerPerf();
    const f = last();
    expect(f.mt_probes).toBe(3);
    expect(f.mt_blocks).toBe(1);
    expect(f.mt_late_max_ms).toBe(84);
    expect(f.mt_late_p95_ms).toBe(84);
  });

  it("skips hidden-document samples but re-anchors on them", () => {
    noteMainThreadProbe(0, false);
    noteMainThreadProbe(1200, true);     // background tab: the 1 s clamp is policy, not a block
    noteMainThreadProbe(1208, false);    // due 1208 → on time against the re-anchored clock
    recordRender(0.1, 1208);
    flushViewerPerf();
    const f = last();
    expect(f.mt_probes).toBe(1);
    expect(f.mt_blocks).toBe(0);
    expect(f.mt_late_max_ms).toBe(0);
  });
});

describe("GPU fences", () => {
  it("measures how many ticks the GPU trails a render", () => {
    const gl = new FakeGl(2);            // signals on the second poll
    setViewerPerfGl(gl);
    recordRafTick(0);
    recordRender(0.4, 1);                // fence at tick 1
    expect(gl.flushes).toBe(1);
    recordRafTick(16);                   // poll 1: pending
    recordRafTick(32);                   // poll 2: done → 2 ticks behind, 31 ms
    flushViewerPerf();
    const f = last();
    expect(f.gpu_fences).toBe(1);
    expect(f.gpu_behind_max).toBe(2);
    expect(f.gpu_behind_p95).toBe(2);
    expect(f.gpu_done_max_ms).toBe(31);
    expect(f.gpu_dropped).toBe(0);
    expect(gl.deleted).toHaveLength(1);
  });

  it("reports 1 tick when the GPU keeps up", () => {
    const gl = new FakeGl(1);
    setViewerPerfGl(gl);
    for (let i = 0; i < 5; i++) { recordRafTick(i * 16); recordRender(0.3, i * 16 + 1); }
    recordRafTick(80);
    flushViewerPerf();
    const f = last();
    expect(f.gpu_fences).toBe(5);
    expect(f.gpu_behind_max).toBe(1);
    expect(f.gpu_done_max_ms).toBe(15);
  });

  it("stops fencing at the cap and counts the renders it skipped", () => {
    const gl = new FakeGl(1000);         // never signals within the test
    setViewerPerfGl(gl);
    recordRafTick(0);
    for (let i = 0; i < 10; i++) recordRender(0.3, 1 + i);
    recordRafTick(16);
    flushViewerPerf();
    const f = last();
    expect(f.gpu_fences).toBe(0);
    expect(f.gpu_dropped).toBe(2);       // 8 pending, two renders unfenced
  });

  it("abandons a fence that never signals (lost context) and says so", () => {
    const gl = new FakeGl(1000);
    setViewerPerfGl(gl);
    recordRafTick(0);
    recordRender(0.3, 1);
    recordRafTick(20000);                // > FENCE_STALE_MS since the fence
    flushViewerPerf();
    const f = last();
    expect(f.gpu_fences).toBe(0);
    expect(f.gpu_dropped).toBe(1);
    expect(gl.deleted).toHaveLength(1);
  });

  it("ignores a non-WebGL2 context and frees pending fences on teardown", () => {
    const gl = new FakeGl(1000);
    setViewerPerfGl(gl);
    recordRafTick(0);
    recordRender(0.3, 1);
    setViewerPerfGl({ not: "webgl2" });  // e.g. a WebGL1 context
    expect(gl.deleted).toHaveLength(1);
    recordRafTick(16);
    recordRender(0.3, 17);
    flushViewerPerf();
    expect(last()).not.toHaveProperty("gpu_fences");
  });
});

describe("context provider", () => {
  it("merges the viewer's context fields (chunked-draw counters) into the same row", () => {
    setViewerPerfContext(() => ({ chunks: 37, chunks_visible: 12, overlay_chunks: 0, gl_calls: 115, display_mode: "part" }));
    recordApply(1, 1000);
    recordApply(1, 1033);
    flushViewerPerf();
    const f = last();
    expect(f.frames).toBe(2);
    expect(f.chunks).toBe(37);
    expect(f.chunks_visible).toBe(12);
    expect(f.overlay_chunks).toBe(0);
    expect(f.gl_calls).toBe(115);
    expect(f.display_mode).toBe("part");
    setViewerPerfContext(null);
  });
});

describe("histograms that pool (Codex R181 VP181-01)", () => {
  it("bins by width 1 / 2 / 10 / 50 / 500 ms, each bin at its lower edge", () => {
    expect([0, 0.4, 19.9, 20, 21.9, 99.9, 100, 499, 500, 1999, 2000, 2700].map(binOf))
      .toEqual([0, 0, 19, 20, 20, 98, 100, 490, 500, 1950, 2000, 2500]);
  });

  it("carries every status gap and apply in the window's histograms, and clears them at the flush", () => {
    for (const t of [1000, 1033, 1066, 1116, 1700]) recordApply(0.4, t);
    flushViewerPerf();
    const f = last();
    expect(f.gap_h).toEqual({ "32": 2, "50": 1, "550": 1 });   // 33, 33, 50, 584
    expect(f.apply_h).toEqual({ "0": 5 });
    recordApply(2.5, 1733);
    flushViewerPerf();
    expect(last().gap_h).toEqual({ "32": 1 });
    expect(last().apply_h).toEqual({ "2": 1 });
  });
});

describe("status age: socket receipt → applied", () => {
  const T0 = performance.timeOrigin;

  it("ages no frame before the viewer's first apply (its build, not the status path)", () => {
    noteStatusReceived(T0 + 100);
    recordApply(1, 1500);                 // the viewer built 1.4 s later: no age
    noteStatusReceived(T0 + 1510);
    recordApply(1, 1533);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(1);
    expect(f.age_max_ms).toBe(23);
  });

  it("measures the oldest frame received since the last apply, once per apply", () => {
    recordApply(1, 990);                  // the viewer is built
    noteStatusReceived(T0 + 1000);
    noteStatusReceived(T0 + 1030);        // a newer frame — the older one waited longest
    recordApply(1, 1048);
    recordApply(1, 1081);                 // a re-apply with no new receipt: no age
    noteStatusReceived(T0 + 1100);
    recordApply(1, 1105);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(2);
    expect(f.age_max_ms).toBe(48);
    expect(f.age_h).toEqual({ "5": 1, "48": 1 });
    expect(f.age_neg).toBe(0);
  });

  it("ignores a frame without a receipt and counts a receipt after its apply apart", () => {
    recordApply(1, 900);
    noteStatusReceived(undefined);
    noteStatusReceived(0);
    recordApply(1, 1000);
    noteStatusReceived(T0 + 2000);
    recordApply(1, 1990);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(0);
    expect(f.age_neg).toBe(1);
    expect(f.age_h).toEqual({});
  });
});

describe("the gateway → socket bound and input delay", () => {
  it("keeps the heartbeat round trip less the gateway's hold", () => {
    noteRoundTrip(30, 12);
    noteRoundTrip(25, undefined);         // a frame without timing: no sample
    noteRoundTrip(140, 21);
    recordApply(1, 1000);
    flushViewerPerf();
    const f = last();
    expect(f.rt_n).toBe(2);
    expect(f.rt_net_max_ms).toBe(119);
    expect(f.rt_net_h).toEqual({ "18": 1, "110": 1 });
  });

  it("measures a press from its stamp to its first listener; a window with only presses still reports", () => {
    noteInput(100, 103);
    noteInput(200, 262);
    noteInput(300, 290);                  // stamped after it ran: a clock oddity, not a delay
    flushViewerPerf();
    const f = last();
    expect(f.frames).toBe(0);
    expect(f.in_n).toBe(2);
    expect(f.in_delay_max_ms).toBe(62);
    expect(f.in_delay_h).toEqual({ "3": 1, "62": 1 });
    expect(f.in_odd).toBe(1);
  });

  it("reports the slow presses only where the browser has Event Timing", () => {
    noteSlowInput(40, 12);
    noteInput(10, 11);
    flushViewerPerf();
    expect(last()).not.toHaveProperty("ev_n");   // node: no PerformanceObserver "event" entries
  });
});
