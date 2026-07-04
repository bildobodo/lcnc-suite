// useTouchoffMath (WS-D regression) — axis resolution must go through the
// MACHINE's axis list. The pre-WS-D code did AXIS_LETTERS[axis] against the
// canonical "XYZABCUVW" string and hardcoded the Z-eoffset guard to index 2:
// on a lathe ["X","Z"], setAxis(1) emitted G10 ... Y… (wrong axis!) and the
// eoffset compensation never applied to Z.
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { useTouchoffMath } from "./useTouchoffMath";

function harness(axes: string[], eoffsetZ?: number) {
  const fire = vi.fn();
  const t = useTouchoffMath({
    axes: computed(() => axes),
    st: ref({ eoffset_z: eoffsetZ } as any),
    fire,
  });
  return { fire, ...t };
}

describe("setAxis", () => {
  it("lathe [X,Z]: index 1 touches off Z (with eoffset), not Y", () => {
    const { fire, setAxis } = harness(["X", "Z"], 0.25);
    setAxis(1, 10);
    expect(fire).toHaveBeenCalledOnce();
    const text = fire.mock.calls[0]![0].text as string;
    expect(text).toBe("G10 L20 P0 Z10.250000"); // Z + eoffset, NOT Y10
  });

  it("lathe [X,Z]: Z refused while eoffset_z is absent (no silent 0)", () => {
    const { fire, setAxis } = harness(["X", "Z"], undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setAxis(1, 10);
    expect(fire).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("mill [X,Y,Z,A]: non-Z axes fire without the eoffset guard", () => {
    const { fire, setAxis } = harness(["X", "Y", "Z", "A"], undefined);
    setAxis(3, 90);
    expect(fire.mock.calls[0]![0].text).toBe("G10 L20 P0 A90.000000");
  });

  it("out-of-range index is a no-op", () => {
    const { fire, setAxis } = harness(["X", "Z"]);
    setAxis(5, 1);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("setAll", () => {
  it("adds eoffset to the Z slot wherever Z sits", () => {
    const { fire, setAll } = harness(["X", "Z"], 0.5);
    setAll([1, 2]);
    expect(fire.mock.calls[0]![0].text).toBe("G10 L20 P0 X1.000000 Z2.500000");
  });
});
