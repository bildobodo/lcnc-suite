// useAxes (WS-D) — the single axis source every panel renders from.
import { describe, expect, it } from "vitest";
import { computed, ref } from "vue";
import { isRotaryAxis, useAxes } from "./useAxes";

describe("isRotaryAxis", () => {
  it("ABC rotary, XYZUVW linear", () => {
    for (const l of ["A", "B", "C"]) expect(isRotaryAxis(l)).toBe(true);
    for (const l of ["X", "Y", "Z", "U", "V", "W"]) expect(isRotaryAxis(l)).toBe(false);
  });
});

describe("useAxes", () => {
  it("full 9-axis machine: groups in machine order with kinds", () => {
    const ax = useAxes(ref(["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]));
    expect(ax.entries.value).toHaveLength(9);
    expect(ax.primary.value.map(a => a.letter)).toEqual(["X", "Y", "Z"]);
    expect(ax.abc.value.map(a => a.letter)).toEqual(["A", "B", "C"]);
    expect(ax.uvw.value.map(a => a.letter)).toEqual(["U", "V", "W"]);
    expect(ax.extra.value.map(a => a.letter)).toEqual(["A", "B", "C", "U", "V", "W"]);
    expect(ax.hasRotary.value).toBe(true);
    expect(ax.entries.value[3]!.kind).toBe("rotary");
    expect(ax.entries.value[6]!.kind).toBe("linear");
  });

  it("lathe [X,Z]: indices resolve by letter, NOT canonical position", () => {
    const ax = useAxes(ref(["X", "Z"]));
    // THE bug class this composable kills: Z is index 1 here, not 2.
    expect(ax.indexOf("Z")).toBe(1);
    expect(ax.indexOf("Y")).toBe(-1);
    expect(ax.find("Z")).toEqual({ letter: "Z", index: 1, kind: "linear" });
    expect(ax.find("Y")).toBeUndefined();
    expect(ax.hasRotary.value).toBe(false);
    expect(ax.abc.value).toEqual([]);
  });

  it("XYZAC 5-axis: extra preserves machine order, entries index-aligned", () => {
    const ax = useAxes(ref(["X", "Y", "Z", "A", "C"]));
    expect(ax.abc.value.map(a => [a.letter, a.index])).toEqual([["A", 3], ["C", 4]]);
    expect(ax.extra.value.map(a => a.letter)).toEqual(["A", "C"]);
    expect(ax.uvw.value).toEqual([]);
  });

  it("is reactive: axis list arriving later (viewer_init) updates groups", () => {
    const src = ref<string[]>([]);
    const ax = useAxes(computed(() => src.value));
    expect(ax.entries.value).toEqual([]);
    expect(ax.indexOf("X")).toBe(-1);
    src.value = ["X", "Y", "Z", "B"];
    expect(ax.entries.value).toHaveLength(4);
    expect(ax.hasRotary.value).toBe(true);
    expect(ax.indexOf("B")).toBe(3);
  });
});
