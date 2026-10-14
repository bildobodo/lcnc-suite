// The Simulation tab's list as a WINDOW, and the steps, the look-ahead and the
// timeline's marks on the index (step 4 package 2, plan 4.4): the contact view
// holds every target, the list shows at most LIST_WINDOW rows around the shown
// or next one, ‹ › and the counts reach every target. Nothing here builds a
// list of every target — at the budget a row and a tick per target held the
// page for minutes. The list's order is simRows' (simRowOrder: the position,
// then tool → limit → collision), the collisions among themselves in the
// view's own order. Pure; unit-tested against the full list.
import { isNearMiss, type ClashTarget } from "./clashTargets";
import { findKey, indexAtOrAfter, targetAt, targetEnd, targetKey, targetKind, targetPos, T_NEAR, type ContactView, type LineAt } from "./contactView";
import { JUMP_NUDGE, sampleCum, type NavSelection, type NavTarget } from "./findingNav";
import { KIND_ORDER, type SimRowKind } from "./simRows";

/** The most rows the list shows. */
export const LIST_WINDOW = 400;
/** The window moves only when the row it is centred on comes this close to
 *  its edge — not with every row the playhead passes. */
export const WINDOW_MARGIN = 50;

/** The collision targets by index, ascending by position. */
export interface ClashIndex {
  readonly n: number;
  pos(i: number): number;
  end(i: number): number;
  key(i: number): string;
  /** A near miss, by the sweep's class. */
  near(i: number): boolean;
  /** The first index whose position is past `x` (strict), or at or past it. */
  atOrAfter(x: number, strict: boolean): number;
  /** The index of `key` (`near`: where it should be), −1 when gone. */
  find(key: string, near?: number): number;
  target(i: number): ClashTarget;
}

export const NO_CLASH: ClashIndex = {
  n: 0, pos: () => NaN, end: () => NaN, key: () => "", near: () => false, atOrAfter: () => 0, find: () => -1,
  target: () => { throw new Error("no collision targets"); },
};

/** The contact view as the list's index. */
export function clashIndexOfView(v: ContactView, lineAt: LineAt): ClashIndex {
  return {
    n: v.n, pos: i => targetPos(v, i), end: i => targetEnd(v, i), key: i => targetKey(v, i),
    near: i => (targetKind(v, i) & T_NEAR) !== 0, atOrAfter: (x, strict) => indexAtOrAfter(v, x, strict),
    // a limit's or a tool change's key is no collision's: never a walk over every target for it
    find: (key, near) => (key[0] === "C" || key[0] === "E" ? findKey(v, key, near) : -1), target: i => targetAt(v, i, lineAt),
  };
}

