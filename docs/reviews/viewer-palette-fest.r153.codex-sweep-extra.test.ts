// Round B4 after Codex R152 (VP-I113): a rerun that learns nothing new keeps
// every earlier event — through the REAL sweep, not made-up rows. A head with
// a Ø20 tool passes a vise; the tool is unknown on random stretches, known
// again for an instant at times (two touching tool gaps; Codex's probe: the
// known phase's own time coordinates fall together in f32), and the time
// axis collapses at random. The sweep writes the earlier generation; the view
// of it alone, its union with an EMPTY rerun and its union with an IDENTICAL
// rerun must list the same events: keys, positions, ends, kinds (an earlier
// near miss the empty rerun did not find again is "from the earlier run" —
// its key and place stay).
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from "vitest";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from "./collision";
import { boxPositions } from "./collisionFixtures";
import { ContactStore, IV_AFTER_UNKNOWN_TOOL } from "./contactStore";
import { buildContactView, findKey, T_EARLIER, targetEnd, targetKey, targetKind, targetPos, type ContactView } from "./contactView";
import { buildScrubTrack, type ScrubTrack } from "./scrubTrack";

const machine: CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
  kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
const model = buildCollisionModel(machine, [
  { id: "vise", group: "table", positions: boxPositions(2, 2, 2, 0, 0, 1) },
  { id: "tool", group: "head", positions: toolCylinderPositions(20, 2), tool: true },
]);
const pairName = (p: number) => ({ a: model.bodies[model.pairs[p]![0]]!.id, b: model.bodies[model.pairs[p]![1]]!.id });
/** Tool 1 is known (Ø20, 2 long), tool 3 has no length: its stretches are tool gaps. */
const EVENTS = [{ seq: 0, xyz: [0, 0, 0] as [number, number, number], tool: 1 }, { seq: 1, xyz: [0, 0, 0] as [number, number, number], tool: 3 }];

