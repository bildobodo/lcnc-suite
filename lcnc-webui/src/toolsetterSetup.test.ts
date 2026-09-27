// Codex review R15 B1: the toolsetter's values reach the machine only when
// SET UP — from the server-confirmed section, raw, before fallbacks.
import { describe, expect, it } from "vitest";
import {
  toolsetterSetup, toolsetterVarMap, TOOLSETTER_REQUIRED, TOOLSETTER_FALLBACK,
  TOOLSETTER_UNSET_REASON, TOOLSETTER_INVALID_REASON, TOOLSETTER_PENDING_REASON,
} from "./toolsetterSetup";
import { TS_POSITION_FIELDS, TS_PROBE_FIELDS } from "./probeFields";

// The server-confirmed side (an optimistic save is no setup, a pending
// server blob neither) is DOM-bound — e2e/toolsetter-setup.spec.ts.
const SET_UP = {
  touchX: 0, touchY: 0, touchZ: -300,             // chosen zero coordinates are allowed
  fastFeed: 200, slowFeed: 0, traverseFeed: 500,  // slow feed 0 skips the second touch
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180,
};

describe("toolsetterSetup", () => {
  it("no section, the reset's empty one and a single saved field are not set up", () => {
    for (const section of [undefined, null, {}, { touchZ: -300 }]) {
      const s = toolsetterSetup(section);
      expect(s.ok).toBe(false);
      if (!s.ok) expect(s.reason).toBe(TOOLSETTER_UNSET_REASON);
    }
    const one = toolsetterSetup({ touchZ: -300 });
    expect(!one.ok && one.missing).toEqual(TOOLSETTER_REQUIRED.filter(k => k !== "touchZ"));
  });

  it("every required field saved and valid is set up; options keep their default (off)", () => {
    const s = toolsetterSetup(SET_UP);
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.values).toEqual({ ...TOOLSETTER_FALLBACK, ...SET_UP });
  });

  it("a saved value outside its field's rule or an option's values is invalid", () => {
    for (const [key, bad] of [["fastFeed", 0], ["retractDist", 0], ["spindleZeroHeight", 0],
                              ["addReps", 2.5], ["spindleStopM", 7], ["brakeAfter", 3],
                              ["offsetValue", 150], ["touchZ", "x"], ["touchX", Number.NaN]] as const) {
      const s = toolsetterSetup({ ...SET_UP, [key]: bad });
      expect(s.ok, key).toBe(false);
      if (!s.ok) {
        expect(s.invalid, key).toEqual([key]);
        expect(s.reason).toBe(TOOLSETTER_INVALID_REASON);
      }
    }
  });

  it("the required list is the form's position and probe fields; reasons fit a hint", () => {
    const fields = [...TS_POSITION_FIELDS, ...TS_PROBE_FIELDS].map(f => f.key);
    expect([...TOOLSETTER_REQUIRED].sort()).toEqual([...fields].sort());
    for (const r of [TOOLSETTER_UNSET_REASON, TOOLSETTER_INVALID_REASON, TOOLSETTER_PENDING_REASON]) {
      expect(r.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("toolsetterVarMap", () => {
  it("writes the var numbers tool_touch_off.ngc reads", () => {
    const s = toolsetterSetup({ ...SET_UP, useToolTable: 1, goBackToStart: 0 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const m = toolsetterVarMap(s.values);
    expect([m["3100"], m["3101"], m["3102"]]).toEqual([0, 0, -300]);
    expect([m["3004"], m["3005"], m["3006"], m["3007"], m["3009"], m["3010"]]).toEqual([200, 0, 500, 180, 2, 180]);
    expect([m["3103"], m["3106"], m["3107"]]).toEqual([1, 0, 5]);
    expect(Object.keys(m)).toHaveLength(23);
  });
});
