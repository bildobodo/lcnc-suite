import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ContactStore, REQUEST_BUDGET, deltaTransfer, NONE, GAP_UNDECIDABLE } from './contactStore';

it('R170: the outstanding delta before the first interval includes update row indexes', () => {
  const s = new ContactStore(1, 0);
  for (let k = 0; k < REQUEST_BUDGET.episodes; k++)
    s.episodes.append({ pair: k, ordinal: 0, flags: 0, onset: 0, end: 1,
      closeAt: 0.5, closeDist: 1, firstIv: NONE, ivCount: 0 });
  for (let k = 0; k < REQUEST_BUDGET.gaps; k++)
    s.gaps.append({ pair: k, start: 0, end: 1, reason: GAP_UNDECIDABLE });
  const appended = s.takeDelta()!; s.ack();
  for (let k = 0; k < s.episodes.rows; k++) s.episodes.set(k, 'end', 2);
  for (let k = 0; k < s.gaps.rows; k++) s.gaps.set(k, 'end', 2);
  const earlier = s.takeDelta()!;
  s.intervals.append({ episode: 0, enter: 2, exit: NaN, flags: 0, next: NONE, witness: 2, freeAt: NaN, freeR: 0 });
  const firstTouch = s.takeDelta()!;
  const bytes = (d: typeof earlier) => deltaTransfer(d).reduce((n, a) => n + a.byteLength, 0);
  const result = { appendBytes: bytes(appended), updatedBytes: bytes(earlier),
    updateIndexes: earlier.episodes.updates.byteLength + earlier.gaps.updates.byteLength,
    earlierIntervals: earlier.intervals.count, firstTouchIntervals: firstTouch.intervals.count,
    thirdBlocked: s.takeDelta(true) === null };
  writeFileSync(process.env.R170_OUT! + '/delta-budget.json', JSON.stringify(result, null, 2) + '\n');
  expect(result).toEqual({ appendBytes: 3358720, updatedBytes: 3686400, updateIndexes: 327680,
    earlierIntervals: 0, firstTouchIntervals: 1, thirdBlocked: true });
});
