// The Sim tab's rows rendered in portions (Codex R164 VP-I120): the range
// rules — the first portion where the focus and the tab stop are, a portion a
// frame until every row is there, a far row a portion of its own, a list that
// moved by a few rows at once.
import { describe, expect, it } from "vitest";
import { FIRST_ROWS, SIZER_SHAPES, STEP_ROWS, admit, grow, isComplete, nextRange, sizerTexts, widestOf } from "./simListRange";

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

  it("a few rows kept — one shown row of an otherwise new list: a whole first portion around them, never one row between spacers", () => {
    const n = 400, keys0 = keys(n, 5000);
    keys0[200] = "k200";
    const r = nextRange(new Set(keys(n)), keys0, [200, 200, 200]);
    expect(r).toEqual({ lo: 200 - FIRST_ROWS / 2, hi: 200 + FIRST_ROWS / 2 });
    const top = keys(n, 5000);
    top[0] = "k0";
    expect(nextRange(new Set(keys(n)), top, []), "at the list's top").toEqual({ lo: 0, hi: FIRST_ROWS });
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

  it("the sizer row: every shape of the window's values with each digit in all its places, both moves", () => {
    const w = widestOf([{ lineLabel: "L7", at: "0:01", rapid: null }, { lineLabel: "L12345", at: "12:34", rapid: false }, { lineLabel: "entry", at: "0:00", rapid: true }]);
    expect(w.line).toEqual(["L00000", "L11111", "L22222", "L33333", "L44444", "L55555", "L66666", "L77777", "L88888", "L99999", "entry",
      "L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"]);
    expect(w.at.slice(0, 2), "the longest shape first").toEqual(["00:00", "11:11"]);
    expect(w.at).toHaveLength(20);
    expect(w.move, "both words where both moves are listed").toEqual(["Feed", "Rapid"]);
    expect(widestOf([{ lineLabel: "L1", at: "1 %", rapid: false }])).toEqual({ line: [..."0123456789"].map(d => `L${d}`), at: [..."0123456789"].map(d => `${d} %`), move: ["Feed"] });
    expect(widestOf([])).toEqual({ line: [], at: [], move: [] });
  });

  it("a value of a shape is never wider than the shape with its widest digit everywhere", () => {
    // per-glyph widths as hinting rounds them: the digits apart
    const glyph: Record<string, number> = { "0": 8, "1": 7, "2": 8, "3": 8, "4": 8, "5": 8, "6": 8, "7": 7, "8": 8, "9": 8, ":": 3, "L": 7 };
    const width = (t: string) => [...t].reduce((a, c) => a + glyph[c]!, 0);
    const values = ["00:01", "00:04", "11:17", "L4", "L12", "L300", "07:59"];
    const texts = sizerTexts(values);
    for (const v of values) expect(Math.max(...texts.map(width)), v).toBeGreaterThanOrEqual(width(v));
    // the longest value is not the widest one — the old rule took "00:01" for "00:04"
    expect(width("00:04")).toBeGreaterThan(width("00:01"));
  });

  it("many shapes: the longest kept", () => {
    const texts = sizerTexts(Array.from({ length: 20 }, (_, i) => "x".repeat(i + 1)));
    expect(texts).toHaveLength(SIZER_SHAPES);
    expect(texts[0]).toBe("x".repeat(20));
  });
});
