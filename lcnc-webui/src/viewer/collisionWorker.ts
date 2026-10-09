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
//     (collision.ts SnapshotHandle.peek) at most every PEEK_MS — and never
//     more than a tenth of the time (PEEK_DUTY: a snapshot of a million
//     records takes a second) — and only when the record count changed, so
//     clashes show on the timeline as they are found. The refined result
//     replaces it at the end.
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
  /** Wall-clock per slice between message checks (default SLICE_MS): a check
   *  during a run takes shorter slices (plan „Prüfung im Lauf“ 4). */
  sliceMs?: number;
}

export interface CollisionCancel { cancel: number }
/** Park the running sweep at its next slice boundary: the owner receives
 *  `{stopped: true, result}` (the sweep-so-far, `truncated.reason ===
 *  "stopped"`) and may `continue` it later. */
export interface CollisionStop { stop: number }
/** Resume a parked sweep. */
export interface CollisionContinue { continue: number }
/** camera: interaction (expires after PAUSE_MAX_MS); hidden: a hidden tab;
 *  decode: a preview payload being decoded (plan „Prüfung im Lauf“ 4) —
 *  independent holds, each released by its own resume. */
export type PauseWhy = "camera" | "hidden" | "decode";
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
/** A snapshot copies and orders every record so far — on a program in
 *  permanent contact a record per line and pair, 500 000 by a fifth of
 *  haus.ngc and 0.5 s a snapshot, growing. Taken every PEEK_MS from its
 *  START, it ran after every 40 ms slice once it took 500 ms itself: the
 *  browser's sweep spent nearly all its time on snapshots and stood at 42 %
 *  after an hour where the sweep alone takes 22 minutes (2026-10-07). The
 *  next one waits PEEK_DUTY times as long as the last took: snapshots take
 *  at most a tenth of the sweep, the live findings come less often on a
 *  large program. */
const PEEK_DUTY = 9;

