// Off-main-thread collision sweep (offline dry run, stage 3). BVH builds and
// the per-sample mesh distance queries are seconds-of-CPU on a real program —
// exactly the class of work that must never touch the UI thread (heartbeat).
//
// The sweep runs as a resumable iterator (collision.ts sweepCollisionsIter)
// driven in wall-clock slices (sweepPump.ts) with a setTimeout(0) between
// them, so this worker reads its messages while a sweep is in progress:
//   - `{cancel: id}` aborts the running sweep at its next checkpoint — no
//     terminate, no worker recreation, no BVH rebuild for the next sweep;
//   - a new request supersedes the running sweep the same way.
// The collision model (bodies + BVHs) stays RESIDENT under its `modelKey`:
// the owner omits `bodies` when it knows the worker holds the model; a
// worker that does not (recreated after a failure) answers `needBodies`
// instead of guessing. A busy worker is off the main thread but not off the
// machine (2026-09-10: a never-finishing sweep starved the operator's GPU),
// so the owner also bounds every sweep with `options.maxMs`.
import {
  buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionOptions,
  type CollisionTrack,
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
}

export interface CollisionCancel { cancel: number }
/** Hold the running sweep while the operator moves the camera (a busy
 *  worker starves the GPU-side of the browser); `resume` continues it. The
 *  budget runs on ACTIVE time, so a pause costs the sweep nothing. */
export interface CollisionPause { pause: number }
export interface CollisionResume { resume: number }

/** Wall-clock per slice between message checks. */
const SLICE_MS = 40;
/** Poll cadence while paused. */
const PAUSE_POLL_MS = 50;
/** A pause with no resume for this long resumes by itself — a lost
 *  pointer-up must not leave a sweep pinned "busy" forever. */
const PAUSE_MAX_MS = 30_000;

interface Run {
  id: number;
  it: SweepIter;
  cancelled: boolean;
  paused: boolean;
  pausedAt: number;
  /** Active (unpaused) time accumulated by finished slices. */
  activeMs: number;
  /** performance.now() at the start of the slice in progress, else 0. */
  sliceStart: number;
}

let _resident: { key: string; model: CollisionModel } | null = null;
let _run: Run | null = null;

self.onmessage = (e: MessageEvent<CollisionReq | CollisionCancel | CollisionPause | CollisionResume>) => {
  const d = e.data;
  if ("cancel" in d) {
    if (_run && _run.id === d.cancel) _run.cancelled = true;
    return;
  }
  if ("pause" in d) {
    if (_run && _run.id === d.pause && !_run.paused) { _run.paused = true; _run.pausedAt = performance.now(); }
    return;
  }
  if ("resume" in d) {
    if (_run && _run.id === d.resume) _run.paused = false;
    return;
  }
  if (_run) _run.cancelled = true;   // a new request supersedes the running sweep
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
        bodies.push({ id: "tool", group: machine.toolGroup, positions });
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
      paused: false, pausedAt: 0, activeMs: 0, sliceStart: 0,
    };
    // The sweep's budget clock: active time only (paused time stands still).
    const activeClock = () => run.activeMs + (run.sliceStart ? performance.now() - run.sliceStart : 0);
    run.it = sweepCollisionsIter(model, track, wcs, { ...options, clock: activeClock });
    _run = run;
    const pump = () => {
      if (run.paused && !run.cancelled) {
        if (performance.now() - run.pausedAt < PAUSE_MAX_MS) { setTimeout(pump, PAUSE_POLL_MS); return; }
        run.paused = false;   // lost resume: continue rather than hang
      }
      let slice;
      try {
        run.sliceStart = performance.now();
        slice = runSweepSlice(run.it, SLICE_MS, () => run.cancelled);
        run.activeMs += performance.now() - run.sliceStart;
        run.sliceStart = 0;
      } catch (err) {
        if (_run === run) _run = null;
        self.postMessage({ id, error: String((err as Error)?.message ?? err) });
        return;
      }
      if (!slice.done) {
        self.postMessage({ id, progress: slice.progress });
        setTimeout(pump, 0);
        return;
      }
      if (_run === run) _run = null;
      if (slice.cancelled) { self.postMessage({ id, cancelled: true }); return; }
      self.postMessage({ id, result: slice.result });
    };
    pump();
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
