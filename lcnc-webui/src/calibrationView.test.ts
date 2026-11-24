import { describe, expect, it } from "vitest";
import { activeOffsetText, calOffsetView, type CalCandidate, type ProbeCalibration } from "./calibrationView";

const active: ProbeCalibration = { value: 0.0677, unit: "mm", state: "active", machine: { outcome: "taken" } };
const cand = (over: Partial<CalCandidate> = {}): CalCandidate => ({
  run: 12, value: 0.0712, was: 0.0677, routine: "probe_cal_round_pocket", size: { d: 20 },
  axis: 0, at: "05:12", state: "pending", ...over,
});

describe("calOffsetView (P5, W3)", () => {
  it("the gateway's record: its value and what the machine holds", () => {
    expect(calOffsetView(active, null, "mm"))
      .toEqual({ value: "0.0677 mm", machine: "on the machine", note: null, refusal: null, resetRefusal: null });
  });

  it("each machine outcome is said as such, none is claimed without one", () => {
    const m = (outcome: NonNullable<ProbeCalibration["machine"]>["outcome"]) =>
      calOffsetView({ ...active, machine: { outcome } }, null, "mm").machine;
    expect(m("saved_not_written")).toBe("the next probe writes it");
    expect(m("saved_write_unknown")).toBe("machine value unknown");
    expect(m("taken_persist_unconfirmed")).toBe("on the machine, file not confirmed");
    expect(calOffsetView({ ...active, machine: null }, null, "mm").machine).toBeNull();
  });

  it("before the gateway sends a record, or when it cannot read it: no value and no claim", () => {
    for (const a of [null, undefined, { value: null, unit: null, state: "unread" as const, machine: null }]) {
      expect(calOffsetView(a, null, "mm")).toEqual({ value: "—", machine: null, note: null, refusal: null, resetRefusal: null });
    }
  });

  it("no active value is 'not set', never a 0; a value that goes nowhere says what to do", () => {
    expect(calOffsetView({ value: null, unit: null, state: "none" }, null, "mm"))
      .toEqual({ value: "not set", machine: "calibrate or Reset", note: null, refusal: null, resetRefusal: null });
    expect(calOffsetView({ value: 0.2, unit: null, state: "unit_unknown", machine: null }, null, "mm").machine)
      .toBe("unit unknown, calibrate or Reset");
    expect(activeOffsetText({ value: 0.2, unit: null, state: "unit_unknown" })).toBe("0.2000");
    expect(activeOffsetText(active, true)).toBe("0.0677");
    expect(calOffsetView({ value: 0.2, unit: "in", state: "unit_other", machine: null }, null, "mm").machine)
      .toBe("other unit, calibrate or Reset");
  });

  it("a pending candidate: its value, routine, size and axis — the old value stays in the Active line only", () => {
    const v = calOffsetView(active, cand(), "mm");
    expect(v.note).toEqual({ kind: "pending", run: 12, value: 0.0712,
      lead: "Candidate 0.0712 mm", detail: "Round hole Ø 20 mm, Avg XY",
      text: "Candidate 0.0712 mm · Round hole Ø 20 mm, Avg XY" });
    expect(v.note!.text).not.toContain("0.0677");
    expect(v.refusal).toBeNull();
  });

  it("a refusal is shown only for the run it was given for, and names the act that failed", () => {
    const apply = (run = 12, why: string | null = "the save failed") => ({ run, kind: "cal_apply" as const, why });
    expect(calOffsetView(active, cand(), "mm", apply()).refusal).toBe("Not applied: the save failed");
    expect(calOffsetView(active, cand(), "mm", { run: 12, kind: "cal_discard", why: "the save failed" }).refusal)
      .toBe("Not discarded: the save failed");
    expect(calOffsetView(active, cand(), "mm", apply(12, null)).refusal, "no answer claims no outcome")
      .toBe("No reply — outcome unknown");
    expect(calOffsetView(active, cand({ run: 13 }), "mm", apply()).refusal).toBeNull();
    expect(calOffsetView(active, cand({ state: "applied" }), "mm", apply()).refusal).toBeNull();
  });

  it("applied: the note says where it went, once; the Active line holds the value without a second machine word", () => {
    const v = calOffsetView({ ...active, value: 0.0712 }, cand({ state: "applied" }), "mm");
    expect(v).toEqual({ value: "0.0712 mm", machine: null, note: { kind: "applied", text: "Applied — on the machine" }, refusal: null, resetRefusal: null });
    expect(calOffsetView({ ...active, machine: { outcome: "saved_write_unknown" } }, cand({ state: "applied" }), "mm").note?.text)
      .toBe("Applied — machine value unknown");
  });

  it("discarded: the candidate line goes, no note; stale: not offered with its reason", () => {
    expect(calOffsetView(active, cand({ state: "discarded" }), "mm").note).toBeNull();
    expect(calOffsetView(active, cand({ state: "stale", why: "the run was aborted" }), "mm").note?.text)
      .toBe("Result not offered — the run was aborted");
  });

  it("a Reset not carried out says so on the record it was asked for, and only there", () => {
    const r = { kind: "cal_reset" as const, rev: 4, why: "Machine off — press Machine On" };
    expect(calOffsetView({ ...active, rev: 4 }, null, "mm", r).resetRefusal).toBe("Not reset: Machine off — press Machine On");
    expect(calOffsetView({ ...active, rev: 4 }, null, "mm", { ...r, why: null }).resetRefusal).toBe("No reply — outcome unknown");
    expect(calOffsetView({ ...active, rev: 5 }, null, "mm", r).resetRefusal).toBeNull();
    expect(calOffsetView({ ...active, rev: 4 }, cand(), "mm", r).refusal, "never on the candidate").toBeNull();
  });

  it("a run that reported no value has none to show", () => {
    const v = calOffsetView(active, cand({ state: "stale", value: null, why: "no result was reported" }), "mm");
    expect(v.note).toEqual({ kind: "stale", text: "Result not offered — no result was reported" });
  });

  it("every text stays within 60 characters", () => {
    const texts = [
      calOffsetView(active, cand({ routine: "probe_cal_square_pocket", size: { x: 20.25, y: 30.25 }, axis: 2 }), "mm").note!.text,
      calOffsetView(active, cand({ state: "stale" }), "mm").note!.text,
      calOffsetView({ ...active, machine: { outcome: "taken_persist_unconfirmed" } }, cand({ state: "applied" }), "mm").note!.text,
    ];
    for (const t of texts) expect(t.length, t).toBeLessThanOrEqual(60);
  });
});
