import { describe, expect, it } from "vitest";
import {
  PROBE_COMMON_FIELDS, PROBE_HINT_FIELDS, CAL_ROUND_FIELD, CAL_RECT_FIELDS, SCAN_FIELDS,
  TS_POSITION_FIELDS, TS_PROBE_FIELDS, TS_OPTION_FIELDS, TS_OFFSET_FIELDS, TS_FINDER_FIELDS,
  unitText, type ParamField,
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
