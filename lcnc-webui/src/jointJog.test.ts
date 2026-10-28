// Jogging before homing (button gates package E, BG-07): the strip, the
// keyboard and the gamepad refuse a closed axis by one rule (jointJog.ts);
// homed, or without a declaration, nothing changes.
import "./testGlobals";
import { describe, it, expect } from "vitest";
import { AXIS_NOT_DECLARED, jogAxisJoint, jogAxisRefusal, jointJogActive, jointJogNote, type JointJog } from "./jointJog";

const GANTRY = "Gantry axis — jog it after Home All";
const XYYZ: JointJog = {
  enabled: true, fraction: 0.1, reason: null,
  axes: [{ letter: "X", joint: 0, reason: null }, { letter: "Y", joint: null, reason: GANTRY },
         { letter: "Z", joint: 3, reason: null }],
};

describe("jogging before homing", () => {
  it("is active only before homing and where the machine declares it", () => {
    expect(jointJogActive(XYYZ, false)).toBe(true);
    expect(jointJogActive(XYYZ, true)).toBe(false);
    expect(jointJogActive({ ...XYYZ, enabled: false }, false)).toBe(false);
    expect(jointJogActive(null, false)).toBe(false);
  });

  it("names the joint an axis moves for its corner mark, only while jogging joints", () => {
    expect(jogAxisJoint(XYYZ, false, 0)).toBe(0);
    expect(jogAxisJoint(XYYZ, false, 2)).toBe(3);
    expect(jogAxisJoint(XYYZ, false, 1)).toBeNull();      // the gantry letter
    expect(jogAxisJoint(XYYZ, true, 0)).toBeNull();       // homed
    expect(jogAxisJoint({ ...XYYZ, enabled: false }, false, 0)).toBeNull();
    expect(jogAxisJoint(XYYZ, false, -1)).toBeNull();
  });

  it("refuses a closed axis with its reason, never after homing", () => {
    expect(jogAxisRefusal(XYYZ, false, 1)).toBe(GANTRY);
    expect(jogAxisRefusal(XYYZ, false, 0)).toBeNull();
    expect(jogAxisRefusal(XYYZ, false, 7)).toBe(AXIS_NOT_DECLARED);
    expect(jogAxisRefusal(XYYZ, true, 1)).toBeNull();
    expect(jogAxisRefusal({ ...XYYZ, enabled: false }, false, 1)).toBeNull();
  });

  it("states the cap", () => {
    expect(jointJogNote(XYYZ)).toBe("Joint jog — no soft limits · max 10 %");
    expect(jointJogNote({ ...XYYZ, fraction: 0.25 })).toBe("Joint jog — no soft limits · max 25 %");
    expect(jointJogNote({ ...XYYZ, fraction: null })).toBe("Joint jog — no soft limits");
  });
});