function track(xs: number[], times: number[], unknown: number[]): ScrubTrack {
  const n = xs.length;
  return buildScrubTrack({ pos: new Float32Array() }, {
    pos: new Float32Array(xs.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
    lines: Uint32Array.from({ length: n }, (_, i) => i + 1), seq: Uint32Array.from({ length: n }, (_, i) => i + 1),
    tcum: new Float32Array(times), tlo: Uint32Array.from(unknown),
  }, undefined, undefined, undefined, EVENTS)!;
}
function sweep(t: ScrubTrack, generation: number): ContactStore {
  const st = new ContactStore(1, generation);
  const r = sweepCollisions(model, t, { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 }, {
    margin: 0.1, linStepMm: 0.1, rotStepDeg: 0.1, tloEvents: EVENTS, toolDims: { 1: { diam: 20, len: 2 } }, liveTool: 1, unknownTools: [3],
    contacts: { store: st },
  });
  expect(r.truncated).toBeNull();
  return st;
}
/** The three views: the earlier generation alone, with an empty rerun, with an identical one. */
function views(t: ScrubTrack): { plain: ContactView; empty: ContactView; same: ContactView; old: ContactStore } {
  const old = sweep(t, 0), cur = sweep(t, 1), end = t.cum[t.count - 1]!;
  const plain = buildContactView({ sources: [{ stores: [old], at: x => x, ownCoverage: end }], coverage: end, pairName });
  const empty = buildContactView({ sources: [{ stores: [new ContactStore(1, 1)], held: [old], heldCoverage: [end], at: x => x, ownCoverage: 0 }], coverage: end, pairName });
  const same = buildContactView({ sources: [{ stores: [cur], held: [old], heldCoverage: [end], at: x => x, ownCoverage: end }], coverage: end, pairName });
  return { plain, empty, same, old };
}
const list = (v: ContactView) => Array.from({ length: v.n }, (_, i) =>
  [targetKey(v, i), targetPos(v, i), targetEnd(v, i), targetKind(v, i) & ~T_EARLIER] as const);
/** Two contacts of a pair that touch at one coordinate within ONE known
 *  stretch (exit, free sample, re-entry in zero time — the second began after
 *  no restart): the free sample lies on both confirmed points, nothing in the
 *  store orders them, so the union joins them (the named limit; the second
 *  key is handed over to the piece). */
function oneInstantTwice(st: ContactStore): boolean {
  const I = st.intervals, E = st.episodes, last = new Map<number, number>();
  for (let iv = 0; iv < I.rows; iv++) {
    const pair = E.get(I.get(iv, "episode"), "pair"), prev = last.get(pair);
    if (prev !== undefined && I.get(prev, "exit") === I.get(iv, "enter") && !(I.get(iv, "flags") & IV_AFTER_UNKNOWN_TOOL)) return true;
    last.set(pair, iv);
  }
  return false;
}

describe("a rerun that learns nothing new keeps every earlier event (Codex R152 VP-I113), through the real sweep", () => {
  it.each([["collapsed", 10001.00001], ["apart", 10001.01]] as const)("Codex's probe: a known instant between two unknown stretches, its time %s", (_, t3) => {
    // the head passes the vise at X 6 … 10; unknown from 10000 to 10001 and from 10001(+) to 10002
    const t = track([6, 7, 8, 8.001, 9, 10], [0, 10000, 10001, t3, 10002, 10003], [0, 0, 1, 0, 1, 0]);
    const { plain, empty, same, old } = views(t);
    expect(plain.n, "before the unknown tool, the instant between, after it").toBe(3);
    expect(list(empty), "an empty rerun").toEqual(list(plain));
    expect(list(same), "an identical rerun").toEqual(list(plain));
    const second = targetKey(plain, 1);
    expect([findKey(empty, second), findKey(same, second)], "the middle event selectable in both").toEqual([1, 1]);
    // the sweep's own rows: the middle contact between two gaps that touch on the time axis when collapsed
    const gaps = Array.from({ length: old.gaps.rows }, (_, g) => [old.gaps.get(g, "start"), old.gaps.get(g, "end")]);
    expect(gaps.length).toBe(2);
    if (t3 === 10001.00001) expect(gaps[0]![1], "the gaps touch").toBe(gaps[1]![0]);
  });

  it("random passes: unknown stretches, known instants, collapsed times — the empty and the identical rerun list exactly the earlier events", { timeout: 300_000 }, () => {
    let seed = 153;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let cases = 0, events = 0, withGaps = 0, touching = 0, limit = 0, clusters = 0;
    const limitCases: unknown[] = [];
    for (let c = 0; c < 1000; c++) {
      const n = 12 + Math.floor(rnd() * 30);
      const xs: number[] = [], times: number[] = [], unknown: number[] = [];
      let x = 4 + rnd() * 12, time = 0, u = 0;
      for (let i = 0; i < n; i++) {
        if (i && rnd() < 0.12) {
          // a cluster: several moves in zero time (f32 at 1e4), the tool toggling at each, inside the vise's reach
          for (let r = 2 + Math.floor(rnd() * 4); r > 0 && xs.length < n; r--) {
            x = Math.min(x, 10.5) + 0.001;
            xs.push(x); time += 0.00001; times.push(10000 + time);
            u = 1 - u; unknown.push(u);
          }
          clusters++;
          if (xs.length >= n) break;
        }
        // in and out of the vise's reach (the tool touches up to X ≈ 11.1)
        x = Math.max(3, Math.min(17, x + (rnd() - 0.5) * 6));
        xs.push(rnd() < 0.1 && xs.length ? xs[xs.length - 1]! + 0.001 : x);
        // a collapsed step at the f32 resolution of 1e4 now and then
        time += rnd() < 0.15 ? 0.00001 : 0.5 + rnd() * 3;
        times.push(10000 + time);
        // the tool: unknown stretches, a known instant between two of them
        if (rnd() < (u ? 0.45 : 0.12)) u = 1 - u;
        unknown.push(xs.length === 1 ? 0 : u);
      }
      const t = track(xs, times, unknown);
      const { plain, empty, same, old } = views(t);
      const tag = `case ${c}: ${JSON.stringify({ xs, times, unknown })}`;
      const a=list(plain), b=list(empty), d=list(same);
      const lost = a.filter(v=>findKey(empty,String(v[0]))<0||findKey(same,String(v[0]))<0);
      const limits=oneInstantTwice(old);
      if(lost.length || (!limits && (JSON.stringify(a)!==JSON.stringify(b)||JSON.stringify(a)!==JSON.stringify(d)))) {
        writeFileSync('/tmp/codex-r153-rt47y2tc/sweep-extra-failure.json',JSON.stringify({c,xs,times,unknown,limits,plain:a,empty:b,same:d,lost},null,2));
      }
      expect(lost,tag+': each prior key in empty AND identical rerun').toEqual([]);
      if (limits) {
        // the named limit: one piece fewer at most per such instant, every earlier key still answers
        limit++;
        const aliases = a.map(v => [v[0], findKey(empty,String(v[0])),findKey(same,String(v[0]))]);
        limitCases.push({c,xs,times,unknown,plain:a,empty:b,same:d,aliases});
        const I=old.intervals, E=old.episodes, last=new Map<number,number>(); let collisions=0;
        for(let iv=0;iv<I.rows;iv++) {
          const pair=E.get(I.get(iv,'episode'),'pair'), prev=last.get(pair);
          if(prev!==undefined && I.get(prev,'exit')===I.get(iv,'enter') && !(I.get(iv,'flags')&IV_AFTER_UNKNOWN_TOOL)) collisions++;
          last.set(pair,iv);
        }
        expect(plain.n-empty.n,tag+': at most one merge per named boundary (empty)').toBeLessThanOrEqual(collisions);
        expect(plain.n-same.n,tag+': at most one merge per named boundary (same)').toBeLessThanOrEqual(collisions);
        for (let i = 0; i < plain.n; i++) expect(findKey(empty, targetKey(plain, i)), `${tag}: event ${i} handed over`).toBeGreaterThanOrEqual(0);
        continue;
      }
      expect(list(empty), `${tag}: an empty rerun`).toEqual(list(plain));
      expect(list(same), `${tag}: an identical rerun`).toEqual(list(plain));
      for (let i = 0; i < plain.n; i++) expect(findKey(empty, targetKey(plain, i)), `${tag}: event ${i} selectable`).toBe(i);
      cases++;
      events += plain.n;
      if (old.gaps.rows) withGaps++;
      for (let a = 0; a < old.gaps.rows; a++) for (let b = 0; b < old.gaps.rows; b++) {
        if (a !== b && old.gaps.get(a, "pair") === old.gaps.get(b, "pair") && old.gaps.get(a, "end") === old.gaps.get(b, "start")) touching++;
      }
    }
    writeFileSync('/tmp/codex-r153-rt47y2tc/sweep-extra.json',JSON.stringify({seed:153,total:1000,cases,events,withGaps,touching,limit,clusters,limitCases},null,2)+'\n');
    console.log(`[B4 rerun] ${cases} sweeps compared, ${events} events, ${withGaps} with tool gaps, ${touching} touching gap pairs, ` +
                `${clusters} zero-time clusters; ${limit} sweeps with two contacts in one known instant (the named limit)`);
    expect([withGaps > 100, touching > 20, events > 2 * cases, limit < 0.2 * cases], "tool gaps, gaps that touch, several events a pass, the limit rare")
      .toEqual([true, true, true, true]);
  });
});
