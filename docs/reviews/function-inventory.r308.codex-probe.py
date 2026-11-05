#!/usr/bin/env python3
"""R308: offline probes of the archived source + read-only report audit.

Usage: python3 -B r308-probe.py ARCHIVE LIVE_REPORT_PARENT
No gateway import, socket, HAL, machine command or file write. The gateway
functions are extracted by AST; every dependency with effects is a recorder.
"""
import ast
import asyncio
import collections
import hashlib
import json
import os
from pathlib import Path
import sys
import types
import __future__

root, reports = map(Path, sys.argv[1:3])
sys.path.insert(0, str(root / "scripts"))
from test_support import native_cases as nc

source = (root / "lcnc-gateway/gateway.py").read_text()
tree = ast.parse(source)
out = {"archive": str(root), "sources": {}, "live_reports": [], "start_guard": [], "apply": []}
for rel in ("scripts/native_run.py", "scripts/test_support/native_cases.py", "lcnc-gateway/gateway.py"):
    out["sources"][rel] = hashlib.sha256((root / rel).read_bytes()).hexdigest()


def extract(name, ns):
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == name)
    module = ast.Module(body=[node], type_ignores=[])
    exec(compile(module, str(root / "lcnc-gateway/gateway.py"), "exec",
                 flags=__future__.annotations.compiler_flag), ns)
    return ns[name]


def judge(row, **change):
    kw = {k: row[k] for k in ("call", "end", "top_z", "errors", "call_tool", "call_offset", "tool",
                            "end_tool", "table", "applied")}
    kw["setting"] = row["setting_3106"]
    kw.update(change)
    return nc.eval_m600_return("r308", **kw)


for run in ("20261105T211916", "20261105T212704"):
    path = reports / run
    raw = json.loads((path / "report.json").read_text())
    rows = raw["rows"]
    row = next(r for r in rows if r["case"] == "m600-t1-return")
    counts = collections.Counter(r["status"] for r in rows if not r.get("informational"))
    item = {"run": run, "commit": raw["commit"], "verdict": raw["verdict"], "counts": dict(counts),
            "row": row, "report_sha256": hashlib.sha256((path / "report.json").read_bytes()).hexdigest()}
    for fname in ("restore.json", "restore-post.json"):
        restored = json.loads((path / fname).read_text())
        assert restored["outcome"] == "complete" and restored["isolation"] == []
        item[fname] = {k: restored.get(k) for k in ("outcome", "isolation", "cleanup", "repeat_of")}
    assert max(abs(a-b) for a, b in zip(row["call"][:2], row["end"][:2])) <= nc.RETURN_TOL
    assert abs(row["end"][2] - row["top_z"]) <= nc.RETURN_TOL
    if run == "20261105T212704":
        assert judge(row)["status"] == "PASS"
        tests = [
            ("Y return wrong", {"end": [0, 0.01, 0]}, "FAIL"),
            ("above top wrong", {"end": [0, 0, 0.01]}, "FAIL"),
            ("unknown X cannot hide bad Z", {"call": [None, 0, 0], "end": [None, 0, -20]}, "FAIL"),
            ("unknown return flag cannot hide wrong tool", {"setting": None, "end_tool": 2}, "FAIL"),
            ("unknown applied length cannot hide NML error", {"applied": None, "errors": [(1, "injected")]}, "FAIL"),
            ("unknown call offset", {"call_offset": None}, "incomplete"),
            ("unknown measured length", {"table": None}, "incomplete"),
            ("no increase", {"call_offset": row["table"]}, "incomplete"),
            ("missing Y", {"end": [0, None, 0]}, "incomplete"),
        ]
        item["counterprobes"] = []
        for name, changes, expected in tests:
            actual = judge(row, **changes)
            assert actual["status"] == expected, (name, actual)
            item["counterprobes"].append({"case": name, "expected": expected, "actual": actual["status"]})
    out["live_reports"].append(item)


async def guard_case(unknown, clears):
    calls = []
    async def mode(*args, **kw):
        calls.append("mode")
    async def apply(values, armed):
        calls.append({"apply": values})
        return True, True
    ns = {"_skip_flag_unknown": unknown, "_rfl_busy_reason": lambda: None,
          "_interp_idle_refusal": lambda: None, "_program_start_refusal": lambda armed: None,
          "set_mode": mode, "_apply_probe_vars": apply, "linuxcnc": types.SimpleNamespace(MODE_MDI=3),
          "_trace": types.SimpleNamespace(emit=lambda *a, **k: None)}
    result = await extract("_start_guard", ns)(True, clears_flag=clears, program=True)
    assert result is None
    assert bool(calls) == (unknown and not clears)
    return {"skip_unknown": unknown, "clears_flag": clears, "calls": calls}


class Lock:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass


async def apply_case(name, values, rcs):
    calls, booked = [], []
    def file_write(path, vals): calls.append({"file": vals})
    async def file_thread(fn, *a): return fn(*a)
    async def mode(*a, **kw): calls.append({"mode": a})
    async def cmd(fn, text, **kw):
        calls.append({"mdi": text})
        rc = rcs.pop(0)
        if isinstance(rc, BaseException): raise rc
        return rc
    ns = {"asyncio": asyncio, "os": os, "_skip_flag_unknown": True,
          "STAT": types.SimpleNamespace(ini_filename="/tmp/FAKE/fixture.ini", poll=lambda: None),
          "linuxcnc": types.SimpleNamespace(MODE_MDI=3, ini=lambda p: types.SimpleNamespace(find=lambda *a: "vars")),
          "finite_float": float, "_get_var_file_lock": Lock, "_var_file_thread": file_thread,
          "_write_var_file_updates": file_write,
          "_status_runtime": types.SimpleNamespace(mark_var_file_written=lambda p: None),
          "_trace": types.SimpleNamespace(emit=lambda *a, **kw: None),
          "safe_get": lambda key, fallback: True, "reject_if_auto_running": lambda: None,
          "_ts_ensure": lambda: None, "_ts_book": lambda v, state: booked.append({"values": v, "origin": state}),
          "set_mode": mode, "_interp_idle_refusal": lambda: None,
          "_cmd_blocking": cmd, "_cmd_rc_failed": lambda rc: rc != 1,
          "CMD": types.SimpleNamespace(mdi=object())}
    try:
        result = await extract("_apply_probe_vars", ns)(values, True)
    except asyncio.CancelledError:
        result = "cancelled"
    return {"case": name, "result": result, "calls": calls, "booked": booked}


async def main():
    for unknown, clears in ((False, False), (True, False), (True, True)):
        out["start_guard"].append(await guard_case(unknown, clears))
    r = await apply_case("file and MDI precision", {"3102": 1.123456789}, [1])
    assert r["calls"][0] == {"file": {"3102": 1.123456789}}
    assert r["booked"][0]["values"][3102] == 1.123457
    out["apply"].append(r)
    values = {str(k): 1 for k in (3004,3005,3006,3007,3009,3010,3013,*range(3100,3116))}
    r = await apply_case("second chunk fails", values, [1, 3])
    assert r["result"] == (True, False)
    assert [b["origin"] for b in r["booked"]] == ["applied", "unknown"]
    out["apply"].append(r)
    r = await apply_case("second chunk cancelled", values, [1, asyncio.CancelledError()])
    assert r["result"] == "cancelled"
    assert [b["origin"] for b in r["booked"]] == ["applied", "unknown"]
    out["apply"].append(r)


asyncio.run(main())
out["status"] = "PASS"
print(json.dumps(out, ensure_ascii=False, indent=2))
