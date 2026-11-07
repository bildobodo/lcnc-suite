// The form's toolsetter rule is the gateway's (P2, Codex R308–R309): a
// program start applies the SERVER's confirmed section, judged by
// lcnc-gateway/toolsetter_rules.py. Both sides are held to ONE file,
// toolsetterRules.contract.json (written by `python3 toolsetter_rules.py
// --write`; test_toolsetter_rules.py holds the Python side to it).
import { describe, expect, it } from "vitest";
import contract from "./toolsetterRules.contract.json";
import { OPTION_VALUES, TOOLSETTER_FALLBACK, TOOLSETTER_REQUIRED, toolsetterSetup, toolsetterVarMap } from "./toolsetterSetup";
import { TS_FINDER_FIELDS, TS_OFFSET_FIELDS, TS_OPTION_FIELDS, TS_POSITION_FIELDS, TS_PROBE_FIELDS } from "./probeFields";
import type { ToolsetterDefaults } from "./defaults";

const six = (v: number) => Number(v.toFixed(6));

describe("the toolsetter rule is one contract with the gateway", () => {
  it("maps every key to the same parameter number", () => {
    const probe = Object.fromEntries(Object.keys(TOOLSETTER_FALLBACK).map((k, i) => [k, i + 1])) as unknown as ToolsetterDefaults;
    const mapped = toolsetterVarMap(probe);
    const byKey = Object.fromEntries(Object.entries(probe).map(([k, v]) => [k, Number(Object.keys(mapped).find(n => mapped[n] === v))]));
    expect(byKey).toEqual(contract.varMap);
  });

  it("has the same defaults, required keys, options and bounds", () => {
    expect(TOOLSETTER_FALLBACK).toEqual(contract.defaults);
    expect([...TOOLSETTER_REQUIRED]).toEqual(contract.required);
    expect(Object.fromEntries(Object.entries(OPTION_VALUES).map(([k, v]) => [k, [...(v ?? [])]]))).toEqual(contract.optionValues);
    const bounds = Object.fromEntries([...TS_POSITION_FIELDS, ...TS_PROBE_FIELDS, ...TS_OPTION_FIELDS, ...TS_OFFSET_FIELDS, ...TS_FINDER_FIELDS]
      .map(f => [f.key, { ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}),
                          ...(f.integer ? { integer: true } : {}) }]));
    expect(bounds).toEqual(contract.bounds);
  });

  it("judges every case of the grid as the gateway does", () => {
    for (const c of contract.cases) {
      const r = toolsetterSetup(c.section);
      expect({ ok: r.ok, missing: r.ok ? [] : r.missing, invalid: r.ok ? [] : r.invalid }, JSON.stringify(c.section))
        .toEqual({ ok: c.ok, missing: c.missing, invalid: c.invalid });
      if (r.ok) {
        const values = Object.fromEntries(Object.entries(toolsetterVarMap(r.values)).map(([k, v]) => [k, six(v)]));
        expect(values, JSON.stringify(c.section)).toEqual(c.values);
      }
    }
  });
});
