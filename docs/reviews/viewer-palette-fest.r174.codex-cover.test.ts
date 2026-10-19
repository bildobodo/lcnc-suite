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
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_RAPID, NONE } from "./contactStore";
import { buildContactView, contactBands, lineMark, lineRuns, runsOf, T_NEAR, T_RAPID, targetEnd, targetKind, targetPos,
         tintAt, trackLineAt, targetKey, targetAt, type ContactView } from "./contactView";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 0.01;   // interval boundaries are bisected to 1e-3
const COLUMNS = 8192;

type Run = { st: ContactStore; queries: number; probes: number; v: ContactView };
function sweepWith(model: CollisionModel, track: CollisionTrack, lineSample: boolean): Run {
  const st = new ContactStore(1, 0);
  const profile: { queries?: Uint32Array; probes?: Uint32Array } = {};
  const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store: st }, profile, ...(lineSample ? { lineSample: true } : {}) });
  expect(r.truncated, "swept whole").toBeNull();
  const end = track.cum[track.count - 1]!;
  const pairName = (p: number) => ({ a: model.bodies[model.pairs[p]![0]]!.id, b: model.bodies[model.pairs[p]![1]]!.id });
  const v = buildContactView({ sources: [{ stores: [st], at: c => c, ownCoverage: end }], pairName, coverage: end });
  const sum = (a?: Uint32Array) => { let n = 0; for (const x of a ?? []) n += x; return n; };
  return { st, queries: sum(profile.queries), probes: sum(profile.probes), v };
}

// `queries`: the main step's distance queries with / without the per-line
// sample; `probes`: those away from it (the re-sampling after a touch, the
// store's bisections) — what the rule cost and what its absence costs
const tally = { compared: 0, stayLines: 0, findings: 0, rapidFindings: 0, marks: 0, columns: 0, narrow: 0,
                queries: { with: 0, without: 0 }, probes: { with: 0, without: 0 } };

/** Sweep `track` with and without the per-line sample and hold the run
 *  without it to cover the run with it (see the head). */
