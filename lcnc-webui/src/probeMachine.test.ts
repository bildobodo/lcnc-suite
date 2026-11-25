import { describe, expect, it } from "vitest";
import { probeMachineState, probeMachineText, probeSectionLine, timeOfDay, type ProbeBooking, type ProbeBookingEntry } from "./probeMachine";
import { PROBE_FALLBACK, probeVarMap, surfaceVarMap } from "./probeVars";

const { autoZero: _a, ...P } = PROBE_FALLBACK;
const T = new Date(2026, 10, 24, 5, 12, 30).getTime();
const booking = (over: Record<string, Partial<ProbeBookingEntry> | null> = {}, map = probeVarMap(P, 1)): ProbeBooking => {
  const keys: Record<string, ProbeBookingEntry> = Object.fromEntries(Object.entries(map)
    .map(([k, v]) => [k, { value: v, outcome: "applied" as const, t: T, job: "probe" }]));
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete keys[k];
    else keys[k] = { ...(keys[k] ?? { value: null, outcome: null, t: T }), ...v };
  }
  return { version: 1, keys };
};
const state = (b: ProbeBooking | null, st = {}, stored = true, surface = false, form = {}) =>
  probeMachineState({ ...PROBE_FALLBACK, ...form }, stored, st, b, surface);
const text = (b: ProbeBooking | null, st = {}, stored = true) => probeMachineText(state(b, st, stored));
/** The line with an open edit: the form's own value, its field's state. */
const edited = (b: ProbeBooking | null, form: object, st: object, surface = false) => probeMachineText(state(b, st, true, surface, form));

describe("what the machine holds of the probing form (P5-2 c)", () => {
  it("every value applied or read, equal, on this Link: on the machine, with the last time", () => {
    expect(text(booking())).toBe("On the machine · 05:12");
    expect(text(booking({ "3015": { outcome: "read" } }))).toBe("On the machine · 05:12");
    expect(text(booking({ "3015": { t: T + 60_000 } }))).toBe("On the machine · 05:13");
  });

  it("another value, or none booked: the next probe writes it", () => {
    expect(text(booking({ "3015": { value: 60 } }))).toBe("Saved · the next probe writes it");
    expect(text(booking({ "3015": null }))).toBe("Saved · the next probe writes it");
    expect(text({ version: 0, keys: {} })).toBe("Saved · the next probe writes it");
  });

  it("a section the server never held is no 'Saved'", () => {
    expect(text({ version: 0, keys: {} }, {}, false)).toBe("Defaults · the next probe writes them");
    expect(text(booking({ "3015": { outcome: "unknown", value: null } }), {}, false)).toBe("Defaults · machine value unknown");
  });

  it("one unknown value makes the line unknown — whatever the others are", () => {
    expect(text(booking({ "3015": { outcome: "unknown", value: null } }))).toBe("Saved · machine value unknown");
    expect(text(booking({ "3015": { outcome: "unknown", value: null }, "3016": { value: 1 } }))).toBe("Saved · machine value unknown");
  });

  it("some taken, some refused before the write", () => {
    expect(text(booking({ "3015": { outcome: "applied", value: 25, refused: P.slowFr } })))
      .toBe("Partly on the machine · the next probe writes it");
    // a refusal of ANOTHER value says nothing about this one
    expect(text(booking({ "3015": { outcome: "applied", value: 25, refused: 99 } }))).toBe("Saved · the next probe writes it");
  });

  it("an open edit takes no unknown value out of the line", () => {
    // Codex R470 MT-I40: the edited field's own key, and any other's
    const b = booking({ "3015": { outcome: "unknown", value: null } });
    for (const st of ["draft", "refused"] as const) {
      expect(edited(b, { slowFr: 60 }, { slowFr: st })).toBe("Not saved yet · machine value unknown");
      expect(edited(b, { fastFr: 300 }, { fastFr: st })).toBe("Not saved yet · machine value unknown");
    }
  });

  it("the machine holds the saved value, the form another: the next probe writes what the form shows", () => {
    const b = booking();          // #3015 booked as the saved 50
    expect(edited(b, { slowFr: 60 }, { slowFr: "draft" })).toBe("Not saved yet · the next probe writes it");
    expect(edited(b, { autoZero: true }, { autoZero: "draft" })).toBe("Not saved yet · the next probe writes it");
    // its write refused before it began: the same consequence
    expect(edited(booking({ "3015": { outcome: "applied", value: 50, refused: 60 } }), { slowFr: 60 }, { slowFr: "draft" }))
      .toBe("Not saved yet · the next probe writes it");
  });

  it("the machine took the entry before the server held it; then it is on the machine again", () => {
    const b = booking({ "3015": { value: 60 } });
    expect(edited(b, { slowFr: 60 }, { slowFr: "draft" })).toBe("Not saved yet · on the machine · 05:12");
    expect(edited(b, { slowFr: 60 }, {})).toBe("On the machine · 05:12");
  });

  it("an edit of another job's value is no part of this one's", () => {
    expect(edited(booking(), { scanX0: 5 }, { scanX0: "draft" })).toBe("On the machine · 05:12");
    const scan = booking({}, surfaceVarMap(P));
    expect(edited(scan, { scanX0: 5 }, { scanX0: "draft" }, true)).toBe("Not saved yet · the next probe writes it");
    expect(edited(scan, { traverseFr: 5 }, { traverseFr: "draft" }, true)).toBe("On the machine · 05:12");
  });

  it("the offset and the calibration's axis are no part of it", () => {
    expect(text(booking({ "3032": { outcome: "unknown", value: null }, "3036": { outcome: "unknown", value: null } })))
      .toBe("On the machine · 05:12");
  });

  it("the surface map's job has its own numbers", () => {
    const b = booking({}, surfaceVarMap(P));
    expect(state(b, {}, true, true).kind).toBe("machine");
    expect(state(b).kind).toBe("next");
  });

  it("nothing read is no claim", () => {
    expect(text(null)).toBe("Machine state not read yet");
    expect(probeMachineState(null, true, {}, booking(), false).kind).toBe("unread");
  });

  it("a refusal reason takes the line", () => {
    expect(probeSectionLine("settings.json not written", state(booking()))).toEqual({ text: "Not saved: settings.json not written", refused: true });
    expect(probeSectionLine(null, state(booking()))).toEqual({ text: `On the machine · ${timeOfDay(T)}`, refused: false });
  });

  it("every text of the line stays within 60 characters", () => {
    const all = [booking(), booking({ "3015": { value: 60 } }), booking({ "3015": { outcome: "unknown" } }),
      booking({ "3015": { outcome: "applied", value: 25, refused: P.slowFr } }), null].map(b => text(b));
    const draft = [booking(), booking({ "3015": { value: 60 } }), booking({ "3015": { outcome: "unknown" } })]
      .map(b => edited(b, { slowFr: 60 }, { slowFr: "draft" }));
    for (const t of [...all, ...draft, text({ version: 0, keys: {} }, {}, false)]) expect(t.length, t).toBeLessThanOrEqual(60);
  });
});
