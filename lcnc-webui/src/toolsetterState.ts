// The toolsetter form's machine state (P2, Codex R308–R309 FI308-04): what
// the interpreter holds, projected from the SERVER's confirmed section and
// the gateway's booking (ws/statusStore `toolsetter_booking`) — never from a
// reply or a local wait list, so a late reply, a reconnect or a reopened form
// cannot claim more than the gateway knows. Only the 23 synchronised keys
// (toolsetterVarMap) count; the booking may hold more (#3014, the preview's).
import type { ToolsetterBooking } from "./ws/statusStore";
import { TOOLSETTER_PENDING_REASON, toolsetterVarMap, type ToolsetterSetup } from "./toolsetterSetup";

export type ToolsetterMachineState =
  | { kind: "not_set_up" }                 // no sync — says nothing about what the machine holds
  | { kind: "unknown" }                    // no booking on this connection yet / settings not loaded
  | { kind: "confirmed" }                  // every value applied or read back, equal to the section
  | { kind: "pending"; differ: string[] }  // every value confirmed, some differ: the next start applies them
  | { kind: "unconfirmed"; confirmed: number; total: number; differ: string[] };

const CONFIRMED = new Set(["applied", "read"]);
const six = (v: number) => Number(v.toFixed(6));   // the number a parameter MDI sends

export function toolsetterMachineState(setup: ToolsetterSetup,
                                       booking: ToolsetterBooking | null | undefined): ToolsetterMachineState {
  if (!setup.ok) return setup.reason === TOOLSETTER_PENDING_REASON ? { kind: "unknown" } : { kind: "not_set_up" };
  if (!booking) return { kind: "unknown" };
  const want = Object.entries(toolsetterVarMap(setup.values));
  let confirmed = 0;
  const differ: string[] = [];
  for (const [k, v] of want) {
    const e = booking.keys[k];
    if (!e || !CONFIRMED.has(e.origin) || e.value === null || !Number.isFinite(e.value)) continue;
    confirmed++;
    if (six(e.value) !== six(v)) differ.push(k);
  }
  if (confirmed < want.length) return { kind: "unconfirmed", confirmed, total: want.length, differ };
  return differ.length ? { kind: "pending", differ } : { kind: "confirmed" };
}

/** The form's line for a state (≤ 90 characters, the reason style). It names
 *  WHERE the values count — the interpreter's parameters the measurement reads
 *  (operator 2026-11-07); never the var file, which LinuxCNC writes only at
 *  its next synch, nor "written" — a read-back confirms too. */
export const TOOLSETTER_PARAMS_HELP =
  "#3004–#3013 and #3100–#3115 — the values the measurement (M600) reads.";

export function toolsetterMachineText(s: ToolsetterMachineState): string {
  switch (s.kind) {
    case "confirmed": return "LinuxCNC parameters hold these values — confirmed";
    case "pending": return "Saved — not yet in the LinuxCNC parameters; a program start or measurement writes them";
    case "unconfirmed": return `LinuxCNC parameters not confirmed (${s.confirmed} of ${s.total}) — the next program start writes them`;
    case "not_set_up": return "Not set up — nothing written to the LinuxCNC parameters";
    case "unknown": return "LinuxCNC parameters not known yet";
  }
}
