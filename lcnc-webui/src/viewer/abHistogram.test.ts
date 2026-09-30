// The A/B histograms (Codex R39 VP39-03): mergeable, conservative quantiles,
// the highest window p95 beside the merged one — and the SAME convention as
// scripts/viewer_ab_report.py (both read ab_histogram_cases.json).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BINS, binOf, binHigh, Histogram, PhaseHistogram, splitSparse, WINDOW_MS } from "./abHistogram";

interface Case { name: string; windows: [number, number][][]; expect: { p95: number; window_p95_max: number;
  window_p95_mean: number; at_least_100: number; at_least_50: number; sparse: number[] } }
const CASES = (JSON.parse(readFileSync(new URL("../../../scripts/test_fixtures/ab_histogram_cases.json", import.meta.url), "utf8")) as { cases: Case[] }).cases;

/** Feed a case's windows into a phase: window k's samples inside [k·W, (k+1)·W). */
function phaseOf(c: Case): PhaseHistogram {
  const ph = new PhaseHistogram();
  c.windows.forEach((w, k) => {
    const n = w.reduce((s, [, cnt]) => s + cnt, 0);
    let i = 0;
    for (const [v, cnt] of w) for (let j = 0; j < cnt; j++) ph.add(v, k * WINDOW_MS + (i++ * (WINDOW_MS - 1)) / n);
  });
  ph.finish();
  return ph;
}

describe("abHistogram — the shared cases (report script twin)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const ph = phaseOf(c);
      expect(ph.total.quantile(0.95)).toBe(c.expect.p95);
      expect(ph.windowP95Max).toBe(c.expect.window_p95_max);
      const mean = ph.windowP95s.reduce((s, x) => s + x, 0) / ph.windowP95s.length;
      expect(mean).toBeCloseTo(c.expect.window_p95_mean, 9);
      expect(ph.total.atLeast(100)).toBe(c.expect.at_least_100);
      expect(ph.total.atLeast(50)).toBe(c.expect.at_least_50);
      expect(ph.total.sparse()).toEqual(c.expect.sparse);
    });
  }
});

describe("abHistogram — bins and merging", () => {
  it("bins: 1 ms to 200, 10 ms to 1000, one overflow; a quantile is an upper edge", () => {
    expect([binOf(0), binOf(-3), binOf(16.9), binOf(199.99), binOf(200), binOf(209.9), binOf(999.9), binOf(1000), binOf(1e6)])
      .toEqual([0, 0, 16, 199, 200, 200, 279, 280, 280]);
    expect(BINS).toBe(281);
    expect([binHigh(16), binHigh(199), binHigh(200), binHigh(279), binHigh(280)]).toEqual([17, 200, 210, 1000, Infinity]);
  });

  it("merging two runs equals one run over both samples", () => {
    const a = new Histogram(), b = new Histogram(), both = new Histogram();
    for (let i = 0; i < 500; i++) { const v = (i * 37) % 90; a.add(v); both.add(v); }
    for (let i = 0; i < 300; i++) { const v = 10 + (i * 11) % 400; b.add(v); both.add(v); }
    a.merge(b);
    expect(a.counts).toEqual(both.counts);
    expect([a.n, a.max, a.quantile(0.95)]).toEqual([both.n, both.max, both.quantile(0.95)]);
  });

  it("sparse round trip, and a split never loses a bin", () => {
    const h = new Histogram();
    for (let b = 0; b < 1000; b += 3) h.add(b + 0.5);
    const round = Histogram.fromSparse(h.sparse(), h.max);
    expect(round.counts).toEqual(h.counts);
    const parts = splitSparse(h.sparse(), 400);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(JSON.stringify(p).length).toBeLessThanOrEqual(400);
    expect(parts.flat()).toEqual(h.sparse());
  });

  it("no samples: no quantile, no window", () => {
    const ph = new PhaseHistogram();
    ph.finish();
    expect(ph.total.quantile(0.95)).toBeNull();
    expect(ph.windowP95Max).toBeNull();
  });
});
