// Off-main-thread collision sweep (offline dry run, stage 3). BVH builds and
// the per-sample mesh distance queries are seconds-of-CPU on a real program —
// exactly the class of work that must never touch the UI thread (heartbeat).
//
// The sweep runs as a resumable iterator (collision.ts sweepCollisionsIter)
// driven in wall-clock slices (sweepPump.ts) with a setTimeout(0) between
// them, so this worker reads its messages while a sweep is in progress:
//   - `{cancel: id}` aborts the running sweep at its next checkpoint — no
//     terminate, no worker recreation, no BVH rebuild for the next sweep;
//   - a new request supersedes the running sweep the same way;
//   - `{stop: id}` (2026-09-12) parks the sweep at its next slice boundary
//     (immediately while paused — the generator is at a checkpoint) and
//     posts the sweep-so-far (`stopped` + a `truncated` result); the
//     generator stays RESIDENT with every certificate and contact state, and
//     `{continue: id}` resumes it. The owner parks a sweep while a rotary
//     axis moves (its track is about to be re-parsed). A stop is never a
//     loss; only a cancel or a superseding request drops a parked sweep.
//   - `{pause: id, why}` / `{resume: id, why}` hold the sweep while the
//     operator moves the camera (a busy worker starves the GPU side of the
//     browser; auto-expires after PAUSE_MAX_MS — a lost pointer-up must not
//     pin a sweep) or while the tab is hidden (no expiry: a hidden tab must
//     not burn a core). Sweeps are OPEN-ENDED (2026-09-13): the 300 s budget
//     of the certificate-fix era is gone — the pauses and the park are what
//     keep a busy worker off the operator; the iterator's 4 M-sample
//     backstop is the only hard limit, reported as `truncated`.
//   - `side: true` (2026-09-12) runs a SIDE sweep on the resident model
//     without touching the main run — the sim-entry segment (a two-point
//     slice, milliseconds) while the program's own sweep runs or sits parked.
//     A side run never parks or pauses; a new side request supersedes the
//     previous one; only `cancel` with its id addresses it.
//   - Progress posts carry `partial` (2026-09-13): the unrefined sweep-so-far
//     (collision.ts SnapshotHandle.peek) at most every PEEK_MS and only when
//     the record count changed, so clashes show on the timeline as they are
//     found. The refined result replaces it at the end.
// The collision model (bodies + BVHs) stays RESIDENT under its `modelKey`:
// the owner omits `bodies` when it knows the worker holds the model; a
// worker that does not (recreated after a failure) answers `needBodies`
// instead of guessing.
import { restoreBaseTool,
  buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionOptions,
  type CollisionResult, type CollisionTrack, type SnapshotHandle,
} from "./collision";
import { runSweepSlice, type SweepIter } from "./sweepPump";
import type { PartFrameWcs } from "./partFrame";

export interface CollisionReq {
  id: number;
  machine: CollisionMachine;
  /** Bodies for the collision model. Omitted = reuse the resident model
   *  built for `modelKey`; the worker replies `needBodies` if it has none. */
  bodies?: CollisionBody[];
  /** Identity of the model the bodies + tool describe (owner-defined). */
  modelKey: string;
  /** Parametric tool body attached to the tool group (viewer marker dims,
   *  machine units). null = no tool body (bodies-only check). */
  tool: { diam: number; len: number } | null;
  track: CollisionTrack;
  wcs: PartFrameWcs;
  options: CollisionOptions;
  /** Run beside the main sweep instead of superseding it (see header). */
  side?: boolean;
}

export interface CollisionCancel { cancel: number }
/** Park the running sweep at its next slice boundary: the owner receives
 *  `{stopped: true, result}` (the sweep-so-far, `truncated.reason ===
 *  "stopped"`) and may `continue` it later. */
export interface CollisionStop { stop: number }
/** Resume a parked sweep. */
export interface CollisionContinue { continue: number }
export type PauseWhy = "camera" | "hidden";
/** Hold the running sweep (see header); `resume` with the same `why` lets
 *  it go — both holds must be released. */
export interface CollisionPause { pause: number; why: PauseWhy }
export interface CollisionResume { resume: number; why: PauseWhy }

/** Wall-clock per slice between message checks. The iterator itself
 *  yields every ~8 ms of active time (collision.ts YIELD_MS), so a slice
 *  overruns this by at most one sample's queries + one snapshot. */
