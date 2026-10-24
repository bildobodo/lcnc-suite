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
//   - What a sweep finds is its contact tables' (step 4 package 2): deltas
//     at the end of a slice, one unacknowledged per path — the one with the
//     request's first interval goes beside it, once (C2: a held
//     acknowledgement held the first touch back by its hold). Progress posts
//     carry `partial` — the running sweep's METADATA (collision.ts
//     SnapshotHandle.meta: static contacts, notes, a range's start and
//     boundary contacts, `truncated.reason === "running"`), no records —
//     after the first slice and whenever it changes, at most every META_MS,
//     so a check shows its state without a single table row (C2).
// The collision model (bodies + BVHs) stays RESIDENT under its `modelKey`:
// the owner omits `bodies` when it knows the worker holds the model; a
// worker that does not (recreated after a failure) answers `needBodies`
// instead of guessing.
import { restoreBaseTool, geometryNote, bodyClasses,
  buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionOptions,
  type CollisionResult, type CollisionTrack, type SnapshotHandle,
} from "./collision";
import { runSweepSlice, type SweepIter } from "./sweepPump";
import { mergeShardResults } from "./sweepShards";
import type { PartFrameWcs } from "./partFrame";
import { ContactStore, REQUEST_BUDGET, deltaTransfer, shareOf, type StoreBudget, type StoreDelta } from "./contactStore";

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
  /** The contact store of step 4 package 2 (plan Fassung 5, 3.1/3.2): the
   *  sweep also writes episodes, intervals and gaps, and they go out as
   *  DELTAS (`{id, contacts: StoreDelta[]}`, one per shard), at most one
   *  unacknowledged per path (the one with the first interval beside it,
   *  once — C2) — the owner answers each with `{contactsAck:
   *  id, generation}` (the delta's: a late acknowledgement of an older run
   *  releases nothing of a newer one — Codex R144 VP-I99); a run's last delta
   *  rides with its result. `generation` counts the request's runs (a fall
   *  back to this core is the next, a side run's too). Absent = records only,
   *  as before. */
  contacts?: { generation: number; budget?: StoreBudget; origin?: number };
  /** Say the run's real slices against the page's witness ticks (a check
   *  during a run — the browser-PC report's witness, Codex R185/R186):
   *  `{id, witness}` words. */
  witness?: boolean;
}

/** The page's witness tick: it issues one after each heartbeat answer it
 *  handled; the coordinator hands it to every shard. */
export interface CollisionTick { tick: number }
/** A run's word (Codex R186: a CAUSAL witness, no clock): a real slice of
 *  this run began after tick `tick` reached the context that computed it — a
 *  shard's own — and this word left after the slice ended. One word per new
 *  tick, after the first slice that began with it. `shard` is the pool's
 *  index (null: this worker alone), `gen` the contact generation (a fall
 *  back to one core is the next). */
export interface CollisionWitness { shard: number | null; gen: number | null; tick: number }

export interface CollisionCancel { cancel: number }
/** The owner applied the oldest contact delta out of request `contactsAck`
 *  in that generation (one per message, in order). */
export interface CollisionContactsAck { contactsAck: number; generation: number }
/** Park the running sweep at its next slice boundary: the owner receives
 *  `{stopped: true, result}` (the sweep-so-far, `truncated.reason ===
 *  "stopped"`) and may `continue` it later. */
export interface CollisionStop { stop: number }
/** Resume a parked sweep. */
export interface CollisionContinue { continue: number }
/** camera: interaction (expires after PAUSE_MAX_MS); hidden: a hidden tab;
 *  decode: a preview payload being decoded (plan „Prüfung im Lauf“ 4);
 *  reparse: the gateway re-parses the displayed program (VP188-02 E1 — the
 *  check beside the parse took the browser's frames) — independent holds,
 *  each released by its own resume. */
export type PauseWhy = "camera" | "hidden" | "decode" | "reparse";
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
/** Minimum interval between a running sweep's metadata posts (its first
 *  goes after the first slice). */
const META_MS = 500;
/** The highest witness tick this context has been handed (see CollisionTick). */
let _tick = 0;

