// The sweep's first confirmed contact (step 4 plan 1b) folded into what is
// shown: it is a contact's ONSET record — on its margin entry's line, with
// `touches` when the touch came later — so it REPLACES the record of the
// same onset a partial already shows (a near miss until then), and joins
// the list only when the partial has none (Codex R136 VP-I91: appended, one
// contact read "1 collision · 1 near miss"). Pure.
import { confirmedContact, type CollisionHit, type CollisionResult } from "./collision";

/** The same onset: its line, its pair, a program onset (no continuation, no
 *  boundary record, not the entry move's). */
export function sameOnset(h: CollisionHit, first: CollisionHit): boolean {
  return h.continuation === undefined && !h.boundary && !h.entry
    && h.line === first.line && h.a === first.a && h.b === first.b;
}

/** `r` already shows the contact `first` reports, as a confirmed contact. */
export function holdsFirst(r: CollisionResult | null | undefined, first: CollisionHit): boolean {
  return !!r?.hits.some(h => sameOnset(h, first) && confirmedContact(h));
}

/** A running result of the first contact alone (nothing else known yet). */
export function firstOnly(first: CollisionHit, covered: number): CollisionResult {
  return { hits: [first], staticContacts: [], samples: 0, coarsened: false, uncertified: null,
           pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: { covered, reason: "running" } };
}

/** `r` with `first` in it: the record of the same onset replaced, else the
 *  record added — every other record kept, in track order. */
export function withFirstContact(r: CollisionResult, first: CollisionHit): CollisionResult {
  const i = r.hits.findIndex(h => sameOnset(h, first));
  const hits = i >= 0 ? r.hits.map((h, k) => (k === i ? first : h)) : [...r.hits, first];
  return { ...r, hits: hits.sort((x, y) => x.cum - y.cum) };
}
