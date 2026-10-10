// The program's START-DEPENDENT beginning bound to a start
// (docs/reviews/parity-ef.plan.md E5/E7, Codex R122–R131).
//
// X, Y and Z stand where the machine stands when the program starts — a
// value no parse knows. The parse books, per point, the axes whose value
// still depends on it (`dep`) and keeps the coordinates it ASSUMED (from
// `startBelieved`). A base track draws and checks nothing of that beginning
// (scrubTrack.buildScrubTrack breaks the segments into points 1..K). Bound to
// a start — the live joints at the simulation's entry, a run's start joints,
// the parity record's — every dependent axis moves by Δ = start − assumed
// start: within the scope the canon admits (identity kinematics, X/Y
// unrotated, straight moves) program = machine − offset per axis, so one Δ
// holds across fixture switches, G43 and G91 deltas alike (plan E3).
//
// The time of a move from a dependent position is recomputed from its kind
// and basis (plan E7, VP122-02): a rapid as the entry move is timed, a G94
// feed at its F, a feed the parse could not time (G93, G95, no F) at the
// shortest duration the INI limits allow — a lower bound, named — or, with a
// limit missing, at none: the time is unknown from there.
import type { ScrubTrack } from "../ws/bulkData";
import { buildLineIndex } from "./lineIndex";

export interface DepRates {
  /** Rapid rates (units/s, deg/s) — the entry move's. */
  linear?: number | null;
  rotary?: number | null;
  /** INI limits for a feed's shortest duration (units/s): per axis X/Y/Z
   *  MAX_VELOCITY and [TRAJ] MAX_LINEAR_VELOCITY (wire axis_vmax /
   *  traj_vmax; null = missing). */
  axisVmax?: readonly (number | null)[] | null;
  trajVmax?: number | null;
}

const DEG_AS_MM = 1;

export type DepTime = NonNullable<ScrubTrack["depTime"]>;

/** Two time causes in execution order (`a` runs first, Codex R133
 *  VP-I89): the first inexact line is a's; the time stays a lower bound only
 *  while neither is unknown; the first unknown line is a's, else b's. */
export function earlierTime(a: DepTime, b: DepTime | undefined): DepTime {
  if (!b) return a;
  const unknownLine = a.unknownLine ?? b.unknownLine;
  return { line: a.line, bound: a.bound && b.bound, ...(unknownLine != null ? { unknownLine } : {}) };
}

/** The duration of one move from (p0, a0) to (p1, a1) by its basis: 1 rapid,
 *  2 a G94 feed at f (units/min), 3 a feed whose time is not known. On a
 *  distance axis (no time base) every move is max(linear, rotary°). Returns
 *  [duration, flag]: flag 0 exact, 1 a lower bound, 2 unknown (0 counted). */
export function moveTime(basis: number, f: number, dx: number, dy: number, dz: number, rotDeg: number,
                         timeBased: boolean, rates: DepRates | undefined): [number, 0 | 1 | 2] {
  const lin = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!timeBased) return [Math.max(lin, rotDeg * DEG_AS_MM), 0];
  if (basis === 2 && f > 0) return [Math.max(lin, rotDeg) / (f / 60), 0];
  if (basis === 3 || basis === 2) {
    // The planner never exceeds a joint's or the trajectory's limit: the
    // shortest the move can take. A limit missing for an axis that moves
    // (or the trajectory's) gives no invented finite duration (Codex R124).
    const v = rates?.axisVmax, vt = rates?.trajVmax;
    const d = [Math.abs(dx), Math.abs(dy), Math.abs(dz)];
    let t = 0;
    for (let k = 0; k < 3; k++) {
      if (d[k]! <= 1e-12) continue;
      const vk = v?.[k];
      if (!(vk != null && vk > 0)) return [0, 2];
      t = Math.max(t, d[k]! / vk);
    }
    if (lin > 1e-12) {
      if (!(vt != null && vt > 0)) return [0, 2];
      t = Math.max(t, lin / vt);
    }
    return [t, 1];
  }
  // a rapid
  if (rates?.linear) return [Math.max(lin / rates.linear, rotDeg / (rates.rotary || rates.linear)), 0];
  return [Math.max(lin, rotDeg * DEG_AS_MM), 0];
}

/** The base track's beginning bound to `start` (program frame of the first
 *  point's epoch — machineJointsToProgram under the track's first labeling,
 *  the entry move's own conversion): a NEW track whose dependent axes moved
 *  by Δ = start − startBelieved, whose segments into 1..K are the parse's own
 *  again (its relabels and unknown starts stay breaks) and timed by their
 *  basis, every later cum shifted by the beginning's new duration. `depEnd`
 *  0 on the result (nothing left to bind); `depTime` names the first line a
 *  lower bound or an unknown time begins at. The base itself when it has no
 *  beginning; null when it has one but no assumed start (an older payload —
 *  nothing to shift by: never guessed). Pure. */