const SLICE_MS = 40;
/** Poll cadence while paused. */
const PAUSE_POLL_MS = 50;
/** A CAMERA pause with no resume for this long resumes by itself — a lost
 *  pointer-up must not leave a sweep pinned "busy" forever. */
const PAUSE_MAX_MS = 30_000;
/** Minimum interval between live `partial` snapshots. */
const PEEK_MS = 500;

interface Run {
  id: number;
  it: SweepIter;
  cancelled: boolean;
  pausedCam: boolean;
  pausedCamAt: number;
  pausedHidden: boolean;
  /** Active (unpaused) time accumulated by finished slices. */
  activeMs: number;
  /** performance.now() at the start of the slice in progress, else 0. */
  sliceStart: number;
  /** The iterator's snapshot hook — the sweep-so-far while it is suspended. */
  snapshot: SnapshotHandle;
  /** Parked: not pumping, generator resident, waiting for continue/cancel. */
  stopped: boolean;
  /** A stop arrived; honoured at the next slice boundary. */
  stopRequested: boolean;
  /** Live-snapshot pacing. */
  lastPeekAt: number;
  lastPeekRecords: number;
  /** Re-entry point for `continue`. */
  pump: () => void;
  /** The (resident) model this run poses — restored to its base tool
   *  whenever the run ends without its own epilogue (TWP-07). */
  model: CollisionModel;
}

let _resident: { key: string; model: CollisionModel } | null = null;
/** The MAIN sweep — the one that parks, continues and pauses. */
let _run: Run | null = null;
/** An ephemeral SIDE sweep (sim-entry segment); never parks. */
let _side: Run | null = null;

const clearSnapshot = (s: SnapshotHandle) => { s.take = null; s.peek = null; s.records = null; };

