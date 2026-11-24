// The probe calibration offset as the Calibrate view shows it (P5, machine
// day W3 / MT418-06, plan v6; operator 2026-11-23 O-1…O-4): the ACTIVE value
// with its machine outcome, and a calibration's CANDIDATE with Apply / Discard
// or the outcome it came to. Both are GATEWAY state, the same on every client
// (status `probe_calibration` / `cal_candidate`) — never a reply alone and
// never a value a page saved on its own. Pure: the view, not the wire.
import { fmtNum, fmtQty, fmtUnit, NO_VALUE } from "./format";

/** The machine outcome of the active value (plan v6 P5-1 d). */
export type CalMachineOutcome =
  | "taken"                       // the controller holds it, the parameter file too
  | "taken_persist_unconfirmed"   // the controller holds it, the file is not confirmed
  | "write_pending"               // the write is under way
  | "saved_not_written"           // not written: the next probe writes it
  | "saved_write_unknown";        // written, its outcome is not known

/** The gateway-owned active calibration record (`probeCalibration`), as the
 *  status names it. `state`: `active`; `none` (no value: a probe whose routine
 *  reads #3032 is refused until Calibrate or Reset); `unit_unknown` /
 *  `unit_other` (a value that goes nowhere: no unit, or not the machine's);
 *  `unread` (not migrated yet, or the settings not readable). */
export interface ProbeCalibration {
  value: number | null;
  unit: string | null;
  rev?: number | null;
  state?: "active" | "none" | "unit_unknown" | "unit_other" | "unread";
  machine?: { outcome: CalMachineOutcome; at?: number | null; why?: string | null } | null;
}

/** A calibration run's candidate (`cal_candidate`). */
export interface CalCandidate {
  run: number;
  /** null: the run reported none (it is stale). */
  value: number | null;
  was: number | null;
  routine: string;
  /** The calibration's size basis as it was sent (the record's unit): the
   *  ring's diameter, or the block's X and Y. */
  size?: { d?: number; x?: number; y?: number } | null;
  axis: 0 | 1 | 2;
  unit?: string;
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
  /** This client's Apply / Discard refusal for the pending run. */
  refusal: string | null;
  /** This client's Reset refusal on the record shown. */
  resetRefusal: string | null;
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

/** This client's Apply / Discard (for the candidate `run`) or Reset (on the
 *  record's revision `rev`) that was not carried out: `why` from the
 *  gateway's answer, null = no answer. Shown only while that candidate or
 *  that record is still the one on screen. */
export type CalRefusal =
  | { kind: "cal_apply" | "cal_discard"; run: number; why: string | null }
  | { kind: "cal_reset"; rev: number | null; why: string | null };
const ACT_FAILED = { cal_apply: "Not applied", cal_discard: "Not discarded", cal_reset: "Not reset" } as const;
/** Its words name the act that failed; without an answer nothing is claimed
 *  about the outcome — the status says which state the candidate is in. */
export function refusalText(r: CalRefusal): string {
  return r.why === null ? "No reply — outcome unknown" : `${ACT_FAILED[r.kind]}: ${r.why}`;
}

/** The states in which the record's value goes nowhere, and what to do. */
const STATE_TEXT: Partial<Record<NonNullable<ProbeCalibration["state"]>, string>> = {
  none: "calibrate or Reset",
  unit_unknown: "unit unknown, calibrate or Reset",
  unit_other: "other unit, calibrate or Reset",
};

/** The active value as every place shows it ("0.0677 mm"; `bare`: the number
 *  alone, where the field names the unit) — the gateway's record alone; before
 *  it sent one (or cannot read it) there is none. */
export function activeOffsetText(active: ProbeCalibration | null | undefined, bare = false): string {
  if (!active || active.state === "unread") return NO_VALUE;
  if (active.state === "none" || active.value === null) return "not set";
  return active.unit && !bare ? fmtQty(active.value, active.unit) : fmtNum(active.value);
}

/** The block's view (texts: the UI's "state — consequence" form, ≤ 60
 *  characters, no value said twice — operator 2026-11-23). `unit`: the
 *  machine's, where the record names none. `refusal` is THIS client's last
 *  Apply / Discard refusal for the pending run (a reply, shown where it
 *  began). */
export function calOffsetView(active: ProbeCalibration | null | undefined, candidate: CalCandidate | null | undefined,
                              unit: string, refusal: CalRefusal | null = null): CalOffsetView {
  const outcome = active?.machine?.outcome;
  const machineText = outcome ? (MACHINE_TEXT[outcome] ?? null) : null;
  let machine = (active?.state && STATE_TEXT[active.state]) ?? machineText;
  let note: CalNote | null = null;
  let refused: string | null = null;
  if (candidate?.state === "pending" && candidate.value !== null) {
    const u = candidate.unit ?? active?.unit ?? unit;
    const basis = [ROUTINE_NAMES[candidate.routine] ?? candidate.routine, sizeText(candidate.size, u)]
      .filter(Boolean).join(" ");
    // two parts: the line breaks between them, never after a dangling "·"
    const lead = `Candidate ${fmtQty(candidate.value, u)}`;
    const detail = `${basis}, ${AXIS_NAMES[candidate.axis] ?? NO_VALUE}`;
    note = { kind: "pending", run: candidate.run, value: candidate.value, lead, detail, text: `${lead} · ${detail}` };
    if (refusal && refusal.kind !== "cal_reset" && refusal.run === candidate.run) refused = refusalText(refusal);
  } else if (candidate?.state === "applied") {
    // the Active line already holds the new value; the note says where it
    // went, once — the line then says no machine state of its own
    note = { kind: "applied", text: `Applied — ${machine ?? "saved"}` };
    machine = null;
  } else if (candidate?.state === "stale") {
    note = { kind: "stale", text: `Result not offered — ${candidate.why ?? "the run did not complete"}` };
  }
  // discarded: the candidate line goes, nothing else changed — no note
  const resetRefusal = refusal?.kind === "cal_reset" && refusal.rev === (active?.rev ?? null) ? refusalText(refusal) : null;
  return { value: activeOffsetText(active), machine, note, refusal: refused, resetRefusal };
}
