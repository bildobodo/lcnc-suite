import { describe, it, expect } from "vitest";
import { revealFor, revealText, sectionOf } from "./pathReveal";

describe("a finding on a hidden layer (fixed palette P3, Codex R30/R31)", () => {
  const all = { toolpath: true, rapids: true };
  const run: [number, number] = [14, 16];
  it("shows nothing extra while the layers show what the finding needs", () => {
    expect(revealFor(true, all, run)).toBeNull();
    expect(revealFor(false, { toolpath: true, rapids: false }, run), "a feed finding needs no rapids").toBeNull();
  });
  it("shows the finding's section of a hidden rapid, of a hidden toolpath", () => {
    expect(revealFor(true, { toolpath: true, rapids: false }, run)).toEqual({ toolpath: false, rapids: true, run });
    expect(revealFor(false, { toolpath: false, rapids: true }, run)).toEqual({ toolpath: true, rapids: false, run });
    expect(revealFor(true, { toolpath: false, rapids: false }, run)).toEqual({ toolpath: true, rapids: true, run });
  });
  it("a finding off the drawn path (the entry move) shows nothing", () => {
    expect(revealFor(true, { toolpath: false, rapids: false }, null)).toBeNull();
  });
  it("draws only the hidden streams of the section (Codex R31 VP-I03)", () => {
    expect(sectionOf(null)).toBeNull();
    expect(sectionOf({ toolpath: false, rapids: true, run })).toEqual({ run, feed: false, rapid: true });
    expect(sectionOf({ toolpath: true, rapids: false, run }), "the toolpath off hides both").toEqual({ run, feed: true, rapid: true });
  });
  it("names the temporary state and where the choice lives", () => {
    expect(revealText(null)).toBeNull();
    expect(revealText({ toolpath: false, rapids: true, run })).toBe("Rapids shown for this finding — hidden in Layers");
    expect(revealText({ toolpath: true, rapids: true, run })).toBe("Toolpath and rapids shown for this finding — hidden in Layers");
  });
});
