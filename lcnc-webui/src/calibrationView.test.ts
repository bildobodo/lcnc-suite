import { describe, expect, it } from "vitest";
import { calOffsetView, type CalCandidate, type ProbeCalibration } from "./calibrationView";

const active: ProbeCalibration = { value: 0.0677, unit: "mm", state: "active", machine: { outcome: "taken" } };
const cand = (over: Partial<CalCandidate> = {}): CalCandidate => ({
  run: 12, value: 0.0712, was: 0.0677, routine: "probe_cal_round_pocket", size: { d: 20 },
  axis: 0, at: "05:12", state: "pending", ...over,
});

describe("calOffsetView (P5, W3)", () => {
  it("the gateway's record: its value and what the machine holds", () => {
    expect(calOffsetView(active, 9, null, "mm"))
      .toEqual({ value: "0.0677 mm", machine: "on the machine", note: null, refusal: null });
  });

  it("each machine outcome is said as such, none is claimed without one", () => {
    const m = (outcome: NonNullable<ProbeCalibration["machine"]>["outcome"]) =>
      calOffsetView({ ...active, machine: { outcome } }, 0, null, "mm").machine;
    expect(m("saved_not_written")).toBe("the next probe writes it");
    expect(m("saved_write_unknown")).toBe("machine value unknown");
    expect(m("taken_persist_unconfirmed")).toBe("on the machine, file not confirmed");
    expect(calOffsetView({ ...active, machine: null }, 0, null, "mm").machine).toBeNull();
  });

  it("before the gateway sends a record: the form's value, no machine claim", () => {
    expect(calOffsetView(null, 0.05, null, "mm")).toEqual({ value: "0.0500 mm", machine: null, note: null, refusal: null });
  });

  it("no active value is 'not set', never a 0", () => {
    expect(calOffsetView({ value: null, unit: "mm", state: "none" }, 0.2, null, "mm").value).toBe("not set");
  });

  it("a pending candidate: its value, routine, size and axis — the old value stays in the Active line only", () => {
    const v = calOffsetView(active, 0, cand(), "mm");
    expect(v.note).toEqual({ kind: "pending", run: 12, value: 0.0712,
      lead: "Candidate 0.0712 mm", detail: "Round hole Ø 20 mm, Avg XY",
      text: "Candidate 0.0712 mm · Round hole Ø 20 mm, Avg XY" });
    expect(v.note!.text).not.toContain("0.0677");
    expect(v.refusal).toBeNull();
  });

  it("a refusal is shown only for the run it was given for", () => {
    expect(calOffsetView(active, 0, cand(), "mm", { run: 12, why: "Not armed — press Arm" }).refusal)
      .toBe("Not applied — Not armed — press Arm");
    expect(calOffsetView(active, 0, cand({ run: 13 }), "mm", { run: 12, why: "x" }).refusal).toBeNull();
    expect(calOffsetView(active, 0, cand({ state: "applied" }), "mm", { run: 12, why: "x" }).refusal).toBeNull();
  });

  it("applied: the note says where it went, once; the Active line holds the value without a second machine word", () => {
    const v = calOffsetView({ ...active, value: 0.0712 }, 0, cand({ state: "applied" }), "mm");
    expect(v).toEqual({ value: "0.0712 mm", machine: null, note: { kind: "applied", text: "Applied — on the machine" }, refusal: null });
    expect(calOffsetView({ ...active, machine: { outcome: "saved_write_unknown" } }, 0, cand({ state: "applied" }), "mm").note?.text)
      .toBe("Applied — machine value unknown");
  });

  it("discarded: the candidate line goes, no note; stale: not offered with its reason", () => {
    expect(calOffsetView(active, 0, cand({ state: "discarded" }), "mm").note).toBeNull();
    expect(calOffsetView(active, 0, cand({ state: "stale", why: "the run was aborted" }), "mm").note?.text)
      .toBe("Result not offered — the run was aborted");
  });

  it("every text stays within 60 characters", () => {
    const texts = [
      calOffsetView(active, 0, cand({ routine: "probe_cal_square_pocket", size: { x: 20.25, y: 30.25 }, axis: 2 }), "mm").note!.text,
      calOffsetView(active, 0, cand({ state: "stale" }), "mm").note!.text,
      calOffsetView({ ...active, machine: { outcome: "taken_persist_unconfirmed" } }, 0, cand({ state: "applied" }), "mm").note!.text,
    ];
    for (const t of texts) expect(t.length, t).toBeLessThanOrEqual(60);
  });
});
