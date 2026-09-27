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

/** What a captured draft is bound to: another unit or kinematics mode drops it. */
export interface G30Context { units: string; kinsType: number | null }
export function contextChanged(at: G30Context | null, now: G30Context): boolean {
  return !!at && (at.units !== now.units || at.kinsType !== now.kinsType);
}
