// The collision check's basis (plan „Prüfung im Lauf“ 1c, Codex R112–R115):
// every sweep is built from ONE immutable snapshot of what it reads besides
// the payload — the fixture terms, the fixture table, the tool before the
// program's first tool event — never from the live status at the time a
// field happens to be read. Idle: the live state when the check begins. In
// a run: the run's START as the gateway took it before the start was written
// (run_basis.start), never the first run frame a client saw. Pure.
import type { PreviewOrigin, RunBasis } from "../runBasis";
import type { WcsTableRow } from "./wcsEpochs";

export interface CheckBasis {
  kind: "idle" | "run";
  /** The run it belongs to (kind "run"), else null. */
  runId: number | null;
  g5x: number[];
  g92: number[];
  rotationXy: number;
  /** The offset of the points before the program's first TLO row: the
   *  payload's tool basis, else the applied offset (VP-I20). */
  toolOffset: number[];
  wcsTable: WcsTableRow[] | null;
  /** The spindle tool: the sweep's body before the program's first tool event. */
  toolNum: number | null;
  toolDiam: number | null;
  toolLen: number | null;
  /** The external Z offset (reader): value and enable, null = not read —
   *  a probe's braking range and the path after it assume none (parity-ef
   *  F3, Codex R126 VP-I76). A note, not a sweep input. */
  eoffsetZ: number | null;
  eoffsetEnabled: boolean | null;
  /** The start the program's start-dependent beginning is bound to in a
   *  run check (parity-ef plan E5): the run's start joints; null for an idle
   *  check (the simulation's entry binds its own) or a run without them. */
  startJoints: number[] | null;
}

/** What the viewer holds of the live status (ThreeViewer's `_pv`). */
export interface LiveCheckInputs {
  g5x: number[] | null;
  g92: number[] | null;
  rotationXy: number | null;
  toolOffset: number[] | null;
  wcsTable: WcsTableRow[] | null;
  toolNum: number | null;
  toolDiam: number | null;
  toolLen: number | null;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean | null;
}

const copyRows = (t: WcsTableRow[] | null | undefined): WcsTableRow[] | null =>
  t ? t.map(r => ({ ...r })) : null;

/** The idle basis: the live state now. `payloadToolBasis` = the displayed
 *  payload's tool basis (viewerGcode.toolBasis), when it has one. */
export function basisFromLive(pv: LiveCheckInputs, payloadToolBasis: number[] | null | undefined): CheckBasis {
  return {
    kind: "idle", runId: null,
    g5x: pv.g5x ? [...pv.g5x] : [], g92: pv.g92 ? [...pv.g92] : [],
    rotationXy: pv.rotationXy ?? 0,
    toolOffset: [...(payloadToolBasis ?? pv.toolOffset ?? [])],
    wcsTable: copyRows(pv.wcsTable),
    toolNum: pv.toolNum, toolDiam: pv.toolDiam, toolLen: pv.toolLen,
    eoffsetZ: pv.eoffsetZ, eoffsetEnabled: pv.eoffsetEnabled,
    startJoints: null,
  };
}

/** The run basis: the run's start as the gateway took it. Null without a
 *  start, or for a start that was not written (no run). */
export function basisFromRun(rb: RunBasis | null, payloadToolBasis: number[] | null | undefined): CheckBasis | null {
  const s = rb?.start;
  if (!rb || rb.state !== "sent" || !s) return null;
  return {
    kind: "run", runId: rb.runId,
    g5x: s.g5xOffset ? [...s.g5xOffset] : [], g92: s.g92Offset ? [...s.g92Offset] : [],
    rotationXy: s.rotationXy ?? 0,
    toolOffset: [...(payloadToolBasis ?? s.toolOffset ?? [])],
    wcsTable: copyRows(s.wcsTable),
    toolNum: s.toolNumber, toolDiam: s.toolDiameter, toolLen: s.toolLength,
    eoffsetZ: s.eoffsetZ, eoffsetEnabled: s.eoffsetEnabled,
    startJoints: s.joints ? [...s.joints] : null,
  };
}

