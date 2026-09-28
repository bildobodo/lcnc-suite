import { describe, it, expect } from "vitest";
import { revealFor, revealText } from "./pathReveal";

describe("a finding on a hidden layer (fixed palette P3, Codex R30)", () => {
  const all = { toolpath: true, rapids: true };
  it("shows nothing extra while the layers show what the finding needs", () => {
    expect(revealFor(true, all)).toBeNull();
    expect(revealFor(false, { toolpath: true, rapids: false }), "a feed finding needs no rapids").toBeNull();
  });
  it("shows the rapids for a finding on a hidden rapid, the path for a hidden toolpath", () => {
    expect(revealFor(true, { toolpath: true, rapids: false })).toEqual({ toolpath: false, rapids: true });
    expect(revealFor(false, { toolpath: false, rapids: true })).toEqual({ toolpath: true, rapids: false });
    expect(revealFor(true, { toolpath: false, rapids: false })).toEqual({ toolpath: true, rapids: true });
  });
  it("names the temporary state and where the choice lives", () => {
    expect(revealText(null)).toBeNull();
    expect(revealText({ toolpath: false, rapids: true })).toBe("Rapids shown for this finding — hidden in Layers");
    expect(revealText({ toolpath: true, rapids: true })).toBe("Toolpath and rapids shown for this finding — hidden in Layers");
  });
});
