// The drawings of library shapes, bounded and owned (P6-c plan v8 §1.6, Codex
// R477 MT477-04, R480, R482 MT482-01). Drawings only: a check's bodies are
// numbers of their own and need none of this. Built in counted steps, one job
// at a time; an entry's bytes are its REAL buffers.
//  - at most ENTRIES_MAX entries, at most IDLE_BYTES_MAX in entries without an
//    owner; the least recently used idle one goes first, never an owned or a
//    building one. All of them owned or building: the caller gets a PRIVATE
//    entry of its own, disposed at its release.
//  - liveness is a mark, not membership: a result is published iff its entry is
//    still alive with the job's token — a private one can finish, a released
//    one, or one of an ended scene, cannot.
//  - an entry's end drops its geometry objects: `dispose()` alone frees the
//    renderer's copy and keeps every array.
// Its consumers (the scrub marker) come with P6-c bell 2.
import type * as THREE from "three";
import { partGeometry, toolDrawing } from "./toolGeometry";
import { drawCounter, drawingAdmitted, drawnSteps, ShapeNotUsable, type DrawCounter, type DrawnPart } from "./toolDrawing";
import { formMeta, NOT_USABLE, predictedProfilePoints, PROFILE_POINTS_MAX, TOO_DETAILED, type FormRecord, type FormRefusal } from "./toolForm";
import { FORM_SLICE_MS } from "./toolTableStore";
import { runSteps, type StepRun, type Steps } from "./viewer/steps";

export const ENTRIES_MAX = 32;
export const IDLE_BYTES_MAX = 64 * 1024 * 1024;

/** What a drawing is of — content, no connection. */
export interface ShapeKey { path: string; instance: string; units: number; rev: string; T: number; D: number; len: number }
/** What it is built from: a tool's form, the diameter and visual length. */
export interface ShapeSource { form: FormRecord; diam: number; len: number; units: number }
export interface DrawnShape { cutter: THREE.BufferGeometry | null; shaft: THREE.BufferGeometry | null }

export interface ShapeHandle {
  readonly state: "building" | "ready" | "refused";
  /** the drawing, once ready — owned by the cache, never disposed by a caller */
  readonly shape: DrawnShape | null;
  readonly why: FormRefusal | null;
  /** once, when it is ready or refused (at once when it is already) */
  onSettled(f: () => void): void;
  release(): void;
}

export interface CacheDeps {
  run?: (job: Steps<void>, done: () => void) => StepRun<void>;
  trace?(event: string, fields: Record<string, unknown>): void;
}

/** The bytes a set of geometries holds: every attribute's and the index's
 *  ArrayBuffer, a shared one once. */
export function buffersOf(geoms: Iterable<THREE.BufferGeometry | null>): number {
  const seen = new Set<ArrayBufferLike>();
  let n = 0;
  for (const g of geoms) {
    if (!g) continue;
    for (const a of [...Object.values(g.attributes), ...(g.index ? [g.index] : [])] as THREE.BufferAttribute[]) {
      if (seen.has(a.array.buffer)) continue;
      seen.add(a.array.buffer);
      n += a.array.buffer.byteLength;
    }
  }
  return n;
}

/** A form's drawing in counted steps: refused by its predicted points before
 *  the profile is built, by its vertices before anything is allocated. */
export function* shapeSteps(s: ShapeSource, c: DrawCounter = drawCounter()): Steps<{ parts: DrawnPart[] } | { why: FormRefusal }> {
  if (s.form.refused) return { why: s.form.refused.why };
  if (s.form.kind !== "mesh" && predictedProfilePoints(s.form, s.diam, s.len, s.units) > PROFILE_POINTS_MAX) return { why: TOO_DETAILED };
  try {
    const d = toolDrawing(s.diam, s.len, formMeta(s.form.scalars, s.form), s.units);
    yield;
    if (!drawingAdmitted(d)) return { why: TOO_DETAILED };
    return { parts: yield* drawnSteps(d, c) };
  } catch (e) {
    if (!(e instanceof ShapeNotUsable)) throw e;
    return { why: NOT_USABLE };
  }
}

interface Entry {
  key: string; tool: number; source: ShapeSource | null; inMap: boolean; alive: boolean; token: object;
  owners: number; state: "building" | "ready" | "refused"; shape: DrawnShape | null; why: FormRefusal | null;
  bytes: number; used: number; waiters: Array<() => void>;
}

const keyOf = (k: ShapeKey): string => JSON.stringify([k.path, k.instance, k.units, k.rev, k.T, k.D, k.len]);
const pageRun: NonNullable<CacheDeps["run"]> = (job, done) => {
  const r = runSteps(job, { sliceMs: FORM_SLICE_MS, onDone: done, onError: e => { console.error("[shapes]", e); done(); } });
  r.promise.catch(() => {});
  return r;
};

export class ToolShapeCache {
  private readonly map = new Map<string, Entry>();
  private readonly keys = new Map<Entry, ShapeKey>();
  private queue: Entry[] = [];
  private running: { entry: Entry; run: StepRun<void> | null } | null = null;
  private clock = 0;
  private readonly deps: CacheDeps;

  constructor(deps: CacheDeps = {}) { this.deps = deps; }

  /** Entries, what idle ones hold, jobs waiting (guards, diagnostics). */
  get size(): number { return this.map.size; }
  get idleBytes(): number { let n = 0; for (const e of this.map.values()) if (!e.owners) n += e.bytes; return n; }
  get bytes(): number { let n = 0; for (const e of this.map.values()) n += e.bytes; return n; }
  get waiting(): number { return this.queue.length; }

