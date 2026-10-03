// Package 5 stage C: the bar's items, a macro file's run state (Codex
// VP69-05), the parameter unit, and the `macros` section keeping `bar`.
import { describe, it, expect } from "vitest";
import { macroBarItems, macroRunBlock, fileHoldKey, macroParamUnit } from "./macroBar";
import { mergeMacrosSection, MACRO_BAR_MAX } from "./macroParams";
import type { MacroFile, MacroFolder } from "./lcncApi";

const file = (over: Partial<MacroFile> = {}): MacroFile => ({
  name: "park", title: "Park", units: null, frame: null, params: [], description: [], errors: [],
  warnings: [], revision: "a".repeat(64), mtime: 0, runnable: true, reason: null, ...over,
});
const folder = (...files: MacroFile[]): MacroFolder => ({ ok: true, dir: "/m", problems: [], macros: files });

describe("macroBarItems", () => {
  it("the bar's files in the bar's order, by their title", () => {
    const f = folder(file({ name: "a", title: null }), file({ name: "b", title: "Bee" }));
    const { items, missing } = macroBarItems(["b", "a"], f);
    expect(items.map(i => [i.key, i.label])).toEqual([["file:b", "Bee"], ["file:a", "a"]]);
    expect(missing).toEqual([]);
  });
  it("a name without a file is missing — once the list is known, never before", () => {
    expect(macroBarItems(["gone"], folder()).missing).toEqual(["gone"]);
    expect(macroBarItems(["gone"], null).missing).toEqual([]);
  });
});

describe("macroRunBlock", () => {
  it("the open editor of THIS file blocks its run; another file's editor does not", () => {
    const f = file();
    expect(macroRunBlock(f, null)).toBeNull();
    expect(macroRunBlock(f, { name: "park", state: "draft" })).toMatch(/Unsaved edit/);
    expect(macroRunBlock(f, { name: "park", state: "loading" })).toMatch(/Loading/);
    expect(macroRunBlock(f, { name: "park", state: "conflict" })).toMatch(/Changed on disk/);
    expect(macroRunBlock(f, { name: "park", state: "clean" })).toBeNull();
    // a clean editor on ANOTHER revision than the file (Codex R70 VP-I32)
    expect(macroRunBlock(f, { name: "park", state: "clean", revision: f.revision })).toBeNull();
    expect(macroRunBlock(f, { name: "park", state: "clean", revision: "b".repeat(64) })).toMatch(/another revision/);
    expect(macroRunBlock(f, { name: "other", state: "draft" })).toBeNull();
  });
  it("the gateway's verdict", () => {
    expect(macroRunBlock(file({ runnable: false, reason: "Shadowed by /nc/park.ngc" }), null)).toBe("Shadowed by /nc/park.ngc");
  });
  it("a hold is bound to the name and the revision", () => {
    expect(fileHoldKey(file())).not.toBe(fileHoldKey(file({ revision: "b".repeat(64) })));
  });
});

describe("macroParamUnit", () => {
  it("in the macro's own UNITS, never the machine's", () => {
    expect(macroParamUnit("length", "mm")).toBe("mm");
    expect(macroParamUnit("feed", "inch")).toBe("in/min");
    expect(macroParamUnit("angle", null)).toBe("°");
    expect(macroParamUnit("count", null)).toBe("");
  });
});

describe("mergeMacrosSection", () => {
  const fb = { macros: [] };
  it("a stored earlier-macro list passes through EXACTLY as stored — no longer used, never rewritten", () => {
    // the earlier MDI-line macros were dropped (operator 2026-10-02): a save
    // of the section must write back what was there, malformed and long lists too
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, name: `Old ${i}`, command: "G0 Z{z}", params: [] }));
    const saved = { macros: [...many, { broken: true }, "junk"] };
    const m = mergeMacrosSection(saved, fb);
    expect(m.macros).toBe(saved.macros);
    expect("bar" in m).toBe(false);
  });
  it("bar passes through, valid names only, each once, capped", () => {
    expect(mergeMacrosSection({ macros: [], bar: ["park", "Park", "../x", "park", 3, "face_top"] }, fb).bar)
      .toEqual(["park", "face_top"]);
    const many = Array.from({ length: 80 }, (_, i) => `m${i}`);
    expect(mergeMacrosSection({ macros: [], bar: many }, fb).bar).toHaveLength(MACRO_BAR_MAX);
    expect(mergeMacrosSection({ bar: ["park"] }, fb)).toEqual({ macros: [], bar: ["park"] });
  });
});
