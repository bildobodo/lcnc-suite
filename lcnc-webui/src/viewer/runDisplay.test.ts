// The run's playhead goes with its track (P2b-F1 scene, Fable on R455): the
// run display (runDisplay.ts) projects the live joints onto the SHOWN
// program's track; when that track changes — no preview of the active
// program shown (the identity gate hands null), or a mid-run pinned re-parse
// publishes a new track — the old playhead ({track, index}) is dropped at
// once. Its only reader, the check during a run (ThreeViewer
// `_startRunCheck`), takes a hint only on `hint.track === track`, so an old
// track's playhead was never usable — dropping it keeps nothing stale on
// hand while none is shown. On a re-parse the playhead is RE-DERIVED from
// the new track on the next running status (the watcher re-attaches with
// one full scan) — never left null through the run. The transport is a
// stand-in (vi.mock).
import "../testGlobals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from "vue";
import { emptyLineIndex } from "./lineIndex";
import type { ScrubTrack } from "../ws/bulkData";

const status = shallowRef<{ data: Record<string, unknown> } | null>(null);
const viewerGcode = shallowRef<{ scrubTrack: ScrubTrack } | null>(null);
vi.mock("../lcncWs", () => ({
  status, viewerGcode,
  viewerInit: ref({ axes: ["X", "Y", "Z"] }),
  gcodeContent: ref(null),
  emitTelemetry: () => {},
}));

const { useRunDisplay } = await import("./runDisplay");
const { runPlayhead } = await import("./runPlayhead");

/** A straight track along +X, n points, cum = x (runWatcher.test's shape). */
function lineTrack(n: number): ScrubTrack {
  const pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
  const lines = new Uint32Array(n), rapid = new Uint8Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = i; cum[i] = i; lines[i] = 1 + i; }
  return { pos, abc, cum, lines, rapid, count: n, timeBased: false, lineIndex: emptyLineIndex() } as unknown as ScrubTrack;
}
const RUNNING = 2;
/** A running status with the machine at X = x (a new object: the watcher's edge). */
const at = (x: number) => { status.value = { data: { interp_state: RUNNING, joint_pos: [x, 0, 0] } }; };

let scope: EffectScope;
beforeEach(() => {
  status.value = null;
  viewerGcode.value = null;
  runPlayhead.value = null;
  scope = effectScope();
  scope.run(() => useRunDisplay());
});
afterEach(() => scope.stop());

describe("the run's playhead goes with its track", () => {
  it("none shown any more (the identity gate's null): the old track's playhead is gone", async () => {
    const a = lineTrack(100);
    viewerGcode.value = { scrubTrack: a };
    await nextTick();
    at(10.5);
    await nextTick();
    expect(runPlayhead.value?.track, "the positive control: attached on the shown track").toBe(a);
    viewerGcode.value = null;
    await nextTick();
    expect(runPlayhead.value, "the old playhead is gone with its track").toBeNull();
    at(11.5);
    await nextTick();
    expect(runPlayhead.value, "no track shown: no playhead derived").toBeNull();
  });

  it("a mid-run re-parse (a new track): dropped at once, re-derived from the new track on the next status", async () => {
    const a = lineTrack(100), b = lineTrack(100);
    viewerGcode.value = { scrubTrack: a };
    await nextTick();
    at(20.5);
    await nextTick();
    expect(runPlayhead.value?.track).toBe(a);
    viewerGcode.value = { scrubTrack: b };       // the pinned re-parse's publication
    await nextTick();
    expect(runPlayhead.value, "the old playhead is gone with its track").toBeNull();
    at(21.5);
    await nextTick();
    expect(runPlayhead.value?.track, "re-derived from the new track on the next running status").toBe(b);
    expect(runPlayhead.value?.index).toBe(22);
  });
});
