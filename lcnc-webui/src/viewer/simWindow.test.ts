// The list's window, the steps, the look-ahead and the timeline marks on the
// index (step 4 package 2, plan 4.4) against the FULL list — the way the tab
// read it before: every target materialized, sorted by simRowOrder, stepped by
// findingNav's targetAfter / targetBefore, the look-ahead by nextRowKey.
import { describe, expect, it } from "vitest";
import type { ClashTarget } from "./clashTargets";
import { TIMELINE_COLUMNS } from "./contactView";
import { targetAfter, targetBefore, type NavSelection, type NavTarget } from "./findingNav";
import { simRowOrder, type SimRowKind } from "./simRows";
import {
  LIST_WINDOW, MergedList, POS_OPS, WINDOW_MARGIN, clashIndexOfList, clashTicks, clashTicksSteps, nextTarget, stepTarget, windowCenter, windowFirst,
  type ClashIndex, type SimTargets,
} from "./simWindow";
import { STEP_OPS } from "./steps";

const KINDS: SimRowKind[][] = [["clash", "limit", "tool"], ["clash"], ["limit"], ["tool"], ["clash", "tool"], ["limit", "tool"]];
let seed = 4401;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const int = (n: number) => Math.floor(rnd() * n);

/** Positions with ties — the same moment in several kinds, and several targets of one kind at one moment. */
function targets(nc: number, nl: number, nt: number): SimTargets & { clashList: ClashTarget[] } {
  const spots = Array.from({ length: 12 }, () => Math.round(rnd() * 1000) / 10);
  const at = () => (rnd() < 0.4 ? spots[int(spots.length)]! : Math.round(rnd() * 1000) / 10);
  const len = () => (rnd() < 0.3 ? 0 : rnd() < 0.5 ? 1e-4 : rnd() * 3);
  const clashList: ClashTarget[] = Array.from({ length: nc }, (_, i) => {
    const cum = at();
    return { cum, cumEnd: cum + len(), key: `C${i}|0|0`, line: 1, a: "t", b: "w", near: rnd() < 0.3, dist: 0 };
  }).sort((a, b) => a.cum - b.cum);
  const nav = (p: string, n: number) => Array.from({ length: n }, (_, i) => { const cum = at(); return { cum, cumEnd: cum + len(), key: `${p}${i}` }; })
    .sort((a, b) => a.cum - b.cum);
  return { clash: clashIndexOfList(clashList), limit: nav("L", nl), tool: nav("T", nt), clashList };
}
/** The list the tab built before: every target, sorted (stable) by the list's order. */
function full(t: ReturnType<typeof targets>, kinds: readonly SimRowKind[]) {
  const rows: Array<NavTarget & { kind: SimRowKind }> = [];
  if (kinds.includes("clash")) for (const x of t.clashList) rows.push({ ...x, kind: "clash" });
  if (kinds.includes("limit")) for (const x of t.limit) rows.push({ ...x, kind: "limit" });
  if (kinds.includes("tool")) for (const x of t.tool) rows.push({ ...x, kind: "tool" });
  return rows.sort(simRowOrder);
}

