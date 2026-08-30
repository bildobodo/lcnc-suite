import { describe, it, expect, vi } from "vitest";
import { computed } from "vue";
import { useTouchoffMath, touchoffGate } from "./useTouchoffMath";

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
});