self.onmessage = (e: MessageEvent<CollisionReq | CollisionCancel | CollisionPause | CollisionResume | CollisionStop | CollisionContinue>) => {
  const d = e.data;
  if ("cancel" in d) {
    if (_side && _side.id === d.cancel) { _side.cancelled = true; return; }
    if (_run && _run.id === d.cancel) {
      if (_run.stopped) {
        // A parked sweep is not pumping: nothing will read the flag — drop
        // it. Its generator never runs its epilogue, so the resident model
        // would keep wearing the run's program tool (TWP-07): restore here.
        clearSnapshot(_run.snapshot);
        restoreBaseTool(_run.model);
        _run = null;
        self.postMessage({ id: d.cancel, cancelled: true });
      } else {
        _run.cancelled = true;
      }
    }
    return;
  }
  if ("stop" in d) {
    if (_run && _run.id === d.stop && !_run.stopped) _run.stopRequested = true;
    return;
  }
  if ("continue" in d) {
    if (_run && _run.id === d.continue && _run.stopped) {
      _run.stopped = false;
      _run.pump();
    }
    return;
  }
  if ("pause" in d) {
    if (_run && _run.id === d.pause) {
      if (d.why === "hidden") _run.pausedHidden = true;
      else if (!_run.pausedCam) { _run.pausedCam = true; _run.pausedCamAt = performance.now(); }
    }
    return;
  }
  if ("resume" in d) {
    if (_run && _run.id === d.resume) {
      if (d.why === "hidden") _run.pausedHidden = false;
      else _run.pausedCam = false;
    }
    return;
  }
  const side = !!d.side;
  if (side) {
    if (_side) _side.cancelled = true;   // a newer entry segment supersedes it
  } else if (_run) {
    // A new request supersedes the running sweep — or drops a parked one.
    if (_run.stopped) { clearSnapshot(_run.snapshot); restoreBaseTool(_run.model); _run = null; }
    else _run.cancelled = true;
  }
  const { id, machine, tool, track, wcs, options, modelKey } = d;
  try {
    let model: CollisionModel;
    if (d.bodies) {
      const bodies = d.bodies;
      if (tool) {
        // toolCylinderPositions works in machine units already; the model
        // builder multiplies by unitScale (machine.json mm → machine units),
        // so pre-divide to make that a no-op for the parametric body.
        const positions = toolCylinderPositions(tool.diam / machine.unitScale, tool.len / machine.unitScale);
        // Tip at the body's local origin. The −TLO tip shift is applied PER
        // POSE inside the sweep (schema 8: the offset is per segment) — it
        // used to be baked into these verts once per sweep.
        bodies.push({ id: "tool", group: machine.toolGroup, positions, tool: true });
      }
      model = buildCollisionModel(machine, bodies);
      _resident = { key: modelKey, model };
    } else if (_resident && _resident.key === modelKey) {
      model = _resident.model;
    } else {
      self.postMessage({ id, needBodies: true });
      return;
    }
    if (model.pairs.length === 0) {
      // Not an error and not "clean": no body pair has program-driven
      // relative motion — nothing to check. Surface it honestly.
      // No moving pair: nothing to certify, so the guarantee holds vacuously.
      self.postMessage({ id, result: { hits: [], staticContacts: [], samples: 0, coarsened: false, uncertified: null, pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0, truncated: null } });
      return;
    }
    const run: Run = {
      id, it: null as unknown as SweepIter, cancelled: false,
      pausedCam: false, pausedCamAt: 0, pausedHidden: false, activeMs: 0, sliceStart: 0,
      snapshot: { take: null, peek: null, records: null },
      stopped: false, stopRequested: false, lastPeekAt: 0, lastPeekRecords: 0, pump: () => {},
      model,
    };
    // The slot this run lives in — cleared only if it still holds this run
    // (a superseding request may have replaced it while a slice ran).
    const release = () => {
      if (side) { if (_side === run) _side = null; }
      else if (_run === run) _run = null;
    };
    // The sweep's clock: active time only (paused time stands still) — what
    // `sweepMs` reports. The iterator's own maxMs stays unset: nothing bounds
    // a sweep but its sample backstop and the owner's park.
    const activeClock = () => run.activeMs + (run.sliceStart ? performance.now() - run.sliceStart : 0);
    run.it = sweepCollisionsIter(model, track, wcs, { ...options, maxMs: undefined, clock: activeClock, snapshot: side ? undefined : run.snapshot });
    if (side) _side = run; else _run = run;
    // Park: the generator stays suspended at its current checkpoint; the
    // owner gets the sweep-so-far and decides between continue and cancel.
    // Not a result — `stopped` says so. (Main runs only.)
    const park = () => {
      run.stopRequested = false;
      run.stopped = true;
      self.postMessage({ id, stopped: true, result: run.snapshot.take!("stopped") });
    };
    const pump = () => {
      if ((run.pausedCam || run.pausedHidden) && !run.cancelled) {
        // A stop during a pause parks right here — the generator is
        // suspended at a checkpoint already; waiting for the pause to end
        // and one more slice to run would be the stop the operator saw
        // ignored (2026-09-12).
        if (run.stopRequested && run.snapshot.take) { run.pausedCam = false; run.pausedHidden = false; park(); return; }
        if (run.pausedCam && performance.now() - run.pausedCamAt >= PAUSE_MAX_MS) run.pausedCam = false;   // lost resume
        if (run.pausedCam || run.pausedHidden) { setTimeout(pump, PAUSE_POLL_MS); return; }
      }
      let slice;
      try {
        run.sliceStart = performance.now();
        slice = runSweepSlice(run.it, SLICE_MS, () => run.cancelled);
        run.activeMs += performance.now() - run.sliceStart;
        run.sliceStart = 0;
      } catch (err) {
        release();
        restoreBaseTool(run.model);   // the epilogue never ran (TWP-07)
        self.postMessage({ id, error: String((err as Error)?.message ?? err) });
        return;
      }
      if (!slice.done) {
        let partial: CollisionResult | undefined;
        const recs = run.snapshot.records?.() ?? 0;
        if (run.snapshot.peek && recs !== run.lastPeekRecords && performance.now() - run.lastPeekAt >= PEEK_MS) {
          run.lastPeekAt = performance.now();
          run.lastPeekRecords = recs;
          partial = run.snapshot.peek();
        }
        self.postMessage(partial ? { id, progress: slice.progress, partial } : { id, progress: slice.progress });
        if (run.stopRequested && run.snapshot.take) { park(); return; }
        setTimeout(pump, 0);
        return;
      }
      release();
      clearSnapshot(run.snapshot);
      if (slice.cancelled) { self.postMessage({ id, cancelled: true }); return; }
      self.postMessage({ id, result: slice.result });
    };
    run.pump = pump;
    pump();
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