export function bindBeginning(base: ScrubTrack, start: readonly number[], rates?: DepRates): ScrubTrack | null {
  const K = base.depEnd ?? 0;
  if (K <= 0) return base;
  const sb = base.startBelieved, dep = base.dep, n = base.count;
  if (!sb || !dep || !base.depBrk || !base.depDur) return null;
  const delta = [start[0]! - sb[0], start[1]! - sb[1], start[2]! - sb[2]];
  const pos = base.pos.slice();
  for (let i = 0; i < Math.min(K, n); i++) {
    const m = dep[i]!;
    if (!m) continue;
    for (let k = 0; k < 3; k++) if ((m >> k) & 1) pos[i * 3 + k] = pos[i * 3 + k]! + delta[k]!;
  }
  const last = Math.min(K, n - 1);
  const brk = base.brk ? base.brk.slice() : new Uint8Array(n);
  for (let i = 0; i <= last; i++) brk[i] = base.depBrk[i]!;
  const cum = new Float32Array(n);
  let depTime: ScrubTrack["depTime"];
  for (let i = 1; i <= last; i++) {
    let dur: number;
    const b = base.depBasis?.[i] ?? 0;
    if (brk[i]) dur = 0;
    else if (b === 0) dur = base.depDur[i]!;      // a move from a known position: as timed
    else {
      const j = i * 3, h = j - 3;
      const rot = Math.max(Math.abs(base.abc[j]! - base.abc[h]!), Math.abs(base.abc[j + 1]! - base.abc[h + 1]!),
                           Math.abs(base.abc[j + 2]! - base.abc[h + 2]!));
      const [t, flag] = moveTime(b, base.depF?.[i] ?? 0, pos[j]! - pos[h]!, pos[j + 1]! - pos[h + 1]!,
                                 pos[j + 2]! - pos[h + 2]!, rot, base.timeBased, rates);
      dur = t;
      if (flag) {
        const ln = base.lines[i] ?? 0;
        const c: DepTime = { line: ln, bound: flag === 1, ...(flag === 2 ? { unknownLine: ln } : {}) };
        depTime = depTime ? earlierTime(depTime, c) : c;
      }
    }
    cum[i] = cum[i - 1]! + dur;
  }
  const add = cum[last]!;
  for (let i = last + 1; i < n; i++) cum[i] = base.cum[i]! + add;
  const out: ScrubTrack = { ...base, pos, brk, cum, depEnd: 0, depTime,
                            lineIndex: buildLineIndex(base.lines, cum) };
  delete out.depBrk;
  delete out.depDur;
  return out;
}

/** Where a run check stands with the program's start-dependent beginning
 *  (Codex R133 VP-I86): none, its bound side result merged ("checked"),
 *  still sweeping, no start joints in the run's basis, or no start bindable
 *  at the first point (`startUnbound`). */
export type RunBegin = "none" | "checked" | "checking" | "nojoints" | "unbound";

/** A run check's beginning when it starts: none (K = 0), bound to the run's
 *  start joints (a side sweep follows), no start bindable at the first
 *  point, or no joints in the run's basis. */
export function runBeginOf(K: number, bound: boolean, unbound: boolean): "none" | "bound" | "nojoints" | "unbound" {
  return K <= 0 ? "none" : bound ? "bound" : unbound ? "unbound" : "nojoints";
}

/** ...and as the bar shows it: a bound beginning is checked once ITS side
 *  result (this run check's) is merged, until then still checking. */
export function runBeginView(begin: "none" | "bound" | "nojoints" | "unbound", sideMerged: boolean): RunBegin {
  return begin === "bound" ? (sideMerged ? "checked" : "checking") : begin;
}

/** The "?" sentence for a start-dependent beginning (plan E7; Codex R133
 *  VP-I84/I86): where it lies and whether, and how, it is checked — idle,
 *  in the simulation from the machine's position; in a run from the run's
 *  start joints, or not. */
export function beginSentence(sd: { fromLine: number; toLine: number; whole: boolean; unbound?: boolean },
                              run: { begin?: RunBegin; beginWhy?: string | null } | null | undefined): string {
  const at = sd.fromLine ? ` (${sd.toLine > sd.fromLine ? `L${sd.fromLine}–L${sd.toLine}` : `L${sd.fromLine}`})` : "";
  const how = sd.unbound ? "its first move starts from a position the preview cannot know, so it is not checked"
    : !run ? "checked from the machine's position in the simulation"
    : run.begin === "checking" ? "being checked from the run's start position"
    : run.begin === "nojoints" ? `not checked: the run's start position was not read${run.beginWhy ? ` (${run.beginWhy})` : ""}`
    : "not checked";
  return `${sd.whole ? "The whole program" : "The start of the program"} depends on where the machine stands${at}: ${how}.`;
}

/** The "?" sentence for a beginning's time (plan E7; Codex R133 VP-I89):
 *  from which line it is a lower bound, from which unknown. */
export function depTimeSentence(dt: DepTime): string {
  const lower = "a feed with no known rate is counted at the shortest the INI's velocity limits allow";
  const unknown = "a feed with no known rate, and an INI velocity limit is missing";
  if (dt.unknownLine == null) return `The time from L${dt.line} on is a lower bound: ${lower}.`;
  if (dt.unknownLine === dt.line) return `The time from L${dt.line} on is not known: ${unknown}.`;
  return `The time from L${dt.line} on is a lower bound: ${lower}; from L${dt.unknownLine} on it is not known: ${unknown}.`;
}
