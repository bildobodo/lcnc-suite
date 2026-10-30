// The Setup arrangement by axis count (operator 2026-10-29/30, Codex
// R233/R234). The expected values are LITERAL — Codex's R234 result matrix,
// written out, never the search run again: a change to the width classes
// must not quietly produce another arrangement on someone's machine.
import { describe, it, expect } from "vitest";
import { setupLayout, type SetupLayout } from "./setupLayout";

// Per group: "1+1" two rows of one, "2" one row of two, "1+1+1", "2+1", "3".
const BASE = { "1+1": { zero: 6, home: 6 }, "2": { zero: 3, home: 3 } } as const;
const GOTO = { "1+1+1": { g30: 6, mcs: 6, wcs: 6 }, "2+1": { g30: 3, mcs: 3, wcs: 6 }, "3": { g30: 2, mcs: 2, wcs: 2 } } as const;
const PLANE = { capture: 2, orient: 2, clear: 2 } as const;

function expectLayout(got: SetupLayout, form: SetupLayout["form"], columns: number[], span: SetupLayout["span"]) {
  expect(got.form).toBe(form);
  expect(got.columns).toEqual(columns);
  expect(got.span).toEqual(span);
}

describe("setupLayout: landscape without TWP", () => {
  it("1–4 axes: one column, the actions in the rows under it (K / G)", () => {
    expectLayout(setupLayout(1, false, false), "under", [1], { ...BASE["1+1"], ...GOTO["1+1+1"] });
    expectLayout(setupLayout(2, false, false), "under", [2], { ...BASE["2"], ...GOTO["1+1+1"] });
    expectLayout(setupLayout(3, false, false), "under", [3], { ...BASE["2"], ...GOTO["2+1"] });
    expectLayout(setupLayout(4, false, false), "under", [4], { ...BASE["2"], ...GOTO["3"] });
  });
  it("5–6 axes: one column and an action column beside it (E)", () => {
    expectLayout(setupLayout(5, false, false), "column", [5], { ...BASE["1+1"], ...GOTO["1+1+1"] });
    expectLayout(setupLayout(6, false, false), "column", [6], { ...BASE["1+1"], ...GOTO["1+1+1"] });
  });
  it("7–9 axes: X–C in the first column, the actions under U/V/W, paired as the rows run short", () => {
    expectLayout(setupLayout(7, false, false), "under", [6, 1], { ...BASE["1+1"], ...GOTO["1+1+1"] });
    expectLayout(setupLayout(8, false, false), "under", [6, 2], { ...BASE["2"], ...GOTO["1+1+1"] });
    expectLayout(setupLayout(9, false, false), "under", [6, 3], { ...BASE["2"], ...GOTO["2+1"] });
  });
  it("a tie on width and rows pairs the earlier group first (2 axes: Zero|Home, the Go to alone)", () => {
    // 2 axes: Zero|Home + three Go to rows and Zero, Home + G30|MCS 0, WCS 0
    // both fill four rows at pair width — Zero|Home is the pair.
    expect(setupLayout(2, false, false).span).toMatchObject({ zero: 3, home: 3, g30: 6 });
  });
  it("no axes at all (never with DEFAULT_AXES): the actions as a column", () => {
    expectLayout(setupLayout(0, false, false), "column", [], { ...BASE["1+1"], ...GOTO["1+1+1"] });
  });
});

describe("setupLayout: TWP", () => {
  it("up to six axes: the rows form — groups of three side by side, the three action rows under them", () => {
    for (const [n, columns] of [[5, [3, 2]], [6, [3, 3]]] as const)
      expectLayout(setupLayout(n, true, false), "rows", [...columns], { ...BASE["2"], ...GOTO["3"], ...PLANE });
  });
  it("7–9 axes: under U/V/W with the plane trio always one row (Q)", () => {
    expectLayout(setupLayout(7, true, false), "under", [6, 1], { ...BASE["2"], ...GOTO["1+1+1"], ...PLANE });
    expectLayout(setupLayout(8, true, false), "under", [6, 2], { ...BASE["2"], ...GOTO["2+1"], ...PLANE });
    expectLayout(setupLayout(9, true, false), "under", [6, 3], { ...BASE["2"], ...GOTO["3"], ...PLANE });
  });
  it("the plane trio is never split, whatever the row count", () => {
    for (let n = 1; n <= 9; n++) for (const portrait of [false, true])
      expect(setupLayout(n, true, portrait).span).toMatchObject(PLANE);
  });
  it("only a TWP machine has the plane actions", () => {
    for (let n = 1; n <= 9; n++) expect(Object.keys(setupLayout(n, false, false).span).sort())
      .toEqual(["g30", "home", "mcs", "wcs", "zero"]);
  });
});

describe("setupLayout: portrait stays as today", () => {
  it("one axis list, then Zero|Home, the Go to trio and (TWP) the plane trio as rows", () => {
    for (let n = 1; n <= 9; n++) {
      expectLayout(setupLayout(n, false, true), "rows", [n], { ...BASE["2"], ...GOTO["3"] });
      expectLayout(setupLayout(n, true, true), "rows", [n], { ...BASE["2"], ...GOTO["3"], ...PLANE });
    }
  });
});

describe("setupLayout: the six-row budget", () => {
  it("no landscape arrangement needs more than six rows in any column", () => {
    for (let n = 1; n <= 9; n++) for (const twp of [false, true]) {
      const l = setupLayout(n, twp, false);
      expect(Math.max(...l.columns)).toBeLessThanOrEqual(6);
      const rowsOf = (keys: string[]) => keys.reduce((r, k) => r + (l.span[k as keyof typeof l.span] ?? 0) / 6, 0);
      const actionRows = Math.ceil(rowsOf(["zero", "home"])) + Math.ceil(rowsOf(["g30", "mcs", "wcs"]))
        + (twp ? Math.ceil(rowsOf(["capture", "orient", "clear"])) : 0);
      const used = l.form === "under" ? l.columns[l.columns.length - 1]! + actionRows
        : l.form === "rows" ? Math.max(...l.columns) + actionRows : actionRows;
      expect(used, `${n} axes${twp ? " TWP" : ""}`).toBeLessThanOrEqual(6);
    }
  });
});
