// Step 4 package 2, round B3: what the operator sees from the contact tables
// against what the records showed, from the SAME sweep (plan 7.2's comparison
// carried through the views — contactView against clashTargets): the
// findings the list, the count, the marks and the steps read, the line each
// names, the contact bands. The named differences of 7.2 carry through, and
// one of plan 4.1:
// - a record bridged a PROVEN free sample: the view has a re-entry more;
// - a record's refinement stopped at its line's start (R90): the view's
//   entry lies earlier — where the contact begins, on the line before;
// - the records kept one near miss per line and pair: the view has each stay;
// - one class (4.1): a record touching between 1e-4 and the views' old 1e-3
//   is a near miss by the sweep's class.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_EPS, sweepCollisions, type CollisionModel, type CollisionTrack } from "./collision";
import { ContactStore } from "./contactStore";
import { clashTargets, isNearMiss, type ClashTarget } from "./clashTargets";
import { buildContactView, contactBands, startTargets, targetAt, targetKind, trackLineAt, T_AT_START, viewCounts } from "./contactView";
import { findingWords } from "./sweepWords";
import { MARGIN, MIN_ADV, generatedCase, loadShippedModel, randomTrack, rng, shippedCases, type Case, type FixtureFiles } from "./collisionFixtures";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 3e-3;   // boundaries are bisected to 1e-3 in both sinks

interface Tally { startsIn: number; compared: number; contacts: number; nears: number; bridged: number; floored: number; touchedLater: number; reclassed: number; extraNear: number }

