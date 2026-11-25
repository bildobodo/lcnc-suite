// The cutting state of a tool × stock pair (stock-mute plan v2 §3, v3 §B;
// Codex R484 / R488 / R490). The stock is never cut away: after a feed
// pass the cutter stands inside its geometry for the rest of that stay, and a
// rapid's touch there proves nothing about uncut material. What a rapid's
// touch means depends on what came before it — this state, per cutting pair:
//
//   NONE        nothing proven: the next touch begins something
//   UNRESOLVED  the surfaces apart, the inside of an OPEN body not excluded:
//               no separation claimed, and machining not proven either
//   MACHINING   begun by a PROVEN touch whose entry lies on a feed: silent
//   RAPID       begun by a touch whose entry lies on a rapid: a finding
//
// Pure: the sweep classifies each sample (cutSample) and asks the step; the
// own-hole question (viewer/fedPath.ts) is asked ONLY from NONE, through the
// callback, and only when a touch would begin RAPID.

/** A decided distance above this, and not on a braking range, is a
 *  separation the cutting state may take (machine units: 0.001 mm, on an inch
 *  machine 0.001 in). Above CONTACT_EPS on purpose: a touch flickering at the
 *  contact tolerance is no separation. */
export const CUT_SEP = 1e-3;

export const CUT_NONE = 0, CUT_UNRESOLVED = 1, CUT_MACHINING = 2, CUT_RAPID = 3;
export type CutState = typeof CUT_NONE | typeof CUT_UNRESOLVED | typeof CUT_MACHINING | typeof CUT_RAPID;

/** What a sample proves (plan v2 §3.1). */
export const SAMPLE_NOTHING = 0, SAMPLE_TOUCH = 1, SAMPLE_APART = 2, SAMPLE_UNRESOLVED = 3;
export type CutSample = typeof SAMPLE_NOTHING | typeof SAMPLE_TOUCH | typeof SAMPLE_APART | typeof SAMPLE_UNRESOLVED;

/** A sample's class. `excluded` answers whether the inside question is
 *  settled for both directions — a CLOSED body by its own verdict (the sweep's
 *  distance is 0 inside it), an OPEN one only by disjoint whole boxes; it is
 *  asked only for a decided distance above CUT_SEP. */
export function cutSample(d: number, contactEps: number, undecidable: boolean, inBand: boolean,
                          excluded: () => boolean): CutSample {
  if (undecidable || inBand) return SAMPLE_NOTHING;
  if (d <= contactEps) return SAMPLE_TOUCH;
  if (d <= CUT_SEP) return SAMPLE_NOTHING;
  return excluded() ? SAMPLE_APART : SAMPLE_UNRESOLVED;
}

/** What a step began: nothing, machining, or a rapid's contact (a finding). */
export const BEGIN_NONE = 0, BEGIN_MACHINING = 1, BEGIN_RAPID = 2;
export type CutBegin = typeof BEGIN_NONE | typeof BEGIN_MACHINING | typeof BEGIN_RAPID;

/** One sample's step (plan v3 §B, total over every state and class). `entryOnFeed`:
 *  the move the bisected entry lies on (a point on a move's end is that
 *  move's), or a range's first sample. `ownHole` is asked only from NONE and
 *  only for a touch whose entry lies on a rapid — never from UNRESOLVED. */
export function cutStep(state: CutState, sample: CutSample, entryOnFeed: () => boolean,
                        ownHole: () => boolean): { state: CutState; begins: CutBegin } {
  switch (sample) {
    case SAMPLE_TOUCH:
      if (state === CUT_NONE || state === CUT_UNRESOLVED) {
        if (entryOnFeed()) return { state: CUT_MACHINING, begins: BEGIN_MACHINING };
        if (state === CUT_NONE && ownHole()) return { state: CUT_MACHINING, begins: BEGIN_MACHINING };
        return { state: CUT_RAPID, begins: BEGIN_RAPID };
      }
      return { state, begins: BEGIN_NONE };            // MACHINING stays; RAPID as today
    case SAMPLE_APART:
      return { state: CUT_NONE, begins: BEGIN_NONE };
    case SAMPLE_UNRESOLVED:
      return { state: CUT_UNRESOLVED, begins: BEGIN_NONE };
    default:
      return { state, begins: BEGIN_NONE };            // nothing proven, nothing changes
  }
}

/** A discontinuity of the pair's motion (a tool or offset change, an unknown
 *  start): MACHINING ends — the cutter after it is no continuation of the
 *  feed — and UNRESOLVED stays: an unknown inside is not resolved by a jump.
 *  RAPID as today (its interval is the sweep's to end). */
export function cutBreak(state: CutState): CutState {
  return state === CUT_MACHINING ? CUT_NONE : state;
}