describe("the list on the index against the full list (plan 4.4)", () => {
  it("the steps: after / before the one shown, else by position, wrapping — ties of kinds included (Codex R78 VP-I38)", () => {
    let steps = 0, viaSel = 0, wraps = 0;
    for (let c = 0; c < 400; c++) {
      const t = targets(int(30), int(8), int(6));
      for (const kinds of KINDS) {
        const list = full(t, kinds);
        for (let q = 0; q < 30; q++) {
          // a position: on a target, a hair past one, or anywhere
          const pick = list.length ? list[int(list.length)]! : null;
          const s = pick && rnd() < 0.6 ? (rnd() < 0.5 ? pick.cum : pick.cum + 5e-4) : rnd() * 110 - 5;
          const anyKey = [...t.clashList, ...t.limit, ...t.tool];
          const sel: NavSelection | null = rnd() < 0.5 && anyKey.length
            ? { key: anyKey[int(anyKey.length)]!.key, pos: rnd() < 0.8 ? s : s + 1 } : null;
          for (const dir of [1, -1] as const) {
            const want = dir > 0 ? targetAfter(list, s, sel) : targetBefore(list, s, sel);
            const got = stepTarget(t, kinds, dir, s, sel);
            expect(got?.key ?? null, `case ${c} ${kinds} dir ${dir} s ${s} sel ${JSON.stringify(sel)}`).toBe(want?.key ?? null);
            steps++;
            if (sel && sel.pos === s && list.some(r => r.key === sel.key)) viaSel++;
            if (want && list.length > 1 && (dir > 0 ? want === list[0] : want === list[list.length - 1])) wraps++;
          }
        }
      }
    }
    expect([steps > 50_000, viaSel > 5_000, wraps > 2_000], "steps by position, by the shown one, and wrapping").toEqual([true, true, true]);
  });

  it("the look-ahead: the first target of any kind past the position (simRows.nextRowKey)", () => {
    for (let c = 0; c < 300; c++) {
      const t = targets(int(30), int(8), int(6));
      const list = full(t, ["clash", "limit", "tool"]);
      for (let q = 0; q < 40; q++) {
        const s = list.length && rnd() < 0.6 ? list[int(list.length)]!.cum : rnd() * 110 - 5;
        expect(nextTarget(t, ["clash", "limit", "tool"], s)?.key ?? null).toBe(list.find(r => r.cum > s)?.key ?? null);
      }
    }
  });

  it("the merged list: every slice is the full list's, every target at its global index", () => {
    for (let c = 0; c < 300; c++) {
      const t = targets(int(40), int(10), int(8));
      for (const kinds of KINDS) {
        const list = full(t, kinds), m = new MergedList(t, kinds);
        expect(m.total).toBe(list.length);
        for (let q = 0; q < 10; q++) {
          const a = int(list.length + 1), b = a + int(list.length + 1 - a);
          const sl = m.slice(a, b);
          expect([...sl.clash.map(x => ({ ...x, kind: "clash" as const })), ...sl.limit.map(x => ({ ...x, kind: "limit" as const })),
                  ...sl.tool.map(x => ({ ...x, kind: "tool" as const }))].sort(simRowOrder).map(r => r.key))
            .toEqual(list.slice(a, b).map(r => r.key));
        }
        list.forEach((r, g) => {
          const index = r.kind === "clash" ? t.clashList.findIndex(x => x.key === r.key)
            : (r.kind === "limit" ? t.limit : t.tool).findIndex(x => x.key === r.key);
          expect(m.indexOf({ kind: r.kind, index }), `${kinds}: ${r.key}`).toBe(g);
        });
      }
    }
  });

  it("the window: at most LIST_WINDOW rows around the row it is centred on, moving only near its edge", () => {
    const max = LIST_WINDOW, total = 5000;
    let first: number | null = null, moves = 0;
    for (let center = 0; center < total; center += 7) {
      const f = windowFirst(total, center, first);
      expect(center >= f && center < f + max, `the centre ${center} in [${f}, ${f + max})`).toBe(true);
      if (first !== null && f !== first) {
        moves++;
        // it moved because the centre came within the margin of an edge that is not the list's
        expect(center < first + WINDOW_MARGIN || center >= first + max - WINDOW_MARGIN).toBe(true);
      }
      first = f;
    }
    // re-centred, the centre has (window / 2 − margin) rows to go before the next move
    expect(moves, "one move per (window / 2 − margin) rows").toBeLessThan(total / (max / 2 - WINDOW_MARGIN) + 2);
    expect(windowFirst(300, 250, null), "a short list: all of it").toBe(0);
    expect(windowFirst(5000, 4999, null), "the end").toBe(5000 - max);
    expect(windowFirst(5000, 4990, 5000 - max), "at the list's end the edge is no reason to move").toBe(5000 - max);
  });

  it("the window's centre: the shown target, else the first past the position, else the last", () => {
    for (let c = 0; c < 200; c++) {
      const t = targets(1 + int(30), int(8), int(6));
      const kinds: SimRowKind[] = ["clash", "limit", "tool"], list = full(t, kinds), m = new MergedList(t, kinds);
      const r = list[int(list.length)]!;
      expect(windowCenter(m, kinds, r.cum, { key: r.key, pos: r.cum })).toBe(list.indexOf(r));
      const s = rnd() * 110 - 5, next = list.findIndex(x => x.cum > s);
      expect(windowCenter(m, kinds, s, null)).toBe(next >= 0 ? next : list.length - 1);
    }
  });

  it("the marks: one per occupied column, at its first target, a near miss only where all in it are", () => {
    for (let c = 0; c < 200; c++) {
      const t = targets(int(60), 0, 0), cols = 1 + int(50), end = 100;
      const w = end / cols, want: Array<{ pct: number; near: boolean }> = [];
      for (let col = 0; col < cols; col++) {
        const hi = col === cols - 1 ? Infinity : (col + 1) * w;
        const inCol = t.clashList.filter(x => x.cum >= col * w && x.cum < hi);
        if (inCol.length) want.push({ pct: Math.min(100, (inCol[0]!.cum / end) * 100), near: inCol.every(x => x.near) });
      }
      expect(clashTicks(t.clash, cols, end)).toEqual(want);
      expect(clashTicks(t.clash, cols, end).length).toBeLessThanOrEqual(Math.min(cols, t.clashList.length));
    }
    // a wider timeline than the bands' resolution: at most TIMELINE_COLUMNS marks (Codex R154)
    const many: ClashTarget[] = Array.from({ length: 20_000 }, (_, i) => ({ cum: i / 200, cumEnd: i / 200, key: `C${i}|0|0`, line: 1, a: "t", b: "w" }));
    const ticks = clashTicks(clashIndexOfList(many), 1e6, 100);
    expect(ticks.length).toBe(TIMELINE_COLUMNS);
  });
});

// Plan 3.6: a position read through the index decodes an evidence piece in a
// union — every one counts, or a column's binary search read as a flat 64 made
// steps of 11 ms at the budget. The reads between two yields, counted.
describe("the timeline's collision marks in bounded steps (plan 3.6)", () => {
  it("every position read counts: a step reads at most the budget's share, in many columns and in one dense one", () => {
    for (const [n, dense] of [[100_000, false], [100_000, true]] as Array<[number, boolean]>) {
      let reads = 0;
      const pos = (i: number) => { reads++; return dense ? 500 + i * 1e-6 : i * (1000 / n); };
      const c: ClashIndex = { n, pos, end: pos, key: i => `C${i}`, near: () => true,
        atOrAfter: (x, strict) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1, p = pos(m); if (strict ? p <= x : p < x) lo = m + 1; else hi = m; } return lo; },
        find: () => -1, target: () => { throw new Error("not read"); } };
      const job = clashTicksSteps(c, 1200, 1000);
      let worst = 0, ticks: Array<{ pct: number; near: boolean }> | null = null;
      while (!ticks) { reads = 0; const r = job.next(); worst = Math.max(worst, reads); if (r.done) ticks = r.value; }
      expect(worst, `${dense ? "one dense column" : "many columns"}: reads in one step`).toBeLessThanOrEqual(2 * Math.ceil(STEP_OPS / POS_OPS) + 2 * (Math.ceil(Math.log2(n + 1)) + 1));
      expect(ticks.length).toBe(dense ? 1 : 1200);
      expect(ticks.every(t => t.near)).toBe(true);
    }
  });
});
