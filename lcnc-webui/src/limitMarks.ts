// The code panel's soft-limit marks (Codex R177/R178 VP-I130): the lines the
// bar's placed limit rows show (viewer/limitPlaces.ts). A record marks a line
// only where its own violating move shows one — a called file's move its call
// line; a record with no place, or whose move no line of the program shows,
// marks none, never its raw number. The bar publishes; GcodePanel reads.
import { shallowRef } from "vue";
import type { LimitViolation } from "./ws/bulkData";

export type LimitMarks = ReadonlyMap<number, readonly LimitViolation[]>;
export const NO_LIMIT_MARKS: LimitMarks = new Map();
export const limitMarks = shallowRef<LimitMarks>(NO_LIMIT_MARKS);
