// Display pipeline — the pure DECISION layer of "what does the viewer draw"
// (W2 P8.4).
//
// The wave-2 flat-TWP defect was invisible to every existing test because
// the failure lived between tested units: the transform was correct, the
// payload was correct-for-its-schema, but the GATE between them silently
// chose the programmed polyline (no abc on the wire → "no rotary"). This
// module extracts that gate as a pure function over plain data so a
// headless test can assert the whole decision for a fixture payload —
// no Vue refs, no scene, no worker.
//
// The other display-pipeline stages are already pure and tested elsewhere:
// per-epoch re-add + display rebase (wcsEpochs.rebasePositions/boundsOf),
// the part-frame transform (partFrame.transformToPartFrame), the drawn
// stream split (scrubTrack.splitTrackStreams). displayPipeline.test.ts
// composes decision + transform into the L1 display oracle: the DRAWN
// vertices of a TWP-shaped fixture must come out tilted, or the test is
// red — whichever layer regressed. (Deferred, recorded in
// docs/decisions.md: full scene-transform assembly here, the L2
// playwright window.__lcncDisplayProbe(), the L3 live-session probe.)
import { chainsHaveRotary, type PartFrameMachine } from "./partFrame";
import { specFromWire, worldModeForSpec } from "./kins";

/** The payload facts the decision consumes — a structural subset of
 *  ViewerGcode (plain data so tests build it without the wire). */
export interface DisplayFacts {
  /** Drawn-stream abc arrays present and non-empty (ships whenever the
   *  tool-vs-work pose depends on abc — should_ship_abc, W2 P3). */
  feedAbc?: Float32Array | null;
  rapidAbc?: Float32Array | null;
  /** Drawn-stream RAW switchkins types (present iff the program carried
   *  markers). */
  feedMode?: Uint8Array | null;
  rapidMode?: Uint8Array | null;
}

/** Which preview the viewer must draw for this payload on this machine.
 *
 *  "part" — the part-frame transform is REQUIRED: non-identity switchkins
 *  segments exist (the kins routing is what poses them — belt, W2 P3), or
 *  the abc pose channel shipped and the machine has a rotary DOF to pose
 *  it through.
 *  "programmed" — the programmed polyline is already exact (pure-linear
 *  program, or a machine whose chains cannot rotate), or the operator
 *  explicitly chose it.
 *
 *  Pure twin of ThreeViewer's _partFrameEligible — keep them delegating,
 *  never parallel. */
export function displayDecision(
  g: DisplayFacts,
  machine: PartFrameMachine,
  kinsWire: Parameters<typeof specFromWire>[0],
  previewMode: "part" | "programmed",
): "part" | "programmed" {
  if (previewMode === "programmed") return "programmed";
  const spec = specFromWire(kinsWire);
  for (const m of [g.feedMode, g.rapidMode]) {
    if (!m) continue;
    for (let i = 0; i < m.length; i++) {
      if (worldModeForSpec(m[i]!, spec)) return "part";
    }
  }
  if (!(g.feedAbc?.length || g.rapidAbc?.length)) return "programmed";
  return chainsHaveRotary(machine) ? "part" : "programmed";
}
