// Sim-entry sweep plan (2026-09-12, second attempt — pure, so the semantics
// are pinned by sweepEntry.test.ts). The program's own sweep is the MAIN
// run, always on the BASE track, and a sim entry never cancels it; the
// entry segment (the rapid from the machine's live position to the
// program's first point) is a SIDE sweep of a two-point slice, merged with
// the base result at display time (sweepMerge.ts). The first attempt
// cancelled a base sweep at 59 % for that one segment whenever the base
// was still running or parked, and re-swept the whole entry track on every
// re-entry because the merged result had taken the entry track's identity.
//
// Track identities are compared by reference: a rebuilt entry track is a
// new track and needs its own side sweep; a base result stays valid across
// sim entries because it is keyed on the base track.
export interface EntryPlanInput<T extends object> {
  /** The entry-extended track ScrubBar is about to display. */
  entry: T;
  /** The program's own track it was built from (null = no program). */
  base: T | null;
  /** Track the main result was swept on (null = none). */
  mainTrack: T | null;
  hasMainResult: boolean;
  /** The main run is sweeping / parked, and on which track. */
  mainBusy: boolean;
  mainResumable: boolean;
  pendingTrack: T | null;
  /** Entry track an overlay (side result) already exists for. */
  overlayTrack: T | null;
  /** Entry track a side sweep is in flight for. */
  sideTrack: T | null;
}

export interface EntryPlan {
  /** Start the main sweep on the base track (nothing current, running or parked). */
  runBase: boolean;
  /** Side-sweep the entry segment. */
  runSide: boolean;
}

export function planEntryCheck<T extends object>(i: EntryPlanInput<T>): EntryPlan {
  if (!i.base) return { runBase: false, runSide: false };
  const baseKnown = (i.hasMainResult && i.mainTrack === i.base)
    || ((i.mainBusy || i.mainResumable) && i.pendingTrack === i.base);
  // The machine already sits at the program's first point: the entry track
  // IS the base track — nothing new to sweep.
  if (i.entry === i.base) return { runBase: !baseKnown, runSide: false };
  const sideKnown = i.overlayTrack === i.entry || i.sideTrack === i.entry;
  return { runBase: !baseKnown, runSide: !sideKnown };
}
