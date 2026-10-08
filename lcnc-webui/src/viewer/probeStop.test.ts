// M600 in the preview: the words every surface reads for a tool measurement
// the preview cannot predict (payload `probe_unpredicted`) and for a length
// the routine took from the table (`toollen_table`).
import { describe, expect, it } from "vitest";
import { firstProbeStopSeq, m600ToolNotes, parseProbeStops, probeStopTitle, probeStopWhy, toolsetterBasisLine } from "./probeStop";
import { fmtClock } from "../format";
import { buildSimRows } from "./simRows";

describe("probe stops", () => {
  it("parses the wire rows in seq order and drops malformed ones", () => {
    expect(parseProbeStops([[40, 3, "travel"], [14, 2, "length"], ["x", 1, "feed"], [5.5, 1, "feed"], [-1, 1, "feed"], "no"]))
      .toEqual([{ seq: 14, tool: 2, reason: "length" }, { seq: 40, tool: 3, reason: "travel" }]);
    expect(parseProbeStops(undefined)).toEqual([]);
    expect(parseProbeStops([[7]])).toEqual([{ seq: 7, tool: -1, reason: "" }]);
    expect(firstProbeStopSeq([[40, 3, "travel"], [14, 2, "length"]])).toBe(14);
    expect(firstProbeStopSeq([])).toBeUndefined();
  });

  it("says why in words, for every reason the routine and the gateway write", () => {
    const why = (reason: string, tool = 2) => probeStopWhy({ tool, reason });
    expect(why("length")).toBe("T2 has no length in the table");
    expect(why("setter_z")).toBe("the tool setter lies above machine Z0");
    expect(why("travel")).toBe("T2's table length does not trip within the probe's travel");
    expect(why("feed")).toBe("the probe feed is not positive");
    expect(why("retract")).toBe("the probe retract is not positive");
    expect(why("slow_limit")).toBe("the slow probe would end past the Z limit");
    expect(why("toolsetter_unknown", -1)).toBe("the toolsetter values are not confirmed");
    expect(why("toolsetter_not_set_up", -1)).toBe("the toolsetter is not set up");
    expect(why("foreign_remap", -1)).toBe("the tool change remap is not the suite's routine");
    expect(why("length", -1)).toBe("the tool has no length in the table");
    // a word this client does not know is still a stop, said as it came
    expect(why("newer_reason")).toBe("not predicted: newer_reason");
    expect(probeStopTitle({ tool: 2, reason: "length" })).toBe("Tool measurement not predicted (T2 has no length in the table)");
  });

  it("notes a tool's length as the table's, never as measured — and a stop's reason over it", () => {
    const notes = m600ToolNotes(parseProbeStops([[30, 3, "travel"], [50, -1, "toolsetter_unknown"]]),
                                [[22, 2, 80], [60, 3, 10], [70, 0, 5], ["x", 4, 1]], "mm");
    expect([...notes]).toEqual([
      [3, "measurement not predicted: T3's table length does not trip within the probe's travel"],
      [2, "80.000 mm from the table (assumed)"],
    ]);
    for (const n of notes.values()) expect(n).not.toMatch(/measured(?! ?not)/i);
  });

  it("puts the note on the tool's change rows", () => {
    const rows = buildSimRows({
      clash: [], limit: [], violations: [], unit: "mm", timeBased: true, axisEnd: 10,
      tool: [{ key: "T3", line: 3, tool: 2, cum: 1, cumEnd: 2 }, { key: "T7", line: 7, tool: 5, cum: 4, cumEnd: 5 }],
      toolNotes: m600ToolNotes([], [[22, 2, 65.04]], "mm"),
    });
    expect(rows.map(r => [r.what, r.note])).toEqual([
      ["Tool change → T2", "65.040 mm from the table (assumed)"],
      ["Tool change → T5", ""],
    ]);
  });

  it("says where the toolsetter values come from, and when the Settings hold others", () => {
    const t = 1760000000;
    const base = { routine: true, t, values: { "3009": 3, "3102": -180 } };
    expect(toolsetterBasisLine({ ...base, state: "confirmed", origin: "applied" }))
      .toBe(`Toolsetter values taken over ${fmtClock(t * 1000)}`);
    expect(toolsetterBasisLine({ ...base, state: "confirmed", origin: "read" }))
      .toBe(`Toolsetter values read ${fmtClock(t * 1000)}`);
    expect(toolsetterBasisLine({ ...base, state: "assumed" }))
      .toBe("Toolsetter values assumed from the parameter file — not verified");
    // unknown / never stored: the stop says it
    expect(toolsetterBasisLine({ ...base, state: "unknown" })).toBeNull();
    expect(toolsetterBasisLine({ ...base, state: "confirmed", routine: false })).toBeNull();
    expect(toolsetterBasisLine(undefined)).toBeNull();
    // the confirmed Settings section holds another value: the next
    // measurement the WebUI starts takes it over
    expect(toolsetterBasisLine({ ...base, state: "confirmed", origin: "read" }, { "3009": 3, "3102": -170 }))
      .toBe(`Toolsetter values read ${fmtClock(t * 1000)}. Settings has newer values — the next measurement the WebUI starts takes them over`);
    expect(toolsetterBasisLine({ ...base, state: "confirmed", origin: "read" }, { "3009": 3, "3102": -180 }))
      .toBe(`Toolsetter values read ${fmtClock(t * 1000)}`);
  });
});