interface Run {
  id: number;
  it: SweepIter;
  cancelled: boolean;
  pausedCam: boolean;
  pausedCamAt: number;
  pausedHidden: boolean;
  pausedDecode: boolean;
  pausedReparse: boolean;
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
  /** The running sweep's metadata as last posted (its JSON, without the
   *  counters and the coverage), and when the next may be looked at. */
  lastMeta: string | null;
  nextMetaAt: number;
  /** Re-entry point for `continue`. */
  pump: () => void;
  /** The (resident) model this run poses — restored to its base tool
   *  whenever the run ends without its own epilogue (TWP-07). */
  model: CollisionModel;
  /** Its contact store (package 2), and the final message waiting for the
   *  owner's acknowledgement of the delta before it. */
  store: ContactStore | null;
  final: Record<string, unknown> | null;
  /** The model pairs' body ids went out with the first delta (round B2). */
  pairsSent: boolean;
  /** Its witness words, when the request asks (Codex R186): the last tick said. */
  witness: { shard: number | null; gen: number | null; said: number } | null;
}

let _resident: { key: string; model: CollisionModel } | null = null;
/** The MAIN sweep — the one that parks, continues and pauses. */
let _run: Run | null = null;
/** An ephemeral SIDE sweep (sim-entry segment); never parks. */
let _side: Run | null = null;

const clearSnapshot = (s: SnapshotHandle) => { s.take = null; s.meta = null; };
/** What of a running sweep's metadata is news: everything but its counters
 *  and the coverage (the progress carries that). */
function metaSignature(r: CollisionResult): string {
  const { samples: _s, sweepMs: _m, bvhMs: _b, truncated: _t, ...rest } = r;
  return JSON.stringify(rest);
}

/** Runs whose contact store still talks to the owner — until their final
 *  delta went out (a run released from its slot may still wait for an ack). */
const _contactRuns = new Map<number, Run>();
/** The run's next contact delta, unless one is unacknowledged (VP139-03) —
 *  the one with the store's first interval goes beside it (C2); `extra`
 *  rides with it (the result: then a delta goes even if empty). */
function sendContacts(run: Run, extra?: Record<string, unknown>): boolean {
  const s = run.store;
  if (!s) return false;
  // a failed pool's older generation still owes the owner its last word on
  // this request's path: this run computes on, its rows wait in its own store
  // until that is delivered and acknowledged (Codex R145 VP-I98)
  if (_drain && _drain.id === run.id) return false;
  const delta = s.takeDelta(extra !== undefined);
  if (!delta) return false;
  const contacts: StoreDelta[] = [delta];
  // the tables name pairs by the model's index: their body ids go once, with
  // the generation's first delta (round B2)
  const pairs = run.pairsSent ? null : run.model.pairs.map(([a, b]) => [run.model.bodies[a]!.id, run.model.bodies[b]!.id]);
  run.pairsSent = true;
  self.postMessage({ id: run.id, contacts, ...(pairs ? { contactPairs: pairs } : {}), ...extra }, { transfer: deltaTransfer(delta) });
  return true;
}

type Msg = CollisionReq | CollisionCancel | CollisionPause | CollisionResume | CollisionStop | CollisionContinue | CollisionContactsAck
  | CollisionTick;

/** Holds a run starts with — the owner's pause, carried over when a pooled
 *  sweep falls back to this core (Codex R90 VP-I49). */
interface Holds { pausedCam?: boolean; pausedCamAt?: number; pausedHidden?: boolean; pausedDecode?: boolean;
                  pausedReparse?: boolean }
/** The owner's holds as a run, a pooled run and a lost parked one keep them. */
interface HoldFlags { pausedCam: boolean; pausedCamAt: number; pausedHidden: boolean; pausedDecode: boolean;
                      pausedReparse: boolean }
/** One hold set or released — the others untouched (each its own resume). */
function setHold(h: HoldFlags, why: PauseWhy, on: boolean): void {
  if (why === "hidden") h.pausedHidden = on;
  else if (why === "decode") h.pausedDecode = on;
  else if (why === "reparse") h.pausedReparse = on;
  else if (!on) h.pausedCam = false;
  else if (!h.pausedCam) { h.pausedCam = true; h.pausedCamAt = performance.now(); }
}

/** One sweep in THIS worker — the single-core path, a shard's work, and every
 *  side run. */
