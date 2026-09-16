import { describe, expect, it } from "vitest";
import {
  NO_LINE, buildLineIndex, emptyLineIndex, lineCumOf, lineHas, lineIndexLines,
  lineIndexTransferables, lineMaskFrom, lineMaskHas, lineMaskLines, lineRange,
} from "./lineIndex";

describe("lineIndex", () => {
  it("indexes first/last point per line and cum at the first point (line 0 never mapped)", () => {
    const idx = buildLineIndex(new Uint32Array([0, 4, 7, 7, 9]), new Float32Array([0, 1, 2, 3, 4]));
    expect(idx.maxLine).toBe(9);
    expect(idx.count).toBe(4);
    expect(lineRange(idx, 7)).toEqual({ start: 2, end: 3 });
    expect(lineRange(idx, 4)).toEqual({ start: 1, end: 1 });
    expect(lineRange(idx, 0)).toEqual({ start: 0, end: 0 });   // buildLineMap parity
    expect(lineRange(idx, 5)).toBeUndefined();
    expect(lineHas(idx, 9)).toBe(true);
    expect(lineHas(idx, 10)).toBe(false);
    expect(lineHas(idx, -1)).toBe(false);
    expect(lineCumOf(idx, 7)).toBe(2);       // first occurrence
    expect(lineCumOf(idx, 0)).toBeUndefined();
    expect(lineCumOf(idx, 5)).toBeUndefined();
    expect(idx.start[5]).toBe(NO_LINE);
    expect(lineIndexLines(idx)).toEqual([0, 4, 7, 9]);
  });

  it("empty input → empty index with no cum; a fresh instance each time", () => {
    const a = buildLineIndex(undefined);
    const b = emptyLineIndex();
    expect(a.maxLine).toBe(-1);
    expect(lineHas(a, 0)).toBe(false);
    expect(lineCumOf(a, 1)).toBeUndefined();
    expect(a.start).not.toBe(b.start);
    expect(lineIndexTransferables(buildLineIndex([]))).toEqual([]);
  });

  it("transferables list every distinct buffer (start, end, cum)", () => {
    const idx = buildLineIndex([1, 2], [0, 5]);
    expect(lineIndexTransferables(idx)).toHaveLength(3);
    expect(lineIndexTransferables(buildLineIndex([1, 2]))).toHaveLength(2);
    expect(lineIndexTransferables(null)).toEqual([]);
  });

  it("line masks replace the trusted-lines Set", () => {
    const m = lineMaskFrom([4, 7, 9, 12]);
    expect(m.length).toBe(13);
    expect(lineMaskHas(m, 7)).toBe(true);
    expect(lineMaskHas(m, 8)).toBe(false);
    expect(lineMaskHas(m, 13)).toBe(false);
    expect(lineMaskHas(null, 4)).toBe(false);
    expect(lineMaskLines(m)).toEqual([4, 7, 9, 12]);
  });

  it("refuses an absurd line number instead of allocating for it", () => {
    expect(() => buildLineIndex([1, 4_000_000_000])).toThrow(/exceeds/);
  });
});
