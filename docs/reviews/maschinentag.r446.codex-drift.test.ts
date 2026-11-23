import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { driftVerdict, type DriftDecision } from './driftWait';
const d = (state: DriftDecision['state'], extra = {}): DriftDecision => ({ state, gen: [0, 0], ...extra });
const adopted = () => true;
describe('R446 a new idle decision after a completed wait at the same inputs', () => {
  it.each(['none', 'published', 'fallback'] as const)('%s does not spend the next idle edge\'s three seconds', previous => {
    let r = driftVerdict(previous === 'published' ? d('parse', { job: 5, published: 6 }) : d(previous === 'none' ? 'none' : 'pending'), null, 0, 1, adopted);
    if (previous === 'fallback') {
      r = driftVerdict(d('pending'), r.wait, 3000, 1, adopted);
      r = driftVerdict(d('none'), r.wait, 3500, 1, adopted); // that round ended; the next pending is new
    }
    const next = driftVerdict(d('pending'), r.wait, 10000, 1, adopted);
    writeFileSync(`/tmp/r446/drift-${previous}.json`, JSON.stringify({ previous: r, next }, null, 2));
    expect(next.verdict).toEqual({ go: false, why: 'decision', retryInMs: 3000 });
  });
});

// Consume the actual gateway probe's before/after status, not invented wire.
it('R446 a terminal job forgotten by the gateway does not become an endless wait', () => {
  const wire = JSON.parse(readFileSync('/tmp/r446/forgotten-end.json', 'utf8'));
  const prev = driftVerdict(wire.before, null, 0, 1, adopted);
  const next = driftVerdict(wire.after, prev.wait, 10000, 1, adopted);
  writeFileSync('/tmp/r446/forgotten-client.json', JSON.stringify({ wire, prev, next }, null, 2));
  expect(next.verdict.go).toBe(true);
});
