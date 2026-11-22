import { describe, expect, it } from "vitest";
import {
  PROBE_COMMON_FIELDS, PROBE_HINT_FIELDS, CAL_ROUND_FIELD, CAL_RECT_FIELDS, SCAN_FIELDS,
  TS_POSITION_FIELDS, TS_PROBE_FIELDS, TS_OPTION_FIELDS, TS_OFFSET_FIELDS, TS_FINDER_FIELDS,
  unitText, type ParamField,
  bossPocketRefusal, bossPocketNote, SIZE_NEEDED_ROUND, SIZE_NEEDED_RECT, SIZE_NOT_A_NUMBER, SEARCH_LIMITED,
} from "./probeFields";

const PROBE: ParamField<string>[] = [
  ...PROBE_COMMON_FIELDS, ...Object.values(PROBE_HINT_FIELDS).flat(), CAL_ROUND_FIELD, ...CAL_RECT_FIELDS, ...SCAN_FIELDS,
];
const TOOLSETTER: ParamField<string>[] = [
  ...TS_POSITION_FIELDS, ...TS_PROBE_FIELDS, ...TS_OPTION_FIELDS, ...TS_OFFSET_FIELDS, ...TS_FINDER_FIELDS,
];

// Every key is a numeric setting of ProbeDefaults / ToolsetterDefaults by
// type (ParamField<K>); these pin the texts and the unit rule.
describe("probeFields", () => {
  it("a help text says what the value is in at most 120 characters (the LONG_HELP rule)", () => {
    for (const f of [...PROBE, ...TOOLSETTER]) {
      expect(f.help.length, f.label).toBeLessThanOrEqual(120);
      expect(f.help, f.label).toMatch(/\S/);
    }
  });

  it("labels are unique within a form", () => {
    const common = PROBE_COMMON_FIELDS.map(f => f.label);
    expect(new Set(common).size).toBe(common.length);
    const ts = TOOLSETTER.map(f => f.label);
    expect(new Set(ts).size).toBe(ts.length);
  });

  it("a unit follows the machine's linear unit; counts and tool numbers have none", () => {
    expect(unitText("len", "mm")).toBe("mm");
    expect(unitText("feed", "mm")).toBe("mm/min");
    expect(unitText("len", "in")).toBe("in");
    expect(unitText("feed", "in")).toBe("in/min");
    expect(unitText("pct", "in")).toBe("%");
    expect(unitText(null, "mm")).toBeUndefined();
    for (const f of [...PROBE, ...TOOLSETTER].filter(f => f.integer)) expect(f.unit, f.label).toBeNull();
  });

  it("the probing feeds carry the glossary's names in both forms", () => {
    const feeds = (fs: ParamField<string>[]) => fs.filter(f => f.unit === "feed").map(f => f.label).sort();
    expect(feeds(PROBE_COMMON_FIELDS)).toEqual(["Fast Feed", "Slow Feed", "Traverse Feed"]);
    expect(feeds(TS_PROBE_FIELDS)).toEqual(["Fast Feed", "Slow Feed", "Traverse Feed"]);
  });
});

// P4-5 (machine day F25, Codex MT433-02): the Boss/Pocket size contract —
// a boss needs its size (it is pre-positioned by it), a pocket at 0 searches
// Max X/Y Travel alone (said, not refused), an empty or invalid size is
// never 0; one function for the cell and the press.
describe("the Boss/Pocket size contract", () => {
  const sizes = (o: Record<string, unknown>) => ({ diameterHint: 0, xHintBP: 0, yHintBP: 0, ...o });
  it("a Round Boss needs its diameter, a Rect Boss X and Y", () => {
    expect(bossPocketRefusal("rb", sizes({}))).toBe(SIZE_NEEDED_ROUND);
    expect(bossPocketRefusal("rb", sizes({ diameterHint: 20 }))).toBeNull();
    expect(bossPocketRefusal("xb", sizes({ xHintBP: 20 }))).toBe(SIZE_NEEDED_RECT);
    expect(bossPocketRefusal("xb", sizes({ yHintBP: 20 }))).toBe(SIZE_NEEDED_RECT);
    expect(bossPocketRefusal("xb", sizes({ xHintBP: 20, yHintBP: 10 }))).toBeNull();
    // a Rect Boss does not read the diameter, a Round Boss not X/Y
    expect(bossPocketRefusal("xb", sizes({ diameterHint: 20 }))).toBe(SIZE_NEEDED_RECT);
    expect(bossPocketRefusal("rb", sizes({ xHintBP: 20, yHintBP: 20 }))).toBe(SIZE_NEEDED_ROUND);
  });
  it("a pocket at 0 runs and says its limited search", () => {
    for (const op of ["rp", "rpc"]) {
      expect(bossPocketRefusal(op, sizes({}))).toBeNull();
      expect(bossPocketNote(op, sizes({}))).toBe(SEARCH_LIMITED);
      expect(bossPocketNote(op, sizes({ diameterHint: 30 }))).toBeNull();
    }
    for (const op of ["xp", "xpc"]) {
      expect(bossPocketNote(op, sizes({ xHintBP: 30 })), "Y at 0 limits Y").toBe(SEARCH_LIMITED);
      expect(bossPocketNote(op, sizes({ xHintBP: 30, yHintBP: 20 }))).toBeNull();
    }
    expect(bossPocketNote("rb", sizes({ diameterHint: 20 })), "a boss has no limited search note").toBeNull();
  });
  it("an empty or invalid size is never 0", () => {
    for (const bad of ["", null, undefined, Number.NaN, -1, "5"]) {
      expect(bossPocketRefusal("rp", sizes({ diameterHint: bad })), String(bad)).toBe(SIZE_NOT_A_NUMBER);
      expect(bossPocketRefusal("xp", sizes({ yHintBP: bad })), String(bad)).toBe(SIZE_NOT_A_NUMBER);
      expect(bossPocketRefusal("rb", sizes({ diameterHint: bad })), String(bad)).toBe(SIZE_NEEDED_ROUND);
      expect(bossPocketNote("rp", sizes({ diameterHint: bad }))).toBeNull();
    }
  });
  it("no help promises a blind probe", () => {
    for (const f of PROBE_HINT_FIELDS.boss ?? []) expect(f.help).not.toMatch(/blind/i);
  });
});
