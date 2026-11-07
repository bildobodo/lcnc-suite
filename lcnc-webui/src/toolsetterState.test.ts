// The toolsetter form's machine state (P2, Codex R309 FI308-04): projected
// from the server's confirmed section and the gateway's booking — never from
// a reply or a local wait list.
import { describe, expect, it } from "vitest";
import { toolsetterMachineState, toolsetterMachineText, type ToolsetterMachineState } from "./toolsetterState";
import { toolsetterSetup, toolsetterVarMap } from "./toolsetterSetup";
import type { ToolsetterBooking } from "./ws/statusStore";
import contract from "./toolsetterRules.contract.json";

const SECTION = { touchX: 10, touchY: 10, touchZ: -179, fastFeed: 2000, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 3, spindleZeroHeight: 180 };
const setup = toolsetterSetup(SECTION);
const want = setup.ok ? toolsetterVarMap(setup.values) : {};

function booking(origin: string | ((k: string) => string), over: Record<string, number | null> = {}): ToolsetterBooking {
  const keys: ToolsetterBooking["keys"] = {};
  for (const [k, v] of Object.entries(want)) {
    keys[k] = { value: k in over ? over[k]! : v, origin: typeof origin === "string" ? origin : origin(k) };
  }
  keys["3014"] = { value: 99, origin: "applied" };     // the preview's booking has #3014 too: not the form's
  return { version: 4, keys };
}

describe("toolsetterMachineState", () => {
  it("every value equal and applied or read: confirmed in the machine", () => {
    expect(toolsetterMachineState(setup, booking("read")).kind).toBe("confirmed");
    expect(toolsetterMachineState(setup, booking(k => (Number(k) % 2 ? "read" : "applied"))).kind).toBe("confirmed");
  });
  it("confirmed values, one differs: saved, not yet in the machine", () => {
    const s = toolsetterMachineState(setup, booking("applied", { "3102": -180 }));
    expect(s).toEqual({ kind: "pending", differ: ["3102"] });
  });
  it("equal numbers only assumed: not confirmed — the file's numbers are no proof", () => {
    const s = toolsetterMachineState(setup, booking("assumed"));
    expect(s.kind).toBe("unconfirmed");
    expect(s.kind === "unconfirmed" && s.confirmed).toBe(0);
  });
  it("one key unknown beside taken ones: not confirmed, the part named", () => {
    const s = toolsetterMachineState(setup, booking(k => (k === "3102" ? "unknown" : "applied")));
    expect(s).toEqual({ kind: "unconfirmed", confirmed: 22, total: 23, differ: [] });
  });
  it("not set up: no sync — whatever the machine holds", () => {
    expect(toolsetterMachineState(toolsetterSetup({}), booking("read")).kind).toBe("not_set_up");
  });
  it("no booking on this connection yet: not known", () => {
    expect(toolsetterMachineState(setup, null).kind).toBe("unknown");
    expect(toolsetterMachineState(setup, undefined).kind).toBe("unknown");
  });
  it("the numbers the gateway sent, exact ties included, are confirmed — applied or read (Codex R311 FI-I39)", () => {
    // the contract's tie case: the gateway's canonical numbers, as it books them
    const tie = contract.cases.find(c => c.ok && (c.section as Record<string, unknown>).touchZ === -179.0078125)!;
    const tieSetup = toolsetterSetup(tie.section);
    for (const origin of ["applied", "read"]) {
      const keys: ToolsetterBooking["keys"] = {};
      for (const [k, v] of Object.entries(tie.values!)) keys[k] = { value: v, origin };
      expect(toolsetterMachineState(tieSetup, { version: 1, keys }).kind, origin).toBe("confirmed");
    }
  });
  it("a value with more than six decimals compares as the number the machine got", () => {
    const fine = toolsetterSetup({ ...SECTION, touchZ: -179.1234567 });
    const sent = fine.ok ? toolsetterVarMap(fine.values) : {};
    const keys: ToolsetterBooking["keys"] = {};
    for (const [k, v] of Object.entries(sent)) keys[k] = { value: Number(v.toFixed(6)), origin: "applied" };
    expect(toolsetterMachineState(fine, { version: 1, keys }).kind).toBe("confirmed");
  });
});

describe("toolsetterMachineText", () => {
  // operator 2026-11-07: the line names WHERE the values count — LinuxCNC's
  // parameters, which the measurement reads; ≤ 90 characters each
  const states: ToolsetterMachineState[] = [{ kind: "confirmed" }, { kind: "pending", differ: ["3102"] },
    { kind: "unconfirmed", confirmed: 22, total: 23, differ: [] }, { kind: "not_set_up" }, { kind: "unknown" }];
  it.each(states)("$kind names the LinuxCNC parameters, never 'the machine'", s => {
    const text = toolsetterMachineText(s);
    expect(text).toContain("LinuxCNC parameters");
    expect(text).not.toMatch(/machine/i);
    expect(text.length).toBeLessThanOrEqual(90);
  });
});
