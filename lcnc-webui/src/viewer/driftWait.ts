// P2b-2 (plan v4, variant 1 — Codex R439 MT439-02): an idle collision check
// waits for the gateway's FIRST drift decision after an idle transition or
// an input action's end, then — when the decision names a parse — for THAT
// parse's publication and the page's adoption of it. Two separate waits:
// the decision at most FALLBACK_MS (one named fallback), a named parse under
// its own bound (the gateway's timeout_s ends the job, its end rides the
// decision). The wait belongs to (program generation, input generation,
// connection): a newer generation or another connection closes it; a late
// status of an OLDER generation changes nothing. Pure.

/** The gateway's `drift_decision` (gateway._drift_decision_status). */
export interface DriftDecision {
  state: "pending" | "none" | "parse";
  gen: [number, number];
  /** a named parse's job */
  job?: number;
  /** its publication (the version), once it published */
  published?: number;
  /** why it ended without one (cancelled, discarded, verified_same, ended …) */
  why?: string;
}

/** One open wait: its owner and since when it waits for a decision. */
export interface DriftWait { gen: [number, number]; conn: number; since: number; fellBack: boolean }

export type DriftVerdict =
  | { go: true; named: null | { kind: "fallback"; waited_ms: number } | { kind: "parse_ended"; job: number | null; why: string }
      | { kind: "no_decision" } }
  | { go: false; why: "decision" | "parse" | "adoption"; retryInMs: number | null };

export const DECISION_FALLBACK_MS = 3000;

/** Lexicographic order of (program, inputs). */
export function cmpGen(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/** Parse the wire's field; null for anything that is not one. */
export function parseDriftDecision(raw: unknown): DriftDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  const gen = r.gen;
  if ((state !== "pending" && state !== "none" && state !== "parse") || !Array.isArray(gen) || gen.length !== 2
      || !gen.every(n => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    state, gen: [gen[0] as number, gen[1] as number],
    ...(typeof r.job === "number" ? { job: r.job } : {}),
    ...(typeof r.published === "number" ? { published: r.published } : {}),
    ...(typeof r.why === "string" && state === "parse" ? { why: r.why } : {}),
  };
}

/**
 * May an idle check start now? `wait` is the open wait (null: none yet); the
 * returned `wait` replaces it. `adopted(v)`: the page shows publication `v`
 * (or a later one), decoded, no hold.
 */
export function driftVerdict(d: DriftDecision | null, wait: DriftWait | null, now: number, conn: number,
                             adopted: (version: number) => boolean,
                             fallbackMs = DECISION_FALLBACK_MS): { verdict: DriftVerdict; wait: DriftWait | null } {
  if (!d) {
    // a gateway that sends no decision (an older one): nothing to wait for — said once
    return { verdict: { go: true, named: { kind: "no_decision" } }, wait: null };
  }
  let w = wait && wait.conn === conn ? wait : null;
  if (w && cmpGen(d.gen, w.gen) < 0) {
    // a late status of an older generation: no effect — the open wait stays
    return { verdict: { go: false, why: "decision", retryInMs: Math.max(0, w.since + fallbackMs - now) }, wait: w };
  }
  if (!w || cmpGen(d.gen, w.gen) > 0) w = { gen: [d.gen[0], d.gen[1]], conn, since: now, fellBack: false };
  if (d.state === "none") return { verdict: { go: true, named: null }, wait: w };
  if (d.state === "pending") {
    const waited = now - w.since;
    if (waited >= fallbackMs) {
      const named = w.fellBack ? null : { kind: "fallback" as const, waited_ms: Math.round(waited) };
      return { verdict: { go: true, named }, wait: { ...w, fellBack: true } };
    }
    return { verdict: { go: false, why: "decision", retryInMs: fallbackMs - waited }, wait: w };
  }
  // a named parse: its end, its publication, its adoption
  if (d.why !== undefined) return { verdict: { go: true, named: { kind: "parse_ended", job: d.job ?? null, why: d.why } }, wait: w };
  if (d.published === undefined) return { verdict: { go: false, why: "parse", retryInMs: null }, wait: w };
  return adopted(d.published)
    ? { verdict: { go: true, named: null }, wait: w }
    : { verdict: { go: false, why: "adoption", retryInMs: null }, wait: w };
}
