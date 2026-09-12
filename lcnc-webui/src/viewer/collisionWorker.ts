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
//     and posts the sweep-so-far (`stopped` + a `truncated` result); the
//     generator stays RESIDENT with every certificate and contact state,
//     and `{continue: id, budgetMs}` resumes it. Running out of the active-
//     time budget is the same stop, reason "time". A stop is never a loss;
//     only a cancel or a superseding request drops a parked sweep.
// The collision model (bodies + BVHs) stays RESIDENT under its `modelKey`:
// the owner omits `bodies` when it knows the worker holds the model; a
// worker that does not (recreated after a failure) answers `needBodies`
// instead of guessing. A busy worker is off the main thread but not off the
// machine (2026-09-10: a never-finishing sweep starved the operator's GPU),
// so the owner bounds every sweep with `budgetMs` (active time; null =
// unbounded, the operator's stop is the bound) — enforced HERE, at slice
// boundaries, so a budget stop is a resumable park, not the end.
import {
  buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionOptions,
  type CollisionTrack, type SnapshotHandle,
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
  /** Active-time budget (ms) before the sweep PARKS itself (`stopped`,
   *  reason "time"); null = unbounded. */
  budgetMs: number | null;
}

export interface CollisionCancel { cancel: number }
/** Park the running sweep at its next slice boundary: the owner receives
 *  `{stopped: true, result}` (the sweep-so-far, `truncated.reason ===
 *  "stopped"`) and may `continue` it later. */
export interface CollisionStop { stop: number }
/** Resume a parked sweep with a fresh active-time budget (null = unbounded). */
export interface CollisionContinue { continue: number; budgetMs: number | null }
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
  /** The iterator's snapshot hook — the sweep-so-far while it is suspended. */
  snapshot: SnapshotHandle;
  /** Active-time budget for the current leg (reset by `continue`); null = none. */
  budgetMs: number | null;
  /** Parked: not pumping, generator resident, waiting for continue/cancel. */
  stopped: boolean;
  /** An operator stop arrived; honoured at the next slice boundary. */
  stopRequested: boolean;
  /** Re-entry point for `continue`. */
  pump: () => void;
}

let _resident: { key: string; model: CollisionModel } | null = null;
let _run: Run | null = null;

self.onmessage = (e: MessageEvent<CollisionReq | CollisionCancel | CollisionPause | CollisionResume | CollisionStop | CollisionContinue>) => {
  const d = e.data;
  if ("cancel" in d) {
    if (_run && _run.id === d.cancel) {
      if (_run.stopped) {
        // A parked sweep is not pumping: nothing will read the flag — drop it.
        _run.snapshot.take = null;
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
      _run.budgetMs = d.budgetMs;
      _run.activeMs = 0;      // a fresh leg, a fresh budget
      _run.pump();
    }
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
  if (_run) {
    // A new request supersedes the running sweep — or drops a parked one.
    if (_run.stopped) { _run.snapshot.take = null; _run = null; }
    else _run.cancelled = true;
  }
  const { id, machine, tool, track, wcs, options, modelKey, budgetMs } = d;
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
      snapshot: { take: null }, budgetMs: budgetMs ?? null,
      stopped: false, stopRequested: false, pump: () => {},
    };
    // The sweep's budget clock: active time only (paused time stands still).
    // The iterator's own maxMs stays unset — the budget is enforced here so
    // that running out of it PARKS the sweep instead of ending it.
    const activeClock = () => run.activeMs + (run.sliceStart ? performance.now() - run.sliceStart : 0);
    run.it = sweepCollisionsIter(model, track, wcs, { ...options, maxMs: undefined, clock: activeClock, snapshot: run.snapshot });
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
        const overBudget = run.budgetMs != null && run.activeMs > run.budgetMs;
        if ((run.stopRequested || overBudget) && run.snapshot.take) {
          // Park: the generator stays suspended at this checkpoint; the
          // owner gets the sweep-so-far and decides between continue and
          // cancel. Not a result — `stopped` says so.
          const reason = run.stopRequested ? "stopped" : "time";
          run.stopRequested = false;
          run.stopped = true;
          self.postMessage({ id, stopped: true, result: run.snapshot.take(reason) });
          return;
        }
        setTimeout(pump, 0);
        return;
      }
      if (_run === run) _run = null;
      run.snapshot.take = null;
      if (slice.cancelled) { self.postMessage({ id, cancelled: true }); return; }
      self.postMessage({ id, result: slice.result });
    };
    run.pump = pump;
    pump();
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
