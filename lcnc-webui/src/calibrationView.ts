// The probe calibration offset as the Calibrate view shows it (P5, machine
// day W3 / MT418-06, plan v6; operator 2026-11-23 O-1…O-4): the ACTIVE value
// with its machine outcome, and a calibration's CANDIDATE with Apply / Discard
// or the outcome it came to. Both are GATEWAY state, the same on every client
// (status `probe_calibration` / `cal_candidate`) — never a reply alone and
// never a value a page saved on its own. Pure: the view, not the wire.
import { fmtQty, fmtUnit, NO_VALUE } from "./format";

/** The machine outcome of the active value (plan v6 P5-1 d). */
export type CalMachineOutcome =
  | "taken"                       // the controller holds it, the parameter file too
  | "taken_persist_unconfirmed"   // the controller holds it, the file is not confirmed
  | "write_pending"               // the write is under way
  | "saved_not_written"           // not written: the next probe writes it
  | "saved_write_unknown";        // written, its outcome is not known

/** The gateway-owned active calibration record (`probeCalibration`). */
export interface ProbeCalibration {
  value: number | null;
  unit: string | null;
  state?: "active" | "none";
  machine?: { outcome: CalMachineOutcome; at?: string | null; why?: string | null } | null;
}

/** A calibration run's candidate (`cal_candidate`). */
export interface CalCandidate {
  run: number;
  value: number;
  was: number | null;
  routine: string;
  /** The calibration's size basis as it was sent (the record's unit): the
   *  ring's diameter, or the block's X and Y. */
  size?: { d?: number; x?: number; y?: number } | null;
  axis: 0 | 1 | 2;
  at: string;
  state: "pending" | "applied" | "discarded" | "stale";
  why?: string | null;
}

export type CalNote =
  | { kind: "pending"; text: string; lead: string; detail: string; run: number; value: number }
  | { kind: "applied" | "stale"; text: string };

export interface CalOffsetView {
  /** "0.0677 mm" — the active value. */
  value: string;
  /** What the machine holds of it, or null where the gateway says nothing. */
  machine: string | null;
  /** The candidate, or the outcome it came to. */
  note: CalNote | null;
  /** This client's Apply refusal for the pending run: nothing changed. */
  refusal: string | null;
}

const ROUTINE_NAMES: Record<string, string> = {
  probe_cal_round_pocket: "Round hole",
  probe_cal_round_boss: "Round boss",
  probe_cal_square_pocket: "Rect pocket",
  probe_cal_square_boss: "Rect boss",
};
const AXIS_NAMES = ["Avg XY", "X Error", "Y Error"] as const;

const MACHINE_TEXT: Record<CalMachineOutcome, string> = {
  taken: "on the machine",
  taken_persist_unconfirmed: "on the machine, file not confirmed",
  write_pending: "writing to the machine…",
  saved_not_written: "the next probe writes it",
  saved_write_unknown: "machine value unknown",
};

/** A size without trailing zeros ("Ø 20 mm", "20 × 30.5 mm"), or null. */
function sizeText(size: CalCandidate["size"], unit: string): string | null {
  const n = (v: number | undefined) => typeof v === "number" && Number.isFinite(v) ? String(Number(v.toFixed(3))) : null;
  if (!size) return null;
  const d = n(size.d), x = n(size.x), y = n(size.y);
  if (d) return `Ø ${fmtUnit(d, unit)}`;
  if (x && y) return `${x} × ${fmtUnit(y, unit)}`;
  return null;
}

/** This client's Apply / Discard that was not carried out: `why` from the
 *  gateway's answer, null = no answer. */
export interface CalRefusal { run: number; kind: "cal_apply" | "cal_discard"; why: string | null }
/** Its words name the act that failed; without an answer nothing is claimed
 *  about the outcome — the status says which state the candidate is in. */
export function refusalText(r: CalRefusal): string {
  if (r.why === null) return "No reply — outcome unknown";
  return `${r.kind === "cal_apply" ? "Not applied" : "Not discarded"}: ${r.why}`;
}

/** The block's view (texts: the UI's "state — consequence" form, ≤ 60
 *  characters, no value said twice — operator 2026-11-23). `active` is the
 *  gateway's record — `null` before it sent one (an older gateway): then the
 *  form's value stands in as the value only, with no machine claim.
 *  `refusal` is THIS client's last Apply / Discard refusal for the pending
 *  run (a reply, shown where it began). */
export function calOffsetView(active: ProbeCalibration | null, formValue: number,
                              candidate: CalCandidate | null, unit: string,
                              refusal: CalRefusal | null = null): CalOffsetView {
  const u = active?.unit ?? unit;
  const value = active === null ? fmtQty(formValue, unit)
    : active.state === "none" || active.value === null ? "not set"
    : fmtQty(active.value, u);
  const outcome = active?.machine?.outcome;
  const machineText = outcome ? (MACHINE_TEXT[outcome] ?? null) : null;
  let machine = machineText;
  let note: CalNote | null = null;
  let refused: string | null = null;
  if (candidate?.state === "pending") {
    const basis = [ROUTINE_NAMES[candidate.routine] ?? candidate.routine, sizeText(candidate.size, u)]
      .filter(Boolean).join(" ");
    // two parts: the line breaks between them, never after a dangling "·"
    const lead = `Candidate ${fmtQty(candidate.value, u)}`;
    const detail = `${basis}, ${AXIS_NAMES[candidate.axis] ?? NO_VALUE}`;
    note = { kind: "pending", run: candidate.run, value: candidate.value, lead, detail, text: `${lead} · ${detail}` };
    if (refusal && refusal.run === candidate.run) refused = refusalText(refusal);
  } else if (candidate?.state === "applied") {
    // the Active line already holds the new value; the note says where it
    // went, once — the line then says no machine state of its own
    note = { kind: "applied", text: `Applied — ${machineText ?? "saved"}` };
    machine = null;
  } else if (candidate?.state === "stale") {
    note = { kind: "stale", text: `Result not offered — ${candidate.why ?? "the run did not complete"}` };
  }
  // discarded: the candidate line goes, nothing else changed — no note
  return { value, machine, note, refusal: refused };
}
