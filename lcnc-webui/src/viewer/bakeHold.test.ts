// VP188-02 E2 (plan basiswechsel-last Fassung 4 3a, Codex R193/R194): the
// bake hold — every row of the table, every end with and without a held
// change, the windows by their number, the owner's file and connection.
import { describe, expect, it } from "vitest";
import { AFTER_PARSE_MS, LOADING_MS, freeHold, holdStep, type Hold, type HoldEvent } from "./bakeHold";

const F = "/nc/p.ngc";
const run = (h: Hold, ...es: HoldEvent[]) => {
  let bakes = 0;
  for (const e of es) {
    const r = holdStep(h, e);
    h = r.hold;
    if (r.bake) bakes++;
  }
  return { h, bakes };
};
const refresh = (admitted = true, file = F, version = 10, epoch = 0): HoldEvent =>
  ({ kind: "refresh", admitted, file, version, epoch });
const bake: HoldEvent = { kind: "bake" };

describe("the bake hold (VP188-02 E2)", () => {
  it("free bakes; an admitted refresh holds every later bake, once noted", () => {
    expect(holdStep(freeHold(), bake).bake).toBe(true);
    const { h, bakes } = run(freeHold(), bake, refresh(), bake, bake);
    expect(bakes).toBe(1);
    expect(h.state).toBe("parsing");
    expect(h.held).toBe(true);
    expect(h.owner).toEqual({ file: F, version: 10, epoch: 0 });
  });

  it("a refresh that is not admitted holds nothing — checked at every refresh", () => {
    const a = run(freeHold(), refresh(false), bake);
    expect(a.h.state).toBe("free");
    expect(a.bakes).toBe(1);
    // admitted first, then a refresh without admission (a run began): the
    // hold ends with its catch-up
    const b = run(freeHold(), refresh(), bake, refresh(false));
    expect(b.h.state).toBe("free");
    expect(b.bakes).toBe(1);
    // ...and without a held change, no catch-up
    expect(run(freeHold(), refresh(), refresh(false)).bakes).toBe(0);
  });

  it("the supersede gap holds: after_parse with its window, a refresh returns to parsing", () => {
    let { h } = run(freeHold(), refresh(), { kind: "refreshGone", now: 1000 });
    expect(h.state).toBe("after_parse");
    expect(h.deadline).toBe(1000 + AFTER_PARSE_MS);
    const n = h.n;
    ({ h } = run(h, bake, refresh()));
    expect(h.state).toBe("parsing");
    expect(h.deadline).toBeNull();
    // the gap's old timer does nothing now
    const r = holdStep(h, { kind: "deadline", n });
    expect(r.hold).toBe(h);
    expect(r.bake).toBe(false);
  });

  it("a window that runs out ends the hold with ONE catch-up when a change was held", () => {
    const { h } = run(freeHold(), refresh(), { kind: "refreshGone", now: 0 }, bake, bake);
    const r = holdStep(h, { kind: "deadline", n: h.n });
    expect(r.bake).toBe(true);
    expect(r.hold.state).toBe("free");
    expect(r.hold.held).toBe(false);
    // nothing held: no catch-up
    const quiet = run(freeHold(), refresh(), { kind: "refreshGone", now: 0 }).h;
    expect(holdStep(quiet, { kind: "deadline", n: quiet.n }).bake).toBe(false);
  });

  it("the program's newer version arrives: loading with its window, its adoption frees without a bake", () => {
    let { h } = run(freeHold(), refresh(), bake, { kind: "arrival", file: F, version: 11, now: 500 });
    expect(h.state).toBe("loading");
    expect(h.loading).toBe(11);
    expect(h.deadline).toBe(500 + LOADING_MS);
    ({ h } = run(h, bake));
    const r = holdStep(h, { kind: "adopted", file: F, version: 11 });
    expect(r.hold.state).toBe("free");
    expect(r.bake).toBe(false);    // the adoption bakes itself, at the live values
    // from after_parse too
    expect(run(freeHold(), refresh(), { kind: "refreshGone", now: 0 }, { kind: "arrival", file: F, version: 11, now: 1 }).h.state)
      .toBe("loading");
  });

  it("an arrival of another program, of the displayed version or an older one changes nothing", () => {
    const { h } = run(freeHold(), refresh());
    for (const e of [{ file: "/nc/q.ngc", version: 11 }, { file: F, version: 10 }, { file: F, version: 9 }]) {
      expect(holdStep(h, { kind: "arrival", ...e, now: 0 }).hold).toBe(h);
    }
    expect(holdStep(freeHold(), { kind: "arrival", file: F, version: 11, now: 0 }).hold.state).toBe("free");
    // a newer arrival while loading takes over, an older one does not
    const l = run(h, { kind: "arrival", file: F, version: 12, now: 0 }).h;
    expect(holdStep(l, { kind: "arrival", file: F, version: 11, now: 0 }).hold).toBe(l);
    expect(holdStep(l, { kind: "arrival", file: F, version: 13, now: 5 }).hold.loading).toBe(13);
  });

  it("only THIS decode's failure ends loading, with the catch-up", () => {
    const { h } = run(freeHold(), refresh(), bake, { kind: "arrival", file: F, version: 11, now: 0 });
    expect(holdStep(h, { kind: "decodeFailure", file: F, version: 12 }).hold).toBe(h);
    expect(holdStep(h, { kind: "decodeFailure", file: "/nc/q.ngc", version: 11 }).hold).toBe(h);
    const r = holdStep(h, { kind: "decodeFailure", file: F, version: 11 });
    expect(r.bake).toBe(true);
    expect(r.hold.state).toBe("free");
    // not in loading: a failure does nothing
    const p = run(freeHold(), refresh(), bake).h;
    expect(holdStep(p, { kind: "decodeFailure", file: F, version: 11 }).hold).toBe(p);
  });

  it("the loading window runs out: catch-up; a later adoption runs as usual", () => {
    const { h } = run(freeHold(), refresh(), bake, { kind: "arrival", file: F, version: 11, now: 0 });
    const r = holdStep(h, { kind: "deadline", n: h.n });
    expect(r.bake).toBe(true);
    expect(holdStep(r.hold, { kind: "adopted", file: F, version: 11 }).hold.state).toBe("free");
  });

  it("the ends: connection, run, simulation with the catch-up; another program without", () => {
    const held = run(freeHold(), refresh(), bake).h;
    expect(holdStep(held, { kind: "end", catchUp: true }).bake).toBe(true);
    expect(holdStep(held, { kind: "end", catchUp: false }).bake).toBe(false);
    expect(holdStep(held, { kind: "end", catchUp: true }).hold.state).toBe("free");
    // another program adopted: ends without a catch-up
    const o = holdStep(held, { kind: "adopted", file: "/nc/q.ngc", version: 3 });
    expect(o.hold.state).toBe("free");
    expect(o.bake).toBe(false);
    // unloaded
    expect(holdStep(held, { kind: "adopted", file: null, version: null }).bake).toBe(false);
    // the same version adopted again (a tool-basis re-decode) keeps the hold
    expect(holdStep(held, { kind: "adopted", file: F, version: 10 }).hold).toBe(held);
    // free: an end does nothing
    const f = freeHold(4);
    expect(holdStep(f, { kind: "end", catchUp: true })).toEqual({ hold: f, bake: false });
  });

  it("a refresh for another program or connection ends the hold with its catch-up", () => {
    const held = run(freeHold(), refresh(), bake).h;
    expect(holdStep(held, refresh(true, "/nc/q.ngc")).bake).toBe(true);
    expect(holdStep(held, refresh(true, F, 10, 1)).bake).toBe(true);
    expect(holdStep(held, refresh(true, F, 10, 0)).hold).toBe(held);   // the burst's next job
  });

  it("every transition bumps the number, an end too; a timer of an earlier window does nothing", () => {
    let h = freeHold();
    const seen = new Set<number>([h.n]);
    const gone = (): HoldEvent => ({ kind: "refreshGone", now: 0 });
    const arrive = (version: number): HoldEvent => ({ kind: "arrival", file: F, version, now: 0 });
    for (const e of [refresh(), gone, refresh, () => arrive(11),
                     (): HoldEvent => ({ kind: "deadline", n: h.n }),                       // loading's window ends
                     refresh, (): HoldEvent => ({ kind: "end", catchUp: true }),           // a run
                     refresh, () => arrive(12), (): HoldEvent => ({ kind: "decodeFailure", file: F, version: 12 }),
                     refresh, gone, (): HoldEvent => ({ kind: "deadline", n: h.n }),       // the gap's window ends
                     refresh, () => refresh(false),                                       // admission lost
                     refresh, () => arrive(13), (): HoldEvent => ({ kind: "adopted", file: F, version: 13 })]) {
      const before = h.state;
      h = holdStep(h, typeof e === "function" ? e() : e).hold;
      expect(h.state, "each step is a transition").not.toBe(before);
      expect(seen.has(h.n)).toBe(false);
      seen.add(h.n);
    }
    for (const n of seen) if (n !== h.n) expect(holdStep(h, { kind: "deadline", n }).hold).toBe(h);
  });
});
