// The macro parameter dialog reads its macro FILE live (implementation
// review round 4, UI-DI08, now for files — the earlier MDI-line macros were
// dropped 2026-10-02): a save from any client while the dialog is open
// changes what it shows and binds the Execute hold to; entered values stay,
// a new parameter takes its default, a deleted file runs nothing. (The
// end-to-end path is run-hold.spec / macros.spec.)
import { describe, it, expect, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { MacroFile, MacroFolder } from "./lcncApi";

// defaults.ts and macroFiles.ts reach the DOM / the socket at import; the
// composable needs only these.
vi.mock("./defaults", () => ({ loadMacrosDefaults: () => ({ macros: [] }), saveMacrosDefaults: () => {}, settingsVersion: ref(0) }));
const folder = ref<MacroFolder | null>(null);
const basis = ref<{ name: string; state: "clean" | "draft" | "loading" | "conflict" } | null>(null);
vi.mock("./macroFiles", () => ({
  macroFolder: folder,
  macroEditorBasis: basis,
  macroFileByName: (n: string) => folder.value?.macros.find(m => m.name === n) ?? null,
}));
const { useMacros } = await import("./useMacros");

const P = (n: number, key: string, def: number) =>
  ({ n, key, label: key, unit: "length" as const, default: def, min: null, max: null, integer: false });
const FACE: MacroFile = { name: "face_top", title: "Face top", units: "mm", frame: null, description: [], errors: [], warnings: [],
  params: [P(1, "depth", 5), P(2, "feed", 100)], revision: "a".repeat(64), mtime: 0, runnable: true, reason: null };
const PARK: MacroFile = { ...FACE, name: "park", title: "Park", params: [], revision: "c".repeat(64) };
const list = (...m: MacroFile[]): MacroFolder => ({ ok: true, dir: "/m", problems: [], macros: m });

function setup() {
  folder.value = list(FACE, PARK);
  basis.value = null;
  const fired: { cmd: string; name?: string; revision?: string; args?: number[] }[] = [];
  const m = useMacros({ fire: p => fired.push(p) });
  return { m, fired };
}

describe("useMacros: macro files", () => {
  it("a file with parameters opens its dialog with the defaults; Execute sends numbers bound to the revision", () => {
    const { m, fired } = setup();
    m.runMacroFile(FACE);
    expect(fired).toEqual([]);
    expect(m.macroParamDialog.value).toEqual({ name: "face_top", title: "Face top", values: { depth: "5", feed: "100" } });
    m.macroParamDialog.value!.values.depth = "2.5";
    m.confirmMacroParams();
    expect(fired).toEqual([{ cmd: "run_macro", name: "face_top", revision: FACE.revision, args: [2.5, 100] }]);
    expect(m.macroParamDialog.value).toBeNull();
  });

  it("a file without parameters runs at once; a file with a draft open runs nothing", () => {
    const { m, fired } = setup();
    basis.value = { name: "park", state: "draft" };
    m.runMacroFile(PARK);
    expect(fired).toEqual([]);
    basis.value = null;
    m.runMacroFile(PARK);
    expect(fired).toEqual([{ cmd: "run_macro", name: "park", revision: PARK.revision, args: [] }]);
  });

  it("a new revision re-keys the Execute hold; a new parameter set keeps entered values, adds defaults, drops removed ones", async () => {
    const { m } = setup();
    m.runMacroFile(FACE);
    m.macroParamDialog.value!.values.feed = "250";
    const key = m.macroExecuteKey();
    folder.value = list({ ...FACE, revision: "b".repeat(64), title: "Face deep", params: [P(2, "feed", 100), P(3, "clear", 5)] }, PARK);
    await nextTick();
    expect(m.macroExecuteKey()).not.toBe(key);
    expect(m.macroParamDialog.value!.values).toEqual({ feed: "250", clear: "5" });
    expect(m.macroParamDialog.value!.title).toBe("Face deep");
  });

  it("the Execute hold is bound to the entered values: a changed value re-keys it", () => {
    const { m } = setup();
    m.runMacroFile(FACE);
    const key = m.macroExecuteKey();
    m.macroParamDialog.value!.values.feed = "300";
    expect(m.macroExecuteKey()).not.toBe(key);
  });

  it("a deleted file binds nothing and runs nothing", async () => {
    const { m, fired } = setup();
    m.runMacroFile(FACE);
    folder.value = list(PARK);
    await nextTick();
    expect(m.dialogFileBlock.value).toBe("Macro removed — nothing to run");
    expect(m.macroExecuteKey()).toBe("");
    m.confirmMacroParams();
    expect(fired).toEqual([]);
  });
});
