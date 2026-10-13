// R150: these probes evaluate the TWO PROPOSED B4 RULES, not contactUnion.ts
// (that implementation is not part of the reviewed commit).
import { afterAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildCollisionModel, sweepCollisionsIter, type CollisionMachine, type CollisionTrack } from './collision';
import { ContactStore } from './contactStore';
import { buildContactView, targetEnd, tintAt } from './contactView';

const evidence: Record<string, unknown> = {};
afterAll(() => writeFileSync('/tmp/codex-r150-b8abm816/b4-contract.json', JSON.stringify(evidence, null, 2) + '\n'));

it('proposal 1: an epsilon neighbourhood of a conflicting witness can consume a whole certified gap', () => {
  // One explicit numerical-conflict case allowed by the preview: the witness
  // lies 0.0001 inside the free interval, less than the 0.001 tolerance.
  const free = { lo: 1, hi: 1.001, probe: 1.0005 };
  const witness = 1.0001, eps = 1e-3;
  const protection = [witness - eps, witness + eps];
  const priorityAtPoint = (p: number) => !(free.lo < p && p < free.hi) || p === witness;
  const priorityInNeighbourhood = (p: number) => !(free.lo < p && p < free.hi) || protection[0]! <= p && p <= protection[1]!;
  const r = { free, witness, tolerance: eps, conflictDepth: Math.min(witness - free.lo, free.hi - witness), protection,
    exactPointKeepsWitness: priorityAtPoint(witness),
    exactPointKeepsFreeProbe: !priorityAtPoint(free.probe),
    proposedNeighbourhoodCoversFreeProbe: priorityInNeighbourhood(free.probe),
    proposedNeighbourhoodCoversEntireGap: protection[0]! < free.lo && protection[1]! > free.hi };
  evidence.proposedPointProtection = r;
  expect(r.conflictDepth).toBeLessThan(eps);
  expect(r.exactPointKeepsWitness).toBe(true);
  expect(r.exactPointKeepsFreeProbe).toBe(true);
  expect(r.proposedNeighbourhoodCoversFreeProbe).toBe(true);
  expect(r.proposedNeighbourhoodCoversEntireGap).toBe(true);
});

it('proposal 3: real open-contact rows do not retain the already reported sweep coverage', () => {
  const machine: CollisionMachine = { groups: [{ id: 'fixed', parent: 'root' }, { id: 'head', parent: 'root' }],
    kinematics: [{ group: 'head', joint: 0, type: 'translate', direction: 'x', sign: 1 }],
    workGroup: 'fixed', toolGroup: 'head', unitScale: 1, axes: ['X', 'Y', 'Z'] };
  const cube = (size: number) => { const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
    const p = new Float32Array(g.getAttribute('position').array); g.dispose(); return p; };
  const model = buildCollisionModel(machine, [
    { id: 'obstacle', group: 'fixed', positions: cube(100) },
    { id: 'tool', group: 'head', positions: cube(2), tool: true },
  ]);
  const n = 33, pos = new Float32Array(n * 3), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = i; cum[i] = i; }
  const track = { count: n, pos, abc: new Float32Array(n * 3), cum,
    lines: new Uint32Array(n).fill(7), rapid: new Uint8Array(n).fill(1) } as CollisionTrack;
  const store = new ContactStore(1, 0);
  const iter = sweepCollisionsIter(model, track, { g5x: [], g92: [], rotationDeg: 0 },
    { margin: 0.1, contacts: { store }, clock: () => 0 });
  let progress = 0;
  for (let i = 0; i < 100; i++) {
    const step = iter.next();
    expect(step.done, 'observe the actual running sweep, before it finishes').not.toBe(true);
    progress = step.value as number;
    if (progress > 0 && store.intervals.rows > 0) break;
  }
  expect(progress).toBeGreaterThan(0);
  const coverage = progress * cum[n - 1]!;
  const rows: Record<string, number[]> = {};
  for (const col of ['onset', 'end', 'closeAt'] as const)
    rows['episode.' + col] = Array.from({ length: store.episodes.rows }, (_, i) => store.episodes.get(i, col));
  for (const col of ['enter', 'exit', 'witness', 'freeAt'] as const)
    rows['interval.' + col] = Array.from({ length: store.intervals.rows }, (_, i) => store.intervals.get(i, col));
  for (const col of ['start', 'end'] as const)
    rows['gap.' + col] = Array.from({ length: store.gaps.rows }, (_, i) => store.gaps.get(i, col));
  const inferred = Math.max(0, ...Object.values(rows).flat().filter(Number.isFinite));
  const view = (ownCoverage: number) => buildContactView({
    sources: [{ stores: [store], at: c => c, ownCoverage }],
    pairName: () => ({ a: 'tool', b: 'obstacle' }), coverage: ownCoverage,
  });
  const before = view(coverage), heldByProposal = view(inferred), query = coverage / 2;
  evidence.proposedHeldCoverage = { progress, coverage, rows, inferred, query,
    previousEnd: targetEnd(before, 0), proposedHeldEnd: targetEnd(heldByProposal, 0),
    previouslyLit: [...tintAt(before, query)], litUsingProposedBound: [...tintAt(heldByProposal, query)],
    newGenerationRows: 0, newFreeCertificates: 0 };
  expect(before.n).toBe(1);
  expect(coverage).toBeGreaterThan(inferred);
  expect(targetEnd(before, 0)).toBe(coverage);
  expect(targetEnd(heldByProposal, 0)).toBe(inferred);
  expect([...tintAt(before, query)].sort()).toEqual(['obstacle', 'tool']);
  expect([...tintAt(heldByProposal, query)]).toEqual([]);
  // Dispose the private generator only after reading its current tables.
  iter.return(undefined as never);
});