const sameArr = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Do two bases describe the same check input (kind and run aside)? */
export function sameCheckInputs(a: CheckBasis, b: CheckBasis): boolean {
  return sameArr(a.g5x, b.g5x) && sameArr(a.g92, b.g92) && a.rotationXy === b.rotationXy
    && sameArr(a.toolOffset, b.toolOffset)
    && JSON.stringify(a.wcsTable) === JSON.stringify(b.wcsTable)
    && a.toolNum === b.toolNum && a.toolDiam === b.toolDiam && a.toolLen === b.toolLen
    // a beginning bound to another start is another check (plan E5)
    && (a.startJoints == null ? b.startJoints == null : b.startJoints != null && sameArr(a.startJoints, b.startJoints));
}

/** What the shown collision result is (plan 1c, 3c/3d). */
export type CheckState =
  | { kind: "current" }
  | { kind: "run-provisional"; fromLine: number | null; done: boolean }
  | { kind: "run-full"; done: boolean }
  | { kind: "previous" }
  | { kind: "none" };

export interface CheckStateInputs {
  /** The result (or the running sweep) shown, with the basis it was built from. */
  shown: { basis: CheckBasis; phase: "full" | "provisional"; fromLine: number | null; done: boolean } | null;
  /** An earlier preview's result is kept, named, without its marks. */
  previous: boolean;
}

/** current: checked at standstill on the live state; run-provisional: in the
 *  run, from the machine's presumed line to the end; run-full: in the run,
 *  the whole program; previous: the result of a preview that is no longer
 *  the displayed one; none. */
export function checkState(i: CheckStateInputs): CheckState {
  const s = i.shown;
  if (!s) return i.previous ? { kind: "previous" } : { kind: "none" };
  if (s.basis.kind === "idle") return { kind: "current" };
  return s.phase === "provisional"
    ? { kind: "run-provisional", fromLine: s.fromLine, done: s.done }
    : { kind: "run-full", done: s.done };
}

export interface RunCheckInputs {
  /** The status's preview_origin: where the published payload comes from. */
  origin: PreviewOrigin | null;
  /** The payload ON SCREEN: its published version and file. */
  shownVersion: number | null;
  shownFile: string | null;
  /** The run in progress (run_basis) — and whether the frame shows it running. */
  run: RunBasis | null;
  running: boolean;
}

/** May a check run DURING the run on the displayed payload (plan „Prüfung im
 *  Lauf“ 3a)? Only a pinned mid-run parse made for exactly this run — its
 *  version on screen, its file and text the run's, planned for the run's id,
 *  start context and tool basis revision, the basis not moved since, the
 *  run's start verified and the run going on. Anything else waits for idle
 *  (the full check there). Pure. */
export function admitRunCheck(i: RunCheckInputs): { ok: true } | { ok: false; why: string } {
  const o = i.origin, r = i.run;
  if (!i.running || !r || r.state !== "sent") return { ok: false, why: "no run in progress" };
  if (!r.verified) return { ok: false, why: `the run's start is not the preview's${r.why ? ` (${r.why})` : ""}` };
  if (!o || !o.pinned) return { ok: false, why: "not a parse made during the run" };
  if (i.shownVersion == null || o.version !== i.shownVersion) return { ok: false, why: "another version on screen" };
  if (o.file !== r.file || i.shownFile !== r.file) return { ok: false, why: "another program" };
  if (o.source == null || o.source !== r.source) return { ok: false, why: "another program text" };
  const f = o.forRun;
  if (!f || f.runId !== r.runId || f.ctxDigest !== r.ctxDigest || f.toolBasisRev !== r.toolBasisRev) {
    return { ok: false, why: "not made for this run" };
  }
  if (o.toolBasisRevNow !== o.toolBasisRev) return { ok: false, why: "the tool basis moved since" };
  return { ok: true };
}
