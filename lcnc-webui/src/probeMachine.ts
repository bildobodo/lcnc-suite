// What the machine holds of the probing form (P5-2 c, plan v6; the texts by
// the operator 2026-11-23/24): ONE line under "Parameters", from the gateway's
// booking (`probe_booking`) and the values the SERVER holds — what the next
// job of this form writes of them. A field with a draft is no part of the
// claim: its bar says it. Pure.
import type { FieldState } from "./fieldState";
import { SCAN_VAR_FIELDS, PROBE_VAR_FIELDS, probeVarMap, surfaceVarMap } from "./probeVars";
import type { ProbeDefaults } from "./defaults";

export interface ProbeBookingEntry {
  value: number | null;
  /** null: only a refused write is known of it. */
  outcome: "applied" | "read" | "unknown" | null;
  /** When it was booked, ms. */
  t: number;
  job?: string | null;
  /** A value whose write was refused before it began. */
  refused?: number;
}
export interface ProbeBooking { version: number; keys: Record<string, ProbeBookingEntry> }

export type ProbeMachineState =
  | { kind: "unread" }                 // no server settings or no booking on this connection yet
  | { kind: "machine"; at: number }    // every value applied or read back, equal
  | { kind: "unknown" }                // a value the machine may hold otherwise
  | { kind: "partly" }                 // some taken, some refused: the next probe writes the rest
  | { kind: "saved"; stored: boolean }; // the next probe writes it (stored: the server holds a section)

const six = (v: number) => Number(v.toFixed(6));   // the number a parameter MDI sends

/** `held`: the probe section as the server holds it (fallbacks merged in);
 *  `stored`: it holds one at all. `surface`: the surface map's job. */
export function probeMachineState(held: ProbeDefaults | null, stored: boolean, states: Record<string, FieldState>,
                                  booking: ProbeBooking | null | undefined, surface: boolean): ProbeMachineState {
  if (!held || !booking) return { kind: "unread" };
  const { autoZero, ...p } = held;
  const map = surface ? surfaceVarMap(p) : probeVarMap(p, autoZero ? 0 : 1);
  const fields: Record<string, string> = surface ? SCAN_VAR_FIELDS : PROBE_VAR_FIELDS;
  let at = 0, unknown = false, taken = 0, refused = 0, other = 0;
  for (const [k, v] of Object.entries(map)) {
    if (states[fields[k] ?? ""]) continue;          // a draft or a refused change: its own bar
    const e = booking.keys[k];
    if (e?.outcome === "unknown") { unknown = true; continue; }
    if (e && (e.outcome === "applied" || e.outcome === "read") && e.value !== null && six(e.value) === six(v)) {
      taken++; at = Math.max(at, e.t);
    } else if (e?.refused !== undefined && six(e.refused) === six(v)) refused++;
    else other++;
  }
  if (unknown) return { kind: "unknown" };
  if (taken && !refused && !other) return { kind: "machine", at };
  if (taken && refused && !other) return { kind: "partly" };
  return { kind: "saved", stored };
}

const two = (n: number) => String(n).padStart(2, "0");
/** The booking's time of day, as the clock on the wall shows it. */
export function timeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function probeMachineText(s: ProbeMachineState): string {
  switch (s.kind) {
    case "unread": return "Machine state not read yet";
    case "machine": return `On the machine · ${timeOfDay(s.at)}`;
    case "unknown": return "Saved · machine value unknown";
    case "partly": return "Partly on the machine · the next probe writes it";
    case "saved": return s.stored ? "Saved · the next probe writes it" : "Defaults · the next probe writes them";
  }
}

/** The section's ONE line: a refusal reason, else what the machine holds. */
export function probeSectionLine(refusal: string | null, machine: ProbeMachineState): { text: string; refused: boolean } {
  return refusal ? { text: `Not saved: ${refusal}`, refused: true } : { text: probeMachineText(machine), refused: false };
}