function handleLocal(d: Exclude<Msg, CollisionTick>, holds: Holds = {}): void {
  if ("contactsAck" in d) {
    const run = _contactRuns.get(d.contactsAck);
    if (!run?.store || run.store.generation !== d.generation) return;   // another run's — late or early
    run.store.ack();
    if (run.final) {
      if (sendContacts(run, run.final)) { run.final = null; _contactRuns.delete(run.id); }
    } else sendContacts(run);
    return;
  }
  if ("cancel" in d) {
    _contactRuns.delete(d.cancel);
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
    if (_run && _run.id === d.pause) setHold(_run, d.why, true);
    return;
  }
  if ("resume" in d) {
    if (_run && _run.id === d.resume) setHold(_run, d.why, false);
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
      const bodies = bodyClasses(model);
      const empty = d.contacts ? new ContactStore(id, d.contacts.generation).takeDelta(true) : null;
      self.postMessage({ id, result: { staticContacts: [], samples: 0, coarsened: false, uncertified: geometryNote(model), pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0, truncated: null, ...(bodies ? { bodies } : {}) },
                         ...(empty ? { contacts: [empty] } : {}) });
      return;
    }
    const run: Run = {
      id, it: null as unknown as SweepIter, cancelled: false,
      pausedCam: !!holds.pausedCam, pausedCamAt: holds.pausedCamAt ?? 0, pausedHidden: !!holds.pausedHidden,
      pausedDecode: !!holds.pausedDecode, pausedReparse: !!holds.pausedReparse, sliceMs: d.sliceMs ?? SLICE_MS,
      activeMs: 0, sliceStart: 0,
      snapshot: { take: null, meta: null },
      stopped: false, stopRequested: false, lastMeta: null, nextMetaAt: 0, pump: () => {},
      model, store: null, final: null, pairsSent: false,
      witness: d.witness ? { shard: options.shard?.index ?? null, gen: d.contacts?.generation ?? null, said: 0 } : null,
    };
    if (d.contacts) {
      // a shard's share of the request's budget, a side run's T/8 (plan 2.4)
      const base = d.contacts.budget ?? REQUEST_BUDGET;
      run.store = new ContactStore(id, d.contacts.generation,
        options.shard ? shareOf(base, options.shard.of) : side ? shareOf(base, 8) : base);
      _contactRuns.set(id, run);
    }
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
    // A side run (the entry move, the start-dependent beginning — the whole
    // program on a dependent one) posts no partials (Codex R136 VP-I93): its
    // tables show what it finds, its result the rest.
    run.it = sweepCollisionsIter(model, track, wcs, { ...options, maxMs: undefined, clock: activeClock, snapshot: run.snapshot,
                                                       ...(run.store ? { contacts: { store: run.store, origin: d.contacts!.origin } } : {}) });
    if (side) _side = run; else _run = run;
    // Park: the generator stays suspended at its current checkpoint; the
    // owner gets the sweep-so-far and decides between continue and cancel.
    // Not a result — `stopped` says so. (Main runs only.)
    const park = () => {
      run.stopRequested = false;
      run.stopped = true;
      self.postMessage({ id, stopped: true, result: run.snapshot.take!("stopped") });
      sendContacts(run);
    };
    const pump = () => {
      if ((run.pausedCam || run.pausedHidden || run.pausedDecode || run.pausedReparse) && !run.cancelled) {
        // A stop during a pause parks right here — the generator is
        // suspended at a checkpoint already; waiting for the pause to end
        // and one more slice to run would be the stop the operator saw
        // ignored (2026-09-12). The re-parse hold stays: a continue while
        // the owner still holds computes nothing (Codex R197).
        if (run.stopRequested && run.snapshot.take) { run.pausedCam = false; run.pausedHidden = false; run.pausedDecode = false; park(); return; }
        if (run.pausedCam && performance.now() - run.pausedCamAt >= PAUSE_MAX_MS) run.pausedCam = false;   // lost resume
        if (run.pausedCam || run.pausedHidden || run.pausedDecode || run.pausedReparse) { setTimeout(pump, PAUSE_POLL_MS); return; }
      }
      let slice;
      // the tick this slice begins after (a message handled before it ran)
      const tick = _tick;
      try {
        run.sliceStart = performance.now();
        slice = runSweepSlice(run.it, run.sliceMs, () => run.cancelled);
        run.activeMs += performance.now() - run.sliceStart;
        run.sliceStart = 0;
      } catch (err) {
        release();
        _contactRuns.delete(id);
        restoreBaseTool(run.model);   // the epilogue never ran (TWP-07)
        self.postMessage({ id, error: String((err as Error)?.message ?? err) });
        return;
      }
      // the slice ended: its word goes out now, once per new tick — a slice
      // cut short by a cancel ran only the epilogue, no sweep
      if (run.witness && !slice.cancelled && tick > run.witness.said) {
        run.witness.said = tick;
        self.postMessage({ id, witness: { shard: run.witness.shard, gen: run.witness.gen, tick } });
      }
      if (!slice.done) {
        // The running sweep's metadata: after the first slice, then when it
        // changed (a note, the coarser steps), at most every META_MS.
        let partial: CollisionResult | undefined;
        if (!side && run.snapshot.meta && (run.lastMeta === null || performance.now() >= run.nextMetaAt)) {
          const meta = run.snapshot.meta();
          const sig = metaSignature(meta);
          if (sig !== run.lastMeta) { run.lastMeta = sig; partial = meta; }
          run.nextMetaAt = performance.now() + META_MS;
        }
        self.postMessage(partial ? { id, progress: slice.progress, partial } : { id, progress: slice.progress });
        // the contacts so far — the first interval at the end of the slice that
        // wrote it — while no delta waits for its acknowledgement
        sendContacts(run);
        if (run.stopRequested && run.snapshot.take) { park(); return; }
        setTimeout(pump, 0);
        return;
      }
      release();
      clearSnapshot(run.snapshot);
      if (slice.cancelled) { _contactRuns.delete(id); self.postMessage({ id, cancelled: true }); return; }
      if (run.store) {
        // the last delta rides with the result — after the owner acknowledged
        // the one before it (one unacknowledged per path)
        if (sendContacts(run, { result: slice.result })) _contactRuns.delete(id);
        else run.final = { result: slice.result };
        return;
      }
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
//     result goes out as a partial at once, shard partials at most every
//     META_MS (what they found are their tables, forwarded as they come); the result
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
  pausedReparse: boolean;
  /** A stop went out and is not answered yet. */
  stopPending: boolean;
  /** The owner holds a `stopped` result: parked until continue. */
  parkedPosted: boolean;
  cancelling: boolean;
  /** The shards' contact tables as received here (package 2), a delta to the
   *  owner not acknowledged yet, and the final message waiting for that. */
  stores: ContactStore[] | null;
  /** Messages to the owner not acknowledged yet: one, and the one with the
   *  request's first interval beside it (C2). */
  ownerWaiting: number;
  finalMsg: Record<string, unknown> | null;
  /** The model pairs' body ids from the first shard that sent them, and
   *  whether they went on to the owner (once, with the first forward). */
  pairs: Array<[string, string]> | null;
  pairsSent: boolean;
}
/** A parked pooled sweep whose shards failed: nothing computes until the
 *  owner continues it (from the beginning, here) or cancels it. */
interface LostParked extends HoldFlags { req: CollisionReq }

let _shards: Worker[] = [];
let _shardModel: string[] = [];          // the modelKey each shard holds
let _bodies: { key: string; bodies: CollisionBody[] } | null = null;
let _poolRun: PoolRun | null = null;
let _lostParked: LostParked | null = null;
/** The side request on shard 0. Null is none — every number is a side id
 *  the owner may use (−1 is its first; Codex R90 VP-I50). */
let _sideOnShard: { req: CollisionReq; cancelling: boolean; progress: number } | null = null;
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
 *  (`now`), else at most every META_MS. */
function postProgress(run: PoolRun, now: boolean): void {
  const progress = Math.min(...run.progress);
  if (run.partialDirty && (now || performance.now() >= run.nextPartialAt)) {
    const partial = poolView(run, "running");
    if (partial) {
      run.partialDirty = false;
      run.nextPartialAt = performance.now() + META_MS;
      self.postMessage({ id: run.id, progress, partial });
      run.posted = progress;
      return;
    }
  }
  if (progress !== run.posted) self.postMessage({ id: run.id, progress });
  run.posted = progress;
}

/** The shards' contacts received here go to the owner as ONE message, one
 *  delta per shard, while none waits for its acknowledgement (VP139-03) —
 *  the message with the request's first interval goes beside one that waits
 *  (C2, Codex R167), once; the shards are acknowledged as soon as their delta
 *  is applied here, so a slow owner holds up no shard — the changes wait as
 *  marks in these tables. */
function forwardContacts(run: PoolRun, extra?: Record<string, unknown>): boolean {
  if (!run.stores) return false;
  const firstTouch = run.stores.every(s => s.intervals.sent === 0) && run.stores.some(s => s.intervals.rows > 0);
  if (run.ownerWaiting > (firstTouch ? 1 : 0)) return false;
  if (!extra && !run.stores.some(s => s.pending())) return false;
  const contacts = run.stores.map(s => { const d = s.takeDelta(true)!; s.ack(); return d; });
  run.ownerWaiting++;
  const pairs = !run.pairsSent && run.pairs ? run.pairs : null;
  if (pairs) run.pairsSent = true;
  self.postMessage({ id: run.id, contacts, ...(pairs ? { contactPairs: pairs } : {}), ...extra }, { transfer: contacts.flatMap(deltaTransfer) });
  return true;
}

function onShardMessage(k: number, m: any): void {
  // a shard's witness words go on as they come, whatever became of its run —
  // real work is evidence of its own (Codex R185); named by the shard
  if (m.witness) { self.postMessage({ id: m.id, witness: { ...m.witness, shard: k } }); return; }
  if (_sideOnShard && m.id === _sideOnShard.req.id) {
    if (m.progress !== undefined) _sideOnShard.progress = m.progress;
    self.postMessage(m);
    if (m.result || m.error || m.cancelled || m.needBodies) _sideOnShard = null;
    return;
  }
  const run = _poolRun;
  if (!run || m.id !== run.id || run.ended) return;   // a superseded run's late word
  if (m.contacts && run.stores) {
    if (m.contactPairs && !run.pairs) run.pairs = m.contactPairs;
    for (const dl of m.contacts as StoreDelta[]) run.stores[k]!.apply(dl);
    _shards[k]!.postMessage({ contactsAck: run.id, generation: run.stores[k]!.generation });
    if (!m.result) forwardContacts(run);
  }
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
        forwardContacts(run);
      } else {
        run.ended = true;
        if (run.stores) { if (!forwardContacts(run, { result: merged })) run.finalMsg = { result: merged }; }
        else self.postMessage({ id: run.id, result: merged });
      }
      return;
    }
    run.partialDirty = true;
    postProgress(run, true);
    forwardContacts(run);
  }
}