function compare(model: CollisionModel, track: CollisionTrack, where: string, t: Tally) {
  const store = new ContactStore(1, 0);
  const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store } });
  if (r.truncated || (r.capped ?? 0) > 0) return;   // the records were cut: no full comparison
  t.compared++;
  const end = track.cum[track.count - 1]!;
  const names = model.pairs.map(([a, b]) => ({ a: model.bodies[a]!.id, b: model.bodies[b]!.id }));
  const v = buildContactView({ sources: [{ stores: [store], at: c => c }], pairName: p => names[p]!, coverage: end });
  const lineAt = trackLineAt(track);
  const vt = Array.from({ length: v.n }, (_, i) => targetAt(v, i, lineAt));
  const rt = clashTargets(r.hits);
  // the free samples the store proved, per pair (the records' bridges)
  const pairKey = (x: { a: string; b: string }) => [x.a, x.b].sort().join("/");
  const free = new Map<string, number[]>();
  for (let iv = 0; iv < store.intervals.rows; iv++) {
    const f = store.intervals.get(iv, "freeAt");
    if (Number.isNaN(f)) continue;
    const k = pairKey(names[store.episodes.get(store.intervals.get(iv, "episode"), "pair")]!);
    free.set(k, [...(free.get(k) ?? []), f]);
  }
  const lineStarts = new Set<number>();
  for (let i = 1; i < track.count; i++) if (track.lines[i] !== track.lines[i - 1]) lineStarts.add(track.cum[i - 1]!);
  const atLineStart = (x: number) => [...lineStarts].some(l => Math.abs(l - x) <= TOL);
  const used = new Set<ClashTarget>();
  const recContacts = rt.filter(x => !isNearMiss(x));
  const matched = new Set<ClashTarget>();
  const same = (rc: ClashTarget) => vt.filter(x => !x.near && pairKey(x) === pairKey(rc));
  // every record contact is a view finding of its pair — at its place
  for (const rc of recContacts) {
    const m = same(rc).find(x => !used.has(x) && Math.abs(x.cum - rc.cum) <= TOL);
    if (!m) continue;
    expect(m.line, `${where} ${pairKey(rc)} @${rc.cum.toFixed(4)}: the line it names`).toBe(rc.line);
    used.add(m); matched.add(rc); t.contacts++;
  }
  // ...or (its refinement floored at a line start, R90) up to MIN_ADV
  // earlier, where the contact begins
  for (const rc of recContacts.filter(x => !matched.has(x) && atLineStart(x.cum))) {
    const m = same(rc).find(x => !used.has(x) && x.cum < rc.cum && rc.cum - x.cum <= MIN_ADV + TOL);
    if (!m) continue;
    expect(m.line, `${where} ${pairKey(rc)}: a floored record's line is at most the view's later one`).toBeLessThanOrEqual(rc.line);
    used.add(m); matched.add(rc); t.floored++;
  }
  // ...or a margin entry that touched later (`touches`): the records' finding
  // is the margin entry, the view's the touch it led to (plan 4.1) — one
  // contact the records may have counted twice (the entry and the touch's
  // own onset on its line)
  for (const rc of recContacts.filter(x => !matched.has(x) && x.touches && (x.dist ?? 0) > CONTACT_EPS)) {
    const m = same(rc).find(x => x.cum >= rc.cum - MIN_ADV - TOL);
    if (!m) continue;
    expect(m.line, `${where} ${pairKey(rc)}: the touch is on the margin entry's line or later`).toBeGreaterThanOrEqual(rc.line);
    used.add(m); matched.add(rc); t.touchedLater++;
  }
  // ...or one class (4.1): touching by the views' old 1e-3, not by the sweep's
  for (const rc of recContacts.filter(x => !matched.has(x) && (x.dist ?? 0) > CONTACT_EPS)) {
    const m = vt.find(x => !used.has(x) && x.near && pairKey(x) === pairKey(rc) && Math.abs(x.cum - rc.cum) <= MIN_ADV + TOL);
    if (!m) continue;
    used.add(m); matched.add(rc); t.reclassed++;
  }
  for (const rc of recContacts) {
    expect(matched.has(rc), `${where} ${pairKey(rc)}: the record's contact at ${rc.cum.toFixed(4)} (L${rc.line}) is a view finding`).toBe(true);
  }
  // a view contact no record has: the records bridged a free sample before it
  for (const x of vt.filter(y => !used.has(y) && !y.near)) {
    const f = (free.get(pairKey(x)) ?? []).some(p => p <= x.cum + TOL);
    expect(f, `${where} ${pairKey(x)}: the view's contact at ${x.cum.toFixed(4)} (L${x.line}) no record has — no free sample before it`).toBe(true);
    expect(x.reentry, "it is a re-entry of a contact the records bridged").toBe(true);
    t.bridged++;
  }
  // every record near miss is a stay of its pair without a touch — whose
  // closest approach over the WHOLE stay the view names (plan 1.1)
  const pairIndex = new Map(names.map((n, k) => [pairKey(n), k]));
  const E = store.episodes;
  for (const rn of rt.filter(isNearMiss)) {
    const pi = pairIndex.get(pairKey(rn))!;
    let key: string | null = null;
    for (let e = 0; e < E.rows; e++) {
      if (E.get(e, "pair") !== pi || E.get(e, "ivCount") !== 0) continue;
      const on = E.get(e, "onset"), en = Number.isNaN(E.get(e, "end")) ? end : E.get(e, "end");
      if (rn.cum >= on - MIN_ADV - TOL && rn.cum <= en + TOL) { key = `C${pi}|${E.get(e, "ordinal")}|n`; break; }
    }
    const m = key ? vt.find(x => x.key === key) : undefined;
    expect(m, `${where} ${pairKey(rn)}: the record's near miss at ${rn.cum.toFixed(4)} is a stay the view names`).toBeDefined();
    used.add(m!);
    t.nears++;
  }
  t.extraNear += vt.filter(x => !used.has(x) && x.near).length;
  // the targets it starts in: found at the tables' first sample, the same as asking every target (plan 4.4)
  const starts = startTargets(v);
  expect(starts, `${where}: the start contacts`).toEqual(Array.from({ length: v.n }, (_, i) => i).filter(i => targetKind(v, i) & T_AT_START));
  t.startsIn += starts.length;
  // the words: the index's count and the objects' words say the same
  const vc = viewCounts(v), vw = findingWords(vt);
  expect([vc.collisions, vc.entryCollisions, vc.nearMisses, vc.possible], `${where}: the counts`)
    .toEqual([vw.collisions, vw.entryCollisions, vw.nearMisses, vw.possible]);
  // a record contact's two ends light their columns in the view's bands
  const W = 400;
  const lit = new Set<number>();
  for (const [a, b] of contactBands(v, W, end)) for (let c = Math.round(a * W); c < Math.round(b * W); c++) lit.add(c);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / end) * W)));
  for (const rc of rt.filter(x => !isNearMiss(x) && (x.dist ?? 0) <= CONTACT_EPS)) {
    expect(lit.has(col(rc.cum)), `${where} ${pairKey(rc)}: the band at the contact's start`).toBe(true);
  }
}

describe("the views from the contact tables against the records' views, one sweep (step 4 package 2, round B3)", () => {
  const cases: Array<{ c: Case; load: () => { model: CollisionModel } }> = [
    ...shippedCases(FILES).map(c => ({ c, load: () => loadShippedModel(c, FILES) })),
    ...Array.from({ length: 10 }, (_, k) => { const g = generatedCase(20261013 + k); return { c: g.c, load: () => g }; }),
  ];
  const tally: Tally = { startsIn: 0, compared: 0, contacts: 0, nears: 0, bridged: 0, floored: 0, touchedLater: 0, reclassed: 0, extraNear: 0 };
  for (const { c, load } of cases) {
    it(`${c.name}: the same findings and lines, the named differences only`, { timeout: 600_000 }, () => {
      const { model } = load();
      const rand = rng(c.seed ?? 20261013);
      for (let k = 0; k < 2; k++) compare(model, randomTrack(c, rand, 4, 0.5), `${c.name} track ${k}`, tally);
    });
  }
  it("the comparison reaches findings", () => {
    if (process.env.CONTACT_VIEW_CROSS_LOG) fs.appendFileSync(process.env.CONTACT_VIEW_CROSS_LOG, JSON.stringify(tally) + "\n");
    expect(tally.contacts, "contacts compared").toBeGreaterThan(5);
  });
});
