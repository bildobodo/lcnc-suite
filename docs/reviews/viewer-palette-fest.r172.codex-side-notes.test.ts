import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ContactStore, GAP_UNDECIDABLE, NONE, IV_ENTER_DECIDED, IV_EXIT_DECIDED } from './contactStore';
import { displayLineAt, undecidableNote, targetAt } from './contactView';
import { buildShownSteps, type ShownSpec } from './shownContacts';
import { runToEnd } from './steps';

it.each([true, false])('R172: a folded side note keeps the same line provenance as its contact (verified call = %s)', (call) => {
  const baseTrack = { count: 3, cum: Float64Array.from([0, 10, 20]), lines: Uint32Array.from([40, 40, 41]), lineOk: Uint8Array.from([1, 1, 1]) };
  const sideTrack = { count: 4, cum: Float64Array.from([0, 2, 4, 5]), lines: Uint32Array.from([0, 2, 3, 4]),
    lineOk: Uint8Array.from([0, 0, 0, 0]), cline: Uint16Array.from([0, 0, call ? 7 : 0, call ? 7 : 0]), sub: Uint8Array.from([255, 255, 0, 0]), subNames: ['touch'] };
  const base = new ContactStore(1, 0), side = new ContactStore(2, 0);
  side.gaps.append({ pair: 0, start: 2.5, end: 3.5, reason: GAP_UNDECIDABLE });
  const ep = side.episodes.append({ pair: 0, ordinal: 0, onset: 2.1, end: 2.3, closeAt: 2.1, closeDist: 0, firstIv: NONE, ivCount: 1 });
  side.episodes.set(ep, 'firstIv', side.intervals.append({ episode: ep, enter: 2.1, exit: 2.3, flags: IV_ENTER_DECIDED | IV_EXIT_DECIDED, next: NONE, witness: 2.1, freeAt: NaN }));
  const pairs: [string, string][] = [['spindle', 'stock']];
  const spec: ShownSpec = { base: { id: 1, map: null, coverage: 20, ownCoverage: 20, ownEnd: 20 },
    side: { id: 2, map: { kind: 'minus', shift: 5 }, coverage: 0, ownCoverage: 5, ownEnd: 5, entry: true, entryEnd: 2, sweptToEnd: false, track: sideTrack, linesTrusted: true }, axisEnd: 20 };
  const shown = runToEnd(buildShownSteps(id => ({ generation: 0, stores: [id === 1 ? base : side], pairs, deltas: 1 }), spec, () => null, displayLineAt(baseTrack, true), 100, 20))!;
  const row = targetAt(shown.view, 0, shown.lineAt);
  const text = undecidableNote(shown.derived!.undecidable![0]!, shown.lineAt);
  writeFileSync(process.env.R172_OUT! + `/folded-${call ? 'call' : 'unknown'}.json`, JSON.stringify({ spec, contact: row, gaps: shown.derived!.undecidable, note: text }, null, 2)+'\n');
  expect(row.line).toBe(call ? 7 : 0);
  if (!call) expect(row.subName).toBe('touch');
  expect(text).toContain(call ? '(L7)' : '(in touch)');
  expect(text).not.toContain('L40');
});
