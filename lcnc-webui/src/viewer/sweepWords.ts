// The collision check's RESULT in words (step 4 plan, package 1a/1d): what
// the timeline's × marks are, by kind — a confirmed collision, a near miss
// (inside the margin, never touching: never called a collision), a possible
// contact (the probe's braking range), a collision on the entry move apart
// from the program's — and whether the program STARTS in contact. One list
// (`clashTargets`) still makes the marks, the count and the steps: the kinds
// split its number, their sum is the marks'. Pure.
import { isNearMiss, type ClashTarget } from "./clashTargets";

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

export function findingWords(targets: readonly ClashTarget[]): FindingWords {
  let collisions = 0, entryCollisions = 0, nearMisses = 0, possible = 0, startsIn = false;
  for (const t of targets) {
    if (t.possible) { possible++; continue; }
    if (isNearMiss(t)) { nearMisses++; continue; }
    if (t.entryMove) entryCollisions++;
    else collisions++;
    if (t.atStart && !t.entry) startsIn = true;
  }
  const parts: string[] = [];
  if (collisions) parts.push(plural(collisions, "collision", "collisions"));
  if (entryCollisions) parts.push(plural(entryCollisions, "collision on the entry move", "collisions on the entry move"));
  if (possible) parts.push(plural(possible, "possible contact", "possible contacts"));
  if (nearMisses) parts.push(plural(nearMisses, "near miss", "near misses"));
  return { text: parts.join(" · "), collisions, entryCollisions, nearMisses, possible, startsIn,
           danger: collisions + entryCollisions > 0 };
}
