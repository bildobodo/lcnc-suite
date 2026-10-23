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
  binOf, flushViewerPerf, noteHeartbeatReply, noteHeartbeatSentAt, noteInput, noteMainThreadProbe,
  notePendingReceipt, noteSlowInput, noteVisibilityChanged,
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

  it("names each row's ACTUAL window on the global clock — the previous row's end to this one's (Codex R185)", () => {
    const T0 = performance.timeOrigin;
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    resetViewerPerf();
    recordApply(1, 1_100);
    vi.spyOn(performance, "now").mockReturnValue(5_200);   // a window the load held 4.2 s
    flushViewerPerf();
    const r1 = (x: number) => +x.toFixed(1);
    expect([last().win_start, last().win_end, last().win_ms]).toEqual([r1(T0 + 1_000), r1(T0 + 5_200), 4_200]);
    flushViewerPerf();                                       // an idle window says nothing and keeps its start
    recordApply(2, 7_000);
    vi.spyOn(performance, "now").mockReturnValue(8_200);
    flushViewerPerf();
    expect([last().win_start, last().win_ms]).toEqual([r1(T0 + 5_200), 3_000]);
    vi.restoreAllMocks();
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

describe("status age: the receipt the viewer takes, at its apply", () => {
  const T0 = performance.timeOrigin;

  it("ages no frame at the viewer's first apply (its build, not the status path)", () => {
    notePendingReceipt(T0 + 100);
    recordApply(1, 1500);                 // the viewer built 1.4 s later: no age
    notePendingReceipt(T0 + 1510);
    recordApply(1, 1533);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(1);
    expect(f.age_max_ms).toBe(23);
  });

  it("keeps the oldest receipt the viewer took before one apply, and consumes it there", () => {
    recordApply(1, 990);                  // the viewer is built
    notePendingReceipt(T0 + 1030);
    notePendingReceipt(T0 + 1000);        // an older flush taken too (order of notes is free)
    recordApply(1, 1048);
    recordApply(1, 1081);                 // a local re-apply: no receipt, no age
    notePendingReceipt(T0 + 1100);
    recordApply(1, 1105);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(2);
    expect(f.age_max_ms).toBe(48);
    expect(f.age_h).toEqual({ "5": 1, "48": 1 });
    expect(f.age_neg).toBe(0);
  });

  it("ignores a status without a receipt, counts a receipt after its apply and one from before a visibility change apart", () => {
    recordApply(1, 900);
    notePendingReceipt(undefined);
    notePendingReceipt(0);
    recordApply(1, 1000);
    notePendingReceipt(T0 + 2000);
    recordApply(1, 1990);
    notePendingReceipt(T0 + 2100);        // received, then the page was hidden and shown again
    noteVisibilityChanged(T0 + 2200);
    recordApply(1, 5000);
    flushViewerPerf();
    const f = last();
    expect(f.age_n).toBe(0);
    expect(f.age_neg).toBe(1);
    expect(f.age_vis_skip).toBe(1);
    expect(f.age_h).toEqual({});
  });
});

describe("the gateway → socket bound, timed in the worker and paired by number (Codex R182/R183 VP182-02)", () => {
  const T0 = performance.timeOrigin;

  it("pairs an answer with the heartbeat it names, whenever the page handles them", () => {
    // R182: sent at 10, answered at the worker at 130, hold 20 — the page
    // handled both posts only at 200/201: both legs are 100, not 0
    noteHeartbeatSentAt(T0 + 10, 1);
    noteHeartbeatReply(T0 + 130, 20, 1);
    recordApply(1, 1000);
    flushViewerPerf();
    expect(last().rt_net_max_ms).toBe(100);
    expect(last().rt_n).toBe(1);
  });

  it("pairs a late answer with ITS heartbeat, never the newest one sent (Codex R183)", () => {
    noteHeartbeatSentAt(T0 + 10, 1);
    noteHeartbeatSentAt(T0 + 1010, 2);
    noteHeartbeatReply(T0 + 1500, 20, 1);  // H1's answer, late
    noteHeartbeatSentAt(T0 + 2010, 3);
    noteHeartbeatReply(T0 + 2300, 20, 2);  // H2's: 1270 ms for both legs — not 270 against H3
    noteHeartbeatReply(T0 + 2350, 20, 3);
    recordApply(1, 1000);
    flushViewerPerf();
    const f = last();
    expect(f.rt_n).toBe(3);
    expect(f.rt_invalid).toBe(0);
    expect(f.rt_net_h).toEqual({ "320": 1, "1250": 1, "1450": 1 });   // 320, 1270, 1470
    expect(f.rt_net_max_ms).toBe(1470);
  });

  it("gives no bound for an answer naming no heartbeat sent here, an unstamped one or a negative pair", () => {
    noteHeartbeatSentAt(T0 + 10, 1);
    noteHeartbeatReply(T0 + 100, 20, 1);
    noteHeartbeatReply(T0 + 150, 20, 1);   // answered already
    noteHeartbeatReply(T0 + 160, 20);      // names no heartbeat (an old gateway)
    noteHeartbeatReply(T0 + 170, 20, 9);   // never sent here
    noteHeartbeatSentAt(undefined, 4);     // a worker without the stamp: not remembered
    noteHeartbeatReply(T0 + 2100, 20, 4);
    noteHeartbeatSentAt(T0 + 3000, 5);
    noteHeartbeatReply(T0 + 3010, 20, 5);  // hold longer than the round trip
    noteHeartbeatSentAt(T0 + 4000, 6);
    noteHeartbeatReply(T0 + 4050, undefined, 6);
    recordApply(1, 1000);
    flushViewerPerf();
    const f = last();
    expect(f.rt_n).toBe(1);
    expect(f.rt_invalid).toBe(6);
  });

  it("keeps each valid pair with the gateway's monotonic stamp for the row, and only valid ones (Codex R185)", () => {
    noteHeartbeatSentAt(T0 + 10, 1);
    noteHeartbeatReply(T0 + 130, 20, 1, 5_000.25, 4242);
    noteHeartbeatSentAt(T0 + 1010, 2);
    noteHeartbeatReply(T0 + 1120, 20, 2);                 // an old gateway: no stamp, a bound but no pair
    noteHeartbeatSentAt(T0 + 2010, 3);
    noteHeartbeatReply(T0 + 2015, 20, 3, 7_000, 4242);    // negative: no bound, no pair
    noteHeartbeatReply(T0 + 2100, 20, 9, 7_100, 4242);    // never sent here
    noteHeartbeatSentAt(T0 + 3010, 4);
    noteHeartbeatReply(T0 + 3140, 20, 4, 8_000.5, 4242);
    recordApply(1, 1000);
    flushViewerPerf();
    expect(last().hb_pairs).toEqual([[1, T0 + 10, T0 + 130, 5_000.25, 4242], [4, T0 + 3010, T0 + 3140, 8_000.5, 4242]]);
    expect(last().hb_pairs_dropped).toBeUndefined();
    noteHeartbeatSentAt(T0 + 4010, 5);
    recordApply(2, 1000);
    flushViewerPerf();
    expect(last().hb_pairs).toEqual([]);                 // a window keeps its own
  });

  it("caps a window's pairs and counts the rest", () => {
    for (let k = 1; k <= 40; k++) {
      noteHeartbeatSentAt(T0 + k * 100, k);
      noteHeartbeatReply(T0 + k * 100 + 50, 1, k, k * 100 + 25, 7);
    }
    recordApply(1, 1000);
    flushViewerPerf();
    expect(last().hb_pairs).toHaveLength(32);
    expect((last().hb_pairs as unknown[])[0]).toEqual([1, T0 + 100, T0 + 150, 125, 7]);
    expect(last().hb_pairs_dropped).toBe(8);
  });

  it("counts the visibility changes in a window", () => {
    noteVisibilityChanged(T0 + 10);
    noteVisibilityChanged(T0 + 20);
    recordApply(1, 1000);
    flushViewerPerf();
    expect(last().vis_changes).toBe(2);
    recordApply(1, 1033);
    flushViewerPerf();
    expect(last().vis_changes).toBe(0);
  });
});

describe("input delay", () => {
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
