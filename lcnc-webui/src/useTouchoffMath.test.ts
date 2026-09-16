import { describe, it, expect, vi } from "vitest";
import { computed } from "vue";
import { useTouchoffMath, touchoffGate, touchoffTargetLabel } from "./useTouchoffMath";

// The eoffset arithmetic and the kins-mode routing now live on the gateway
// (`touchoff` command, command_policy.touchoff_route); the client names the
// letters and picks the gate CLASS. These tests pin that contract.

function harness(axes: string[]) {
  const fire = vi.fn();
  const t = useTouchoffMath({ axes: computed(() => axes), fire });
  return { fire, t };
}

describe("useTouchoffMath", () => {
  it("setAxis resolves the letter through the MACHINE's axis list (lathe index 1 = Z)", () => {
    const { fire, t } = harness(["X", "Z"]);
    t.setAxis(1, 0);
    expect(fire).toHaveBeenCalledWith({ cmd: "touchoff", axes: { Z: 0 } }, "touchoff");
  });

  it("does not add the eoffset itself — the gateway does (and refuses when undelivered)", () => {
    const { fire, t } = harness(["X", "Y", "Z"]);
    t.setAxis(2, 5);
    expect(fire.mock.calls[0]![0]).toEqual({ cmd: "touchoff", axes: { Z: 5 } });
  });

  it("rotary letters go out under touchoffRotary", () => {
    const { fire, t } = harness(["X", "Y", "Z", "A", "C"]);
    t.setAxis(3, 0);
    expect(fire).toHaveBeenCalledWith({ cmd: "touchoff", axes: { A: 0 } }, "touchoffRotary");
  });

  it("out-of-range index is a no-op", () => {
    const { fire, t } = harness(["X", "Y", "Z"]);
    t.setAxis(7, 0);
    expect(fire).not.toHaveBeenCalled();
  });

  it("setAll zeroes the given letters in ONE command (linear only → touchoff)", () => {
    const { fire, t } = harness(["X", "Y", "Z", "A", "C"]);
    t.setAll(["X", "Y", "Z"]);
    expect(fire).toHaveBeenCalledWith(
      { cmd: "touchoff", axes: { X: 0, Y: 0, Z: 0 } }, "touchoff");
  });

  it("setAll with no letters zeroes every configured axis under the rotary gate", () => {
    const { fire, t } = harness(["X", "Z", "A"]);
    t.setAll();
    expect(fire).toHaveBeenCalledWith(
      { cmd: "touchoff", axes: { X: 0, Z: 0, A: 0 } }, "touchoffRotary");
  });

  it("setAll ignores letters the machine does not have", () => {
    const { fire, t } = harness(["X", "Z"]);
    t.setAll(["X", "Y", "Z"]);
    expect(fire).toHaveBeenCalledWith({ cmd: "touchoff", axes: { X: 0, Z: 0 } }, "touchoff");
  });

  it("touchoffGate: a mixed request takes the stricter (rotary) class", () => {
    expect(touchoffGate(["X", "A"])).toBe("touchoffRotary");
    expect(touchoffGate(["X", "U"])).toBe("touchoff");
    expect(touchoffGate([])).toBe("touchoff");
  });

  it("carries the expected target when given (U-03)", () => {
    const { fire, t } = harness(["X", "Y", "Z"]);
    t.setAxis(2, 5, { kins_type: 2, g5x_index: 6 });
    expect(fire.mock.calls[0]![0]).toEqual({ cmd: "touchoff", axes: { Z: 5 }, expect: { kins_type: 2, g5x_index: 6 } });
    t.setAll(["X", "Y"], { kins_type: 0, g5x_index: 1 });
    expect(fire.mock.calls[1]![0]).toEqual({ cmd: "touchoff", axes: { X: 0, Y: 0 }, expect: { kins_type: 0, g5x_index: 1 } });
    t.setAxis(0, 1);
    expect(fire.mock.calls[2]![0]).toEqual({ cmd: "touchoff", axes: { X: 1 } });
  });
});

describe("touchoffTargetLabel (U-03)", () => {
  it("names axis, frame and datum in every mode", () => {
    expect(touchoffTargetLabel("z", { kinsType: 2, g5xLabel: "G59", twpActive: true })).toBe("Touch off Z · Plane · updates G54");
    expect(touchoffTargetLabel("Z", { kinsType: 2, g5xLabel: "G54", twpActive: false })).toBe("Touch off Z · TOOL kins, no plane");
    expect(touchoffTargetLabel("X", { kinsType: 1, g5xLabel: "G55" })).toBe("Touch off X · TCP · G55");
    expect(touchoffTargetLabel("A", { kinsType: 0, g5xLabel: "G54" })).toBe("Touch off A · Machine · G54");
    expect(touchoffTargetLabel("Z", { kinsType: null, g5xLabel: "G54" })).toBe("Touch off Z · G54");
    expect(touchoffTargetLabel("Z", { kinsType: 7, g5xLabel: "G54" })).toBe("Touch off Z · kins 7 · G54");
  });
});
