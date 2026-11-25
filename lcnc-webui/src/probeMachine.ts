// What the machine holds of the probing form (P5-2 c, plan v6; the texts by
// the operator 2026-11-23/24): ONE line under "Parameters". The machine's half
// compares the gateway's booking (`probe_booking`) with the values the FORM
// shows — what this page's next probe sends, saved or not (BG-19; App passes
// them on as they are) — over EVERY key that job writes; the first half says
// where those values stand: saved, not saved yet (an open edit of one of
// them), or defaults the server never held. So an open edit takes no unknown
// value out of the line, and a machine that holds another value is never "on
// the machine" (Codex R470 MT-I40: a field with a bar used to be no part of
// the claim, and the rest read as complete). Pure.
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

/** Where the form's values stand with the server. */
export type FormValues = "saved" | "draft" | "defaults";
export type ProbeMachineState =
  | { kind: "unread" }                                  // no server settings or no booking on this connection yet
  | { kind: "machine"; at: number; values: FormValues } // every value applied or read back, equal
  | { kind: "unknown"; values: FormValues }             // a value the machine may hold otherwise
  | { kind: "partly"; values: FormValues }              // some taken, some refused: the next probe writes the rest
  | { kind: "next"; values: FormValues };               // the next probe writes it

const six = (v: number) => Number(v.toFixed(6));   // the number a parameter MDI sends

/** `form`: the values the form shows — null before the server's settings
 *  arrived; `states`: its fields against what the server holds (fieldState.ts);
 *  `stored`: the server holds the section at all. `surface`: the surface map's
 *  job. */
export function probeMachineState(form: ProbeDefaults | null, stored: boolean, states: Record<string, FieldState>,
                                  booking: ProbeBooking | null | undefined, surface: boolean): ProbeMachineState {
  if (!form || !booking) return { kind: "unread" };
  const { autoZero, ...p } = form;
  const map = surface ? surfaceVarMap(p) : probeVarMap(p, autoZero ? 0 : 1);
  const fields: Record<string, string> = surface ? SCAN_VAR_FIELDS : PROBE_VAR_FIELDS;
  let at = 0, unknown = false, taken = 0, refused = 0, other = 0, values: FormValues = stored ? "saved" : "defaults";
  for (const [k, v] of Object.entries(map)) {
    if (states[fields[k] ?? ""]) values = "draft";      // an open edit of a meant value — its key counts like every other
    const e = booking.keys[k];
    if (e?.outcome === "unknown") { unknown = true; continue; }
    if (e && (e.outcome === "applied" || e.outcome === "read") && e.value !== null && six(e.value) === six(v)) {
      taken++; at = Math.max(at, e.t);
    } else if (e?.refused !== undefined && six(e.refused) === six(v)) refused++;
    else other++;
  }
  if (unknown) return { kind: "unknown", values };
  if (taken && !refused && !other) return { kind: "machine", at, values };
  if (taken && refused && !other) return { kind: "partly", values };
  return { kind: "next", values };
}

const two = (n: number) => String(n).padStart(2, "0");
/** The booking's time of day, as the clock on the wall shows it. */
export function timeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

const STAND: Record<FormValues, string> = { saved: "Saved", draft: "Not saved yet", defaults: "Defaults" };

export function probeMachineText(s: ProbeMachineState): string {
  if (s.kind === "unread") return "Machine state not read yet";
  const stand = STAND[s.values], draft = s.values === "draft";
  switch (s.kind) {
    case "machine": return `${draft ? `${stand} · on` : "On"} the machine · ${timeOfDay(s.at)}`;
    case "unknown": return `${stand} · machine value unknown`;
    case "partly": return draft ? `${stand} · the next probe writes it` : "Partly on the machine · the next probe writes it";
    case "next": return `${stand} · the next probe writes ${s.values === "defaults" ? "them" : "it"}`;
  }
}

/** The section's ONE line: a refusal reason, else what the machine holds. */
export function probeSectionLine(refusal: string | null, machine: ProbeMachineState): { text: string; refused: boolean } {
  return refusal ? { text: `Not saved: ${refusal}`, refused: true } : { text: probeMachineText(machine), refused: false };
}
