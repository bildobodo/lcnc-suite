import { describe, expect, it } from "vitest";
import { planEntryCheck, type EntryPlanInput } from "./sweepEntry";

const base = { id: "base" }, entry = { id: "entry" }, entry2 = { id: "entry2" };
const idle = (over: Partial<EntryPlanInput<object>> = {}): EntryPlanInput<object> => ({
  entry, base, mainTrack: null, hasMainResult: false, mainBusy: false, mainResumable: false,
  pendingTrack: null, overlayTrack: null, sideTrack: null, ...over,
});

describe("planEntryCheck", () => {
  it("base done: only the entry segment is swept", () => {
    expect(planEntryCheck(idle({ mainTrack: base, hasMainResult: true }))).toEqual({ runBase: false, runSide: true });
  });
  it("base still RUNNING: never cancelled — the entry segment runs beside it", () => {
    expect(planEntryCheck(idle({ mainBusy: true, pendingTrack: base }))).toEqual({ runBase: false, runSide: true });
  });
  it("base PARKED: kept resumable — the entry segment runs beside it", () => {
    expect(planEntryCheck(idle({ mainTrack: base, hasMainResult: true, mainResumable: true, pendingTrack: base })))
      .toEqual({ runBase: false, runSide: true });
  });
  it("no base result at all (cleared by a touch-off): base sweep + entry segment", () => {
    expect(planEntryCheck(idle())).toEqual({ runBase: true, runSide: true });
  });
  it("re-entry with the overlay already swept for THIS entry track: nothing runs", () => {
    expect(planEntryCheck(idle({ mainTrack: base, hasMainResult: true, overlayTrack: entry })))
      .toEqual({ runBase: false, runSide: false });
  });
  it("re-entry with a NEW entry track (machine moved): only the new segment", () => {
    expect(planEntryCheck(idle({ mainTrack: base, hasMainResult: true, overlayTrack: entry, entry: entry2 })))
      .toEqual({ runBase: false, runSide: true });
  });
  it("a side sweep already in flight for this entry track is not repeated", () => {
    expect(planEntryCheck(idle({ mainBusy: true, pendingTrack: base, sideTrack: entry })))
      .toEqual({ runBase: false, runSide: false });
  });
  it("machine at the first point (entry IS the base): base only when unknown", () => {
    expect(planEntryCheck(idle({ entry: base }))).toEqual({ runBase: true, runSide: false });
    expect(planEntryCheck(idle({ entry: base, mainTrack: base, hasMainResult: true }))).toEqual({ runBase: false, runSide: false });
    expect(planEntryCheck(idle({ entry: base, mainBusy: true, pendingTrack: base }))).toEqual({ runBase: false, runSide: false });
  });
  it("a main result on some OTHER track does not count as the base", () => {
    expect(planEntryCheck(idle({ mainTrack: entry2, hasMainResult: true }))).toEqual({ runBase: true, runSide: true });
  });
  it("no program: nothing", () => {
    expect(planEntryCheck(idle({ base: null }))).toEqual({ runBase: false, runSide: false });
  });
});