interface Run {
  id: number;
  it: SweepIter;
  cancelled: boolean;
  pausedCam: boolean;
  pausedCamAt: number;
  pausedHidden: boolean;
  pausedDecode: boolean;
  sliceMs: number;
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
  /** Live-snapshot pacing: no snapshot before this time (performance.now). */
  nextPeekAt: number;
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

/** Holds a run starts with — the owner's pause, carried over when a pooled
 *  sweep falls back to this core (Codex R90 VP-I49). */
interface Holds { pausedCam?: boolean; pausedCamAt?: number; pausedHidden?: boolean; pausedDecode?: boolean }

/** One sweep in THIS worker — the single-core path, a shard's work, and every
 *  side run. */
function handleLocal(d: Msg, holds: Holds = {}): void {
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
      else if (d.why === "decode") _run.pausedDecode = true;
      else if (!_run.pausedCam) { _run.pausedCam = true; _run.pausedCamAt = performance.now(); }
    }
    return;
  }
  if ("resume" in d) {
    if (_run && _run.id === d.resume) {
      if (d.why === "hidden") _run.pausedHidden = false;
      else if (d.why === "decode") _run.pausedDecode = false;
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
      // Never the request's own array: the coordinator keeps it for its
      // shards, and a tool pushed into it rode along as a second tool body.
      const bodies = d.bodies.slice();
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
      pausedCam: !!holds.pausedCam, pausedCamAt: holds.pausedCamAt ?? 0, pausedHidden: !!holds.pausedHidden,
      pausedDecode: !!holds.pausedDecode, sliceMs: d.sliceMs ?? SLICE_MS,
      activeMs: 0, sliceStart: 0,
      snapshot: { take: null, peek: null, records: null },
      stopped: false, stopRequested: false, nextPeekAt: 0, lastPeekRecords: 0, pump: () => {},
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
      if ((run.pausedCam || run.pausedHidden || run.pausedDecode) && !run.cancelled) {
        // A stop during a pause parks right here — the generator is
        // suspended at a checkpoint already; waiting for the pause to end
        // and one more slice to run would be the stop the operator saw
        // ignored (2026-09-12).
        if (run.stopRequested && run.snapshot.take) { run.pausedCam = false; run.pausedHidden = false; run.pausedDecode = false; park(); return; }
        if (run.pausedCam && performance.now() - run.pausedCamAt >= PAUSE_MAX_MS) run.pausedCam = false;   // lost resume
        if (run.pausedCam || run.pausedHidden || run.pausedDecode) { setTimeout(pump, PAUSE_POLL_MS); return; }
      }
      let slice;
      try {
        run.sliceStart = performance.now();
        slice = runSweepSlice(run.it, run.sliceMs, () => run.cancelled);
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
        if (run.snapshot.peek && recs !== run.lastPeekRecords && performance.now() >= run.nextPeekAt) {
          const t0 = performance.now();
          run.lastPeekRecords = recs;
          partial = run.snapshot.peek();
          const took = performance.now() - t0;
          run.nextPeekAt = performance.now() + Math.max(PEEK_MS, PEEK_DUTY * took);
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
//     is the least swept shard's; a partial merges every shard's LATEST word
//     — its result once it has one, else its last partial — and counts a
//     shard not heard from yet as swept 0 (Codex R90 VP-I47); a shard's
//     result goes out as a partial at once (what it found shows before the
//     slowest shard ends), shard partials at most every PEEK_MS; the result
//     comes when every shard has one, `stopped` when every shard is parked
//     or done (a continue resumes the parked ones);
//   - a side request (the sim-entry segment) runs on shard 0, which holds
//     the model, with every pair;
//   - one shard's error ends the sweep with that error (the others are
//     cancelled) — never a merge of what the rest found.
// A sub-worker that FAILS (it does not load, or throws past its own handler)
// takes the pool down for good, and what was in flight moves to this core
// with the owner's state (VP-I48/I49): a running sweep starts again here with
// its pauses; a cancelled one is acknowledged; a parked one — or one whose
// stop is not answered yet — computes nothing: the owner keeps (or gets) what
// the shards swept as the parked result, and a continue starts it again from
// the beginning here (the shards' generators are gone) — with nothing swept
// yet to hand over, the stop is answered as an error at once (R91); a side
// run starts again here, a cancelled one is acknowledged.
// K: the cores but TWO, for the page and the browser's own processes (Codex
// R90 — one busy worker once held the Mac's GPU frames behind; four cores
// make two shards), at most MAX_SHARDS, and never more copies of the model
// than SHARD_TRIANGLES allows (every shard holds the whole BVH model: the
// shipped 3-axis table alone is 1.1 M triangles). One shard, no Worker in
// this scope, or a pool that failed: the single-core path, as before.
const MAX_SHARDS = 8;
const SHARD_TRIANGLES = 4_000_000;

interface PoolRun {
  id: number;
  k: number;
  /** The request as the owner sent it — what a fall back to this core runs. */
  req: CollisionReq;
  progress: number[];
  partial: Array<CollisionResult | undefined>;
  final: Array<CollisionResult | undefined>;   // a shard's result, or its parked snapshot
  parked: boolean[];
  /** Cancel acknowledgements counted so far. */
  cancelled: number;
  ended: boolean;
  /** The progress last posted — a shard's slice moves nothing it alone. */
  posted: number;
  /** A shard's word not yet in a posted partial, and when the next may go. */
  partialDirty: boolean;
  nextPartialAt: number;
  /** The owner's controls, kept for a fall back to this core. */
  pausedCam: boolean;
  pausedCamAt: number;
  pausedHidden: boolean;
  pausedDecode: boolean;
  /** A stop went out and is not answered yet. */
  stopPending: boolean;
  /** The owner holds a `stopped` result: parked until continue. */
  parkedPosted: boolean;
  cancelling: boolean;
}
/** A parked pooled sweep whose shards failed: nothing computes until the
 *  owner continues it (from the beginning, here) or cancels it. */
interface LostParked { req: CollisionReq; pausedCam: boolean; pausedCamAt: number; pausedHidden: boolean; pausedDecode: boolean }

let _shards: Worker[] = [];
let _shardModel: string[] = [];          // the modelKey each shard holds
let _bodies: { key: string; bodies: CollisionBody[] } | null = null;
let _poolRun: PoolRun | null = null;
let _lostParked: LostParked | null = null;
/** The side request on shard 0. Null is none — every number is a side id
 *  the owner may use (−1 is its first; Codex R90 VP-I50). */
let _sideOnShard: { req: CollisionReq; cancelling: boolean } | null = null;
let _poolBroken = typeof Worker !== "function";

function shardCount(d: CollisionReq): number {
  if (_poolBroken || d.options.shard) return 1;
  const bodies = d.bodies ?? (_bodies?.key === d.modelKey ? _bodies.bodies : null);
  if (!bodies) return 1;   // the model is not known here: the single path asks for it
  const tris = bodies.reduce((n, b) => n + b.positions.length / 9, 0);
  const cores = (self.navigator?.hardwareConcurrency ?? 2) - 2;
  return Math.max(1, Math.min(MAX_SHARDS, cores, d.maxShards ?? MAX_SHARDS, Math.floor(SHARD_TRIANGLES / Math.max(tris, 1))));
}

function shardRequest(d: CollisionReq, k: number, of: number): CollisionReq {
  const hasModel = _shardModel[k] === d.modelKey;
  _shardModel[k] = d.modelKey;
  return { ...d, bodies: hasModel ? undefined : _bodies!.bodies,
           options: of > 1 ? { ...d.options, shard: { index: k, of } } : d.options };
}

/** The pool's sweep so far: every shard's latest word merged, a shard not
 *  heard from yet swept 0 — the coverage and the shard count are the whole
 *  pool's. Null before any shard has a word. */
function poolView(run: PoolRun, reason: "running" | "stopped"): CollisionResult | null {
  const words: CollisionResult[] = [];
  let covered = 1;
  for (let k = 0; k < run.k; k++) {
    const w = run.final[k] ?? run.partial[k];
    if (w) words.push(w);
    covered = Math.min(covered, w ? (w.truncated?.covered ?? 1) : 0);
  }
  if (!words.length) return null;
  return { ...mergeShardResults(words), shards: run.k, truncated: { covered, reason } };
}

/** Progress, with the merged partial when a shard's word is new — at once
 *  (`now`), else at most every PEEK_MS. */
function postProgress(run: PoolRun, now: boolean): void {
  const progress = Math.min(...run.progress);
  if (run.partialDirty && (now || performance.now() >= run.nextPartialAt)) {
    const partial = poolView(run, "running");
    if (partial) {
      run.partialDirty = false;
      run.nextPartialAt = performance.now() + PEEK_MS;
      self.postMessage({ id: run.id, progress, partial });
      run.posted = progress;
      return;
    }
  }
  if (progress !== run.posted) self.postMessage({ id: run.id, progress });
  run.posted = progress;
}

function onShardMessage(k: number, m: any): void {
  if (_sideOnShard && m.id === _sideOnShard.req.id) {
    self.postMessage(m);
    if (m.result || m.error || m.cancelled || m.needBodies) _sideOnShard = null;
    return;
  }
  const run = _poolRun;
  if (!run || m.id !== run.id || run.ended) return;   // a superseded run's late word
  if (m.needBodies) {
    if (_bodies?.key === run.req.modelKey) { _shardModel[k] = ""; _shards[k]!.postMessage(shardRequest(run.req, k, run.k)); }
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
    if (m.partial) { run.partial[k] = m.partial; run.partialDirty = true; }
    postProgress(run, false);
    return;
  }
  if (m.result) {
    run.final[k] = m.result;
    run.parked[k] = !!m.stopped;
    // Done: its own coverage from now on — 1 when it swept its pairs whole,
    // what its backstop let it sweep when it stopped there (Codex R91 VP-I47:
    // counted as 1, the pool showed 80 % swept where 20 % was).
    if (!m.stopped) run.progress[k] = m.result.truncated ? m.result.truncated.covered : 1;
    if (run.final.every(r => r)) {
      const merged = mergeShardResults(run.final as CollisionResult[]);
      if (run.parked.some(p => p)) {
        run.stopPending = false;
        run.parkedPosted = true;
        self.postMessage({ id: run.id, stopped: true, result: merged });
      } else {
        run.ended = true;
        self.postMessage({ id: run.id, result: merged });
      }
      return;
    }
    run.partialDirty = true;
    postProgress(run, true);
  }
}

/** A request to run on this core: on the resident model when it is this one,
 *  else with the bodies kept here, else without (the run asks the owner). */
function onThisCore(req: CollisionReq): CollisionReq {
  if (_resident?.key === req.modelKey) return { ...req, bodies: undefined };
  return { ...req, bodies: _bodies?.key === req.modelKey ? _bodies.bodies : undefined };
}

/** A sub-worker failed: the pool is gone for good; what was in flight moves
 *  to this core with the owner's state (see the header). */
function poolFailed(): void {
  _poolBroken = true;
  _shards.forEach(x => x.terminate());
  _shards = [];
  _shardModel = [];
  const run = _poolRun, side = _sideOnShard;
  _poolRun = null;
  _sideOnShard = null;
  if (run && !run.ended) {
    run.ended = true;
    const holds = { pausedCam: run.pausedCam, pausedCamAt: run.pausedCamAt, pausedHidden: run.pausedHidden,
                    pausedDecode: run.pausedDecode };
    if (run.cancelling) {
      self.postMessage({ id: run.id, cancelled: true });
    } else if (run.parkedPosted || run.stopPending) {
      const swept = run.stopPending ? poolView(run, "stopped") : null;
      if (run.stopPending && !swept) {
        // Nothing swept yet to hand over, and no generator here to park (a
        // run started for it would compute under a pause until its first
        // checkpoint — Codex R91 VP-I49: a hidden tab never let it): the stop
        // is answered at once, as the end of this sweep. The owner shows the
        // check as not run; the next request sweeps afresh.
        self.postMessage({ id: run.id, error: "a sweep worker failed before anything was swept — stopped, not resumable" });
      } else {
        if (swept) self.postMessage({ id: run.id, stopped: true, result: swept });
        _lostParked = { req: run.req, ...holds };
      }
    } else {
      handleLocal(onThisCore(run.req), holds);
    }
  }
  if (side) {
    if (side.cancelling) self.postMessage({ id: side.req.id, cancelled: true });
    else handleLocal(onThisCore(side.req));
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
    w.onerror = (ev: Event) => {
      // Handled HERE: unhandled, a sub-worker's error goes on to this
      // worker's scope and the page's onerror, which drops the sweep.
      ev.preventDefault?.();
      if (_shards.includes(w)) poolFailed();
    };
    _shards.push(w);
    _shardModel.push("");
  }
  return true;
}

/** A control message for a parked sweep whose shards failed. */
function onLostParked(lp: LostParked, d: Msg): void {
  if ("cancel" in d) { _lostParked = null; self.postMessage({ id: lp.req.id, cancelled: true }); }
  else if ("continue" in d) { _lostParked = null; handleLocal(onThisCore(lp.req), lp); }
  else if ("pause" in d) {
    if (d.why === "hidden") lp.pausedHidden = true;
    else if (d.why === "decode") lp.pausedDecode = true;
    else if (!lp.pausedCam) { lp.pausedCam = true; lp.pausedCamAt = performance.now(); }
  } else if ("resume" in d) {
    if (d.why === "hidden") lp.pausedHidden = false;
    else if (d.why === "decode") lp.pausedDecode = false;
    else lp.pausedCam = false;
  }
  // A stop: it is parked already.
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const d = e.data;
  // Control messages for the pooled run go to every shard.
  const ctrlId = "cancel" in d ? d.cancel : "stop" in d ? d.stop : "continue" in d ? d.continue
    : "pause" in d ? d.pause : "resume" in d ? d.resume : null;
  if (ctrlId !== null) {
    if (_sideOnShard && _sideOnShard.req.id === ctrlId) {
      // A side run takes nothing but a cancel (see the header).
      if ("cancel" in d) { _sideOnShard.cancelling = true; _shards[0]?.postMessage(d); }
      return;
    }
    if (_lostParked && _lostParked.req.id === ctrlId) { onLostParked(_lostParked, d); return; }
    const run = _poolRun;
    if (run && run.id === ctrlId && !run.ended) {
      if ("continue" in d) {
        run.stopPending = false;
        run.parkedPosted = false;
        // A parked shard's snapshot stays its word until it says more.
        run.parked.forEach((p, k) => {
          if (p) { run.parked[k] = false; run.partial[k] = run.final[k]; run.final[k] = undefined; }
        });
      } else if ("stop" in d) {
        if (!run.parkedPosted) run.stopPending = true;
      } else if ("cancel" in d) {
        run.cancelling = true;
        // A shard already done has no run to cancel and sends no word: it
        // counts as acknowledged.
        run.cancelled = run.final.filter((r, i) => r && !run.parked[i]).length;
      } else if ("pause" in d) {
        if (d.why === "hidden") run.pausedHidden = true;
        else if (d.why === "decode") run.pausedDecode = true;
        else if (!run.pausedCam) { run.pausedCam = true; run.pausedCamAt = performance.now(); }
      } else if ("resume" in d) {
        if (d.why === "hidden") run.pausedHidden = false;
        else if (d.why === "decode") run.pausedDecode = false;
        else run.pausedCam = false;
      }
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
      _sideOnShard = { req, cancelling: false };
      const hasModel = _shardModel[0] === req.modelKey;
      _shardModel[0] = req.modelKey;
      _shards[0]!.postMessage({ ...req, bodies: hasModel ? undefined : _bodies?.key === req.modelKey ? _bodies.bodies : undefined });
      return;
    }
    handleLocal(req);
    return;
  }
  _lostParked = null;   // a new request supersedes a parked one
  const k = shardCount(req);
  if (k <= 1 || !ensureShards(k)) {
    if (_poolRun) { for (const w of _shards) w.postMessage({ cancel: _poolRun.id }); _poolRun = null; }
    handleLocal(req);
    return;
  }
  // A pooled sweep supersedes the in-process one, as a new request does.
  if (_run) handleLocal({ cancel: _run.id });
  _poolRun = { id: req.id, k, req, progress: new Array(k).fill(0), partial: new Array(k).fill(undefined),
               final: new Array(k).fill(undefined), parked: new Array(k).fill(false), cancelled: 0, ended: false,
               posted: -1, partialDirty: false, nextPartialAt: 0, pausedCam: false, pausedCamAt: 0,
               pausedHidden: false, pausedDecode: false, stopPending: false, parkedPosted: false, cancelling: false };
  _shards.forEach((w, i) => w.postMessage(shardRequest(req, i, k)));
};
