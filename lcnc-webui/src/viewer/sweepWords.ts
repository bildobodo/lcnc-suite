// The collision check's RESULT in words (step 4 plan, package 1a/1d): what
// the timeline's × marks are, by kind — a confirmed collision, a near miss
// (inside the margin, never touching: never called a collision), a possible
// contact (the probe's braking range), a collision on the entry move apart
// from the program's — and whether the program STARTS in contact. The
// contact view counts them from its index (contactView.viewCounts, plan 4.1):
// the kinds split its number, their sum is the marks'. Pure.

export interface FindingWords {
  /** "2 collisions · 1 near miss", "" when there is no finding. */
  text: string;
  collisions: number;
  entryCollisions: number;
  nearMisses: number;
  possible: number;
  /** A confirmed contact the program starts in (not the entry move's). */
  startsIn: boolean;
  /** Any confirmed collision, on the entry move or the program. */
  danger: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the words count, by kind — the contact view counts them from its
 *  index (contactView.viewCounts, plan 4.1), never from a list of every
 *  target (plan 4.4). */
export interface FindingCounts { collisions: number; entryCollisions: number; nearMisses: number; possible: number; startsIn: boolean }

export function wordsOfCounts(c: FindingCounts): FindingWords {
  const { collisions, entryCollisions, nearMisses, possible, startsIn } = c;
  const parts: string[] = [];
  if (collisions) parts.push(plural(collisions, "collision", "collisions"));
  if (entryCollisions) parts.push(plural(entryCollisions, "collision on the entry move", "collisions on the entry move"));
  if (possible) parts.push(plural(possible, "possible contact", "possible contacts"));
  if (nearMisses) parts.push(plural(nearMisses, "near miss", "near misses"));
  return { text: parts.join(" · "), collisions, entryCollisions, nearMisses, possible, startsIn,
           danger: collisions + entryCollisions > 0 };
}
