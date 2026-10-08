import { describe, expect, it } from "vitest";
import { buildSimRows, nextRowKey, partLabel } from "./simRows";
import type { ClashTarget } from "./clashTargets";

const clash = (o: Partial<ClashTarget> & { cum: number; line: number }): ClashTarget =>
  ({ cumEnd: o.cum, key: `C${o.line}|tool|a_yoke_casting|0`, a: "spindle_nose", b: "a_yoke_casting", ...o });

describe("simRows", () => {
  it("names a body as the operator reads it", () => {
    expect(partLabel("spindle_nose")).toBe("Spindle nose");
    expect(partLabel("a_yoke_casting")).toBe("A yoke casting");
    expect(partLabel("tool")).toBe("Tool");
    expect(partLabel("c_faceplate")).toBe("C faceplate");
  });

  it("one row per timeline mark, in timeline order, each kind with its own words", () => {
    const rows = buildSimRows({
      clash: [clash({ cum: 25, line: 7 }), clash({ cum: 174, line: 42, rapid: true, a: "spindle_cartridge", b: "c_faceplate", key: "C42|x|y|0" })],
      limit: [{ key: "L23", line: 23, cum: 93, cumEnd: 97 }],
      tool: [{ key: "T30", line: 30, tool: 3, cum: 123, cumEnd: 127 }],
      violations: [{ line: 23, axis: "Y", value: 512, limit: 500, kind: "max" }, { line: 23, axis: "A", value: 112, limit: 50, kind: "max" }],
      unit: "mm", timeBased: true, axisEnd: 250,
    });
    expect(rows.map(r => [r.kind, r.lineLabel, r.at])).toEqual([
      ["clash", "L7", "00:25"], ["limit", "L23", "01:33"], ["tool", "L30", "02:03"], ["clash", "L42", "02:54"]]);
    expect(rows[0]!.what).toBe("Spindle nose ↔ A yoke casting");
    expect(rows[0]!.rapid).toBe(false);
    expect(rows[3]!.rapid).toBe(true);
    expect(rows[1]!.what).toBe("Y 512 mm > max 500 mm · A 112° > max 50°");
    expect(rows[2]!.what).toBe("Tool change → T3");
    expect(rows[1]!.rapid).toBeNull();
  });

  it("says a re-entry, a near miss, a contact through later lines, and the entry move", () => {
    const [a, b, c] = buildSimRows({
      clash: [clash({ cum: 1, line: 5, entry: true, key: "E5|t|w|0" }), clash({ cum: 2, line: 5, reentry: true, key: "C5|t|w|1" }),
        clash({ cum: 3, line: 6, dist: 1.5, spanEndLine: 9, key: "C6|t|w|0" })],
      limit: [], tool: [], violations: [], unit: "mm", timeBased: false, axisEnd: 4,
    });
    expect(a!.lineLabel).toBe("entry");
    expect(b!.note).toBe("re-entry");
    expect(c!.note).toBe("near miss, 1.5 mm apart · through L9");
    expect([a!.at, c!.at]).toEqual(["25 %", "75 %"]);
  });

  it("marks the rows after the first point a move ends beyond the window — the latest the run reaches", () => {
    // LinuxCNC refuses a move whose end leaves the window when it is queued
    // and aborts what runs: nothing after it runs. The boundary is the first
    // track point flagged outside (here the end of L9's move at 45): a row
    // starting after it is marked, one at or before it is not — a tool
    // change and a contact at L9's start included; every row stays listed.
    const rows = buildSimRows({
      clash: [clash({ cum: 10, line: 4 }), clash({ cum: 40, line: 9, key: "C9|t|w|0" }),
        clash({ cum: 45, line: 9, reentry: true, key: "C9|t|w|1" }),
        clash({ cum: 60, line: 12, reentry: true, key: "C12|t|w|1" })],
      limit: [{ key: "L30", line: 30, cum: 70, cumEnd: 75 }, { key: "L9", line: 9, cum: 40, cumEnd: 45 }],
      tool: [{ key: "T9", line: 9, tool: 2, cum: 40, cumEnd: 45 }, { key: "T20", line: 20, tool: 3, cum: 50, cumEnd: 55 }],
      violations: [], unit: "mm", timeBased: true, axisEnd: 100, stop: { cum: 45, line: 9 },
    });
    expect(rows.map(r => [r.key, r.note])).toEqual([
      ["C4|tool|a_yoke_casting|0", ""],
      ["T9", ""],
      ["L9", "first predicted limit crossing — where the run stops is not determined"],
      ["C9|t|w|0", ""],
      ["C9|t|w|1", "re-entry"],                       // AT the boundary: the pose reached there
      ["T20", "after the first limit crossing at L9"],
      ["C12|t|w|1", "re-entry · after the first limit crossing at L9"],
      ["L30", "after the first limit crossing at L9"],
    ]);
    // no flags, no claim
    expect(buildSimRows({ clash: [clash({ cum: 10, line: 4 })], limit: [{ key: "L3", line: 3, cum: 5, cumEnd: 6 }],
      tool: [], violations: [], unit: "mm", timeBased: true, axisEnd: 20 }).map(r => r.note)).toEqual(["", ""]);
  });

  it("an arc whose ends lie inside the window stops where it crosses, not at its line's start (Codex R96 VP-I55)", () => {
    // G2 from Z40 over Z60 back to Z40, max Z 50 (Codex's case): the limit
    // row starts at 0, the first point beyond the window comes at 9.72 s.
    // A contact at 1 s (Z 40.14) is reached; one at 12 s is not.
    const rows = buildSimRows({
      clash: [clash({ cum: 1, line: 3, key: "C3|t|w|0" }), clash({ cum: 12, line: 3, reentry: true, key: "C3|t|w|1" })],
      limit: [{ key: "L3", line: 3, cum: 0, cumEnd: 30 }], tool: [],
      violations: [], unit: "mm", timeBased: true, axisEnd: 30, stop: { cum: 9.7183, line: 3 },
    });
    expect(rows.map(r => [r.key, r.note])).toEqual([
      ["L3", "first predicted limit crossing — where the run stops is not determined"],
      ["C3|t|w|0", ""],
      ["C3|t|w|1", "re-entry · after the first limit crossing at L3"],
    ]);
  });

  it("the next row is the first after the position, none past the last", () => {
    const rows = buildSimRows({ clash: [clash({ cum: 10, line: 2 })], limit: [{ key: "L3", line: 3, cum: 20, cumEnd: 21 }],
      tool: [], violations: [], unit: "mm", timeBased: true, axisEnd: 30 });
    expect(nextRowKey(rows, 0)).toBe(rows[0]!.key);
    expect(nextRowKey(rows, 10)).toBe("L3");
    expect(nextRowKey(rows, 25)).toBeNull();
  });
});
