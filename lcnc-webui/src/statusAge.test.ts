// The status AGE through the real path (Codex R182 VP182-01): the WS frame's
// receipt → the status store's rAF flush → the viewer's status watcher →
// the viewer's apply. The two buffers (the store's rAF batch and the viewer's
// pendingState) can each hold a different frame: an apply of the older one
// must not take the receipt of a frame still waiting in the store. The
// viewer's consumer is ThreeViewer's watcher in its essentials — take the
// flushed status as the next state and note its receipt.
import "./testGlobals";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick, watch } from "vue";

const emitted: Array<Record<string, any>> = [];
vi.mock("./ws/telemetry", () => ({ emitTelemetry: (_k: string, row: Record<string, any>) => emitted.push(row) }));

import { flushViewerPerf, notePendingReceipt, recordApply, resetViewerPerf } from "./viewerPerf";
import { handleStatusMessage, resetOnClose, status, statusReceiptOf } from "./ws/statusStore";

let now = 1;
let raf: FrameRequestCallback[] = [];
let pending: any = null;
let stop: (() => void) | undefined;
const T0 = performance.timeOrigin;

beforeEach(() => {
  resetOnClose(); resetViewerPerf(); emitted.length = 0; status.value = null;
  now = 1; raf = []; pending = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
  stop = watch(() => status.value, (msg) => {
    if (!msg?.data) return;
    pending = msg.data;
    notePendingReceipt(statusReceiptOf(msg));
  });
});

afterEach(async () => {
  for (const cb of raf.splice(0)) cb(now);
  await nextTick();
  stop?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A frame the worker received at t (its stamp) reaches the store. */
function receive(id: string, t: number) {
  now = t;
  handleStatusMessage({ type: "status", data: { id } }, T0 + t);
}
/** The store's rAF runs: its batch reaches the viewer's watcher. */
async function flushStatus() { for (const cb of raf.splice(0)) cb(now); await nextTick(); }
/** The viewer's animate applies what it holds. */
function apply(t: number) { now = t; const shown = pending?.id; recordApply(1); pending = null; return shown; }

it("frames folded into one flush are aged from the oldest receipt", async () => {
  recordApply(1, 80);                     // the viewer is built
  receive("A", 90); receive("B", 101); await flushStatus();
  expect(apply(110)).toBe("B");
  flushViewerPerf();
  expect(emitted[0]?.age_n).toBe(1);
  expect(emitted[0]?.age_max_ms).toBe(20);
});

it("an apply of A leaves B, still in the store's batch, its own receipt for its own apply", async () => {
  recordApply(1, 80);
  receive("A", 90); now = 95; await flushStatus();   // the viewer holds A
  receive("B", 101);                                 // B waits in the store's rAF batch
  const first = apply(110);                          // the viewer's frame came first: it shows A
  await flushStatus();                               // the store hands B over
  const second = apply(200);
  flushViewerPerf();
  expect([first, second]).toEqual(["A", "B"]);
  expect(emitted[0]?.age_n, "B was shown by an apply of its own").toBe(2);
  expect(emitted[0]?.age_h).toEqual({ "20": 1, "98": 1 });   // 20 and 99 ms
  expect(emitted[0]?.age_max_ms).toBe(99);
});

it("frames the viewer folds over two flushes keep the older flush's receipt", async () => {
  recordApply(1, 80);
  receive("A", 90); await flushStatus();             // the viewer holds A …
  receive("B", 120); await flushStatus();            // … and takes B over it before applying
  expect(apply(130)).toBe("B");
  flushViewerPerf();
  expect(emitted[0]?.age_n).toBe(1);
  expect(emitted[0]?.age_max_ms).toBe(40);           // A's receipt: A's information waited 40 ms
});

it("a local re-apply of the last state takes no receipt", async () => {
  recordApply(1, 80);
  receive("A", 90);                                  // still in the store's batch
  pending = { id: "last" };                          // the viewer re-applies what it showed
  expect(apply(100)).toBe("last");
  await flushStatus();
  expect(apply(140)).toBe("A");
  flushViewerPerf();
  expect(emitted[0]?.age_n).toBe(1);
  expect(emitted[0]?.age_max_ms).toBe(50);
});