/** A failed pool's last word (Codex R144 VP-I98): the coordinator
 *  acknowledged its shards' deltas as they came — what it took over and had
 *  not forwarded yet, and a result computed but held for the owner's
 *  acknowledgement, are still the owner's. Delivered in that generation, one
 *  delta at a time, before the generation is let go; a run already computed
 *  is not run again. */
/** `ownerWaiting` carries the pool's count: the drain says nothing more until
 *  every message out is acknowledged (generations in order). */
interface PoolDrain { id: number; generation: number; stores: ContactStore[]; ownerWaiting: number; finalMsg: Record<string, unknown> | null }
let _drain: PoolDrain | null = null;

function drainForward(dr: PoolDrain): void {
  if (dr.ownerWaiting) return;
  if (!dr.finalMsg && !dr.stores.some(s => s.pending())) {
    if (_drain === dr) {
      // delivered and acknowledged: the path is the newer generation's now
      _drain = null;
      const run = _contactRuns.get(dr.id);
      if (run?.final) { if (sendContacts(run, run.final)) { run.final = null; _contactRuns.delete(run.id); } }
      else if (run) sendContacts(run);
    }
    return;
  }
  const contacts = dr.stores.map(s => { const d = s.takeDelta(true)!; s.ack(); return d; });
  const extra = dr.finalMsg;
  dr.finalMsg = null;
  dr.ownerWaiting++;
  self.postMessage({ id: dr.id, contacts, ...(extra ?? {}) }, { transfer: contacts.flatMap(deltaTransfer) });
}

