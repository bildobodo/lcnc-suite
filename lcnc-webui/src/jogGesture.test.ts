import { describe, it, expect } from "vitest";
import { JogGestures, stopFor } from "./jogGesture";

// Button gates BG-06 (Codex R202): a jog's end stops what its start started.

describe("stopFor", () => {
  it("a continuous single-axis jog stops its axis", () => {
    expect(stopFor({ axes: [2], cont: true })).toEqual({ cmd: "jog_stop", axis: 2 });
  });
  it("a continuous diagonal stops both axes in one command", () => {
    expect(stopFor({ axes: [0, 1], cont: true })).toEqual({ cmd: "jog_stop_multi", axes: [0, 1] });
  });
  it("a step stops by itself", () => {
    expect(stopFor({ axes: [0], cont: false })).toBeNull();
  });
});

describe("JogGestures", () => {
  it("ends a gesture with the stop recorded at its start, whatever changed since", () => {
    const g = new JogGestures<string>();
    g.start("jog_x_plus", { axes: [0], cont: true });
    // the step selector moved to 1 mm while the key was held: the gesture
    // is still the continuous jog it started as
    expect(g.end("jog_x_plus")).toEqual({ cmd: "jog_stop", axis: 0 });
    expect(g.has("jog_x_plus")).toBe(false);
  });

  it("a step ends without a stop, a second end without anything", () => {
    const g = new JogGestures<string>();
    g.start("k", { axes: [1], cont: false });
    expect(g.end("k")).toBeNull();
    expect(g.end("k")).toBeNull();
  });

  it("endAll returns every continuous gesture's own stop and clears", () => {
    const g = new JogGestures<string>();
    g.start("a", { axes: [0], cont: true });
    g.start("b", { axes: [1], cont: false });
    g.start("c", { axes: [0, 1], cont: true });
    expect(g.endAll()).toEqual([
      { cmd: "jog_stop", axis: 0 },
      { cmd: "jog_stop_multi", axes: [0, 1] },
    ]);
    expect(g.size).toBe(0);
  });
});
