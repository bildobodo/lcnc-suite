"""Re-judge a parse-basis native run's stored trace with the CURRENT judges
(offline; no controller, no new run). Also re-judges each damaged variant
Codex R435 used: one gcode.worker_done of a drift job dropped.

  python3 -I reeval_pb.py <tree> <run dir>
"""
import json, os, sys
from pathlib import Path
tree, run = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(tree / "scripts"))
from test_support import native_cases as nc   # noqa: E402

logs = run / "logs"
names = ["trace.ndjson"] + [f"trace.ndjson.{i}" for i in range(1, 6)]
files = []
for n in names:
    p = logs / n
    if p.exists():
        with open(p, "rb") as f:
            st = os.fstat(f.fileno())
            files.append((n, st.st_ino, f.read(st.st_size)))
marks = []
for _n, _i, data in files:
    for line in data.split(b"\n"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        m = str(e.get("native_mark") or "")
        if m.startswith("parse-basis.") and e.get("edge") == "start":
            marks.append((m, e.get("pid")))
token, pid = marks[-1]
window = nc.frame_window(files, token, pid)
report = json.loads((run / "report.json").read_text())
row = next(r for r in report["rows"] if r["case"] == "parse-basis")
basis = nc.eval_parse_basis("parse-basis", window, ops=3, quiet_s=row.get("quiet_s"))
nice = nc.eval_parse_nice("parse-basis.nice", window)
drift_jobs = [e.get("job") for e in window["events"] if e.get("tag") == "gcode.spawn_start"
              and str(e.get("reason")) not in nc.LOAD_REASONS and not e.get("pinned")]
damaged = {}
for j in drift_jobs:
    w = dict(window, events=[e for e in window["events"]
                             if not (e.get("tag") == "gcode.worker_done" and e.get("job") == j)])
    damaged[str(j)] = nc.eval_parse_nice("parse-basis.nice", w)["status"]
print(json.dumps({"what": "offline re-judgement of a stored native run with the current judges",
                  "run": run.name, "commit": report.get("commit"), "framed": window["framed"],
                  "losses": window["losses"], "parse_basis": basis, "parse_basis_nice": nice,
                  "drift_jobs": drift_jobs,
                  "nice_with_one_worker_done_dropped": damaged}, indent=1, default=str))