/** The owner applied the pool's last contact message. */
function onPoolAck(run: PoolRun): void {
  run.ownerWaiting = Math.max(0, run.ownerWaiting - 1);
  if (run.finalMsg) { if (forwardContacts(run, run.finalMsg)) run.finalMsg = null; }
  else forwardContacts(run);
}

/** A run again on this core is the request's next generation (plan 1.2):
 *  its contacts are counted afresh and its messages say so. */
const nextGeneration = (req: CollisionReq): CollisionReq =>
  req.contacts ? { ...req, contacts: { ...req.contacts, generation: req.contacts.generation + 1 } } : req;

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
  // how far each shard swept, with the generation whose tables it belongs to —
  // before anything of the next generation: the earlier generation's own
  // coverage, which its rows alone cannot tell (an open contact names its
  // entry only; Codex R150 VP150-02)
  if (run?.stores && !run.cancelling) {
    self.postMessage({ id: run.id, heldCoverage: { generation: run.stores[0]!.generation, covered: run.progress.slice() } });
  }
  if (side?.req.contacts && !side.cancelling) {
    self.postMessage({ id: side.req.id, heldCoverage: { generation: side.req.contacts.generation, covered: [side.progress] } });
  }
  // what the coordinator took over is still owed in its generation (VP-I98)
  if (run?.stores && !run.cancelling && (run.ownerWaiting || run.finalMsg || run.stores.some(s => s.pending()))) {
    _drain = { id: run.id, generation: run.stores[0]!.generation, stores: run.stores, ownerWaiting: run.ownerWaiting, finalMsg: run.finalMsg };
    run.finalMsg = null;
    drainForward(_drain);
  }
  if (run && !run.ended) {
    run.ended = true;
    const holds = { pausedCam: run.pausedCam, pausedCamAt: run.pausedCamAt, pausedHidden: run.pausedHidden,
                    pausedDecode: run.pausedDecode, pausedReparse: run.pausedReparse };
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
        _lostParked = { req: nextGeneration(run.req), ...holds };
      }
    } else {
      handleLocal(onThisCore(nextGeneration(run.req)), holds);
    }
  }
  if (side) {
    if (side.cancelling) self.postMessage({ id: side.req.id, cancelled: true });
    // run again here: its next generation, its tables counted afresh (VP-I99)
    else handleLocal(onThisCore(nextGeneration(side.req)));
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
  else if ("pause" in d) setHold(lp, d.why, true);
  else if ("resume" in d) setHold(lp, d.why, false);
  // A stop: it is parked already.
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const d = e.data;
  if ("tick" in d) {
    // here, and on to every shard: a slice that begins after it, begins
    // after the answer the page issued it for (Codex R186)
    if (d.tick > _tick) _tick = d.tick;
    for (const w of _shards) w.postMessage(d);
    return;
  }
  if ("contactsAck" in d) {
    // the pool's, a side run's on shard 0, or a run on this core
    if (_poolRun && _poolRun.id === d.contactsAck && _poolRun.stores) {
      if (_poolRun.stores[0]!.generation === d.generation) onPoolAck(_poolRun);
    } else if (_drain && _drain.id === d.contactsAck && _drain.generation === d.generation) {
      _drain.ownerWaiting = Math.max(0, _drain.ownerWaiting - 1);
      drainForward(_drain);
    } else if (_sideOnShard && _sideOnShard.req.id === d.contactsAck) _shards[0]?.postMessage(d);
    else handleLocal(d);
    return;
  }
  // Control messages for the pooled run go to every shard.
  const ctrlId = "cancel" in d ? d.cancel : "stop" in d ? d.stop : "continue" in d ? d.continue
    : "pause" in d ? d.pause : "resume" in d ? d.resume : null;
  if ("cancel" in d && _drain && _drain.id === d.cancel) _drain = null;
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
        setHold(run, d.why, true);
      } else if ("resume" in d) {
        setHold(run, d.why, false);
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
      _sideOnShard = { req, cancelling: false, progress: 0 };
      const hasModel = _shardModel[0] === req.modelKey;
      _shardModel[0] = req.modelKey;
      _shards[0]!.postMessage({ ...req, bodies: hasModel ? undefined : _bodies?.key === req.modelKey ? _bodies.bodies : undefined });
      return;
    }
    handleLocal(req);
    return;
  }
  _lostParked = null;   // a new request supersedes a parked one
  _drain = null;        // ...and a failed pool's last word
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
               pausedHidden: false, pausedDecode: false, pausedReparse: false, stopPending: false, parkedPosted: false, cancelling: false,
               stores: req.contacts
                 ? Array.from({ length: k }, () => new ContactStore(req.id, req.contacts!.generation, shareOf(req.contacts!.budget ?? REQUEST_BUDGET, k)))
                 : null,
               ownerWaiting: 0, finalMsg: null, pairs: null, pairsSent: false };
  _shards.forEach((w, i) => w.postMessage(shardRequest(req, i, k)));
};
