// viewer/planeView.ts — the tilted work plane's one display decision
// (viewer contrast plan, V4): role, object label, HUD word, edge pattern and
// arrow come from one result, for every live state, both staleness claims
// together, and a simulated plane whatever the live machine says.
import { describe, expect, it } from "vitest";
import { planeView } from "./planeView";

const live = { simulated: false, active: false, headMoved: false, datumMoved: false };

describe("planeView", () => {
  it("active and defined: a solid edge, the state named on the object and in the HUD", () => {
    expect(planeView({ ...live, active: true })).toEqual({ role: "planeActive", label: "Plane · active",
      hudWord: "plane active", dashed: false, arrowStale: false });
    expect(planeView(live)).toEqual({ role: "planeDefined", label: "Plane · defined",
      hudWord: "plane defined", dashed: false, arrowStale: false });
  });

  it("head moved: stale, dashed, and the normal arrow carries it — active or not", () => {
    for (const active of [true, false]) {
      expect(planeView({ ...live, active, headMoved: true })).toEqual({ role: "planeStale", label: "Plane · head moved",
        hudWord: "plane head moved", dashed: true, arrowStale: true });
    }
  });

  it("datum moved: stale and dashed, but the head's arrow stays the axis colour", () => {
    expect(planeView({ ...live, active: true, datumMoved: true })).toEqual({ role: "planeStale", label: "Plane · datum moved",
      hudWord: "plane datum moved", dashed: true, arrowStale: false });
  });

  it("both claims at once: the label names both, the arrow the head's", () => {
    expect(planeView({ ...live, headMoved: true, datumMoved: true })).toEqual({ role: "planeStale",
      label: "Plane · head moved · datum moved", hudWord: "plane head moved, datum moved", dashed: true, arrowStale: true });
  });

  it("a simulated plane is never stale — whatever the live machine claims", () => {
    for (const claims of [live, { ...live, active: true }, { ...live, headMoved: true, datumMoved: true }]) {
      expect(planeView({ ...claims, simulated: true })).toEqual({ role: "planeActive", label: "Plane · simulated",
        hudWord: "plane simulated", dashed: false, arrowStale: false });
    }
  });
});
