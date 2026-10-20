// The per-line sample's removal (step 4 package 2, plan 5, B8): a pair in
// contact no longer owes every LINE a sample — it samples at the EXPLORE
// cadence, re-sampled at MIN_ADV at every separation (a touch's end and a near
// pair's margin exit), and where the KIND of move changes. Codex R139 (answer 1): admissible when no known separation,
// touch or cutting / rapid rule is lost; "new ⊇ old" holds for the coverage
// by intervals and for every view, not only for the number of onsets. So
// each track is swept twice — with the old rule (`lineSample`, a seam for this
// check and the measurement only) and without — and what the run WITH it
// found must lie in what the run without found:
//  · every witness, decided entry and decided exit inside a touch interval
//    of the pair; every line a stay of the pair reaches, reached by a stay
//    of the pair;
//  · every finding inside a contact of the pair, a rapid one inside a rapid
//    contact; every tinted pose tinted; every marked line marked; every lit
//    band column lit —
// else the truth shows a run no wider than MIN_ADV (the sweep's guarantee:
// the run with more samples may have landed in it by chance). The tracks are
// the oracle's random tracks cut into short lines (0.05–1.5 units, a line
// each, the kind flipping now and then): the per-line rule mattered where a
// contact's lines are shorter than the cadence (haus.ngc's 0.09 mm lines) —
// and the tracks on which plan 7.3 check 2 found a near stay ending early.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepCollisions, type CollisionModel, type CollisionTrack } from "./collision";
import { CONTACT, MARGIN, generatedCase, inSpans, insideTrack, loadShippedModel, meetsSpan, randomTrack, rng, shippedCases,
         shortLines, tablesByPair, trackTruth, type Case, type FixtureFiles } from "./collisionFixtures";
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_RAPID } from "./contactStore";
import { buildContactView, contactBands, lineMark, lineRuns, runsOf, T_NEAR, T_RAPID, targetAt, targetEnd, targetKind, targetPos,
         tintAt, trackLineAt, type ContactView } from "./contactView";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 0.01;   // interval boundaries are bisected to 1e-3
const COLUMNS = 8192;

type Run = { st: ContactStore; queries: number; probes: number; v: ContactView };
const viewOf = (model: CollisionModel, st: ContactStore, end: number): ContactView => buildContactView({
  sources: [{ stores: [st], at: c => c, ownCoverage: end }], coverage: end,
  pairName: p => ({ a: model.bodies[model.pairs[p]![0]]!.id, b: model.bodies[model.pairs[p]![1]]!.id }) });
function sweepWith(model: CollisionModel, track: CollisionTrack, lineSample: boolean): Run {
  const st = new ContactStore(1, 0);
  const profile: { queries?: Uint32Array; probes?: Uint32Array } = {};
  const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store: st }, profile, ...(lineSample ? { lineSample: true } : {}) });
  expect(r.truncated, "swept whole").toBeNull();
  const sum = (a?: Uint32Array) => { let n = 0; for (const x of a ?? []) n += x; return n; };
  return { st, queries: sum(profile.queries), probes: sum(profile.probes), v: viewOf(model, st, track.cum[track.count - 1]!) };
}

// `queries`: the main step's distance queries with / without the per-line
// sample; `probes`: those away from it (the re-sampling after a touch, the
// store's bisections) — what the rule cost and what its absence costs
const tally = { compared: 0, stayLines: 0, findings: 0, rapidFindings: 0, marks: 0, columns: 0, narrow: 0,
                queries: { with: 0, without: 0 }, probes: { with: 0, without: 0 } };

/** A difference the truth shows no wider than MIN_ADV: it excuses exactly
 *  its pair's stretch [lo, hi] — never the pair elsewhere, never another
 *  pair (Codex R174 VP-I128: one narrow difference excused a whole pair). */
type Exempt = { pair: number; lo: number; hi: number };

/** Hold the run without the per-line sample to cover the run with it (see
 *  the head); `seed`: exemptions to start from (the sensitivity guard). */
