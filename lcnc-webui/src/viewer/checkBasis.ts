// The collision check's basis (plan „Prüfung im Lauf“ 1c, Codex R112–R115):
// every sweep is built from ONE immutable snapshot of what it reads besides
// the payload — the fixture terms, the fixture table, the tool before the
// program's first tool event — never from the live status at the time a
// field happens to be read. Idle: the live state when the check begins. In
// a run: the run's START as the gateway took it before the start was written
// (run_basis.start), never the first run frame a client saw. Pure.
import type { RunBasis } from "../runBasis";
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
  };
}

const sameArr = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Do two bases describe the same check input (kind and run aside)? */
export function sameCheckInputs(a: CheckBasis, b: CheckBasis): boolean {
  return sameArr(a.g5x, b.g5x) && sameArr(a.g92, b.g92) && a.rotationXy === b.rotationXy
    && sameArr(a.toolOffset, b.toolOffset)
    && JSON.stringify(a.wcsTable) === JSON.stringify(b.wcsTable)
    && a.toolNum === b.toolNum && a.toolDiam === b.toolDiam && a.toolLen === b.toolLen;
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
