"""R248 evidence only. Run beside a COPY of command_policy.py, outside the live tree.

    python3 -B policy-probe.py > policy-results.json

These cases expose the scope of validate_payload; they are not assertions
that a gateway handler would accept these commands or run any machine action.
"""
import hashlib
import json
from pathlib import Path
from command_policy import MachineLimits, validate_payload

cases = [
    ("unknown command", "made_up_command", {"cmd": "made_up_command", "value": 1}, MachineLimits()),
    ("missing required text", "mdi", {"cmd": "mdi"}, MachineLimits()),
    ("misspelled field", "mdi", {"cmd": "mdi", "text": "G0 X1", "vras": {"3015": 10}}, MachineLimits()),
    ("old tool number not bounded", "renumber_tool", {"cmd": "renumber_tool", "old_tool_number": -99, "tool_number": 2}, MachineLimits()),
    ("declared vars rejected", "mdi", {"cmd": "mdi", "text": "O<probe_z_minus_wco> CALL", "vars": {"3015": 10}}, MachineLimits(declared_vars=frozenset({3014}))),
    ("clamp is a returned correction", "set_feed_override", {"cmd": "set_feed_override", "scale": 50}, MachineLimits(max_feed_override=2.0)),
]
rows = []
for name, cmd, payload, limits in cases:
    try:
        correction = validate_payload(cmd, payload, limits)
        rows.append({"case": name, "status": "no exception", "corrections": correction})
    except ValueError as e:
        rows.append({"case": name, "status": "rejected", "error": str(e)})
assert [r["status"] for r in rows] == ["no exception"] * 4 + ["rejected", "no exception"]
assert rows[-1]["corrections"] == {"scale": 2.0}
print(json.dumps({
    "source_sha256": hashlib.sha256(Path(__file__).with_name("command_policy.py").read_bytes()).hexdigest(),
    "rows": rows,
    "assertions": "PASS (observed validator scope)",
    "machine_access": False,
}, indent=2))