function compareRuns(model: CollisionModel, c: Case, track: CollisionTrack, on: Run, off: Run, where: string, seed: Exempt[] = [],
                     count = tally): Exempt[] {
  const truth = trackTruth(model, c, track);
  const end = track.cum[track.count - 1]!;
  const ids = (pi: number) => `${model.bodies[model.pairs[pi]![0]]!.id}/${model.bodies[model.pairs[pi]![1]]!.id}`;
  const pairIdx = new Map(model.pairs.map((_, pi) => [ids(pi), pi]));
  const OFF = tablesByPair(off.st, end);
  const exempts: Exempt[] = [...seed];
  const exempted = (pi: number, a: number, b = a) => exempts.some(e => e.pair === pi && a >= e.lo - TOL && b <= e.hi + TOL);
  const narrow = (pi: number, x: number, e: number, alsoInside: boolean, what: string, within?: [number, number]) => {
    const [lo, hi] = truth.runAround(pi, x, e, alsoInside, within);
    expect(hi - lo, `${where}: ${ids(pi)} ${what} at ${x.toFixed(4)} — the truth's run [${lo.toFixed(4)}, ${hi.toFixed(4)}]`).toBeLessThanOrEqual(truth.WIDE);
    exempts.push({ pair: pi, lo, hi });
    count.narrow++;
    return hi;
  };
  const bodies = (pi: number) => [model.bodies[model.pairs[pi]![0]]!, model.bodies[model.pairs[pi]![1]]!] as const;
  // 1 · the touch intervals: witness, decided entry, decided exit
  const S = on.st;
  for (let k = 0; k < S.intervals.rows; k++) {
    const pi = S.episodes.get(S.intervals.get(k, "episode"), "pair");
    const other = OFF.get(pi)?.touches ?? [];
    const exit = S.intervals.get(k, "exit"), decidedExit = (S.intervals.get(k, "flags") & IV_EXIT_DECIDED) !== 0;
    const decidedEnter = (S.intervals.get(k, "flags") & IV_ENTER_DECIDED) !== 0;
    const xs: number[] = [S.intervals.get(k, "witness"), ...(decidedEnter ? [S.intervals.get(k, "enter")] : []),
                          ...(decidedExit && !Number.isNaN(exit) ? [exit] : [])];
    for (const x of xs) {
      if (inSpans(other, x, TOL)) { count.compared++; continue; }
      narrow(pi, x, CONTACT * 10, true, "touch only with the per-line sample");
    }
  }
  // 2 · the stays, per LINE: every line a stay of the run with it reaches, a
  // stay (or a touch) of the same pair without it reaches — else the truth
  // shows every run of the pair inside the margin on that line no wider than
  // MIN_ADV (a stay ends at its last sample inside the margin: plan 7.3 check
  // 2 found stays without the per-line sample ending before lines the pair
  // was inside the margin on; the margin exit is searched since)
  for (let e = 0; e < S.episodes.rows; e++) {
    const pi = S.episodes.get(e, "pair"), u = S.episodes.get(e, "onset"), x = S.episodes.get(e, "end"), w = Number.isNaN(x) ? end : x;
    const o = OFF.get(pi), [A, B] = bodies(pi);
    for (let seg = 1; seg < track.count; seg++) {
      if (track.cum[seg]! < u || track.cum[seg - 1]! > w) continue;
      if (seg > 1 && track.lines[seg - 1] === track.lines[seg] && track.cum[seg - 1]! >= u) continue;   // the line once
      const line = truth.lineSpan(seg);
      count.stayLines++;
      if (o && (meetsSpan(o.stays, line[0], line[1]) || meetsSpan(o.touches, line[0], line[1]))) continue;
      // the truth: every run inside the margin on the line, inside the stay
      for (let y = Math.max(u, line[0]); y <= Math.min(w, line[1]); y += 0.05) {
        truth.poseAt(y);
        if (truth.below(A, B, MARGIN) === null) continue;
        y = narrow(pi, y, MARGIN, false, `inside the margin on L${track.lines[seg]}, reached by a stay only with the per-line sample`, line);
      }
    }
  }
  // 3 · the findings, each by its OWN pair (the target's bodies): a contact
  // inside a touch interval of the pair, a rapid one inside one touched on a
  // rapid (unless every touch on a rapid move there is narrow); a near miss
  // on a line a stay of the pair reaches
  const offIv = (pi: number) => {
    const out: Array<{ a: number; b: number; rapid: boolean }> = [];
    for (let k = 0; k < off.st.intervals.rows; k++) {
      if (off.st.episodes.get(off.st.intervals.get(k, "episode"), "pair") !== pi) continue;
      const b = off.st.intervals.get(k, "exit");
      out.push({ a: off.st.intervals.get(k, "enter"), b: Number.isNaN(b) ? end : b, rapid: (off.st.intervals.get(k, "flags") & IV_RAPID) !== 0 });
    }
    return out;
  };
  const lineAt = trackLineAt(track);
  for (let i = 0; i < on.v.n; i++) {
    const t = targetAt(on.v, i, lineAt), pi = pairIdx.get(`${t.a}/${t.b}`)!;
    const kind = targetKind(on.v, i), p = targetPos(on.v, i), q = targetEnd(on.v, i);
    if (exempted(pi, p)) continue;
    if (kind & T_NEAR) {
      const line = truth.lineSpan(truth.poseAt(p)), o = OFF.get(pi);
      expect(!!o && (meetsSpan(o.stays, line[0], line[1]) || inSpans(o.touches, p, TOL)), `${where}: ${ids(pi)} near miss at ${p.toFixed(4)}`).toBe(true);
      count.findings++;
      continue;
    }
    const ivs = offIv(pi).filter(v => v.a <= q + TOL && v.b >= p - TOL);
    expect(ivs.some(v => p >= v.a - TOL && p <= v.b + TOL), `${where}: ${ids(pi)} contact at ${p.toFixed(4)} inside a contact of the run without`).toBe(true);
    count.findings++;
    if (kind & T_RAPID) {
      count.rapidFindings++;
      if (ivs.some(v => v.rapid)) continue;
      // the truth: every touch on a rapid move inside [p, q] no wider than MIN_ADV within its move
      const [A, B] = bodies(pi);
      for (let seg = 1; seg < track.count; seg++) {
        if (!track.rapid[seg]) continue;
        const a = Math.max(p, track.cum[seg - 1]!), b = Math.min(q, track.cum[seg]!);
        for (let x = a; x <= b; x += 0.05) {
          truth.poseAt(x);
          if (truth.below(A, B, CONTACT * 10) === null) continue;
          x = narrow(pi, x, CONTACT * 10, true, `touch on the rapid move ending at ${track.cum[seg]!.toFixed(4)} — its finding at ${p.toFixed(4)} is a feed without the per-line sample`,
                     [track.cum[seg - 1]!, track.cum[seg]!]);
        }
      }
    }
  }
  // 4 · the tint: at every witness of the run with it, the pair's bodies tinted
  for (let k = 0; k < S.intervals.rows; k++) {
    const pi = S.episodes.get(S.intervals.get(k, "episode"), "pair");
    const w = S.intervals.get(k, "witness");
    if (exempted(pi, w)) continue;
    // at the witness — or, within the bisection's tolerance, at the nearest
    // point of the run without's interval (its entry is bisected to 1e-3)
    const iv = offIv(pi).find(v => w >= v.a - TOL && w <= v.b + TOL);
    const x = iv ? Math.min(Math.max(w, iv.a), iv.b) : w, tint = tintAt(off.v, x);
    const [a, b] = ids(pi).split("/");
    expect(tint.has(a!) && tint.has(b!), `${where}: ${ids(pi)} tinted at ${x.toFixed(4)}`).toBe(true);
  }
  // 5 · the code marks: every line marked with it is marked without it —
  // else every stay of the run with it on the line lies in an exemption of its pair
  const runs = lineRuns(track);
  for (let i = 0; i < track.count; i++) {
    const line = track.lines[i]!;
    if (i > 0 && track.lines[i - 1] === line) continue;
    const spans = runsOf(runs, line);
    if (!lineMark(on.v, line, spans, lineAt)) continue;
    count.marks++;
    if (lineMark(off.v, line, spans, lineAt)) continue;
    for (let e = 0; e < S.episodes.rows; e++) {
      const pi = S.episodes.get(e, "pair"), u = S.episodes.get(e, "onset"), x = S.episodes.get(e, "end"), w = Number.isNaN(x) ? end : x;
      for (const [a, b] of spans) {
        if (w < a || u > b) continue;
        expect(exempted(pi, Math.max(a, u), Math.min(b, w)), `${where}: L${line} marked only with the per-line sample (${ids(pi)})`).toBe(true);
      }
    }
  }
  // 6 · the timeline's bands: every column lit with it is lit without it —
  // else every contact of the run with it there lies in an exemption of its
  // pair, or a contact of the pair without it ends within the bisection's
  // tolerance of the column
  const lit = (v: ContactView) => {
    const sl = new Uint8Array(COLUMNS);
    for (const [f0, f1] of contactBands(v, COLUMNS, end))
      for (let k = Math.floor(f0 * COLUMNS); k < Math.min(COLUMNS, Math.ceil(f1 * COLUMNS)); k++) sl[k] = 1;
    return sl;
  };
  const lOn = lit(on.v), lOff = lit(off.v);
  for (let k = 0; k < COLUMNS; k++) {
    if (!lOn[k]) continue;
    count.columns++;
    if (lOff[k]) continue;
    const a = k / COLUMNS * end, b = (k + 1) / COLUMNS * end;
    for (let r = 0; r < S.intervals.rows; r++) {
      const pi = S.episodes.get(S.intervals.get(r, "episode"), "pair"), u = S.intervals.get(r, "enter"), x = S.intervals.get(r, "exit"), w = Number.isNaN(x) ? end : x;
      if (w < a || u > b) continue;
      const lo = Math.max(a, u), hi = Math.min(b, w);
      expect(exempted(pi, lo, hi) || offIv(pi).some(v => v.a <= hi + TOL && v.b >= lo - TOL),
        `${where}: band column ${k} (${a.toFixed(3)}–${b.toFixed(3)}) lit only with the per-line sample (${ids(pi)})`).toBe(true);
    }
  }
  return exempts;
}

