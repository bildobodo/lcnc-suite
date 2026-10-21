// Where a limit record stands (Codex R177 VP-I130), on hand-made tracks: by
// its violating stretches (seq), never by its raw line number.
import { describe, expect, it } from "vitest";
import type { LimitViolation } from "../ws/bulkData";
import { buildScrubTrack } from "./scrubTrack";
import { limitPlaces } from "./limitPlaces";
import { buildSimRows, placelessLimitRows } from "./simRows";

// raw lines [1, 5, 6, 3, 5, 6]: a called file (from L2) moves with its 5 and
// 6, then the program's L3, L5, L6; seq 1…6, 4 s a move
const track = (explicit = true) => {
  const t = buildScrubTrack({ pos: new Float32Array() }, {
    pos: Float32Array.from([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0, 50, 0, 0]),
    lines: Uint32Array.from([1, 5, 6, 3, 5, 6]), seq: Uint32Array.from([1, 2, 3, 4, 5, 6]),
    tcum: Float32Array.from([0, 4, 8, 12, 16, 20]) })!;
  if (explicit) { t.lineOk = Uint8Array.from([1, 0, 0, 1, 1, 1]); t.cline = Uint16Array.from([0, 2, 2, 0, 0, 0]); }
  return t;
};
const rec = (o: Partial<LimitViolation>): LimitViolation => ({ line: 5, axis: "X", value: 600, limit: 500, kind: "max", ...o });

describe("limitPlaces", () => {
  it("places a record by its stretch: a called file's L5 at its call L2, the program's L5 at its own move", () => {
    const t = track();
    const p = limitPlaces([rec({ sub: "touch", site: 2, runs: [[2, 2]], nruns: 1 }), rec({ value: 700, runs: [[5, 5]], nruns: 1 })], t, t, false);
    expect(p.targets.map(x => [x.line, x.cum, x.cumEnd, x.recs[0]!.value])).toEqual([[2, 0, 4, 600], [5, 12, 16, 700]]);
    expect(p.bands).toEqual([[0, 4], [12, 16]]);
    expect(p.placeless).toEqual([]);
  });

  it("a record without stretches has no place — no raw number stands in for it, with or without line trust", () => {
    // Codex R177 answer 1: rohe Spur [1,5,6,3…], the program's L5 shown or not
    for (const explicit of [true, false]) {
      const t = track(explicit);
      const p = limitPlaces([rec({})], t, t, false);
      expect(p.targets, `explicit ${explicit}`).toEqual([]);
      expect(p.bands).toEqual([]);
      expect(p.placeless).toEqual([[rec({})]]);
    }
  });

  it("a stretch this track does not hold has no place either", () => {
    const t = track();
    expect(limitPlaces([rec({ runs: [[40, 41]], nruns: 1 })], t, t, false).placeless).toHaveLength(1);
  });

  it("one origin and raw line is one row with its axes; one display line twice is two rows with two keys", () => {
    const t = track();
    const p = limitPlaces([
      rec({ axis: "X", sub: "touch", site: 2, runs: [[2, 2]], nruns: 1 }),
      rec({ axis: "Y", sub: "touch", site: 2, runs: [[2, 2]], nruns: 1 }),
      rec({ line: 6, sub: "touch", site: 2, runs: [[3, 3]], nruns: 1 }),
    ], t, t, false);
    expect(p.targets.map(x => [x.line, x.recs.map(r => `${r.line}${r.axis}`).join(",")])).toEqual([[2, "5X,5Y"], [2, "6X"]]);
    expect(new Set(p.targets.map(x => x.key)).size).toBe(2);
  });

  it("a stretch runs from the start of its first move to the end of its last; the row at the first", () => {
    const t = track();
    const p = limitPlaces([rec({ line: 3, runs: [[4, 4]], nruns: 1 }), rec({ line: 6, runs: [[3, 3], [6, 6]], nruns: 2 })], t, t, false);
    expect(p.bands).toEqual([[4, 8], [8, 12], [16, 20]]);
    // one record over two stretches (raw 6 at seq 3 and 6 — the test's own record): its row at the first,
    // which the program shows at its call L2
    expect(p.targets.map(x => [x.line, x.cum])).toEqual([[2, 4], [3, 8]]);
  });

  it("an untrusted move with no call line reads no line: its subroutine's name or —", () => {
    const t = track(false);
    t.sub = Uint8Array.from([0xff, 0, 0, 0xff, 0xff, 0xff]);
    t.subNames = ["touch"];
    const p = limitPlaces([rec({ runs: [[2, 2]], nruns: 1 })], t, t, false);
    expect(p.targets[0]).toMatchObject({ line: 0, noLine: true, subName: "touch" });
    const rows = buildSimRows({ clash: [], limit: p.targets, tool: [], unit: "mm", timeBased: true, axisEnd: 20 });
    expect(rows.map(r => [r.lineLabel, r.note])).toEqual([["(touch)", "in touch, no line of this program"]]);
  });

  it("the code panel's marks are the placed rows' lines: a call line, the program's own, nothing without a line or a place", () => {
    // Codex R178: no mark on a raw number — not for a record with no place,
    // not for a move no line of the program shows
    const t = track();
    const p = limitPlaces([rec({ sub: "touch", site: 2, runs: [[2, 2]], nruns: 1 }), rec({ value: 700, runs: [[5, 5]], nruns: 1 }),
                           rec({ line: 9, axis: "Y" })], t, t, false);
    expect([...p.lines.keys()].sort()).toEqual([2, 5]);
    expect(p.lines.get(2)!.map(r => r.value)).toEqual([600]);
    const legacy = limitPlaces([rec({})], t, t, false);
    expect([...legacy.lines.keys()], "a record with no place marks nothing — not its raw L5").toEqual([]);
    const u = track(false);
    const unmarked = limitPlaces([rec({ runs: [[2, 2]], nruns: 1 })], u, u, false);
    expect(unmarked.targets[0]!.noLine).toBe(true);
    expect([...unmarked.lines.keys()], "a move no line shows marks nothing").toEqual([]);
  });

  it("the placeless rows say so and carry no position", () => {
    const rows = placelessLimitRows([[rec({}), rec({ axis: "Y", value: 501 })]], "mm");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "limit", lineLabel: "—", at: "—", note: "place not known — reload the program" });
    expect(rows[0]!.what).toBe("X 600 mm > max 500 mm · Y 501 mm > max 500 mm");
    expect(Number.isNaN(rows[0]!.cum)).toBe(true);
  });
});
