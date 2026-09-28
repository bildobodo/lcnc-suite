// The G30 section's draft (operator point P4, Codex R21–R24): the fields are
// a DRAFT that starts from the stored values; "Use current position" fills
// it, only Save writes — as ONE gateway command that confirms from a fresh
// parameter file. `basis` is the stored state the draft was started from
// (set_g30's based_on): a value LinuxCNC holds by now that differs from it
// is a conflict the gateway refuses, never a silent overwrite.

export type G30Values = Record<string, number | null>;

/** The parameter file writes %f — six decimals, whatever the magnitude:
 *  equal to 1e-6. */
export function sameG30(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
}

/** Letters whose draft value differs from the basis (an empty field counts as changed). */
export function changedAxes(draft: G30Values, basis: G30Values | null, letters: readonly string[]): string[] {
  return letters.filter(l => !sameG30(draft[l], basis?.[l]));
}

export type G30Payload = { values: Record<string, number>; based_on: Record<string, number> };

/** The set_g30 payload, or why nothing can be saved (≤ 60 chars). */
export function savePayload(draft: G30Values, basis: G30Values | null, letters: readonly string[]): G30Payload | { error: string } {
  if (!basis || letters.some(l => basis[l] == null || !Number.isFinite(basis[l]!)))
    return { error: "Stored G30 not known — refresh first" };
  const changed = changedAxes(draft, basis, letters);
  if (!changed.length) return { error: "Nothing changed" };
  const missing = changed.filter(l => draft[l] == null || !Number.isFinite(draft[l]!));
  if (missing.length) return { error: `${missing.join(", ")}: enter a value` };
  return {
    values: Object.fromEntries(changed.map(l => [l, draft[l]!])),
    based_on: Object.fromEntries(letters.map(l => [l, basis[l]!])),
  };
}

/** What a captured draft is bound to: another unit, kinematics mode or
 *  connection (a reconnect may be another LinuxCNC instance) drops it. */
export interface G30Context { units: string; kinsType: number | null; epoch: number }
export function contextChanged(at: G30Context | null, now: G30Context): boolean {
  return !!at && (at.units !== now.units || at.kinsType !== now.kinsType || at.epoch !== now.epoch);
}

/** What a G30 request was SENT under (Codex R25 OP-I03): its order among
 *  this section's requests, the draft's revision and the context. A reply
 *  arrives later — the operator may have typed, the frame may have changed,
 *  a newer reply may already be shown. */
export interface G30Ticket { seq: number; rev: number; ctx: G30Context }

/** The stored values (and the basis a save is sent on) belong to a
 *  connection — a reconnect may be another LinuxCNC instance, and equal
 *  numbers prove no equal machine — and to the units they are read in. The
 *  kinematics mode does not change them (G30 is machine coordinates). */
export function storedContextChanged(at: G30Context, now: G30Context): boolean {
  return at.units !== now.units || at.epoch !== now.epoch;
}

/** What a reply to `t` may still change NOW:
 *  - `stored`: the stored line and the basis — only when no newer request's
 *    reply is shown (a late file read never overwrites a confirmed save) AND
 *    in the connection and units it was sent under (Codex R26 OP-I03: an
 *    answer from before a reconnect supplies no basis);
 *  - `reset`: the draft may follow those stored values (a read, a save's
 *    confirmation) — nobody edited it since; the frame is irrelevant to
 *    machine coordinates;
 *  - `draft`: a CAPTURED position may fill the draft — unedited AND the
 *    whole context (units, kinematics, connection) unchanged.
 *  A save's confirmation never replaces an entry typed while it was out. */
export function replyApplies(t: G30Ticket, now: { appliedSeq: number; rev: number; ctx: G30Context }): { stored: boolean; reset: boolean; draft: boolean } {
  const stored = t.seq > now.appliedSeq && !storedContextChanged(t.ctx, now.ctx);
  return { stored, reset: stored && t.rev === now.rev,
           draft: t.rev === now.rev && !contextChanged(t.ctx, now.ctx) };
}
