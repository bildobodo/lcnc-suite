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
const check: HoldEvent = { kind: "check" };
/** The steps' check outputs, in order. */
const checks = (h: Hold, ...es: HoldEvent[]) => es.map(e => { const r = holdStep(h, e); h = r.hold; return r.check; });

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
    expect(holdStep(f, { kind: "end", catchUp: true })).toEqual({ hold: f, bake: false, check: false });
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
      // in a window, every earlier window's timer does nothing — only its own ends it
      if (h.state === "after_parse" || h.state === "loading") {
        for (const n of seen) if (n !== h.n) expect(holdStep(h, { kind: "deadline", n }).hold, `timer ${n} in ${h.state}`).toBe(h);
      }
    }
    for (const n of seen) if (n !== h.n) expect(holdStep(h, { kind: "deadline", n }).hold).toBe(h);
  });

  // VP188-02 E1 (plan Fassung 5 3e, Codex R197): the collision check waits at
  // the same hold — its note apart from the bake's
  describe("the collision check at the same hold (E1)", () => {
    it("free checks now; held, a check is noted once — the bake's note apart", () => {
      expect(holdStep(freeHold(), check)).toEqual({ hold: freeHold(), bake: false, check: true });
      let h = run(freeHold(), refresh()).h;
      const r = holdStep(h, check);
      expect([r.check, r.bake, r.hold.checkHeld, r.hold.held]).toEqual([false, false, true, false]);
      expect(holdStep(r.hold, check).hold, "noted once").toBe(r.hold);
      h = run(h, bake).h;
      expect([h.held, h.checkHeld], "a bake does not note a check").toEqual([true, false]);
    });

    it("an end without an adoption checks again once, only when noted — every end, with the bake's own catch-up apart", () => {
      const ends: Array<[string, (h: Hold) => HoldEvent]> = [
        ["the gap's window", h => ({ kind: "deadline", n: h.n })],
        ["the connection, a run, the simulation", () => ({ kind: "end", catchUp: true })],
        ["a refresh not admitted", () => refresh(false)],
        ["another connection's refresh", () => refresh(true, F, 10, 1)],
      ];
      for (const [why, end] of ends) {
        const base = why === "the gap's window" ? [refresh(), { kind: "refreshGone", now: 0 } as HoldEvent] : [refresh()];
        const noted = run(freeHold(), ...base, check).h;
        const r = holdStep(noted, end(noted));
        expect([r.check, r.bake, r.hold.state], `${why}: noted`).toEqual([true, false, "free"]);
        const quiet = run(freeHold(), ...base).h;
        expect(holdStep(quiet, end(quiet)).check, `${why}: nothing noted`).toBe(false);
        const both = run(freeHold(), ...base, check, bake).h;
        const rb = holdStep(both, end(both));
        expect([rb.check, rb.bake], `${why}: both noted`).toEqual([true, true]);
      }
      // loading: its window and THIS decode's failure
      const l = run(freeHold(), refresh(), check, { kind: "arrival", file: F, version: 11, now: 0 }).h;
      expect(holdStep(l, { kind: "deadline", n: l.n }).check).toBe(true);
      expect(holdStep(l, { kind: "decodeFailure", file: F, version: 11 }).check).toBe(true);
    });

    it("an adoption, another program and an end without catch-up check nothing — the adoption schedules its own", () => {
      const l = run(freeHold(), refresh(), check, { kind: "arrival", file: F, version: 11, now: 0 }).h;
      expect(checks(l, { kind: "adopted", file: F, version: 11 })).toEqual([false]);
      const p = run(freeHold(), refresh(), check).h;
      expect(checks(p, { kind: "adopted", file: "/nc/q.ngc", version: 3 })).toEqual([false]);
      expect(checks(p, { kind: "end", catchUp: false })).toEqual([false]);
      // ...and the next hold starts without the old note
      const again = run(holdStep(p, { kind: "adopted", file: "/nc/q.ngc", version: 3 }).hold, refresh(true, "/nc/q.ngc", 3)).h;
      expect(again.checkHeld).toBe(false);
      expect(holdStep(again, { kind: "end", catchUp: true }).check, "no old note runs again").toBe(false);
    });

    it("the supersede gap keeps the note: parsing → after_parse → parsing, one check at the end", () => {
      const h = run(freeHold(), refresh(), check, { kind: "refreshGone", now: 0 }, refresh(), { kind: "refreshGone", now: 5 }).h;
      expect([h.state, h.checkHeld]).toEqual(["after_parse", true]);
      expect(checks(h, { kind: "deadline", n: h.n })).toEqual([true]);
    });
  });
});

