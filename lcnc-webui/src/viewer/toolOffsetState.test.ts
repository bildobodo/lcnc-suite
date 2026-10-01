import { describe, it, expect } from "vitest";
import { toolOffsetState, toolOffsetWord } from "./toolOffsetState";

const nine = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];

describe("toolOffsetState (operator 2026-10-01)", () => {
  it("G43 with the spindle tool's length is applied", () => {
    expect(toolOffsetState({ tool_number: 13, tool_table_z: 65.04, tool_offset: nine(65.04), gcodes: [430] })).toEqual({ kind: "applied" });
  });
  it("G49 with a tool in the spindle is off — the control point is the spindle nose", () => {
    const st = toolOffsetState({ tool_number: 13, tool_table_z: 65.04, tool_offset: nine(0), gcodes: [490] });
    expect(st).toEqual({ kind: "off", g49: true });
    expect(toolOffsetWord(st)).toBe("Off (G49)");
  });
  it("another offset in effect (G43 H7, G43.1) is named", () => {
    const st = toolOffsetState({ tool_number: 13, tool_table_z: 65.04, tool_offset: nine(42), gcodes: [430] });
    expect(st).toEqual({ kind: "other", z: 42 });
    expect(toolOffsetWord(st)).toBe("Other offset");
  });
  it("a zero-length tool under G49 needs no offset", () => {
    expect(toolOffsetState({ tool_number: 3, tool_table_z: 0, tool_offset: nine(0), gcodes: [490] })).toEqual({ kind: "applied" });
  });
  it("no tool, and a missing field, claim nothing", () => {
    expect(toolOffsetState({ tool_number: 0, tool_table_z: null, tool_offset: nine(0) })).toEqual({ kind: "none" });
    expect(toolOffsetState({ tool_number: null })).toEqual({ kind: "unknown" });
    expect(toolOffsetState({ tool_number: 13, tool_table_z: null, tool_offset: nine(0) })).toEqual({ kind: "unknown" });
    expect(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: null })).toEqual({ kind: "unknown" });
    expect(toolOffsetWord({ kind: "applied" })).toBeNull();
  });
});