/** Sweep `track` with and without the per-line sample and compare. */
function holdsCover(model: CollisionModel, c: Case, track: CollisionTrack, where: string) {
  const on = sweepWith(model, track, true), off = sweepWith(model, track, false);
  tally.queries.with += on.queries; tally.queries.without += off.queries;
  tally.probes.with += on.probes; tally.probes.without += off.probes;
  compareRuns(model, c, track, on, off, where);
}

describe("without the per-line sample, a sweep covers what the sweep with it found (B8)", () => {
  for (const c of shippedCases(FILES)) {
    it(`${c.name}: tables and views`, { timeout: 600_000 }, () => {
      const { model } = loadShippedModel(c, FILES);
      const rand = rng((c.seed ?? 20261007 + c.name.length) + 8);
      holdsCover(model, c, shortLines(randomTrack(c, rand, 3, 0.25), rand), `${c.name} track`);
      if (c.inside) holdsCover(model, c, shortLines(insideTrack(c, c.inside, rng(5)), rand), `${c.name} inside track`);
    });
  }
  for (let seed = 20261012; seed < 20261017; seed++) {
    it(`generated machine ${seed}: tables and views`, { timeout: 600_000 }, () => {
      const { c, model } = generatedCase(seed);
      const rand = rng(seed + 8);
      holdsCover(model, c, shortLines(randomTrack(c, rand, 4, 0.5), rand), `${c.name} track`);
    });
  }
  // the tracks on which plan 7.3 check 2 (the oracle at 0.05) found stays
  // ending before lines the pair was inside the margin on, as the oracle
  // draws them (its first track of the machine)
  for (const seed of [20261036, 20261049, 20261053, 20261060]) {
    it(`generated machine ${seed}, the oracle's track: tables and views`, { timeout: 600_000 }, () => {
      const { c, model } = generatedCase(seed);
      holdsCover(model, c, randomTrack(c, rng(seed), 4, 0.5), `${c.name} oracle track`);
    });
  }
  // The exemptions' sensitivity (Codex R174 VP-I128): an exemption of a pair
  // on one stretch excuses nothing of the pair elsewhere. The run without the
  // per-line sample, damaged away from a seeded exemption of the same pair —
  // the rapid touch under a rapid finding cleared, the contact under it cut
  // to nothing — is red; undamaged, with the same exemption, green.
  it("an exemption excuses only its own stretch: damage elsewhere in the same pair is red (Codex R174 VP-I128)", { timeout: 600_000 }, () => {
    const seed = 20261014, { c, model } = generatedCase(seed), rand = rng(seed + 8);
    const track = shortLines(randomTrack(c, rand, 4, 0.5), rand), end = track.cum[track.count - 1]!;
    const truth = trackTruth(model, c, track), lineAt = trackLineAt(track);
    const on = sweepWith(model, track, true);
    const scratch = { compared: 0, stayLines: 0, findings: 0, rapidFindings: 0, marks: 0, columns: 0, narrow: 0,
                      queries: { with: 0, without: 0 }, probes: { with: 0, without: 0 } };
    // a rapid finding of the run with it whose rapid touch the truth shows wide
    let pick: { pi: number; p: number; q: number } | null = null;
    for (let i = 0; i < on.v.n && !pick; i++) {
      const kind = targetKind(on.v, i);
      if (!(kind & T_RAPID) || (kind & T_NEAR)) continue;
      const t = targetAt(on.v, i, lineAt), pi = model.pairs.findIndex(([a, b]) => model.bodies[a]!.id === t.a && model.bodies[b]!.id === t.b);
      const p = targetPos(on.v, i), q = targetEnd(on.v, i), A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
      for (let seg = 1; seg < track.count && !pick; seg++) {
        if (!track.rapid[seg]) continue;
        for (let x = Math.max(p, track.cum[seg - 1]!); x <= Math.min(q, track.cum[seg]!) && !pick; x += 0.05) {
          truth.poseAt(x);
          if (truth.below(A, B, CONTACT * 10) !== null && truth.runWide(pi, x, CONTACT * 10, true, [track.cum[seg - 1]!, track.cum[seg]!])) pick = { pi, p, q };
        }
      }
    }
    expect(pick, "a rapid finding with a wide rapid touch").not.toBeNull();
    const { pi, p, q } = pick!;
    const far: Exempt[] = [{ pair: pi, lo: end + 1, hi: end + 2 }];   // the same pair, excused elsewhere
    const damaged = (hurt: (st: ContactStore, k: number) => void): Run => {
      const off = sweepWith(model, track, false), I = off.st.intervals;
      for (let k = 0; k < I.rows; k++) {
        if (off.st.episodes.get(I.get(k, "episode"), "pair") !== pi) continue;
        const x = I.get(k, "exit");
        if (I.get(k, "enter") <= q + TOL && (Number.isNaN(x) ? end : x) >= p - TOL) hurt(off.st, k);
      }
      off.v = viewOf(model, off.st, end);
      return off;
    };
    expect(() => compareRuns(model, c, track, on, sweepWith(model, track, false), "undamaged", far, scratch), "undamaged: green").not.toThrow();
    expect(() => compareRuns(model, c, track, on, damaged((st, k) => st.intervals.set(k, "flags", st.intervals.get(k, "flags") & ~IV_RAPID)), "rapid lost", far, scratch),
      "the rapid touch under the finding cleared").toThrow(/feed without the per-line sample/);
    expect(() => compareRuns(model, c, track, on, damaged((st, k) => st.intervals.set(k, "exit", st.intervals.get(k, "enter"))), "contact lost", far, scratch),
      "the contact under the finding cut to nothing").toThrow(/only with the per-line sample/);
  });
  it("the comparison saw contacts, rapid findings and queries the rule no longer takes", () => {
    if (process.env.LINE_SAMPLE_LOG) fs.appendFileSync(process.env.LINE_SAMPLE_LOG, JSON.stringify(tally) + "\n");
    expect(tally.compared, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.stayLines, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.findings, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.rapidFindings, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.marks, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.queries.with, JSON.stringify(tally)).toBeGreaterThan(tally.queries.without);
  });
});
