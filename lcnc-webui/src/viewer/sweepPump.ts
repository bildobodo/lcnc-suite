// The worker's driver for sweepCollisionsIter: runs the iterator in wall-
// clock slices so a cancel message (or a superseding request) lands between
// checkpoints, and the worker is never terminated for a cancel — the BVH
// collision model stays resident across sweeps. Pure: sweepPump.test.ts
// drives it with a fake iterator and clock; collisionWorker.ts wires it to
// setTimeout(0) between slices.
import type { CollisionResult } from "./collision";

export type SweepIter = Generator<number, CollisionResult, boolean | undefined>;

export interface SweepSlice {
  /** The iterator finished (a result) or was aborted (cancelled). */
  done: boolean;
  cancelled: boolean;
  /** The sweep's result when it finished on its own; null when cancelled
   *  (the partial result is discarded — the owner has moved on). */
  result: CollisionResult | null;
  /** Latest progress fraction seen (0..1). */
  progress: number;
  /** Checkpoints consumed in this slice. */
  checkpoints: number;
}

/** Resume `it` for up to `sliceMs` of wall-clock. `cancelled()` is polled at
 *  every checkpoint; true aborts the iterator, which then runs its epilogue
 *  and returns — that return is drained here and its value discarded. */
export function runSweepSlice(
  it: SweepIter,
  sliceMs: number,
  cancelled: () => boolean,
  now: () => number = () => performance.now(),
): SweepSlice {
  const start = now();
  let progress = 0;
  let checkpoints = 0;
  for (;;) {
    const cancel = cancelled();
    const r = it.next(cancel);
    if (r.done) {
      return { done: true, cancelled: cancel, result: cancel ? null : r.value, progress: cancel ? progress : 1, checkpoints };
    }
    checkpoints++;
    progress = r.value;
    if (cancel) {
      // Aborted at this checkpoint: the iterator finishes its epilogue on
      // the next resume(s). Bounded — the epilogue yields once.
      for (let g = 0; g < 4; g++) {
        if (it.next(true).done) break;
      }
      return { done: true, cancelled: true, result: null, progress, checkpoints };
    }
    if (now() - start >= sliceMs) {
      return { done: false, cancelled: false, result: null, progress, checkpoints };
    }
  }
}
