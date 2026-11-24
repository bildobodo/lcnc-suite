"""R462 plan review. No gateway import, machine connection or live-tree test.

Run from an isolated directory:
  python3 probes.py /home/cnc/lcnc-suite > observations.json
Reads exact git objects and Claude's saved native evidence. The range probe
executes the existing range-initialization fragment, NOT an entire sweep or
the unimplemented P4. Line selection below is explicitly a model of P4.
"""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from typing import Dict, Optional

repo = Path(sys.argv[1])
revision = "6c78780c"
manifest = {}
plan_path = repo / "docs/reviews/maschinentag.r462.p6d-plan-v4.md"
manifest[str(plan_path.relative_to(repo))] = hashlib.sha256(plan_path.read_bytes()).hexdigest()


def source(path):
    data = subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=repo)
    manifest[path] = hashlib.sha256(data).hexdigest()
    return data.decode()


collision = source("lcnc-webui/src/viewer/collision.ts")
fragment = collision[collision.index("  const rangeFrom = opts.range ?"):]
fragment = fragment[:fragment.index("\n  // In contact at the range's first sample")]
# Only TS syntax in this exact fragment: the non-null postfix after indexing.
js_fragment = fragment.replace("]!", "]")
script = """
function range(from, dcum) {
  const opts = {range: {from}}, n = dcum.length;
  const inContact = [1], seeded = [1], onsetRapid = [1], undecided = [1];
  const restUndec = new Set([1]);
  FRAGMENT
  return {rangeFrom, startSeg, rangeStart, rangeEmpty};
}
console.log(JSON.stringify({
  first_line_endpoint: range(1, [0, 10, 20]),
  final_line_endpoint: range(2, [0, 10, 20]),
  predecessor_control: range(0, [0, 10, 20])
}));
""".replace("FRAGMENT", js_fragment)
ranges = json.loads(subprocess.check_output(["node", "--input-type=module"], input=script.encode()))
assert ranges["first_line_endpoint"]["startSeg"] == 2  # segment 1 omitted
assert ranges["final_line_endpoint"]["rangeEmpty"] is True
assert ranges["predecessor_control"]["startSeg"] == 1

# Raw source line is not a monotone main-program execution boundary.
bulk = source("lcnc-webui/src/ws/bulkData.ts")
scrub = source("lcnc-webui/src/viewer/scrubTrack.ts")
assert "segment ending here" in bulk and "t.cline?.[i] ?? 0" in scrub
raw = [0, 300, 400, 20]
own_ok = [0, 0, 0, 1]
call = [0, 5, 5, 0]
display = [ln if ok else cl for ln, ok, cl in zip(raw, own_ok, call)]
raw_index = next(i for i, ln in enumerate(raw) if ln >= 20)
display_index = next(i for i, ln in enumerate(display) if ln >= 20)
assert raw_index == 1 and display_index == 3

viewer = source("lcnc-webui/src/ThreeViewer.vue")
dep = source("lcnc-webui/src/viewer/startDep.ts")
check = source("lcnc-webui/src/viewer/checkBasis.ts")
store = source("lcnc-webui/src/ws/statusStore.ts")
assert 'const K = track.depEnd ?? 0;' in viewer
assert 'if (K <= 0) return base;' in dep
assert 'runCollisionCheck(t, { basis: run.basis, gen: run.gen, keepShown: true });' in viewer
assert 'kind: "run-full"; done: boolean' in check
assert 'if (poKey !== _previewOriginKey)' in store
assert 'if (rbKey !== _runBasisKey)' in store

# Execute the unchanged booking functions in an isolated namespace.
gateway = source("lcnc-gateway/gateway.py")
names = {"_ts_book", "_ts_mark_assumed"}
nodes = [n for n in ast.parse(gateway).body if isinstance(n, ast.FunctionDef) and n.name in names]
assert len(nodes) == 2
events = []
ns = dict(Dict=Dict, Optional=Optional, TOOLSETTER_BASIS_KEYS={3014},
          _ts_basis={3014: {"value": 1.0, "origin": "assumed", "t": 0}},
          _ts_basis_version=7, _ts_hold_anchor=None,
          _ts_ensure=lambda: None, _ts_file_values=lambda keys: {k: 1.0 for k in keys},
          _trace=SimpleNamespace(emit=lambda *a, **kw: events.append([a, kw])),
          time=SimpleNamespace(time=lambda: 10.0, monotonic=lambda: 10.0),
          toolsetter_basis_view=lambda values: {"state": "assumed"})
