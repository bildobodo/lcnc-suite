// M600 in the preview: the words every surface reads for a tool measurement
// the preview cannot predict (payload `probe_unpredicted`) and for a length
// the routine took from the table (`toollen_table`).
import { describe, expect, it } from "vitest";
import { conditionalHelp, firstProbeStopSeq, parseProbeBands, parseProbeNotes, probeNoteWhy, m600Events, m600StatsText, m600ToolNotes, parseProbeStops, probeStopTitle, probeStopWhy,
         toolsetterBasisLine } from "./probeStop";
import { fmtClock } from "../format";
import { buildSimRows } from "./simRows";

describe("probe stops", () => {
  it("parses the wire rows in seq order and drops malformed ones", () => {
    expect(parseProbeStops([[40, 3, "travel", 6], [14, 2, "length"], ["x", 1, "feed"], [5.5, 1, "feed"], [-1, 1, "feed"], "no"]))
      .toEqual([{ seq: 14, tool: 2, reason: "length", line: 0 }, { seq: 40, tool: 3, reason: "travel", line: 6 }]);
    expect(parseProbeStops(undefined)).toEqual([]);
    expect(parseProbeStops([[7]])).toEqual([{ seq: 7, tool: -1, reason: "", line: 0 }]);
    // a line that is no positive integer names no call
    expect(parseProbeStops([[7, 2, "length", -3], [8, 2, "length", 2.5], [9, 2, "length", "4"]]).map(s => s.line))
      .toEqual([0, 0, 0]);
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

  it("notes a length as the table's, never as measured — and a stop's reason", () => {
    const ev = m600Events(parseProbeStops([[30, 3, "travel", 5], [50, -1, "toolsetter_unknown", 0]]),
                          [[22, 2, 80, 3], [60, 3, 10, 0], [70, 0, 5, 9], ["x", 4, 1, 9]], "mm");
    // in execution order; a stop without a tool (the values unknown) is the summary's
    expect(ev.map(e => [e.seq, e.tool, e.line, e.note])).toEqual([
      [22, 2, 3, "80.000 mm from the table (assumed)"],
      [30, 3, 5, "measurement not predicted: T3's table length does not trip within the probe's travel"],
      [60, 3, 0, "10.000 mm from the table (assumed)"],
    ]);
    for (const e of ev) expect(e.note).not.toMatch(/measured(?! ?not)/i);
    expect(m600StatsText(ev, "mm")).toBe("T2 80.000 mm (L3), T3 not predicted (L5), T3 10.000 mm (line not known)");
  });

  // Codex R105 VP-I63: a note belongs to the CALL it came from — the same
  // tool measured twice, a success before a stop, an ordinary M6 of the same
  // number before an M600 are other calls.
  const rowsOf = (tool: { key: string; line: number; tool: number }[], notes: ReturnType<typeof m600ToolNotes>) =>
    buildSimRows({ clash: [], limit: [], violations: [], unit: "mm", timeBased: true, axisEnd: 10,
                   tool: tool.map((t, i) => ({ ...t, cum: i, cumEnd: i + 0.5 })), toolNotes: notes.byLine })
      .map(r => [r.what, r.note]);

  it("puts a note on its own call's row only", () => {
    // T2 at L3 predicted, #3007=1, T2 at L6 not (the native repeat_same_tool payload's events)
    const ev = m600Events(parseProbeStops([[42, 2, "travel", 6]]), [[22, 2, 80, 3]], "mm");
    const notes = m600ToolNotes(ev);
    expect(notes.unbound).toEqual([]);
    expect(rowsOf([{ key: "T3", line: 3, tool: 2 }, { key: "T6", line: 6, tool: 2 }], notes)).toEqual([
      ["Tool change → T2", "80.000 mm from the table (assumed)"],
      ["Tool change → T2", "measurement not predicted: T2's table length does not trip within the probe's travel"],
    ]);
    // an ordinary M6 of the same tool before the M600: no note
    const one = m600ToolNotes(m600Events([], [[22, 2, 65.04, 5]], "mm"));
    expect(rowsOf([{ key: "T2", line: 2, tool: 2 }, { key: "T5", line: 5, tool: 2 }], one)).toEqual([
      ["Tool change → T2", ""],
      ["Tool change → T2", "65.040 mm from the table (assumed)"],
    ]);
    // a row of another tool on the line takes nothing
    expect(rowsOf([{ key: "T5", line: 5, tool: 7 }], one)).toEqual([["Tool change → T7", ""]]);
  });

  it("names a measurement in general where its call line is not verified, or its runs differ", () => {
    // two M600 lines whose calls are not verified: no row carries either
    const unv = m600ToolNotes(m600Events(parseProbeStops([[42, 2, "travel", 0]]), [[22, 2, 80, 0]], "mm"));
    expect(unv.byLine.size).toBe(0);
    expect(unv.unbound.map(e => e.seq)).toEqual([22, 42]);
    expect(rowsOf([{ key: "T3", line: 3, tool: 2 }, { key: "T6", line: 6, tool: 2 }], unv))
      .toEqual([["Tool change → T2", ""], ["Tool change → T2", ""]]);
    // one line run twice (a loop) — predicted, then not: no single note is true
    const loop = m600ToolNotes(m600Events(parseProbeStops([[42, 2, "travel", 4]]), [[22, 2, 80, 4]], "mm"));
    expect(loop.byLine.has(4)).toBe(false);
    expect(loop.unbound.map(e => e.seq)).toEqual([22, 42]);
    // run twice saying the same: one note
    const same = m600ToolNotes(m600Events([], [[22, 2, 80, 4], [52, 2, 80, 4]], "mm"));
    expect(same.byLine.get(4)).toEqual({ tool: 2, note: "80.000 mm from the table (assumed)" });
    expect(same.unbound).toEqual([]);
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


describe("braking ranges and notes (parity-ef plan F2/F3)", () => {
  it("parses ranges and notes, dropping malformed rows", () => {
    expect(parseProbeBands([[16, 30, 2, 3], [40, 39, 2, 3], ["x"], [50, 60, 7]]))
      .toEqual([{ seqStart: 16, seqEnd: 30, tool: 2, line: 3 }, { seqStart: 50, seqEnd: 60, tool: 7, line: 0 }]);
    expect(parseProbeNotes([[14, 2, "retract", 3], [-1, 2, "x", 3]]))
      .toEqual([{ seq: 14, tool: 2, reason: "retract", line: 3 }]);
    expect(parseProbeBands(null)).toEqual([]);
  });

  it("a note goes on the measurement it precedes, of its tool", () => {
    const ev = m600Events([], [[30, 2, 80, 3], [70, 7, 66, 9]], "mm",
                          [{ seq: 14, tool: 2, reason: "retract", line: 3 }, { seq: 50, tool: 7, reason: "brake_unknown", line: 9 }]);
    expect(ev.map(e => e.note)).toEqual([
      "80.000 mm from the table (assumed); the retract may not clear the probe after braking — the slow probe may start tripped and LinuxCNC stops",
      "66.000 mm from the table (assumed); the braking range is not modeled (the configuration lacks the Z limits) — not checked below the trip point",
    ]);
  });

  it("the help of a conditional row: the assumption, no number", () => {
    expect(conditionalHelp([7])).toBe("After the measurement at L7, this path assumes the table length and the modeled "
      + "successful probe sequence. Probe timing and the resulting tool offset are not verified.");
    expect(conditionalHelp([0])).toMatch(/^After the measurement, /);
    expect(probeNoteWhy({ reason: "slow_limit" })).toMatch(/may end below the Z limit/);
  });
});

describe("probe warnings reach Program Stats (Codex R126 VP-I75)", () => {
  it("a measurement without a verified line keeps its warning in the stats", () => {
    const ev = m600Events([], [[30, 2, 80, 0]], "mm", [{ seq: 14, tool: 2, reason: "brake_unknown", line: 0 }]);
    const { unbound } = m600ToolNotes(ev);
    expect(unbound).toHaveLength(1);
    expect(m600StatsText(ev, "mm")).toBe("T2 80.000 mm (line not known) — the braking range is not modeled "
      + "(the configuration lacks the Z limits) — not checked below the trip point");
  });

  it("two runs of one call line stay apart, each with its own warnings", () => {
    // a loop: the first call warns (a 2 mm retract), the second does not
    const ev = m600Events([], [[30, 2, 80, 5], [70, 2, 80, 5]], "mm", [{ seq: 14, tool: 2, reason: "retract", line: 5 }]);
    expect(m600ToolNotes(ev).unbound).toHaveLength(2);
    expect(m600StatsText(ev, "mm")).toBe("T2 80.000 mm (L5) — the retract may not clear the probe after braking — "
      + "the slow probe may start tripped and LinuxCNC stops, T2 80.000 mm (L5)");
  });
});
