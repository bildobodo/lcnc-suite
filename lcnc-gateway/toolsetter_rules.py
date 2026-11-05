"""The toolsetter's set-up rule and its parameter map — the gateway's copy of
lcnc-webui/src/toolsetterSetup.ts and the toolsetter fields of probeFields.ts
(P2, Codex R308–R309: a program start applies the SERVER's confirmed
section, so the gateway must judge it exactly as the form does).

One contract, two languages: `contract()` is written to
lcnc-webui/src/toolsetterRules.contract.json (`python3 toolsetter_rules.py
--write`); test_toolsetter_rules.py holds this module to the file and
toolsetterRules.contract.test.ts holds the TypeScript side to it — the
tables and the verdicts of a case grid. Pure, no LinuxCNC import."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

#: The form's keys → the parameter numbers tool_touch_off.ngc reads
#: (toolsetterVarMap; CLAUDE.md "Toolsetter Var-File Mapping").
VAR_MAP = {
    "fastFeed": 3004, "slowFeed": 3005, "traverseFeed": 3006, "maxZTravel": 3007, "retractDist": 3009,
    "spindleZeroHeight": 3010, "offsetDirection": 3013,
    "touchX": 3100, "touchY": 3101, "touchZ": 3102, "useToolTable": 3103, "toolMinDis": 3104,
    "brakeAfter": 3105, "goBackToStart": 3106, "spindleStopM": 3107, "disablePrePos": 3108,
    "addReps": 3109, "lastTry": 3110, "offsetDiameter": 3111, "offsetValue": 3112,
    "finderTouchX": 3113, "finderTouchY": 3114, "finderDiffZ": 3115,
}
#: TOOLSETTER_FALLBACK — the form's starting point, never a machine configuration.
DEFAULTS = {
    "fastFeed": 0, "slowFeed": 0, "traverseFeed": 0, "maxZTravel": 0, "retractDist": 0,
    "spindleZeroHeight": 0, "offsetDirection": 0, "touchX": 0, "touchY": 0, "touchZ": 0,
    "useToolTable": 0, "toolMinDis": 0, "brakeAfter": 0, "goBackToStart": 0, "spindleStopM": 5,
    "disablePrePos": 0, "addReps": 0, "lastTry": 0, "offsetDiameter": 0, "offsetValue": 0,
    "finderTouchX": 0, "finderTouchY": 0, "finderDiffZ": 0,
}
#: TOOLSETTER_REQUIRED — saved before anything goes to the machine.
REQUIRED = ("touchX", "touchY", "touchZ", "fastFeed", "slowFeed", "traverseFeed",
            "maxZTravel", "retractDist", "spindleZeroHeight")
#: OPTION_VALUES — a choice, one of these.
OPTION_VALUES = {
    "offsetDirection": (0, 1, 2, 3), "brakeAfter": (0, 1, 2), "spindleStopM": (5, 500),
    "useToolTable": (0, 1), "goBackToStart": (0, 1), "disablePrePos": (0, 1), "lastTry": (0, 1),
}
#: probeFields' constraints of every other key ({} = any finite number).
BOUNDS = {
    "touchX": {}, "touchY": {}, "touchZ": {},
    "fastFeed": {"min": 1}, "slowFeed": {"min": 0}, "traverseFeed": {"min": 1}, "maxZTravel": {"min": 1},
    "retractDist": {"min": 0.1}, "spindleZeroHeight": {"min": 0.1},
    "toolMinDis": {"min": 0}, "addReps": {"min": 0, "integer": True},
    "offsetDiameter": {"min": 0}, "offsetValue": {"min": 0, "max": 100},
    "finderTouchX": {}, "finderTouchY": {}, "finderDiffZ": {},
}
UNSET_REASON = "Toolsetter not set up — Probing › Toolsetter"
INVALID_REASON = "Toolsetter values invalid — Probing › Toolsetter"


def canonical(v: float) -> float:
    """The number a parameter MDI sends (`#n=%.6f`): the one value for the
    booking, the comparison and the file (R309 A-4)."""
    return float(f"{float(v):.6f}")


def _valid(key: str, v) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return False
    if key in OPTION_VALUES:
        return v in OPTION_VALUES[key]
    b = BOUNDS.get(key)
    if b is None:
        return False
    return ((b.get("min") is None or v >= b["min"]) and (b.get("max") is None or v <= b["max"])
            and (not b.get("integer") or float(v).is_integer()))


def setup(section) -> dict:
    """toolsetterSetup(): {"ok": True, "values": {var: canonical}} when every
    REQUIRED field is saved and every saved field valid (options left unsaved
    take DEFAULTS), else {"ok": False, "reason", "missing", "invalid"}."""
    saved = section if isinstance(section, dict) else {}
    missing = [k for k in REQUIRED if k not in saved]
    invalid = [k for k in DEFAULTS if k in saved and not _valid(k, saved[k])]
    if missing or invalid:
        return {"ok": False, "reason": UNSET_REASON if missing else INVALID_REASON,
                "missing": missing, "invalid": invalid}
    values = {**DEFAULTS, **{k: saved[k] for k in DEFAULTS if k in saved}}
    return {"ok": True, "values": {VAR_MAP[k]: canonical(v) for k, v in values.items()}}


def _cases() -> list:
    """The grid both sides are judged on: complete, each required key missing,
    each kind of invalid value, an option outside its set, unknown keys."""
    good = {"touchX": 10, "touchY": 10.5, "touchZ": -180, "fastFeed": 2000, "slowFeed": 20, "traverseFeed": 500,
            "maxZTravel": 180, "retractDist": 3, "spindleZeroHeight": 180}
    out = [{}, good, {**good, "goBackToStart": 1, "spindleStopM": 500, "addReps": 2, "offsetValue": 100},
           {**good, "unknownKey": "x"}, "not a dict"]
    out += [{k: v for k, v in good.items() if k != gone} for gone in REQUIRED]
    out += [{**good, "addReps": 1.5}, {**good, "offsetValue": 101}, {**good, "fastFeed": 0}, {**good, "slowFeed": 0},
            {**good, "retractDist": 0.05}, {**good, "spindleStopM": 6}, {**good, "goBackToStart": 2},
            {**good, "touchZ": "x"}, {**good, "touchZ": True}, {**good, "touchZ": None},
            {**good, "touchZ": -180.1234567}]
    return out


def contract() -> dict:
    cases = []
    for section in _cases():
        r = setup(section)
        cases.append({"section": section, "ok": r["ok"], "missing": r.get("missing", []),
                      "invalid": r.get("invalid", []),
                      "values": {str(k): v for k, v in r["values"].items()} if r["ok"] else None})
    return {"varMap": VAR_MAP, "defaults": DEFAULTS, "required": list(REQUIRED),
            "optionValues": {k: list(v) for k, v in OPTION_VALUES.items()}, "bounds": BOUNDS, "cases": cases}


CONTRACT = Path(__file__).resolve().parent.parent / "lcnc-webui" / "src" / "toolsetterRules.contract.json"

if __name__ == "__main__":
    if "--write" in sys.argv[1:]:
        CONTRACT.write_text(json.dumps(contract(), indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {CONTRACT}")
