// The Sim tab's rows rendered in portions (Codex R164 VP-I120): the range
// rules — the first portion where the focus and the tab stop are, a portion a
// frame until every row is there, a far row a portion of its own, a list that
// moved by a few rows at once.
import { describe, expect, it } from "vitest";
import { FIRST_ROWS, STEP_ROWS, admit, grow, isComplete, nextRange, widestOf } from "./simListRange";

const keys = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `k${from + i}`);
const none = new Set<string>();

describe("the rows rendered in portions (Codex R164 VP-I120)", () => {
  it("a short list at once", () => {
    expect(nextRange(none, keys(FIRST_ROWS), [5])).toEqual({ lo: 0, hi: FIRST_ROWS });
    expect(nextRange(none, keys(0), [])).toEqual({ lo: 0, hi: 0 });
  });

  it("a first list: a portion around the first anchor — never the whole window at once", () => {
    const n = 400;
    expect(nextRange(none, keys(n), [200, 0])).toEqual({ lo: 200 - FIRST_ROWS / 2, hi: 200 + FIRST_ROWS / 2 });
    expect(nextRange(none, keys(n), [3])).toEqual({ lo: 0, hi: FIRST_ROWS });
    expect(nextRange(none, keys(n), [399])).toEqual({ lo: n - FIRST_ROWS, hi: n });
    expect(nextRange(none, keys(n), []), "no anchor: from the top").toEqual({ lo: 0, hi: FIRST_ROWS });
    expect(nextRange(none, keys(n), [-1, 7]), "an anchor not in the list is skipped").toEqual({ lo: 0, hi: FIRST_ROWS });
  });

  it("the anchors are all there when they lie close; the first decides where a far range goes", () => {
    const n = 400;
    const r = nextRange(none, keys(n), [200, 260]);
    expect(r.lo <= 200 && r.hi > 260, "both rendered").toBe(true);
    const far = nextRange(none, keys(n), [300, 10]);
    expect(far.lo <= 300 && far.hi > 300, "the focus's row").toBe(true);
    expect(far.hi - far.lo).toBe(FIRST_ROWS);
  });

  it("a window that moved by a few rows (playing): every row at once; a replaced one: a portion again", () => {
    const n = 400, before = new Set(keys(n));
    expect(nextRange(before, keys(n, 30), [0])).toEqual({ lo: 0, hi: n });
    expect(nextRange(before, keys(n, STEP_ROWS), [0]), "exactly a portion new").toEqual({ lo: 0, hi: n });
    expect(nextRange(before, keys(n, 1000), [0]), "all new").toEqual({ lo: 0, hi: FIRST_ROWS });
  });

  it("a list while the last one was still filling keeps the rows already there and fills on", () => {
    const n = 400, rendered = new Set(keys(160, 100));
    const r = nextRange(rendered, keys(n), [150]);
    expect(r).toEqual({ lo: 100, hi: 260 });
  });

  it("a portion a frame — half on each side, the rest to the side with rows left — until every row is there", () => {
    const n = 400;
    let r = { lo: 160, hi: 240 }, frames = 0;
    expect(grow(r, n)).toEqual({ lo: 160 - STEP_ROWS / 2, hi: 240 + STEP_ROWS / 2 });
    r = { lo: 10, hi: 90 };
    expect(grow(r, n)).toEqual({ lo: 0, hi: 90 + STEP_ROWS - 10 });
    r = { lo: 160, hi: 240 };
    while (!isComplete(r, n)) {
      const next = grow(r, n);
      expect((next.hi - next.lo) - (r.hi - r.lo), "one portion").toBeLessThanOrEqual(STEP_ROWS);
      r = next; frames++;
    }
    expect(r).toEqual({ lo: 0, hi: n });
    expect(frames, "the rows beyond the first 80, a portion a frame").toBe(Math.ceil((n - 80) / STEP_ROWS));
  });

  it("a row the keys move to: the range extended within a portion, else a portion around it — never every row between", () => {
    const n = 400, r = { lo: 160, hi: 240 };
    expect(admit(r, n, 200), "already there").toBe(r);
    expect(admit(r, n, 240), "the next row").toEqual({ lo: 160, hi: 241 });
    expect(admit(r, n, 159)).toEqual({ lo: 159, hi: 240 });
    expect(admit(r, n, 399), "End: far").toEqual({ lo: n - FIRST_ROWS, hi: n });
    expect(admit(r, n, 0), "Home: far").toEqual({ lo: 0, hi: FIRST_ROWS });
    expect(admit({ lo: 0, hi: 0 }, n, 5), "nothing rendered: a portion around it").toEqual({ lo: 0, hi: FIRST_ROWS });
    expect(admit(r, n, 400), "not a row").toBe(r);
  });

  it("the sizer row: the widest line, time and move of the whole window", () => {
    expect(widestOf([{ lineLabel: "L7", at: "0:01", rapid: null }, { lineLabel: "L12345", at: "12:34", rapid: false }, { lineLabel: "entry", at: "0:00", rapid: true }]))
      .toEqual({ line: "L12345", at: "12:34", move: "Rapid" });
    expect(widestOf([{ lineLabel: "L1", at: "1 %", rapid: false }])).toEqual({ line: "L1", at: "1 %", move: "Feed" });
    expect(widestOf([])).toEqual({ line: "", at: "", move: "" });
  });
});
