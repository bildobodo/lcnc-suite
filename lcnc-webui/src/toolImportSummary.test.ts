import { describe, expect, it } from "vitest";
import { summarizeToolImport } from "./toolImportSummary";

describe("tool import source and offset wording", () => {
  it("identifies a mixed example library and zero offsets", () => {
    const summary = summarizeToolImport([{ is_example: true }, { is_example: true, source_format: "freecad" }]);
    expect(summary).toMatchObject({ fusion: 1, freecad: 1, isExample: true, sourceLabel: "Fusion 360 + FreeCAD" });
    expect(summary.replacementNotice).toContain("Z offsets start at zero");
    expect(summary.resultNotice).toContain("initialized to zero");
  });
  it("retains each real source's offset policy", () => {
    expect(summarizeToolImport([{}]).replacementNotice).toContain("Fusion gauge lengths");
    expect(summarizeToolImport([{ source_format: "freecad" }]).replacementNotice).toContain("start at zero");
    const mixed = summarizeToolImport([{}, { source_format: "freecad" }]);
    expect(mixed.isExample).toBe(false);
    expect(mixed.replacementNotice).toContain("Fusion Z offsets use gauge lengths; FreeCAD Z offsets start at zero");
  });
  it("does not present partially flagged data as an example library", () => {
    expect(summarizeToolImport([{ is_example: true }, {}]).isExample).toBe(false);
    expect(summarizeToolImport([]).isExample).toBe(false);
  });
});
