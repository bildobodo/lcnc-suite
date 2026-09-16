import { describe, expect, it } from "vitest";
import { TLO_NONE, parseTloEvents, tloForIndex, toolDimsFor, toolForIndex } from "./tloEvents";

describe("tloEvents (schema 8)", () => {
  const evs = parseTloEvents([[3, 0, 0, 22, -1], [3, 0, 0, 22, 3], [9, 0, 0, 0, 3]])!;

  it("parses rows; -1 tool = inherit; absent/empty = no channel", () => {
    expect(evs).toHaveLength(3);
    expect(evs[0]).toEqual({ seq: 3, xyz: [0, 0, 22], tool: null });
    expect(evs[1]!.tool).toBe(3);
    expect(parseTloEvents(undefined)).toBeUndefined();
    expect(parseTloEvents([])).toBeUndefined();
  });

  it("resolves the offset: event when governed, live before the first row, zero when nothing known", () => {
    const live = [1, 2, 5];
    expect(tloForIndex(1, evs, live)).toEqual([0, 0, 22]);
    expect(tloForIndex(2, evs, live)).toEqual([0, 0, 0]);    // G49 = the program asserted zero
    expect(tloForIndex(TLO_NONE, evs, live)).toBe(live);
    expect(tloForIndex(undefined, undefined, live)).toBe(live);
    expect(tloForIndex(TLO_NONE, evs, undefined)).toEqual([0, 0, 0]);
    expect(tloForIndex(7, evs, live)).toBe(live);              // out of range: honest fallback
  });

  it("resolves the tool: event's when named, else the loaded tool, else null", () => {
    expect(toolForIndex(0, evs, 5)).toBe(5);     // row 0 has no M6 yet → inherit
    expect(toolForIndex(1, evs, 5)).toBe(3);
    expect(toolForIndex(TLO_NONE, evs, 5)).toBe(5);
    expect(toolForIndex(TLO_NONE, evs, 0)).toBeNull();
    expect(toolForIndex(TLO_NONE, evs, null)).toBeNull();
  });

  it("tool dims: parse row first, then live, then the 6×60 stub (flagged)", () => {
    const rows = [[3, 0, 0, 22, 6.5], [8, 0, 0, -80, 0]];
    expect(toolDimsFor(3, rows, 1, { diam: 10, len: 10 })).toEqual({ diam: 6.5, len: 22, known: true });
    expect(toolDimsFor(8, rows, 1, { diam: null, len: null })).toEqual({ diam: 6, len: 80, known: true });
    expect(toolDimsFor(9, rows, 1, { diam: 4, len: 30 })).toEqual({ diam: 4, len: 30, known: true });
    expect(toolDimsFor(null, rows, 1, { diam: null, len: null })).toEqual({ diam: 6, len: 60, known: false });
    expect(toolDimsFor(null, undefined, 25.4, { diam: null, len: null }).diam).toBeCloseTo(152.4, 9);
  });
});