function holdsCover(model: CollisionModel, c: Case, track: CollisionTrack, where: string) {
  const on = sweepWith(model, track, true), off = sweepWith(model, track, false);
  tally.queries.with += on.queries; tally.queries.without += off.queries;
  tally.probes.with += on.probes; tally.probes.without += off.probes;
  const truth = trackTruth(model, c, track);
  const end = track.cum[track.count - 1]!;
  const ids = (pi: number) => `${model.bodies[model.pairs[pi]![0]]!.id}/${model.bodies[model.pairs[pi]![1]]!.id}`;
  const ON = tablesByPair(on.st, end), OFF = tablesByPair(off.st, end);
  // pairs where the run with the per-line sample saw something the run
  // without did not, and the truth shows it no wider than MIN_ADV: their
  // views may differ there (the views follow from the tables)
  const narrowPairs = new Set<number>();
  const touchNarrow = (pi: number, x: number) => {
    const wide = truth.runWide(pi, x, CONTACT * 10, true);
    expect(wide, `${where}: ${ids(pi)} touch at ${x.toFixed(4)} only with the per-line sample`).toBe(false);
    narrowPairs.add(pi); tally.narrow++;
  };
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
      if (inSpans(other, x, TOL)) { tally.compared++; continue; }
      touchNarrow(pi, x);
    }
  }
  // 2 · the stays, per LINE: every line a stay of the run with it reaches, a
  // stay (or a touch) of the same pair without it reaches — else the truth
  // shows the pair inside the margin on that line for no more than MIN_ADV
  // (a stay ends at its last sample inside the margin: plan 7.3 check 2 found
  // stays without the per-line sample ending before lines the pair was inside
  // the margin on; the margin exit is re-sampled since)
  for (let e = 0; e < S.episodes.rows; e++) {
    const pi = S.episodes.get(e, "pair"), u = S.episodes.get(e, "onset"), x = S.episodes.get(e, "end"), w = Number.isNaN(x) ? end : x;
    const o = OFF.get(pi), A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
    for (let seg = 1; seg < track.count; seg++) {
      if (track.cum[seg]! < u || track.cum[seg - 1]! > w) continue;
      if (seg > 1 && track.lines[seg - 1] === track.lines[seg] && track.cum[seg - 1]! >= u) continue;   // the line once
      const line = truth.lineSpan(seg);
      tally.stayLines++;
      if (o && (meetsSpan(o.stays, line[0], line[1]) || meetsSpan(o.touches, line[0], line[1]))) continue;
      // the truth: a pose inside the margin on the line, inside the stay
      for (let y = Math.max(u, line[0]); y <= Math.min(w, line[1]); y += 0.05) {
        truth.poseAt(y);
        if (truth.below(A, B, MARGIN) === null) continue;
        expect(truth.runWide(pi, y, MARGIN, false, line),
          `${where}: ${ids(pi)} inside the margin at ${y.toFixed(4)} on L${track.lines[seg]} — a stay reaches the line only with the per-line sample`).toBe(false);
        narrowPairs.add(pi); tally.narrow++;
        break;
      }
    }
  }
  const pairOf = (v: ContactView, i: number): number => {
    // a target's pair, by its position: the episode whose interval or closest approach it is
    const p = targetPos(v, i), near = (targetKind(v, i) & T_NEAR) !== 0, st = v === on.v ? on.st : off.st;
    for (let e = 0; e < st.episodes.rows; e++) {
      if (near) { if (st.episodes.get(e, "ivCount") === 0 && Math.abs(st.episodes.get(e, "closeAt") - p) <= 1e-6) return st.episodes.get(e, "pair"); continue; }
      for (let iv = st.episodes.get(e, "firstIv"); iv !== NONE; iv = st.intervals.get(iv, "next"))
        if (Math.abs(st.intervals.get(iv, "enter") - p) <= 1e-6) return st.episodes.get(e, "pair");
    }
    throw new Error(`${where}: target ${i} at ${p} has no row`);
  };
  // Codex R174: observe the scope of the short-contact exemption, without changing the production code.
  if (narrowPairs.size) {
    const skipped = [];
    for (let k = 0; k < on.v.n; k++) if (narrowPairs.has(pairOf(on.v, k))) skipped.push({pair: ids(pairOf(on.v,k)), at: targetPos(on.v,k), end: targetEnd(on.v,k), kind: targetKind(on.v,k)});
    fs.appendFileSync('/tmp/codex-r174-lvzu29b5/exemptions.jsonl',JSON.stringify({where,pairs:[...narrowPairs].map(ids),skipped})+'\n');
    if (process.env.CODEX_REMOVE_RAPID === '1') {
      const before = Array.from({length:off.v.n},(_,i)=>({key:targetKey(off.v,i), kind:targetKind(off.v,i), at:targetPos(off.v,i), end:targetEnd(off.v,i), bodyPair:targetAt(off.v,i,()=>null)}));
      let removed = 0, wideRapid = 0;
      const wideProofs:any[]=[];
      for (let k=0;k<off.st.intervals.rows;k++) {
        const pi = off.st.episodes.get(off.st.intervals.get(k,'episode'),'pair');
        if (!narrowPairs.has(pi)) continue;
        const flags = off.st.intervals.get(k,'flags');
        if (!(flags & IV_RAPID)) continue;
        const w = off.st.intervals.get(k,'witness');
        const seg = truth.poseAt(w);
        if (track.rapid[seg] && truth.runWide(pi,w,CONTACT*10,true,[track.cum[seg-1]!,track.cum[seg]!])) {wideRapid++;wideProofs.push({pair:ids(pi),witness:w,line:track.lines[seg],rapidMoveSpan:[track.cum[seg-1],track.cum[seg]]});}
        off.st.intervals.set(k,'flags',flags & ~IV_RAPID); removed++;
      }
      off.v = buildContactView(off.v.input);
      const after = new Map(Array.from({length:off.v.n},(_,i)=>[targetKey(off.v,i),targetKind(off.v,i)]));
      const lostRapid=before.filter(t=>(t.kind&T_RAPID)&&!(after.get(t.key)!&T_RAPID));
      const lostWide:any[]=[];
      for (const item of lostRapid) {
        const pi=model.pairs.findIndex(([a,b])=>model.bodies[a]!.id===item.bodyPair.a && model.bodies[b]!.id===item.bodyPair.b);
        const [ai,bi]=model.pairs[pi]!;
        let found=false;
        for(let seg=1;seg<track.count&&!found;seg++) {
          if(!track.rapid[seg]) continue;
          const lo=Math.max(item.at,track.cum[seg-1]!),hi=Math.min(item.end,track.cum[seg]!);
          for(let x=lo+0.05;x<hi;x+=0.1){
            truth.poseAt(x);
            if(truth.below(model.bodies[ai]!,model.bodies[bi]!,CONTACT*10)===null)continue;
            if(truth.runWide(pi,x,CONTACT*10,true,[track.cum[seg-1]!,track.cum[seg]!])) {lostWide.push({key:item.key,pair:ids(pi),at:x,line:track.lines[seg],rapidMoveSpan:[track.cum[seg-1],track.cum[seg]]});found=true;break;}
          }
        }
      }
      expect(lostWide.length, 'a lost published rapid flag has a real wide rapid contact').toBeGreaterThan(0);
      fs.appendFileSync('/tmp/codex-r174-lvzu29b5/exemptions-final.jsonl',JSON.stringify({where,mutation:'remove rapid flags for the exempted pair',removed,wideRapid,wideProofs,lostRapid,lostWide})+'\n');
      expect(removed, 'this counterproof actually removed rapid flags').toBeGreaterThan(0);
      expect(wideRapid, 'at least one removed rapid flag belongs to a contact wider than MIN_ADV').toBeGreaterThan(0);
      expect(lostRapid.length, 'the mutation actually changes the published findings').toBeGreaterThan(0);
      if (process.env.CODEX_ENFORCE_RAPID === '1') expect(lostWide.length, 'a narrow exception elsewhere must not excuse loss of a wide rapid contact').toBe(0);
    }
  }
  // 3 · the findings: a contact inside a touch interval of the pair, a rapid
  // one inside one touched on a rapid (unless the truth's rapid touch there
  // is narrow); a near miss on a line a stay of the pair reaches
  const offIv = (pi: number) => {
    const out: Array<{ a: number; b: number; rapid: boolean }> = [];
    for (let k = 0; k < off.st.intervals.rows; k++) {
      if (off.st.episodes.get(off.st.intervals.get(k, "episode"), "pair") !== pi) continue;
      const b = off.st.intervals.get(k, "exit");
      out.push({ a: off.st.intervals.get(k, "enter"), b: Number.isNaN(b) ? end : b, rapid: (off.st.intervals.get(k, "flags") & IV_RAPID) !== 0 });
    }
    return out;
  };
  for (let i = 0; i < on.v.n; i++) {
    const pi = pairOf(on.v, i);
    if (narrowPairs.has(pi)) continue;
    const kind = targetKind(on.v, i), p = targetPos(on.v, i), q = targetEnd(on.v, i);
    if (kind & T_NEAR) {
      const line = truth.lineSpan(truth.poseAt(p)), o = OFF.get(pi);
      expect(!!o && (meetsSpan(o.stays, line[0], line[1]) || inSpans(o.touches, p, TOL)), `${where}: ${ids(pi)} near miss at ${p.toFixed(4)}`).toBe(true);
      tally.findings++;
      continue;
    }
    const ivs = offIv(pi).filter(v => v.a <= q + TOL && v.b >= p - TOL);
    expect(ivs.some(v => p >= v.a - TOL && p <= v.b + TOL), `${where}: ${ids(pi)} contact at ${p.toFixed(4)} inside a contact of the run without`).toBe(true);
    tally.findings++;
    if (kind & T_RAPID) {
      tally.rapidFindings++;
      if (ivs.some(v => v.rapid)) continue;
      // the truth: a touch on a rapid move inside [p, q], wider than MIN_ADV within its move
      for (let seg = 1; seg < track.count; seg++) {
        if (!track.rapid[seg]) continue;
        const a = Math.max(p, track.cum[seg - 1]!), b = Math.min(q, track.cum[seg]!);
        for (let x = a; x <= b; x += 0.05) {
          truth.poseAt(x);
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          const d = truth.below(A, B, CONTACT * 10);
          if (d === null) continue;
          expect(truth.runWide(pi, x, CONTACT * 10, true, [track.cum[seg - 1]!, track.cum[seg]!]),
            `${where}: ${ids(pi)} touches on the rapid move ending at ${track.cum[seg]!.toFixed(4)} — its finding at ${p.toFixed(4)} is a feed without the per-line sample`).toBe(false);
          break;
        }
      }
    }
  }
  // 4 · the tint: at every witness of the run with it, the pair's bodies tinted
  for (let k = 0; k < S.intervals.rows; k++) {
    const pi = S.episodes.get(S.intervals.get(k, "episode"), "pair");
    if (narrowPairs.has(pi)) continue;
    // at the witness — or, within the bisection's tolerance, at the nearest
    // point of the run without's interval (its entry is bisected to 1e-3)
    const w = S.intervals.get(k, "witness"), iv = offIv(pi).find(v => w >= v.a - TOL && w <= v.b + TOL);
    const x = iv ? Math.min(Math.max(w, iv.a), iv.b) : w, t = tintAt(off.v, x);
    const [a, b] = ids(pi).split("/");
    const near = (sp: Array<[number, number]> | undefined) => JSON.stringify((sp ?? []).filter(([u, w]) => u <= x + 5 && w >= x - 5));
    expect(t.has(a!) && t.has(b!), `${where}: ${ids(pi)} tinted at ${x.toFixed(4)} — touches ${near(OFF.get(pi)?.touches)}, gaps ${near(OFF.get(pi)?.gaps)}; with it: gaps ${near(ON.get(pi)?.gaps)}`).toBe(true);
  }
  // 5 · the code marks: every line marked with it is marked without it
  const runs = lineRuns(track), lineAt = trackLineAt(track);
  const narrowEps = (st: ContactStore) => {
    const out: Array<[number, number]> = [];
    for (let e = 0; e < st.episodes.rows; e++) if (narrowPairs.has(st.episodes.get(e, "pair"))) {
      const x = st.episodes.get(e, "end");
      out.push([st.episodes.get(e, "onset"), Number.isNaN(x) ? end : x]);
    }
    return out;
  };
  const excused = narrowEps(on.st);
  for (let i = 0; i < track.count; i++) {
    const line = track.lines[i]!;
    if (i > 0 && track.lines[i - 1] === line) continue;
    const spans = runsOf(runs, line);
    if (!lineMark(on.v, line, spans, lineAt)) continue;
    tally.marks++;
    if (lineMark(off.v, line, spans, lineAt)) continue;
    expect(spans.some(([a, b]) => meetsSpan(excused, a, b)), `${where}: L${line} marked only with the per-line sample`).toBe(true);
  }
  // 6 · the timeline's bands: every column lit with it is lit without it
  const lit = (v: ContactView) => {
    const s = new Uint8Array(COLUMNS);
    for (const [f0, f1] of contactBands(v, COLUMNS, end))
      for (let k = Math.floor(f0 * COLUMNS); k < Math.min(COLUMNS, Math.ceil(f1 * COLUMNS)); k++) s[k] = 1;
    return s;
  };
  const lOn = lit(on.v), lOff = lit(off.v);
  for (let k = 0; k < COLUMNS; k++) {
    if (!lOn[k]) continue;
    tally.columns++;
    if (lOff[k]) continue;
    const a = k / COLUMNS * end, b = (k + 1) / COLUMNS * end;
    expect(meetsSpan(excused, a, b), `${where}: band column ${k} (${a.toFixed(3)}–${b.toFixed(3)}) lit only with the per-line sample`).toBe(true);
  }
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
