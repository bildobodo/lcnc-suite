// The receipt of a Firefox unload's beacons (Codex R386 VM-I25): pure, so
// its table holds what the browser cannot stage (src/unloadReceipts.test.ts).
//
// Each beacon the page hands off during its unload carries a mark
// `<nonce>.<n>` in its query (`e2e_beacon`): the nonce names this ONE unload,
// n the beacon's place in it. The mock writes the mark into its replay line
// (e2e/mock-gateway.mjs). A beacon is received only by a POST carrying ITS
// mark AND the cookie of exactly this test attempt (run, test, project,
// retry) — never by a count of POSTs, which an unrelated POST could fill.

/** A test attempt, as its cookie names it (e2e/test.ts ReplayOrigin). */
export interface AttemptOrigin { run: string; test: string; project: string; retry: number }

/** What a receipt reads of one replay line. */
export interface ReplayLine { kind?: unknown; method?: unknown; beacon?: unknown; origin?: unknown }

export interface Receipts {
  /** marks received once, with this attempt's origin */
  received: string[];
  /** marks no line received */
  missing: string[];
  /** marks of this unload that arrived WITHOUT this attempt's origin (no
   *  cookie, another attempt's): the replay would see them as ownerless */
  foreign: string[];
  /** marks received more than once */
  twice: string[];
}

const sameAttempt = (o: unknown, a: AttemptOrigin): boolean => {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  return r.run === a.run && r.test === a.test && r.project === a.project && r.retry === a.retry;
};

/** The marks a page reported, read back from its sessionStorage: a JSON list
 *  of `<nonce>.<n>`, n = 1, 2, … in order. Anything else throws — no count
 *  is no zero. */
export function parseMarks(raw: string | null, nonce: string): string[] {
  if (raw === null) throw new Error("the unload's beacon marks were not readable (none stored)");
  let list: unknown;
  try { list = JSON.parse(raw); } catch { throw new Error(`the unload's beacon marks are no JSON: ${raw.slice(0, 80)}`); }
  if (!Array.isArray(list)) throw new Error(`the unload's beacon marks are no list: ${raw.slice(0, 80)}`);
  for (const m of list) {
    if (typeof m !== "string" || !m.startsWith(`${nonce}.`) || !/^\d+$/.test(m.slice(nonce.length + 1)))
      throw new Error(`a beacon mark not of this unload: ${String(m).slice(0, 80)}`);
  }
  if (new Set(list).size !== list.length) throw new Error(`a beacon mark handed off twice: ${raw.slice(0, 120)}`);
  return list as string[];
}

/** Which of `marks` (one unload's) the replay `lines` received. */
export function receipts(marks: readonly string[], lines: readonly ReplayLine[], attempt: AttemptOrigin, nonce: string): Receipts {
  const counts = new Map<string, number>(marks.map(m => [m, 0]));
  const foreign = new Set<string>();
  for (const l of lines) {
    if (l.kind !== "http" || l.method !== "POST" || typeof l.beacon !== "string") continue;
    if (!l.beacon.startsWith(`${nonce}.`)) continue;               // another unload's
    if (!sameAttempt(l.origin, attempt)) { foreign.add(l.beacon); continue; }
    const n = counts.get(l.beacon);
    if (n === undefined) { foreign.add(l.beacon); continue; }        // a mark this unload never handed off
    counts.set(l.beacon, n + 1);
  }
  return {
    received: marks.filter(m => counts.get(m) === 1),
    missing: marks.filter(m => counts.get(m) === 0),
    foreign: [...foreign].sort(),
    twice: marks.filter(m => (counts.get(m) ?? 0) > 1),
  };
}

/** The unload is proven: every mark received once, nothing foreign. */
export const complete = (r: Receipts): boolean => r.missing.length === 0 && r.foreign.length === 0 && r.twice.length === 0;
