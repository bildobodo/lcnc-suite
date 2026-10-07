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
import { restoreBaseTool, geometryNote,
  buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionOptions,
  type CollisionResult, type CollisionTrack, type SnapshotHandle,
} from "./collision";
import { runSweepSlice, type SweepIter } from "./sweepPump";
import { mergeShardResults } from "./sweepShards";
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
  /** At most this many shards (the parallel sweep; a test seam). */
  maxShards?: number;
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

type Msg = CollisionReq | CollisionCancel | CollisionPause | CollisionResume | CollisionStop | CollisionContinue;

/** One sweep in THIS worker — the single-core path, a shard's work, and every
 *  side run. */
function handleLocal(d: Msg): void {
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
      // No moving pair: nothing to certify, so the guarantee holds vacuously
      // — unless a body was left out for having no facet with area (VP-I46).
      self.postMessage({ id, result: { hits: [], staticContacts: [], samples: 0, coarsened: false, uncertified: geometryNote(model), pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0, truncated: null } });
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
}

// ─── The parallel sweep (operator 2026-10-07: "dass mehrere Kerne daran
// arbeiten") ────────────────────────────────────────────────────────────
// A MAIN request without a shard of its own is split over K sub-workers —
// instances of THIS script, each sweeping one shard of the model's pairs
// (CollisionOptions.shard: the pairs are independent, so the shards merge by
// concatenation, sweepShards.ts) — and this instance only coordinates:
//   - it keeps the request's bodies and sends them to a shard that lacks the
//     model (a new shard, a needBodies) — never builds the model itself;
//   - cancel / stop / continue / pause / resume go to every shard; progress
//     is the least swept shard's; a partial is the merge of each shard's
//     latest; the result comes when every shard has one, `stopped` when every
//     shard is parked or done (a continue resumes the parked ones);
//   - a side request (the sim-entry segment) runs on shard 0, which holds
//     the model, with every pair;
//   - one shard's error ends the sweep with that error (the others are
//     cancelled) — never a merge of what the rest found.
// K: the cores but one for the page, at most MAX_SHARDS, and never more
// copies of the model than SHARD_TRIANGLES allows (every shard holds the
// whole BVH model: the shipped 3-axis table alone is 1.1 M triangles). One
// shard, no Worker in this scope, or a sub-worker that fails to load: the
// single-core path, exactly as before.
const MAX_SHARDS = 8;
const SHARD_TRIANGLES = 4_000_000;

interface PoolRun {
  id: number;
  k: number;
  progress: number[];
  partial: Array<CollisionResult | undefined>;
  final: Array<CollisionResult | undefined>;   // a shard's result, or its parked snapshot
  parked: boolean[];
  cancelled: number;
  ended: boolean;
  /** The progress last posted — a shard's slice moves nothing it alone. */
  posted: number;
}
let _shards: Worker[] = [];
let _shardModel: string[] = [];          // the modelKey each shard holds
let _bodies: { key: string; bodies: CollisionBody[] } | null = null;
let _poolRun: PoolRun | null = null;
let _sideOnShard = -1;                    // the side request forwarded to shard 0
let _poolBroken = typeof Worker !== "function";

function shardCount(d: CollisionReq): number {
  if (_poolBroken || d.options.shard) return 1;
  const bodies = d.bodies ?? (_bodies?.key === d.modelKey ? _bodies.bodies : null);
  if (!bodies) return 1;   // the model is not known here: the single path asks for it
  const tris = bodies.reduce((n, b) => n + b.positions.length / 9, 0);
  const cores = (self.navigator?.hardwareConcurrency ?? 2) - 1;
  return Math.max(1, Math.min(MAX_SHARDS, cores, d.maxShards ?? MAX_SHARDS, Math.floor(SHARD_TRIANGLES / Math.max(tris, 1))));
}

function shardRequest(d: CollisionReq, k: number, of: number): CollisionReq {
  const hasModel = _shardModel[k] === d.modelKey;
  _shardModel[k] = d.modelKey;
  return { ...d, bodies: hasModel ? undefined : _bodies!.bodies,
           options: of > 1 ? { ...d.options, shard: { index: k, of } } : d.options };
}

