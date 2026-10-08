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

  it("marks the first limit row as where the run stops at the latest, and every row after it", () => {
    // LinuxCNC refuses a move whose end leaves the window when the move is
    // queued and aborts the running motion: nothing after the first
    // violation runs. A row AT its start (a contact in the pose the move
    // before reached, a tool change before it) is not claimed unreached; the
    // rows stay listed.
    const rows = buildSimRows({
      clash: [clash({ cum: 10, line: 4 }), clash({ cum: 40, line: 9, key: "C9|t|w|0" }),
        clash({ cum: 60, line: 12, reentry: true, key: "C12|t|w|1" })],
      limit: [{ key: "L30", line: 30, cum: 70, cumEnd: 75 }, { key: "L9", line: 9, cum: 40, cumEnd: 45 }],
      tool: [{ key: "T9", line: 9, tool: 2, cum: 40, cumEnd: 45 }, { key: "T20", line: 20, tool: 3, cum: 50, cumEnd: 55 }],
      violations: [], unit: "mm", timeBased: true, axisEnd: 100,
    });
    expect(rows.map(r => [r.key, r.note])).toEqual([
      ["C4|tool|a_yoke_casting|0", ""],
      ["T9", ""],
      ["L9", "the run stops here at the latest"],
      ["C9|t|w|0", ""],
      ["T20", "after the limit stop at L9"],
      ["C12|t|w|1", "re-entry · after the limit stop at L9"],
      ["L30", "after the limit stop at L9"],
    ]);
    // no limit row: nothing is marked
    expect(buildSimRows({ clash: [clash({ cum: 10, line: 4 })], limit: [], tool: [], violations: [],
      unit: "mm", timeBased: true, axisEnd: 20 })[0]!.note).toBe("");
  });

  it("the next row is the first after the position, none past the last", () => {
    const rows = buildSimRows({ clash: [clash({ cum: 10, line: 2 })], limit: [{ key: "L3", line: 3, cum: 20, cumEnd: 21 }],
      tool: [], violations: [], unit: "mm", timeBased: true, axisEnd: 30 });
    expect(nextRowKey(rows, 0)).toBe(rows[0]!.key);
    expect(nextRowKey(rows, 10)).toBe("L3");
    expect(nextRowKey(rows, 25)).toBeNull();
  });
});
