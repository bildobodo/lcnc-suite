import { describe, it, expect } from "vitest";
import { toolOffsetState, toolOffsetWord } from "./toolOffsetState";

const nine = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];

describe("toolOffsetState (operator 2026-10-01)", () => {
  it("G43 with the spindle tool's length is applied", () => {
    const st = toolOffsetState({ tool_number: 13, tool_table_z: 65.04, tool_offset: nine(65.04), gcodes: [430] });
    expect(st).toEqual({ kind: "applied", mode: "G43" });
    expect(toolOffsetWord(st)).toBe("G43");
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
  it("a zero-length tool under G49 needs no offset — and the word says G49, not G43 (Codex R61 VP-I25)", () => {
    const st = toolOffsetState({ tool_number: 3, tool_table_z: 0, tool_offset: nine(0), gcodes: [490] });
    expect(st).toEqual({ kind: "applied", mode: "G49" });
    expect(toolOffsetWord(st)).toBe("G49");
  });
  it("the word is the REPORTED mode: G43.1 of the table's value says G43.1; no mode reported says Applied (VP-I25)", () => {
    expect(toolOffsetWord(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: nine(65), gcodes: [431] }))).toBe("G43.1");
    expect(toolOffsetWord(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: nine(65), gcodes: [432] }))).toBe("G43.2");
    expect(toolOffsetWord(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: nine(65), gcodes: null }))).toBe("Applied");
    expect(toolOffsetWord(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: nine(65), gcodes: [-1, 0, 170, 400, 540] }))).toBe("Applied");
  });
  it("no tool, and a missing field, claim nothing", () => {
    expect(toolOffsetState({ tool_number: 0, tool_table_z: null, tool_offset: nine(0) })).toEqual({ kind: "none" });
    expect(toolOffsetState({ tool_number: null })).toEqual({ kind: "unknown" });
    expect(toolOffsetState({ tool_number: 13, tool_table_z: null, tool_offset: nine(0) })).toEqual({ kind: "unknown" });
    expect(toolOffsetState({ tool_number: 13, tool_table_z: 65, tool_offset: null })).toEqual({ kind: "unknown" });
    expect(toolOffsetWord({ kind: "none" })).toBeNull();
    expect(toolOffsetWord({ kind: "unknown" })).toBeNull();
  });
});
