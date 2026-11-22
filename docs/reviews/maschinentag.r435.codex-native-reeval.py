"""R435: re-evaluate the already recorded P2a run, no native run."""
import json
import sys
import hashlib
from pathlib import Path
sys.path.insert(0, "/tmp/r435/head/scripts")
import native_run as nr
from test_support import native_cases as nc
run = Path("/home/cnc/claude-work/live-tier/20261122T214315-parse-basis")
files, errors = nr._trace_files(run / "logs")
events = [json.loads(l) for _name,_ino,data in files for l in data.splitlines()]
starts = [e for e in events if e.get("tag") == "client.diag" and str(e.get("native_mark", "")).startswith("parse-basis.") and e.get("edge") == "start"]
assert len(starts) == 1
start = starts[0]
window = nc.frame_window(files, start["native_mark"], start["pid"], errors)
assert window["framed"], window
end = next(e for e in events if e.get("native_mark") == start["native_mark"] and e.get("edge") == "end")
readbacks = [e for e in window["events"] if e.get("tag") == "toolsetter.read_back"]
report = json.loads((run / "report.json").read_text())
result = {"run":str(run), "commit":report["commit"],
 "trace_sha256": {name:hashlib.sha256(data).hexdigest() for name,ino,data in files},
 "framed":window["framed"], "native_mark":start["native_mark"], "pid":start["pid"],
 "parse_basis":nc.eval_parse_basis("parse-basis",window,ops=3,quiet_s=next(row["quiet_s"] for row in report["rows"] if row["case"] == "parse-basis")),
 "nice":nc.eval_parse_nice("parse-basis.nice",window),
 "readback_versions":[e.get("version") for e in readbacks],
 "last_readback_to_end_ms":end["t_mono_ms"]-readbacks[-1]["t_mono_ms"],
 "owed_at_end":nc.pb_owed(window["events"]),
 "loss_reports":window["losses"],
 }


# Evidence sensitivity on an in-memory copy only. Never edit the recorded run.
from copy import deepcopy
spawns = [e for e in window["events"] if e.get("tag") == "gcode.spawn_start"]
done = [e for e in window["events"] if e.get("tag") == "gcode.worker_done"]
result["priority_jobs"] = [{"job": s.get("job"), "reason": s.get("reason"), "requested": s.get("nice"),
                            "answers": [d.get("nice_applied") for d in done if d.get("job") == s.get("job")]}
                           for s in spawns]
result["sensitivity"] = []
for d in done:
    job = d["job"]
    damaged = deepcopy(window)
    damaged["events"] = [e for e in damaged["events"]
                         if not(e.get("tag") == "gcode.worker_done" and e.get("job") == job)]
    result["sensitivity"].append({"mutation": "omit_one_worker_done", "job": job,
                                  "expected": "incomplete", "actual": nc.eval_parse_nice("nice", damaged)})
result["original_report_sha256"] = hashlib.sha256((run / "report.json").read_bytes()).hexdigest()
print(json.dumps(result, indent=2))
