// The DRAWN path's own state (VP188-02 E2, plan basiswechsel-last Fassung 4
// 3b, Codex VP193-01): a preview whose parse basis matches the live offsets
// proves nothing about the geometry on screen — an offset change held while
// the gateway re-parsed leaves the path baked for the earlier values, and an
// adopted payload is drawn only once its part-frame reply is applied. Every
// bake request carries the KEY of exactly what it bakes with; the key is set
// as drawn only when a path is applied, and the path is muted while the drawn
// key is not the key of the adopted preview at the live values.

export type BakeMode = "part" | "programmed";

export interface BakeInputs {
  /** The adopted preview's full path and published version. */
  file: string | null;
  version: number | null;
  mode: BakeMode;
  /** _pfWcs(): the active fixture, G92, the XY rotation, the program's
   *  tool before its first row. */
  g5x: ArrayLike<number>;
  g92: ArrayLike<number>;
  rotationDeg: number;
  tool: ArrayLike<number> | null | undefined;
  /** The fixture rows an epoch-aware payload re-adds (usedWcsRowsKey) —
   *  null where the table is no input. */
  table: string | null;
}

/** A value, never a reference: the request keeps the values it baked with
 *  even when the live arrays are replaced or mutated later (Codex R194). */
export function bakeKey(i: BakeInputs): string {
  const nums = (a: ArrayLike<number> | null | undefined) => (a == null ? null : Array.from(a));
  return JSON.stringify([i.file, i.version, i.mode, nums(i.g5x), nums(i.g92), i.rotationDeg, nums(i.tool), i.table]);
}

export interface EpochEvent { idx: number; rewritten?: boolean }

/** Whether the drawn path is baked from the offsets — the criterion
 *  _pfScheduleWcsRefresh applies: the part frame always; a programmed path
 *  only where its display rebase can differ from identity (more than one
 *  epoch, a program-rewritten epoch 0, or an epoch-0 fixture other than the
 *  active one). A single plain epoch of the active fixture hangs under the
 *  live origin and follows it — nothing to bake, never behind. */
export function bakeFollowsOffsets(mode: BakeMode | null, events: readonly EpochEvent[] | null | undefined,
                                   activeIdx: number): boolean {
  if (mode === "part") return true;
  if (!events?.length) return false;
  return !(events.length === 1 && !events[0]!.rewritten && events[0]!.idx === activeIdx);
}

/** The drawn path is behind: in scope (`want` is null outside it) and not
 *  baked for what is wanted now. */
export function pathBehind(drawn: string | null, want: string | null): boolean {
  return want !== null && drawn !== want;
}
