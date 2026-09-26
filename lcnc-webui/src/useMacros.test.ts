// The macro parameter dialog reads its macro LIVE (implementation review
// round 4, UI-DI08): a revision pushed through the LOCAL setter (Settings'
// macro editor → updateMacros) changes what the dialog shows, previews,
// binds the Execute hold to and runs; entered values stay, a new parameter
// takes its default, a removed macro runs nothing. (The settings-sync path
// is the e2e in run-hold.spec.)
import { describe, it, expect, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { MacroDef } from "./defaults";

// defaults.ts reaches the DOM at import; the composable needs only these two.
vi.mock("./defaults", () => ({ loadMacrosDefaults: () => ({ macros: [] }), settingsVersion: ref(0) }));
const { useMacros } = await import("./useMacros");

const FACE: MacroDef = { id: "m-face", name: "Face Top", command: "G0 Z{depth} F{feed}",
  params: [{ name: "depth", label: "Depth", default: "5" }, { name: "feed", label: "Feed", default: "100" }] } as MacroDef;

function setup() {
  const fired: { cmd: string; text: string }[] = [];
  const m = useMacros({ fire: p => fired.push(p) });
  m.updateMacros([FACE]);
  m.runMacro(FACE);
  return { m, fired };
}

describe("useMacros: the parameter dialog follows its macro", () => {
  it("a new command through the local setter re-keys the Execute hold, previews and runs the new one", async () => {
    const { m, fired } = setup();
    const before = m.macroExecuteKey();
    m.updateMacros([{ ...FACE, name: "Face Deep", command: "G0 Z-{depth} F{feed}" }]);
    await nextTick();
    expect(m.macroExecuteKey(), "a hold bound to the old revision is cancelled").not.toBe(before);
    expect(m.macroParamDialog.value!.name).toBe("Face Deep");
    expect(m.macroPreview()).toBe("G0 Z-5 F100");
    m.confirmMacroParams();
    expect(fired.map(f => f.text)).toEqual(["G0 Z-5 F100"]);
  });

  it("a new parameter set keeps entered values, adds defaults, drops removed ones", async () => {
    const { m } = setup();
    m.macroParamDialog.value!.values.feed = "250";
    const before = m.macroExecuteKey();
    m.updateMacros([{ ...FACE, command: "G0 Z{depth} S{spd}",
      params: [FACE.params[0]!, { name: "spd", label: "Speed", default: "7" }] } as MacroDef]);
    await nextTick();
    expect(m.macroExecuteKey()).not.toBe(before);
    expect(m.macroParamDialog.value!.values).toEqual({ depth: "5", spd: "7" });
    expect(m.macroPreview()).toBe("G0 Z5 S7");
    // A value change re-keys too.
    const k = m.macroExecuteKey();
    m.macroParamDialog.value!.values.depth = "6";
    expect(m.macroExecuteKey()).not.toBe(k);
  });

  it("a removed macro binds nothing and runs nothing", async () => {
    const { m, fired } = setup();
    m.updateMacros([]);
    await nextTick();
    expect(m.dialogMacro.value).toBeNull();
    expect(m.macroExecuteKey()).toBe("");
    expect(m.macroPreview()).toBe("");
    expect(m.macroParamDialog.value!.name, "the title keeps the last name").toBe("Face Top");
    m.confirmMacroParams();
    expect(fired).toEqual([]);
  });
});
