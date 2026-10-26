// Button gates BG-01 (Codex R202–R204, package C): with the outer armed
// fieldset gone, every control a disarmed client can operate is in the
// inventory, classified — and nothing that writes or moves is among them.
import { describe, it, expect } from "vitest";
import { scanControls } from "./controlScan";
import { CONTROL_INVENTORY } from "./controlInventory";

// Vite's glob rather than node:fs — this suite typechecks under the browser
// tsconfig (the commandPath.test.ts pattern).
const SOURCES = import.meta.glob("./**/*.vue", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const usages = Object.entries(SOURCES).flatMap(([f, s]) => scanControls(f.replace(/^\.\//, ""), s));

describe("the control inventory (button gates BG-01)", () => {
  it("has no outer armed Gate around the content, the strip or the macro bar", () => {
    for (const f of ["./App.vue", "./MacroBar.vue"]) {
      expect(SOURCES[f], f).toBeDefined();
      expect(SOURCES[f]!.match(/<Gate\s+gate="armed"/g) ?? [], f).toEqual([]);
    }
  });

  it("classifies every control a disarmed client can operate", () => {
    const missing = [...new Set(usages.filter((u) => !(u.key in CONTROL_INVENTORY)).map((u) => `${u.key}  (line ${u.line})`))];
    expect(missing, "a control a disarmed client can operate is not classified — give it an armed gate, or classify it in controlInventory.ts").toEqual([]);
  });

  it("names nothing the scan no longer finds", () => {
    const found = new Set(usages.map((u) => u.key));
    expect(Object.keys(CONTROL_INVENTORY).filter((k) => !found.has(k))).toEqual([]);
  });

  it("gives every entry a reason", () => {
    for (const [k, [, why]] of Object.entries(CONTROL_INVENTORY)) expect(why.length, k).toBeGreaterThan(10);
  });

  it("keeps the scan honest: the controls it must see are seen", () => {
    // Positive controls: a stop, a nav and a raw handler are found; a
    // protected one (the tool table's Save, armed) is not.
    const keys = usages.map((u) => u.key);
    expect(keys.some((k) => k.startsWith("MacroBar.vue|MachineBtn:abort|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("DialogFrame.vue|MachineBtn:close|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("KeyboardTab.vue|td|"))).toBe(true);
    expect(keys.some((k) => k.includes("|MachineBtn:toolSave|"))).toBe(false);
    expect(keys.some((k) => k.includes("|MachineBtn:fileSave|"))).toBe(false);
  });
});