/** The first index of a list ascending by `cum` past `x` (strict), or at or past it. */
function lowerBound(n: number, cum: (i: number) => number, x: number, strict: boolean): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1, c = cum(mid);
    if (strict ? c <= x : c < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** A list of targets as the index — ascending by position, as the view keeps them. */
export function clashIndexOfList(list: readonly ClashTarget[]): ClashIndex {
  return {
    n: list.length, pos: i => list[i]!.cum, end: i => list[i]!.cumEnd, key: i => list[i]!.key,
    near: i => isNearMiss(list[i]!), atOrAfter: (x, strict) => lowerBound(list.length, i => list[i]!.cum, x, strict),
    find: key => list.findIndex(t => t.key === key), target: i => list[i]!,
  };
}

/** What the tab lists: the collisions by index, the limit violations and the
 *  tool changes as lists ascending by position (a few hundred at most). */
export interface SimTargets<L extends NavTarget = NavTarget, T extends NavTarget = NavTarget> {
  clash: ClashIndex;
  limit: readonly L[];
  tool: readonly T[];
}

/** One kind as the steps read it. */
interface KindList {
  kind: SimRowKind;
  order: number;
  n: number;
  cum(i: number): number;
  cumEnd(i: number): number;
  key(i: number): string;
  find(key: string, near?: number): number;
  atOrAfter(x: number, strict: boolean): number;
}
function kindList(t: SimTargets, kind: SimRowKind): KindList {
  if (kind === "clash") {
    const c = t.clash;
    return { kind, order: KIND_ORDER[kind], n: c.n, cum: i => c.pos(i), cumEnd: i => c.end(i), key: i => c.key(i),
             find: (key, near) => c.find(key, near), atOrAfter: (x, s) => c.atOrAfter(x, s) };
  }
  const l = kind === "limit" ? t.limit : t.tool;
  return { kind, order: KIND_ORDER[kind], n: l.length, cum: i => l[i]!.cum, cumEnd: i => l[i]!.cumEnd, key: i => l[i]!.key,
           find: key => l.findIndex(x => x.key === key), atOrAfter: (x, s) => lowerBound(l.length, i => l[i]!.cum, x, s) };
}

/** A target picked by kind and index. */
export interface Pick { kind: SimRowKind; index: number; key: string; cum: number; cumEnd: number }
const pickOf = (l: KindList, i: number): Pick => ({ kind: l.kind, index: i, key: l.key(i), cum: l.cum(i), cumEnd: l.cumEnd(i) });
/** `a` comes before `b` in the list's order (targets of different kinds). */
const before = (a: Pick, b: Pick) => a.cum < b.cum || (a.cum === b.cum && KIND_ORDER[a.kind] < KIND_ORDER[b.kind]);
const firstOf = (ps: Pick[]) => ps.reduce<Pick | null>((m, p) => (!m || before(p, m) ? p : m), null);
const lastOf = (ps: Pick[]) => ps.reduce<Pick | null>((m, p) => (!m || before(m, p) ? p : m), null);
const sample = (l: KindList, i: number) => sampleCum({ cum: l.cum(i), cumEnd: l.cumEnd(i) });

/** The selected target: its key, while the timeline stands where the jump left it. */
function selected(ls: KindList[], s: number, sel: NavSelection | null): Pick | null {
  if (!sel || sel.pos !== s) return null;
  for (const l of ls) {
    const i = l.find(sel.key, s);
    if (i >= 0) return pickOf(l, i);
  }
  return null;
}

/** The next (dir 1) or previous (−1) target of `kinds` — findingNav's rule
 *  over the whole list, on the index: after the one shown (by its key, while
 *  the timeline stands there), else the first a jump would land past `s`;
 *  wraps. Each kind gives its candidate; the list's order picks. */
export function stepTarget(t: SimTargets, kinds: readonly SimRowKind[], dir: 1 | -1, s: number, sel: NavSelection | null): Pick | null {
  const ls = kinds.map(k => kindList(t, k)).filter(l => l.n > 0);
  if (!ls.length) return null;
  const e = selected(ls, s, sel);
  const cands: Pick[] = [];
  for (const l of ls) {
    let i: number;
    if (e && dir > 0) {
      // the first of this kind after `e` in the list's order
      i = l.kind === e.kind ? e.index + 1 : l.atOrAfter(e.cum, l.order < KIND_ORDER[e.kind]);
    } else if (e) {
      i = l.kind === e.kind ? e.index - 1 : l.atOrAfter(e.cum, l.order < KIND_ORDER[e.kind]) - 1;
    } else if (dir > 0) {
      // a jump samples at most JUMP_NUDGE past a start
      for (i = l.atOrAfter(s - 2 * JUMP_NUDGE, false); i < l.n && !(sample(l, i) > s); i++);
    } else {
      for (i = l.atOrAfter(s, false) - 1; i >= 0 && !(sample(l, i) < s); i--);
    }
    if (i >= 0 && i < l.n) cands.push(pickOf(l, i));
  }
  if (dir > 0) return firstOf(cands) ?? firstOf(ls.map(l => pickOf(l, 0)));
  return lastOf(cands) ?? lastOf(ls.map(l => pickOf(l, l.n - 1)));
}

/** The first target of any kind past the position — the run's and
 *  playback's look-ahead (simRows.nextRowKey, on the index). */
export function nextTarget(t: SimTargets, kinds: readonly SimRowKind[], pos: number): Pick | null {
  const cands: Pick[] = [];
  for (const k of kinds) {
    const l = kindList(t, k), i = l.atOrAfter(pos, true);
    if (i < l.n) cands.push(pickOf(l, i));
  }
  return firstOf(cands);
}

/** The list of `kinds` in its order, addressed by its global index: the
 *  limit violations and tool changes merged among the collisions. */
export class MergedList<L extends NavTarget = NavTarget, T extends NavTarget = NavTarget> {
  readonly total: number;
  private readonly others: Array<{ kind: "limit" | "tool"; index: number; cum: number }>;
  /** Each limit / tool row's global index. */
  private readonly g: number[];
  private readonly clash: ClashIndex | null;
  readonly t: SimTargets<L, T>;
  constructor(t: SimTargets<L, T>, kinds: readonly SimRowKind[]) {
    this.t = t;
    this.clash = kinds.includes("clash") ? t.clash : null;
    const others: MergedList["others"] = [];
    // tool before limit at one position (simRowOrder); a kind keeps its own order
    if (kinds.includes("tool")) t.tool.forEach((x, index) => others.push({ kind: "tool", index, cum: x.cum }));
    if (kinds.includes("limit")) t.limit.forEach((x, index) => others.push({ kind: "limit", index, cum: x.cum }));
    others.sort((a, b) => a.cum - b.cum || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    this.others = others;
    // a collision at the same position comes after them
    this.g = others.map((o, k) => k + (this.clash ? this.clash.atOrAfter(o.cum, false) : 0));
    this.total = others.length + (this.clash?.n ?? 0);
  }
  /** The global index of a target. */
  indexOf(p: { kind: SimRowKind; index: number }): number {
    if (p.kind === "clash") {
      // the limit / tool rows at or before its position come first
      return p.index + lowerBound(this.others.length, k => this.others[k]!.cum, this.clash!.pos(p.index), true);
    }
    const k = this.others.findIndex(o => o.kind === p.kind && o.index === p.index);
    return k < 0 ? -1 : this.g[k]!;
  }
  /** The targets with global indices [from, to), each kind in its order. */
  slice(from: number, to: number): { clash: ClashTarget[]; limit: L[]; tool: T[] } {
    const out = { clash: [] as ClashTarget[], limit: [] as L[], tool: [] as T[] };
    let k = lowerBound(this.others.length, j => this.g[j]!, from, false);
    let c = from - k;
    for (let g = from; g < Math.min(to, this.total); g++) {
      if (k < this.others.length && this.g[k] === g) {
        const o = this.others[k++]!;
        if (o.kind === "limit") out.limit.push(this.t.limit[o.index]!); else out.tool.push(this.t.tool[o.index]!);
      } else out.clash.push(this.clash!.target(c++));
    }
    return out;
  }
}

/** Where the window begins: unchanged while the row it is centred on stays
 *  WINDOW_MARGIN rows inside it (an edge of the list counts as inside), else
 *  centred on it. */
export function windowFirst(total: number, center: number, prev: number | null,
                            max = LIST_WINDOW, margin = WINDOW_MARGIN): number {
  if (total <= max) return 0;
  const last = total - max;
  if (prev !== null && prev >= 0 && prev <= last) {
    const lo = prev === 0 ? 0 : prev + margin, hi = prev === last ? total : prev + max - margin;
    if (center >= lo && center < hi) return prev;
  }
  return Math.max(0, Math.min(last, center - (max >> 1)));
}

/** The row the window is centred on: the shown target, else the first one
 *  past the position, else the last. */
export function windowCenter(m: MergedList, kinds: readonly SimRowKind[], s: number, sel: NavSelection | null): number {
  if (!m.total) return 0;
  const ls = kinds.map(k => kindList(m.t, k)).filter(l => l.n > 0);
  const e = selected(ls, s, sel) ?? nextTarget(m.t, kinds, s);
  return e ? m.indexOf(e) : m.total - 1;
}

/** The timeline's collision marks: one per occupied column of `cols` over the
 *  axis — at its first target, a near miss only where every target in it is
 *  one (a contact beats a near miss). Never one per target: a column is a
 *  pixel of the timeline (plan 4.3's resolution). */
export function clashTicks(c: ClashIndex, cols: number, axisEnd: number): Array<{ pct: number; near: boolean }> {
  const out: Array<{ pct: number; near: boolean }> = [];
  if (!c.n || cols < 1 || !(axisEnd > 0)) return out;
  const w = axisEnd / cols;
  for (let col = 0, i = 0; col < cols && i < c.n; col++) {
    const hi = col === cols - 1 ? Infinity : (col + 1) * w;
    i = c.atOrAfter(col * w, false);
    if (i >= c.n || !(c.pos(i) < hi)) continue;
    let near = true;
    for (let j = i; j < c.n && c.pos(j) < hi; j++) if (!c.near(j)) { near = false; break; }
    out.push({ pct: Math.min(100, (c.pos(i) / axisEnd) * 100), near });
  }
  return out;
}