exec(compile(ast.Module(body=nodes, type_ignores=[]), "6c78780c:gateway.py", "exec"), ns)
ns["_ts_mark_assumed"]([3014])
same = ns["_ts_basis_version"]
assert same == 7 and not events
ns["_ts_basis"][3014]["origin"] = "applied"
ns["_ts_mark_assumed"]([3014])
changed = ns["_ts_basis_version"]
assert changed == 8 and len(events) == 1

path = repo / "docs/reviews/maschinentag.r462.p6d-spike-65a8b419.json"
data = path.read_bytes()
manifest[str(path.relative_to(repo))] = hashlib.sha256(data).hexdigest()
saved = json.loads(data)
verified = []
measured = 0
holds = []
for run_name, run in saved["runs"].items():
    assert run["commit"].startswith("65a8b419")
    assert run["restore"] == run["restore_post"] == "complete"
    assert run["owed"] == "settled"
    assert not run["error"] and not run["case_errors"] and not run["crashes"]
    for case_name, case in run["cases"].items():
        rec = case.get("run_basis_start")
        if not rec or rec["verified"] is not True:
            continue
        wait, written = case["wait"], case["run_basis_written"]
        assert wait["exit"] == "verified"
        assert wait["end"] <= rec["t"] <= written["t"]
        assert wait["version_at_end"] == rec["version"] == written["version_now"]
        assert rec["verified_against"]["version"] == rec["version"]
        assert rec["verified_against"]["tool_basis_rev"] == rec["tool_basis_rev"] == written["tool_basis_rev_now"]
        assert written["ts_version_now"] == rec["ts_version"]
        assert not written["refresh_running"] and not written["reparse_pending"]
        if case_name != "e":
            measured += 1
            assert any(t >= 0 and why == "not a parse made during the run"
                       for t, why in case["page_run_check_refused_rel_write_s"])
        verified.append({"run": run_name, "case": case_name, "wait_s": wait["waited_s"],
                         "record_to_write_ms": case["timing_s"]["record_to_write_ms"]})
        if run_name == "run2_assumed" and case_name in ("a1", "a1b"):
            assert not case["read_backs"]
            assert 3014 in case["booking_before"]["by_origin"]["assumed"]
            assert 3014 in case["booking_after"]["by_origin"]["assumed"]
            held = next(row[0] for row in case["hold"] if row[2] == "gcode.reparse_toolsetter_held")
            end = next(row[0] for row in case["hold"] if row[2] == "gcode.reparse_toolsetter_hold_ended" and row[3]["why"] == "cap")
            publish = case["timing_s"]["publications_in_wait"][-1]["publish"]
            assert wait["start"] <= held < end < publish <= wait["end"] <= rec["t"] <= written["t"]
            holds.append({"case": case_name, "held": held, "cap": end, "published": publish,
                          "wait_exit": wait["end"], "record": rec["t"], "written": written["t"]})
assert len(verified) == 7 and measured == 6 and len(holds) == 2
print(json.dumps({"scope": "Isolated exact-code fragments, P4 line-selection model, re-evaluation of saved evidence; no native run or complete sweep",
                  "revision": subprocess.check_output(["git", "rev-parse", revision], cwd=repo).decode().strip(),
                  "sha256": manifest, "range_fragment": fragment,
                  "range_cases": ranges, "line_model": {"raw": raw, "display": display,
                  "raw_selection": raw_index, "display_selection": display_index},
                  "booking": {"initial_version": 7, "same_assumed_value": same,
                              "applied_to_assumed": changed},
                  "saved_native_verified": verified, "saved_assumed_hold_order": holds}, indent=2))
