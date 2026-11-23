import { describe, expect, it } from "vitest";
import { driftVerdict, parseDriftDecision, type DriftDecision, type DriftWait } from "./driftWait";

// P2b-2 (plan v4 guards 1–6): the two waits, the named fallback once, the
// owner (generation, connection), a late older status.
const never = () => false;
const d = (over: Partial<DriftDecision> = {}): DriftDecision => ({ state: "pending", gen: [1, 4], ...over });

describe("an idle check waits for the drift decision, then for its named parse (P2b-2)", () => {
  it("a parse decided early: no fallback — it waits for the publication and the adoption (guard 1)", () => {
    let w: DriftWait | null = null;
    let r = driftVerdict(d(), w, 0, 1, never);
    expect(r.verdict).toEqual({ go: false, why: "decision", retryInMs: 3000 });
    w = r.wait;
    r = driftVerdict(d({ state: "parse", job: 9 }), w, 500, 1, never);
    expect(r.verdict, "a 5 s parse: still waiting past 3 s").toEqual({ go: false, why: "parse", retryInMs: null });
    r = driftVerdict(d({ state: "parse", job: 9 }), r.wait, 5000, 1, never);
    expect(r.verdict.go).toBe(false);
    r = driftVerdict(d({ state: "parse", job: 9, published: 12 }), r.wait, 5100, 1, never);
    expect(r.verdict, "published, not adopted yet (guard 3)").toEqual({ go: false, why: "adoption", retryInMs: null });
    r = driftVerdict(d({ state: "parse", job: 9, published: 12 }), r.wait, 5600, 1, v => v === 12);
    expect(r.verdict).toEqual({ go: true, named: null });
  });

  it("no decision within 3 s: one named fallback (guard 2)", () => {
    let r = driftVerdict(d(), null, 0, 1, never);
    r = driftVerdict(d(), r.wait, 2999, 1, never);
    expect(r.verdict.go).toBe(false);
    r = driftVerdict(d(), r.wait, 3000, 1, never);
    expect(r.verdict).toEqual({ go: true, named: { kind: "fallback", waited_ms: 3000 } });
    expect(driftVerdict(d(), r.wait, 4000, 1, never).verdict, "said once").toEqual({ go: true, named: null });
  });

  it("a parse that ends without a publication ends the wait, named (guard 4)", () => {
    const r = driftVerdict(d({ state: "parse", job: 9, why: "cancelled:unload" }), null, 0, 1, never);
    expect(r.verdict).toEqual({ go: true, named: { kind: "parse_ended", job: 9, why: "cancelled:unload" } });
  });

  it("a newer generation or another connection closes the wait; an older status has no effect (guards 5, 6)", () => {
    let r = driftVerdict(d(), null, 0, 1, never);
    r = driftVerdict(d({ gen: [2, 0] }), r.wait, 2500, 1, never);      // a load: a new wait from now
    expect(r.wait?.gen).toEqual([2, 0]);
    expect(r.verdict).toEqual({ go: false, why: "decision", retryInMs: 3000 });
    const late = driftVerdict(d({ state: "none", gen: [1, 4] }), r.wait, 2600, 1, never);
    expect(late.verdict.go, "an older generation's none starts nothing").toBe(false);
    expect(late.wait).toEqual(r.wait);
    const other = driftVerdict(d({ gen: [2, 0] }), r.wait, 2700, 2, never);
    expect(other.wait?.since, "another connection: a new wait").toBe(2700);
    // a named parse's wait: a late older status never makes it fall back
    let pw = driftVerdict(d({ state: "parse", job: 5, gen: [5, 1] }), null, 0, 1, never);
    pw = driftVerdict(d({ state: "none", gen: [5, 0] }), pw.wait, 4000, 1, never);
    expect(pw.verdict, "judged as its own parse").toEqual({ go: false, why: "parse", retryInMs: null });
  });

  it("none goes at once; a gateway without decisions is said", () => {
    expect(driftVerdict(d({ state: "none" }), null, 0, 1, never).verdict).toEqual({ go: true, named: null });
    expect(driftVerdict(null, null, 0, 1, never).verdict).toEqual({ go: true, named: { kind: "no_decision" } });
  });

  // Codex R446 MT-I26 (his three cases, with the round on the wire): a new
  // round of the SAME generation — after none, after an adopted parse, after a
  // round that fell back — waits its own three seconds from its own start
  it.each(["none", "published", "fallback"] as const)("a new round after %s waits its own 3 s, even at the same generation", previous => {
    const g = (state: DriftDecision["state"], round: number, extra = {}): DriftDecision => ({ state, gen: [0, 0], round, ...extra });
    let r = driftVerdict(previous === "published" ? g("parse", 1, { job: 5, published: 6 }) : g(previous === "none" ? "none" : "pending", 1),
                         null, 0, 1, () => true);
    if (previous === "fallback") {
      r = driftVerdict(g("pending", 1), r.wait, 3000, 1, () => true);
      expect(r.verdict).toEqual({ go: true, named: { kind: "fallback", waited_ms: 3000 } });
      r = driftVerdict(g("none", 1), r.wait, 3500, 1, () => true);
    }
    const next = driftVerdict(g("pending", 2), r.wait, 10000, 1, () => true);
    expect(next.verdict).toEqual({ go: false, why: "decision", retryInMs: 3000 });
    // repeated frames of that round never reset it; its own fallback is said once
    const again = driftVerdict(g("pending", 2), next.wait, 12000, 1, () => true);
    expect(again.wait?.since).toBe(10000);
    expect(driftVerdict(g("pending", 2), again.wait, 13000, 1, () => true).verdict)
      .toEqual({ go: true, named: { kind: "fallback", waited_ms: 3000 } });
    // a late decision of the previous round closes nothing
    expect(driftVerdict(g("none", 1), next.wait, 11000, 1, () => true).verdict.go).toBe(false);
  });

  it("a round decided before the page saw its pending is a new round too (never guessed from pending)", () => {
    const g = (state: DriftDecision["state"], round: number, extra = {}): DriftDecision => ({ state, gen: [0, 0], round, ...extra });
    let r = driftVerdict(g("none", 1), null, 0, 1, () => true);
    r = driftVerdict(g("parse", 2, { job: 8 }), r.wait, 5000, 1, () => true);
    expect(r.verdict, "round 2's named parse, its pending missed").toEqual({ go: false, why: "parse", retryInMs: null });
    expect(r.wait?.since).toBe(5000);
  });

  it("the wire's field", () => {
    expect(parseDriftDecision({ state: "parse", gen: [1, 2], round: 6, job: 3, published: 4 }))
      .toEqual({ state: "parse", gen: [1, 2], round: 6, job: 3, published: 4 });
    expect(parseDriftDecision({ state: "none", gen: [0, 0], why: "start" })).toEqual({ state: "none", gen: [0, 0] });
    for (const bad of [null, {}, { state: "x", gen: [0, 0] }, { state: "none", gen: [0] }, { state: "none", gen: ["a", 1] }]) {
      expect(parseDriftDecision(bad)).toBeNull();
    }
  });
});