  /** The caller owns the drawing of `key` until it releases it. */
  acquire(key: ShapeKey, source: ShapeSource): ShapeHandle {
    const e = this.entry(key, source, true);
    e.owners++;
    e.used = ++this.clock;
    this.next();
    let held = true;
    return {
      get state() { return e.state; },
      get shape() { return e.alive ? e.shape : null; },
      get why() { return e.why; },
      onSettled: f => { if (!held || !e.alive) return; if (e.state !== "building") f(); else e.waiters.push(f); },
      release: () => {
        if (!held) return;
        held = false;
        e.owners--;
        if (!e.alive || e.owners) return;
        if (!e.inMap) this.end(e); else this.trim();
      },
    };
  }

  /** Builds a drawing nobody owns yet (the publication's program tools) — only
   *  where there is room for it. */
  warm(key: ShapeKey, source: ShapeSource): void {
    if (this.map.has(keyOf(key)) || (this.map.size >= ENTRIES_MAX && !this.idle())) return;
    this.entry(key, source, false);
    this.next();
  }

  /** The binding is another one: what no visible decision names goes at once,
   *  a held one with its last owner; waiting jobs of the old one are dropped. */
  retain(visible: (k: ShapeKey) => boolean): void {
    for (const e of [...this.map.values()]) {
      if (visible(this.keys.get(e)!)) continue;
      this.out(e);
      if (!e.owners || e.state === "building") this.end(e);
    }
  }

  /** The scene is gone: nothing of it is drawn or published any more. */
  endScene(): void {
    this.queue = [];
    for (const e of [...this.keys.keys()]) this.end(e);
  }

  // ---- entries ------------------------------------------------------------------

  private entry(key: ShapeKey, source: ShapeSource, front: boolean): Entry {
    const k = keyOf(key), was = this.map.get(k);
    if (was) {
      if (front && was.state === "building") this.queue = [...this.queue.filter(x => x === was), ...this.queue.filter(x => x !== was)];
      return was;
    }
    const e: Entry = { key: k, tool: key.T, source, inMap: false, alive: true, token: {}, owners: 0, state: "building", shape: null, why: null,
                       bytes: 0, used: ++this.clock, waiters: [] };
    this.keys.set(e, key);
    if (this.map.size >= ENTRIES_MAX) { const i = this.idle(); if (i) this.end(i); }
    if (this.map.size < ENTRIES_MAX) { this.map.set(k, e); e.inMap = true; }
    else this.deps.trace?.("viewer.shape_cache_full", { tool: key.T, entries: this.map.size });
    if (front) this.queue.unshift(e); else this.queue.push(e);
    return e;
  }
  /** The least recently used entry without an owner that is not building. */
  private idle(): Entry | null {
    let best: Entry | null = null;
    for (const e of this.map.values()) if (!e.owners && e.state !== "building" && (!best || e.used < best.used)) best = e;
    return best;
  }
  private trim(): void {
    while (this.idleBytes > IDLE_BYTES_MAX) { const i = this.idle(); if (!i) return; this.end(i); }
  }
  private out(e: Entry): void {
    if (e.inMap) { this.map.delete(e.key); e.inMap = false; }
  }
  /** An entry's end: its drawing's GPU copy, its arrays, its job and its source. */
  private end(e: Entry): void {
    this.out(e);
    e.alive = false;
    this.keys.delete(e);
    this.queue = this.queue.filter(x => x !== e);
    if (this.running?.entry === e) {
      const r = this.running;
      this.running = null;
      r.run?.cancel();
    }
    this.drop(e.shape);
    e.shape = null;
    e.source = null;
    e.bytes = 0;
    e.waiters = [];
    this.next();
  }
  private drop(s: DrawnShape | null): void {
    s?.cutter?.dispose();
    s?.shaft?.dispose();
  }

  // ---- the one job ----------------------------------------------------------------

  private next(): void {
    if (this.running) return;
    const e = this.queue.shift();
    if (!e) return;
    if (!e.alive || !e.source) { this.next(); return; }
    const slot = { entry: e, run: null as StepRun<void> | null };
    this.running = slot;
    const done = () => {
      if (this.running !== slot) return;
      this.running = null;
      this.next();
    };
    slot.run = (this.deps.run ?? pageRun)(this.job(e, e.source, e.token), done);
  }
  private *job(e: Entry, source: ShapeSource, token: object): Steps<void> {
    const c = drawCounter(), t0 = performance.now();
    const r = yield* shapeSteps(source, c);
    const shape: DrawnShape | null = "parts" in r ? { cutter: null, shaft: null } : null;
    if ("parts" in r) for (const p of r.parts) {
      const g = partGeometry(p);
      g.userData._shared = true;             // owned here: a marker's disposal skips it (viewer/disposal.ts)
      shape![p.role] = g;
    }
    // the mark decides, not the map: a private entry finishes, a released one,
    // or one of an ended scene, does not
    if (!e.alive || e.token !== token) { this.drop(shape); return; }
    e.shape = shape;
    e.why = "why" in r ? r.why : null;
    e.state = shape ? "ready" : "refused";
    e.bytes = shape ? buffersOf([shape.cutter, shape.shaft]) : 0;
    e.source = null;
    this.deps.trace?.("viewer.shape_build", { tool: e.tool, phase: "drawing", why: e.why, bytes: e.bytes, ops: c.total, ms: Math.round(performance.now() - t0) });
    const waiters = e.waiters;
    e.waiters = [];
    for (const f of waiters) f();
    this.trim();
  }
}