function onShardMessage(k: number, m: any): void {
  if (m.id === _sideOnShard) { self.postMessage(m); if (m.result || m.error || m.cancelled || m.needBodies) _sideOnShard = -1; return; }
  const run = _poolRun;
  if (!run || m.id !== run.id || run.ended) return;   // a superseded run's late word
  if (m.needBodies) {
    if (_bodies) { _shardModel[k] = ""; _shards[k]!.postMessage(shardRequest(_lastReq!, k, run.k)); }
    else { run.ended = true; self.postMessage({ id: run.id, needBodies: true }); }
    return;
  }
  if (m.error) {
    run.ended = true;
    _shards.forEach((w, i) => { if (i !== k) w.postMessage({ cancel: run.id }); });
    self.postMessage({ id: run.id, error: m.error });
    return;
  }
  if (m.cancelled) {
    if (++run.cancelled >= run.k) { run.ended = true; self.postMessage({ id: run.id, cancelled: true }); }
    return;
  }
  if (m.progress !== undefined) {
    run.progress[k] = m.progress;
    if (m.partial) run.partial[k] = m.partial;
    const progress = Math.min(...run.progress);
    const parts = run.partial.filter((r): r is CollisionResult => !!r);
    if (m.partial && parts.length) self.postMessage({ id: run.id, progress, partial: mergeShardResults(parts) });
    else if (progress !== run.posted) self.postMessage({ id: run.id, progress });
    run.posted = progress;
    return;
  }
  if (m.result) {
    run.final[k] = m.result;
    run.parked[k] = !!m.stopped;
    if (!m.stopped) run.progress[k] = 1;   // done: no longer the least swept
    if (run.final.every(r => r)) {
      const merged = mergeShardResults(run.final as CollisionResult[]);
      if (run.parked.some(p => p)) self.postMessage({ id: run.id, stopped: true, result: merged });
      else { run.ended = true; self.postMessage({ id: run.id, result: merged }); }
    }
  }
}

function ensureShards(n: number): boolean {
  while (_shards.length > n) { _shards.pop()!.terminate(); _shardModel.pop(); }
  while (_shards.length < n) {
    const k = _shards.length;
    let w: Worker;
    try { w = new Worker(self.location.href, { type: "module" }); }
    catch { _poolBroken = true; return false; }
    w.onmessage = (e: MessageEvent) => onShardMessage(k, e.data);
    w.onerror = () => {
      // A shard that cannot load: the pool is gone for good, and the sweep
      // in flight runs on this core instead (it asks for the bodies again
      // if they are not here).
      _poolBroken = true;
      _shards.forEach(x => x.terminate()); _shards = []; _shardModel = [];
      const run = _poolRun;
      _poolRun = null;
      if (run && !run.ended && _lastReq) handleLocal({ ..._lastReq, bodies: _bodies?.key === _lastReq.modelKey ? _bodies.bodies : undefined });
    };
    _shards.push(w);
    _shardModel.push("");
  }
  return true;
}

let _lastReq: CollisionReq | null = null;

self.onmessage = (e: MessageEvent<Msg>) => {
  const d = e.data;
  // Control messages for the pooled run go to every shard.
  const ctrlId = "cancel" in d ? d.cancel : "stop" in d ? d.stop : "continue" in d ? d.continue
    : "pause" in d ? d.pause : "resume" in d ? d.resume : null;
  if (ctrlId !== null) {
    if (_sideOnShard === ctrlId && "cancel" in d) { _shards[0]?.postMessage(d); return; }
    const run = _poolRun;
    if (run && run.id === ctrlId && !run.ended) {
      if ("continue" in d) {
        run.parked.forEach((p, k) => { if (p) { run.parked[k] = false; run.final[k] = undefined; } });
      }
      // A shard already done has no run to cancel and sends no word: it
      // counts as acknowledged.
      if ("cancel" in d) run.cancelled = run.final.filter((r, i) => r && !run.parked[i]).length;
      for (const w of _shards) w.postMessage(d);
      return;
    }
    handleLocal(d);
    return;
  }
  const req = d as CollisionReq;
  if (req.bodies) _bodies = { key: req.modelKey, bodies: req.bodies };
  if (req.side) {
    // The entry segment: on shard 0 (which holds the model) while a pool runs.
    if (_shards.length) {
      _sideOnShard = req.id;
      const hasModel = _shardModel[0] === req.modelKey;
      _shardModel[0] = req.modelKey;
      _shards[0]!.postMessage({ ...req, bodies: hasModel ? undefined : _bodies?.key === req.modelKey ? _bodies.bodies : undefined });
      return;
    }
    handleLocal(req);
    return;
  }
  const k = shardCount(req);
  if (k <= 1 || !ensureShards(k)) {
    if (_poolRun) { for (const w of _shards) w.postMessage({ cancel: _poolRun.id }); _poolRun = null; }
    handleLocal(req);
    return;
  }
  // A pooled sweep supersedes the in-process one, as a new request does.
  if (_run) handleLocal({ cancel: _run.id });
  _lastReq = req;
  _poolRun = { id: req.id, k, progress: new Array(k).fill(0), partial: new Array(k).fill(undefined),
               final: new Array(k).fill(undefined), parked: new Array(k).fill(false), cancelled: 0, ended: false, posted: -1 };
  _shards.forEach((w, i) => w.postMessage(shardRequest(req, i, k)));
};
